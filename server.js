const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Wrap Express with Node HTTP Server for Socket.IO bidirectional communication
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


// Middleware for parsing JSON with a size limit (for base64 images)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from the project directory
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================================================
// SECURITY & DATABASE HELPERS (RBAC)
// ==========================================================================

// Helper: load users
const loadUsers = () => {
  try {
    const usersPath = path.join(__dirname, 'users.json');
    if (fs.existsSync(usersPath)) {
      return JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load users:', err);
  }
  return [];
};

// Helper: save users
const saveUsers = (users) => {
  try {
    const usersPath = path.join(__dirname, 'users.json');
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Failed to save users:', err);
  }
};

// Helper: load chat messages
const loadMessages = () => {
  try {
    const messagesPath = path.join(__dirname, 'chat_messages.json');
    if (fs.existsSync(messagesPath)) {
      return JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
  return [];
};

// Helper: save chat messages
const saveMessages = (messages) => {
  try {
    const messagesPath = path.join(__dirname, 'chat_messages.json');
    fs.writeFileSync(messagesPath, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error('Failed to save messages:', err);
  }
};

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log(`[Socket.IO] A client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// Helper: Broadcast chat messages update in real-time
const broadcastMessageUpdate = () => {
  try {
    const messages = loadMessages();
    io.emit('chat_messages_updated', messages);
    console.log(`[Socket.IO] Broadcasted chat messages updated to all clients.`);
  } catch (err) {
    console.error('[Socket.IO] Broadcast chat messages failed:', err);
  }
};

// Helper: Broadcast user profiles update in real-time
const broadcastProfilesUpdate = () => {
  try {
    const users = loadUsers();
    const profiles = {};
    users.forEach(u => {
      profiles[u.username.toLowerCase()] = {
        nickname: u.nickname || u.username,
        profileImage: u.profileImage || ''
      };
    });
    io.emit('profiles_updated', profiles);
    console.log(`[Socket.IO] Broadcasted user profiles update to all clients.`);
  } catch (err) {
    console.error('[Socket.IO] Broadcast profiles failed:', err);
  }
};

// Helper: save image locally
const saveImageLocally = (base64Data, mimeType) => {
  try {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }
    
    // Determine extension
    let ext = 'png';
    if (mimeType && mimeType.includes('/')) {
      ext = mimeType.split('/')[1];
    }
    if (ext === 'jpeg') ext = 'jpg';
    
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const rand = Math.floor(1000 + Math.random() * 9000);
    const filename = `slip_${timestamp}_${rand}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return filename;
  } catch (err) {
    console.error('Failed to save image locally:', err);
    return null;
  }
};

// Helper: log transaction
const logTransaction = (datetime, transactions, sheetStatus, imageName = null) => {
  try {
    const logPath = path.join(__dirname, 'transactions.json');
    let logs = [];
    if (fs.existsSync(logPath)) {
      logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
    
    transactions.forEach(tx => {
      const txId = 'tx_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
      logs.unshift({
        id: txId,
        datetime,
        slip_date: tx.slip_date || null,
        game: tx.game || 'ไม่ระบุ',
        uid: tx.uid || 'ไม่ระบุ',
        package: tx.package || 'ไม่ระบุ',
        amount: Number(tx.amount) || 0,
        status: tx.status || 'โอนเสร็จ',
        sheetStatus,
        imageName
      });
    });
    
    if (logs.length > 100) {
      logs = logs.slice(0, 100);
    }
    
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('Logging transaction failed:', err);
  }
};

// Helper: Parse DD/MM/YYYY HH:mm to Date object
const parseDateString = (datetimeStr) => {
  if (!datetimeStr) return null;
  const parts = datetimeStr.split(' ');
  const dateParts = parts[0].split('/');
  if (dateParts.length < 3) return null;
  
  let hours = 0;
  let minutes = 0;
  if (parts[1]) {
    const timeParts = parts[1].split(':');
    hours = Number(timeParts[0]) || 0;
    minutes = Number(timeParts[1]) || 0;
  }
  return new Date(Number(dateParts[2]), Number(dateParts[1]) - 1, Number(dateParts[0]), hours, minutes);
};

// Helper: Auto-cleanup old transaction logs & uploaded slip images
const cleanupOldTransactions = () => {
  try {
    const period = process.env.AUTO_DELETE_PERIOD || 'disabled';
    if (period === 'disabled' || period === '0') return;

    // Parse duration value and unit suffix (e.g. "15m", "1h", "1d", "1M")
    const match = period.match(/^(\d+)([mhdM]$)/);
    
    let durationMs = 0;
    let label = '';

    if (!match) {
      // Fallback for legacy numeric month configuration
      const monthsLegacy = Number(period);
      if (!isNaN(monthsLegacy) && monthsLegacy > 0) {
        durationMs = monthsLegacy * 30 * 24 * 60 * 60 * 1000;
        label = `legacy ${monthsLegacy} month(s)`;
      } else {
        return;
      }
    } else {
      const value = Number(match[1]);
      const unit = match[2];

      if (unit === 'm') {
        durationMs = value * 60 * 1000;
        label = `${value} minute(s)`;
      } else if (unit === 'h') {
        durationMs = value * 60 * 60 * 1000;
        label = `${value} hour(s)`;
      } else if (unit === 'd') {
        durationMs = value * 24 * 60 * 60 * 1000;
        label = `${value} day(s)`;
      } else if (unit === 'M') {
        durationMs = value * 30 * 24 * 60 * 60 * 1000;
        label = `${value} month(s)`;
      }
    }

    if (durationMs <= 0) return;

    const logPath = path.join(__dirname, 'transactions.json');
    if (!fs.existsSync(logPath)) return;

    const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const now = new Date();
    
    // Calculate the threshold time
    const thresholdTime = now.getTime() - durationMs;

    let updatedLogs = [];
    let deletedCount = 0;

    logs.forEach(log => {
      const txDate = parseDateString(log.datetime);
      if (txDate && txDate.getTime() < thresholdTime) {
        // Delete image file if exists
        if (log.imageName) {
          const imagePath = path.join(__dirname, 'uploads', log.imageName);
          if (fs.existsSync(imagePath)) {
            try {
              fs.unlinkSync(imagePath);
            } catch (err) {
              console.error(`Failed to delete old image ${log.imageName}:`, err);
            }
          }
        }
        deletedCount++;
      } else {
        updatedLogs.push(log);
      }
    });

    if (deletedCount > 0) {
      fs.writeFileSync(logPath, JSON.stringify(updatedLogs, null, 2));
      console.log(`[Auto-Cleanup] Successfully cleaned up ${deletedCount} transaction logs older than ${label}.`);
    }
  } catch (err) {
    console.error('Error during auto-cleanup of transactions:', err);
  }
};

// Helper: load transactions
const loadTransactions = () => {
  try {
    // Run auto-cleanup check first
    cleanupOldTransactions();

    const logPath = path.join(__dirname, 'transactions.json');
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load transactions:', err);
  }
  return [];
};

// Helper: save env file
const saveEnvConfig = (newConfig) => {
  try {
    let envContent = `# รหัสผ่านสำหรับการเข้าสู่ใช้งานเว็บไซต์ (Access Password)
ACCESS_PASSWORD=${process.env.ACCESS_PASSWORD || 'MT_VIP_TOPUP'}

# พอร์ตสำหรับรันเซิร์ฟเวอร์หลังบ้าน
PORT=${process.env.PORT || 3000}

# ข้อมูลการตั้งค่าระบบความปลอดภัย (ย้ายมาไว้ที่นี่เพื่อความปลอดภัย)
# ใส่ API Key ของ Gemini (แนะนำ) หรือ OpenAI ลงช่องใดช่องหนึ่ง
GEMINI_API_KEY=${newConfig.GEMINI_API_KEY || ''}
OPENAI_API_KEY=${newConfig.OPENAI_API_KEY || ''}

# URL ของ Google Sheets Web App ที่ได้จาก Apps Script
WEBAPP_URL=${newConfig.WEBAPP_URL || ''}

# รุ่น AI เริ่มต้นที่ใช้ประมวลผล (เช่น gemini-2.5-flash หรือ gpt-4o-mini)
DEFAULT_MODEL=${newConfig.DEFAULT_MODEL || 'gemini-2.5-flash'}

# การตั้งค่าช่วงเวลาลบรายการธุรกรรมอัติโนมัติ (disabled หรือจำนวนเดือน เช่น 1, 3, 6, 12)
AUTO_DELETE_PERIOD=${newConfig.AUTO_DELETE_PERIOD || 'disabled'}
`;
    fs.writeFileSync(path.join(__dirname, '.env'), envContent);
    
    // Live update process.env variables (Hot Reload!)
    process.env.GEMINI_API_KEY = newConfig.GEMINI_API_KEY || '';
    process.env.OPENAI_API_KEY = newConfig.OPENAI_API_KEY || '';
    process.env.WEBAPP_URL = newConfig.WEBAPP_URL || '';
    process.env.DEFAULT_MODEL = newConfig.DEFAULT_MODEL || 'gemini-2.5-flash';
    process.env.AUTO_DELETE_PERIOD = newConfig.AUTO_DELETE_PERIOD || 'disabled';
  } catch (err) {
    console.error('Failed to write .env config:', err);
    throw err;
  }
};

// Authentication Middleware: All authenticated users (head-admin & operator)
const checkAuth = (req, res, next) => {
  const token = req.headers['authorization'] || req.headers['x-access-key'];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: ไม่ได้แนบ Token การเข้าใช้งาน' });
  }
  
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [username, role, password] = decoded.split(':');
    
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.role === role && u.password === password);
    
    if (user) {
      req.user = user; // Attach user information to request
      return next();
    }
  } catch (e) {
    // Fail silently to fall through to 401
  }
  
  return res.status(401).json({ error: 'Unauthorized: สิทธิ์การเข้าใช้งานไม่ถูกต้อง หรือเซสชันหมดอายุ' });
};

// Admin-Only Authentication Middleware
const checkAdminAuth = (req, res, next) => {
  checkAuth(req, res, () => {
    if (req.user && req.user.role === 'head-admin') {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: คุณไม่มีสิทธิ์ของผู้ดูแลระบบสูงสุด (Head Admin) ในการจัดการส่วนนี้' });
  });
};

// ==========================================================================
// ROUTES
// ==========================================================================

// Endpoint: check if backend keys are configured
app.get('/api/config', (req, res) => {
  res.json({
    status: 'configured',
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    hasWebappUrl: !!process.env.WEBAPP_URL,
    defaultModel: process.env.DEFAULT_MODEL || 'gemini-2.5-flash',
    requiresPassword: true // Set to true as we now always have RBAC active when backend runs
  });
});

// Endpoint: Verify Username and Password
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน!' });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
  
  if (user) {
    // Generate secure Base64 Token
    const token = Buffer.from(`${user.username}:${user.role}:${user.password}`).toString('base64');
    return res.json({
      status: 'success',
      username: user.username,
      role: user.role,
      token: token,
      nickname: user.nickname || user.username,
      profileImage: user.profileImage || ''
    });
  }
  
  res.status(401).json({ error: 'ชื่อผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง!' });
});

// Endpoint: Verify Token
app.get('/api/verify-token', checkAuth, (req, res) => {
  res.json({ 
    status: 'valid', 
    username: req.user.username, 
    role: req.user.role,
    nickname: req.user.nickname || req.user.username,
    profileImage: req.user.profileImage || ''
  });
});

// Endpoint: Get all chat messages
app.get('/api/messages', checkAuth, (req, res) => {
  const messages = loadMessages();
  res.json({ status: 'success', messages });
});

// Endpoint: Clear all chat messages (Head Admin Only)
app.post('/api/messages/clear', checkAdminAuth, (req, res) => {
  saveMessages([]);
  broadcastMessageUpdate(); // Emit to all sockets
  res.json({ status: 'success', message: 'ล้างประวัติการสนทนาเรียบร้อยแล้ว!' });
});

// Endpoint: Get all users' public profiles (nickname & profileImage)
app.get('/api/users/profiles', checkAuth, (req, res) => {
  const users = loadUsers();
  const profiles = {};
  users.forEach(u => {
    profiles[u.username.toLowerCase()] = {
      nickname: u.nickname || u.username,
      profileImage: u.profileImage || ''
    };
  });
  res.json({ status: 'success', profiles });
});

// Endpoint: Text Chat (Protected - Direct human-to-human chat room)
app.post('/api/chat', checkAuth, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'กรุณากรอกข้อความส่งแชท!' });
    }

    // Save and broadcast user message immediately in real-time
    const messages = loadMessages();
    const userMsgId = 'msg_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
    
    messages.push({
      id: userMsgId,
      sender: 'user',
      username: req.user.username,
      nickname: req.user.nickname || req.user.username,
      profileImage: req.user.profileImage || '',
      text: message,
      imageSrc: null,
      timestamp: Date.now()
    });
    
    saveMessages(messages);
    broadcastMessageUpdate(); // Instant real-time sync for everyone

    res.json({ status: 'success', message: 'ส่งข้อความเรียบร้อยแล้ว' });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Save multi-image user message (Protected - groups multi-uploads side-by-side)
app.post('/api/messages/user-images', checkAuth, async (req, res) => {
  try {
    const { images, userText } = req.body;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'กรุณาแนบรูปภาพอย่างน้อย 1 รูป!' });
    }

    const savedPaths = [];
    images.forEach(img => {
      if (img.base64) {
        const savedFilename = saveImageLocally(img.base64, img.mimeType);
        if (savedFilename) {
          savedPaths.push(`/uploads/${savedFilename}`);
        }
      }
    });

    const messages = loadMessages();
    const userMsgId = 'msg_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
    
    messages.push({
      id: userMsgId,
      sender: 'user',
      username: req.user.username,
      nickname: req.user.nickname || req.user.username,
      profileImage: req.user.profileImage || '',
      text: userText || `อัปโหลดรูปภาพจำนวน ${images.length} รูปเพื่อวิเคราะห์และบันทึกข้อมูลเข้าร้านเติมเงิน`,
      imageSrc: savedPaths,
      timestamp: Date.now()
    });

    saveMessages(messages);
    broadcastMessageUpdate(); // Instant real-time sync for everyone

    res.json({ 
      status: 'success', 
      messageId: userMsgId, 
      imagePaths: savedPaths 
    });

  } catch (error) {
    console.error('Multi-image user message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Multimodal OCR & Sheets Upload (Protected)
app.post('/api/ocr', checkAuth, async (req, res) => {
  try {
    const { image, userText, model, skipUserMessage, savedImagePath } = req.body;
    const activeModel = process.env.DEFAULT_MODEL || model || 'gemini-2.5-flash';
    const isModelOpenai = activeModel.startsWith('gpt');
    const apiKey = isModelOpenai ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
    const webappUrl = process.env.WEBAPP_URL;

    if (!apiKey) {
      return res.status(400).json({ error: `เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า API Key สำหรับรุ่น: ${activeModel}` });
    }

    // Save image locally if present and not skipping user message
    let savedImageName = null;
    if (savedImagePath) {
      savedImageName = savedImagePath.split('/').pop();
    } else if (image && image.base64) {
      savedImageName = saveImageLocally(image.base64, image.mimeType);
    }

    if (!skipUserMessage) {
      // 1. Save and broadcast user's OCR request message immediately
      const chatMsgs = loadMessages();
      const userMsgId = 'msg_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
      
      chatMsgs.push({
        id: userMsgId,
        sender: 'user',
        username: req.user.username,
        nickname: req.user.nickname || req.user.username,
        profileImage: req.user.profileImage || '',
        text: userText || `อัปโหลดรูปภาพเพื่อวิเคราะห์และบันทึกข้อมูลเข้าร้านเติมเงิน`,
        imageSrc: savedImageName ? `/uploads/${savedImageName}` : null,
        timestamp: Date.now()
      });
      
      saveMessages(chatMsgs);
      broadcastMessageUpdate(); // Instant sync
    }

    const systemPrompt = `
คุณคือผู้ช่วย AI อัจฉริยะที่เชี่ยวชาญด้านการสกัดข้อความจากภาพสลิปโอนเงินหรือภาพประวัติการทำรายการเติมเกมออนไลน์
1. **สำคัญมาก**: ดึงรายละเอียดการทำรายการเติมเกมทั้งหมดออกมา ห้ามทักทาย ห้ามพูดคุย ห้ามอธิบาย ห้ามเขียนข้อความเกริ่นนำหรือสรุปใดๆ ทั้งสิ้น
2. ใน 1 รูปภาพอาจจะมีสลิปหรือรายการเติมเงินหลายรายการพร้อมๆ กัน ให้คุณสกัดข้อมูลของทุกรายการออกมาให้ครบถ้วน ห้ามข้ามเด็ดขาด
3. ข้อมูลที่ต้องสกัดสำหรับแต่ละรายการ:
   - เกม (Game): ชื่อเกม เช่น VALORANT, ROV, Free Fire, PUBG (หากไม่ระบุในภาพตรงๆ ให้คาดเดาจากสกุลเงินในสลิป เช่น VP = VALORANT, คูปอง/Coupon = ROV, UC = PUBG)
   - UID: ชื่อไอดีหรือหมายเลขไอดีของผู้เล่น เช่น #CapyBaraBoy#L0505
   - แพ็กเกจ (Package): จำนวนแพ็กเกจที่เติม เช่น 475 VP, 2050 VP, 90 คูปอง
   - ยอดเงิน (Amount): จำนวนเงินที่เป็นยอดโอนในภาพสลิป ให้เอาเฉพาะตัวเลข เช่น 130, 520 (ห้ามใส่สัญลักษณ์ทางการเงินหรือคำว่าบาท)
   - สถานะ (Status): สถานะการทำรายการ ให้ใช้คำว่า "โอนเสร็จ" เสมอในกรณีที่โอนเงินสำเร็จ
   - วันที่ในสลิป/รูปภาพ (slip_date): สกัดวันที่และเวลาการทำรายการโอนเงินหรือชำระเงินที่ระบุในสลิป/รูปภาพนั้นๆ โดยแปลงให้เป็นฟอร์แมต "DD/MM/YYYY HH:mm" เท่านั้น (เช่น "29/05/2026 11:24") หากสลิปใช้ชื่อเดือนภาษาอังกฤษ (เช่น May) หรือภาษาไทย (เช่น พ.ค.) ให้แปลงเป็นตัวเลขเดือน (เช่น May/พ.ค. -> 05) ให้ถูกต้อง หากไม่มีระบุไว้ในรายการนั้นๆ หรือไม่ชัดเจนให้ใส่เป็น null

4. ผลลัพธ์ของคุณต้องมี **เฉพาะ** บล็อกข้อมูล JSON Array ด้านล่างนี้เท่านั้น ห้ามมีคำอธิบายใดๆ นอกบล็อกเด็ดขาด:

---SHEET_DATA_START---
[
  {
    "game": "[ชื่อเกม]",
    "uid": "[UID ของผู้เล่น]",
    "package": "[แพ็กเกจ]",
    "amount": [ยอดเงินตัวเลขเท่านั้น],
    "status": "โอนเสร็จ",
    "slip_date": "[วันที่สลิปในฟอร์แมต DD/MM/YYYY HH:mm หรือ null]"
  }
]
---SHEET_DATA_END---
    `;

    const finalPrompt = `${systemPrompt}\nคำขอเพิ่มเติมจากผู้ใช้: ${userText}`;
    let rawAiResult = '';

    try {
      if (isModelOpenai) {
        const openaiUrl = 'https://api.openai.com/v1/chat/completions';
        const payload = {
          model: activeModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: finalPrompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${image.mimeType};base64,${image.base64}`
                  }
                }
              ]
            }
          ]
        };

        const response = await fetch(openaiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorJson = await response.json().catch(() => ({}));
          throw new Error(errorJson.error?.message || `OpenAI HTTP error ${response.status}`);
        }

        const responseData = await response.json();
        rawAiResult = responseData.choices?.[0]?.message?.content || '';
      } else {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [{
            parts: [
              { text: finalPrompt },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.base64
                }
              }
            ]
          }]
        };

        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorJson = await response.json().catch(() => ({}));
          throw new Error(errorJson.error?.message || `Gemini HTTP error ${response.status}`);
        }

        const responseData = await response.json();
        rawAiResult = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      if (!rawAiResult) {
        throw new Error('ไม่ได้รับการตอบกลับข้อความจาก AI');
      }

      // 2. Parse transactions data
      let transactions = [];
      const dataMatch = rawAiResult.match(/---SHEET_DATA_START---([\s\S]*?)---SHEET_DATA_END---/);
      
      if (dataMatch) {
        try {
          const jsonData = JSON.parse(dataMatch[1].trim());
          transactions = Array.isArray(jsonData) ? jsonData : [jsonData];
        } catch (jsonErr) {
          console.error("Failed to parse JSON sheet data:", jsonErr);
        }
      }

      // 3. Send to Google Sheets Web App if URL is configured
      let sheetUploadStatus = 'skipped';
      let sheetUploadError = null;

      // Create current formatted datetime
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const formattedDateTime = `${day}/${month}/${year} ${hours}:${minutes}`;

      if (webappUrl && transactions.length > 0) {
        try {
          const sheetPayload = {
            datetime: formattedDateTime,
            transactions: transactions,
            base64: image.base64,
            mimeType: image.mimeType
          };

          await fetch(webappUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain'
            },
            body: JSON.stringify(sheetPayload)
          });

          sheetUploadStatus = 'success';
        } catch (sheetError) {
          console.error('Google Sheet Upload failed:', sheetError);
          sheetUploadStatus = 'failed';
          sheetUploadError = sheetError.message;
        }
      } else if (!webappUrl) {
        sheetUploadStatus = 'no_url';
      }

      // 4. Save and broadcast successful bot response
      const activeMsgs = loadMessages();
      const botMsgId = 'msg_' + (Date.now() + 1) + '_' + Math.floor(1000 + Math.random() * 9000);
      
      // Clean technical tags from text if exists
      let botText = rawAiResult || '';
      if (botText) {
        botText = botText.replace(/---SHEET_DATA_START---[\s\S]*?---SHEET_DATA_END---/g, '').trim();
      }
      
      activeMsgs.push({
        id: botMsgId,
        sender: 'bot',
        username: 'bot',
        nickname: 'MT-TOPUP AI',
        profileImage: '',
        text: botText,
        imageSrc: null,
        transactions: transactions,
        sheetStatus: sheetUploadStatus,
        sheetError: sheetUploadError,
        timestamp: Date.now() + 1
      });
      
      saveMessages(activeMsgs);
      broadcastMessageUpdate();

      // Log transaction to JSON database file for Admin Dashboard view!
      if (transactions.length > 0) {
        logTransaction(formattedDateTime, transactions, sheetUploadStatus, savedImageName);
      }

      res.json({
        text: rawAiResult,
        transactions: transactions,
        sheetStatus: sheetUploadStatus,
        sheetError: sheetUploadError
      });

    } catch (apiError) {
      console.error('OCR API Error details:', apiError);
      
      let friendlyError = `เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพ: ${apiError.message}`;
      if (apiError.message.includes('quota') || apiError.message.includes('Rate limit') || apiError.message.includes('429')) {
        friendlyError = `**⚠️ โควต้าการใช้งานโมเดลเต็มชั่วคราว (Rate Limit / Quota Exceeded)**\n\nบัญชีแบบฟรีของ Gemini API มีการจำกัดการใช้งาน กรุณารอสักครู่แล้วลองใหม่ หรือสลับรุ่นโมเดลเพื่อใช้งานต่อครับ`;
      }
      
      // Save and broadcast error bot response
      const activeMsgs = loadMessages();
      const botMsgId = 'msg_' + (Date.now() + 1) + '_' + Math.floor(1000 + Math.random() * 9000);
      
      activeMsgs.push({
        id: botMsgId,
        sender: 'bot',
        username: 'bot',
        nickname: 'MT-TOPUP AI',
        profileImage: '',
        text: friendlyError,
        imageSrc: null,
        timestamp: Date.now() + 1
      });
      
      saveMessages(activeMsgs);
      broadcastMessageUpdate();

      res.status(500).json({ error: friendlyError });
    }

  } catch (error) {
    console.error('OCR overall error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================================================
// ADMIN ONLY ENDPOINTS (Protected by checkAdminAuth)
// ==========================================================================

// GET config values
app.get('/api/admin/config', checkAdminAuth, (req, res) => {
  res.json({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    WEBAPP_URL: process.env.WEBAPP_URL || '',
    DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gemini-2.5-flash',
    AUTO_DELETE_PERIOD: process.env.AUTO_DELETE_PERIOD || 'disabled'
  });
});

// POST save config values (Hot Reload)
app.post('/api/admin/save-config', checkAdminAuth, (req, res) => {
  try {
    const { GEMINI_API_KEY, OPENAI_API_KEY, WEBAPP_URL, DEFAULT_MODEL, AUTO_DELETE_PERIOD } = req.body;
    saveEnvConfig({ GEMINI_API_KEY, OPENAI_API_KEY, WEBAPP_URL, DEFAULT_MODEL, AUTO_DELETE_PERIOD });
    
    // Trigger cleanup immediately if config changed
    cleanupOldTransactions();
    
    res.json({ status: 'success', message: 'บันทึกการตั้งค่าระบบความปลอดภัยใหม่และเปิดใช้ระบบ Hot-Reload สำเร็จ!' });
  } catch (err) {
    res.status(500).json({ error: `ไม่สามารถเขียนไฟล์ตั้งค่าหลังบ้านได้: ${err.message}` });
  }
});

// GET list of accounts
app.get('/api/admin/accounts', checkAdminAuth, (req, res) => {
  const users = loadUsers();
  // Map out to prevent sending plain password in response if not strictly necessary
  const sanitizedUsers = users.map(u => ({ 
    username: u.username, 
    role: u.role,
    nickname: u.nickname || u.username,
    profileImage: u.profileImage || ''
  }));
  res.json(sanitizedUsers);
});

// POST add new account
app.post('/api/admin/accounts/add', checkAdminAuth, (req, res) => {
  const { username, password, role, nickname, profileImage } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูล Username, Password และสิทธิ์ ให้ครบถ้วน!' });
  }

  const users = loadUsers();
  const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: `ชื่อผู้ใช้ "${username}" มีอยู่ในระบบเรียบร้อยแล้ว!` });
  }

  users.push({ 
    username, 
    password, 
    role,
    nickname: nickname || username,
    profileImage: profileImage || ''
  });
  saveUsers(users);
  res.json({ status: 'success', message: `เพิ่มบัญชีสมาชิก "${username}" ในบทบาท ${role} เรียบร้อยแล้ว!` });
});

// POST change account password
app.post('/api/admin/accounts/change-password', checkAdminAuth, (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ใช้งานและรหัสผ่านใหม่!' });
  }

  let users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (!user) {
    return res.status(404).json({ error: 'ไม่พบบัญชีสมาชิกดังกล่าวในระบบ' });
  }

  // Update password
  user.password = newPassword;
  saveUsers(users);
  
  res.json({ status: 'success', message: `เปลี่ยนรหัสผ่านให้กับบัญชี "${username}" เรียบร้อยแล้ว!` });
});

// POST update/edit account details (unified edit for both admin and self-profile for operators)
app.post('/api/admin/accounts/update', checkAuth, (req, res) => {
  const { username, nickname, password, role, profileImage } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ใช้งานที่ต้องการอัปเดต!' });
  }

  // Security Check: Operator can ONLY edit their own account!
  if (req.user.role !== 'head-admin' && req.user.username.toLowerCase() !== username.toLowerCase()) {
    return res.status(403).json({ error: 'Forbidden: คุณไม่มีสิทธิ์แก้ไขข้อมูลบัญชีของผู้อื่น' });
  }

  let users = loadUsers();
  const userIndex = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (userIndex === -1) {
    return res.status(404).json({ error: 'ไม่พบข้อมูลบัญชีผู้ใช้งานในระบบ' });
  }

  const user = users[userIndex];

  // Update nickname
  if (nickname !== undefined) user.nickname = nickname;
  
  // Update password if provided
  if (password && password.trim().length >= 4) {
    user.password = password.trim();
  } else if (password && password.trim().length > 0) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร!' });
  }

  // Update role (ONLY Head Admin can change roles!)
  if (role !== undefined) {
    if (req.user.role === 'head-admin') {
      // Ensure we don't demote the last head admin
      if (user.role === 'head-admin' && role !== 'head-admin') {
        const headAdmins = users.filter(u => u.role === 'head-admin');
        if (headAdmins.length <= 1) {
          return res.status(400).json({ error: 'ไม่สามารถเปลี่ยนบทบาทของประธานแอดมินคนสุดท้ายได้! ต้องมีอย่างน้อย 1 คนในระบบ' });
        }
      }
      user.role = role;
    }
  }

  // Update profile image
  if (profileImage !== undefined) {
    user.profileImage = profileImage;
  }

  saveUsers(users);
  broadcastProfilesUpdate(); // Emit to all sockets

  // Generate a new auth token if the current logged-in user edited their own details
  let newToken = null;
  if (req.user.username.toLowerCase() === username.toLowerCase()) {
    newToken = Buffer.from(`${user.username}:${user.role}:${user.password}`).toString('base64');
  }

  res.json({ 
    status: 'success', 
    message: 'อัปเดตข้อมูลบัญชีสำเร็จเรียบร้อยแล้ว!',
    newToken: newToken,
    nickname: user.nickname || user.username,
    profileImage: user.profileImage || ''
  });
});

// DELETE remove account
app.delete('/api/admin/accounts/delete', checkAdminAuth, (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ใช้งานที่จะลบ!' });
  }

  // Prevent admin from deleting themselves
  if (username.toLowerCase() === req.user.username.toLowerCase()) {
    return res.status(400).json({ error: 'คุณไม่สามารถลบบัญชีของตัวคุณเองที่กำลังใช้งานอยู่ได้!' });
  }

  let users = loadUsers();
  const originalLength = users.length;
  
  // Ensure we do not delete the last Head Admin
  const adminToDelete = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (adminToDelete && adminToDelete.role === 'head-admin') {
    const headAdmins = users.filter(u => u.role === 'head-admin');
    if (headAdmins.length <= 1) {
      return res.status(400).json({ error: 'ไม่สามารถลบผู้ดูแลระบบสูงสุดคนสุดท้ายได้! ต้องมีอย่างน้อย 1 คนในระบบ' });
    }
  }

  users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
  
  if (users.length === originalLength) {
    return res.status(404).json({ error: 'ไม่พบบัญชีสมาชิกดังกล่าวในฐานข้อมูล' });
  }

  saveUsers(users);
  res.json({ status: 'success', message: `ลบบัญชีสมาชิก "${username}" ออกจากระบบเรียบร้อยแล้ว!` });
});

// POST change current user's own password
app.post('/api/user/change-password', checkAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'กรุณาระบุรหัสผ่านปัจจุบันและรหัสผ่านใหม่!' });
  }

  const trimmed = newPassword.trim();
  if (trimmed.length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร!' });
  }

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === req.user.username.toLowerCase());

  if (!user) {
    return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้ในระบบ' });
  }

  // Verify current password
  if (user.password !== currentPassword) {
    return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง!' });
  }

  // Update password
  user.password = trimmed;
  saveUsers(users);

  // Generate a new secure Base64 Token
  const newToken = Buffer.from(`${user.username}:${user.role}:${user.password}`).toString('base64');

  res.json({
    status: 'success',
    message: 'แก้ไขรหัสผ่านของคุณเรียบร้อยแล้ว!',
    newToken: newToken
  });
});

// GET recent transaction logs
app.get('/api/admin/transactions', checkAdminAuth, (req, res) => {
  const logs = loadTransactions();
  res.json(logs);
});

// DELETE transaction log (Protected by checkAdminAuth & password validation)
app.delete('/api/admin/transactions/delete', checkAdminAuth, (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) {
    return res.status(400).json({ error: 'กรุณาระบุ ID รายการ และรหัสผ่านเพื่อลบ!' });
  }

  // Verify the admin's password matches
  if (password !== req.user.password) {
    return res.status(401).json({ error: 'รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง! ไม่สามารถลบรายการได้' });
  }

  try {
    const logPath = path.join(__dirname, 'transactions.json');
    if (fs.existsSync(logPath)) {
      let logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      const originalLength = logs.length;
      
      const txToDelete = logs.find(log => log.id === id);
      if (txToDelete && txToDelete.imageName) {
        const imagePath = path.join(__dirname, 'uploads', txToDelete.imageName);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }

      logs = logs.filter(log => log.id !== id);
      
      if (logs.length === originalLength) {
        return res.status(404).json({ error: 'ไม่พบรายการธุรกรรมดังกล่าวในระบบ' });
      }

      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
      return res.json({ status: 'success', message: 'ลบรายการธุรกรรมและรูปภาพสลิปเรียบร้อยแล้ว!' });
    }
    return res.status(404).json({ error: 'ไม่พบไฟล์ฐานข้อมูลธุรกรรม' });
  } catch (err) {
    console.error('Delete transaction failed:', err);
    res.status(500).json({ error: `ไม่สามารถลบรายการได้: ${err.message}` });
  }
});

// Serve index.html as fallback for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`   MT-TOPUP AI Server is running securely!`);
  console.log(`   Local URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
  
  // Run initial auto-cleanup check on startup
  cleanupOldTransactions();
});

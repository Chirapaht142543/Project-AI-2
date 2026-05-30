// ==========================================================================
// STATE MANAGEMENT & LOCAL STORAGE
// ==========================================================================
let savedApiKey = '';
let savedWebappUrl = '';
let savedModel = 'gemini-2.5-flash';
let savedTheme = 'dark';
let socket = null;

try {
  savedApiKey = localStorage.getItem('vision_sheet_gemini_key') || '';
  savedWebappUrl = localStorage.getItem('vision_sheet_webapp_url') || '';
  savedModel = localStorage.getItem('vision_sheet_model') || 'gemini-2.5-flash';
  savedTheme = localStorage.getItem('vision_sheet_theme') || 'dark';
} catch (e) {
  console.warn('LocalStorage is disabled or not accessible:', e);
}

const STATE = {
  apiKey: savedApiKey,
  webappUrl: savedWebappUrl,
  model: savedModel,
  theme: savedTheme,
  currentImages: [], // Stores array of { base64: '', mimeType: '', name: '', size: '', dataUrl: '' }
  chatHistory: [], // To maintain context for standard chats
  useBackend: false,
  isSendingMessage: false,
  localMessagesCount: 0
};

// ==========================================================================
// DOM ELEMENTS
// ==========================================================================
const elements = {
  apiKeyInput: document.getElementById('api-key-input'),
  webappUrlInput: document.getElementById('webapp-url-input'),
  modelSelect: document.getElementById('model-select'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  statusGemini: document.getElementById('status-gemini'),
  statusSheet: document.getElementById('status-sheet'),
  btnThemeToggle: document.getElementById('btn-theme-toggle'),
  themeToggleText: document.getElementById('theme-toggle-text'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  chatMessagesBox: document.getElementById('chat-messages-box'),
  imagePreviewPanel: document.getElementById('image-preview-panel'),
  btnCancelImage: document.getElementById('btn-cancel-image'),
  previewBodyContainer: document.getElementById('preview-body-container'),
  fileUploader: document.getElementById('file-uploader'),
  btnUploadTrigger: document.getElementById('btn-upload-trigger'),
  textInput: document.getElementById('text-input'),
  chatInputForm: document.getElementById('chat-input-form'),
  btnSend: document.getElementById('btn-send'),
  btnSidebarToggle: document.getElementById('btn-sidebar-toggle'),
  btnSidebarClose: document.getElementById('btn-sidebar-close'),
  sidebar: document.querySelector('.sidebar'),
  // Change Profile elements
  btnChangePassword: document.getElementById('btn-change-password'),
  changePasswordModal: document.getElementById('change-password-modal'),
  changePasswordForm: document.getElementById('change-password-form'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnCancelPassword: document.getElementById('btn-cancel-password'),
  profileUsernameInput: document.getElementById('profile-username'),
  profileNicknameInput: document.getElementById('profile-nickname'),
  newPasswordInput: document.getElementById('new-password-input'),
  profileAvatarPreview: document.getElementById('profile-avatar-preview'),
  profileAvatarPlaceholder: document.getElementById('profile-avatar-placeholder'),
  profileAvatarFile: document.getElementById('profile-avatar-file'),
  profileClearAvatarBtn: document.getElementById('profile-clear-avatar-btn')
};

// ==========================================================================
// APP INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for PWA support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('Service Worker Registered Successfully!', reg))
      .catch(err => console.log('Service Worker Registration Failed: ', err));
  }

  // Load saved configurations into Inputs
  if (STATE.apiKey) elements.apiKeyInput.value = STATE.apiKey;
  if (STATE.webappUrl) elements.webappUrlInput.value = STATE.webappUrl;
  if (STATE.model) elements.modelSelect.value = STATE.model;
  
  // Apply saved theme
  applyTheme(STATE.theme);
  
  // Setup all event listeners
  setupEventListeners();
  
  // Load saved chat HTML and chatHistory context if exists
  try {
    const savedChatHtml = localStorage.getItem('vision_sheet_chat_html');
    if (savedChatHtml) {
      elements.chatMessagesBox.innerHTML = savedChatHtml;
      // Remove any leftover typing indicators
      const indicators = elements.chatMessagesBox.querySelectorAll('.typing-indicator');
      indicators.forEach(ind => {
        const parent = ind.closest('.message');
        if (parent) parent.remove();
      });
      // Remove spinner on any stuck "working" badges
      const workingBadges = elements.chatMessagesBox.querySelectorAll('.status-badge.working');
      workingBadges.forEach(badge => {
        badge.className = 'status-badge error';
        badge.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> การทำงานหยุดชะงัก (หน้าเว็บถูกโหลดใหม่)';
      });
      
      // Defer scroll to bottom to let DOM render completely
      setTimeout(() => {
        scrollToBottom();
      }, 50);
      
      // Update all chat messages avatars and nicknames to match current session
      updateChatAvatarsAndNicknames();
    }

    const savedChatHistory = localStorage.getItem('vision_sheet_chat_history');
    if (savedChatHistory) {
      STATE.chatHistory = JSON.parse(savedChatHistory) || [];
    }
  } catch (e) {
    console.error('Failed to load chat history or HTML from localStorage:', e);
  }
  
  // Check if Backend server is running and configured
  checkBackendConfiguration();
  
  // Auto-resize the input text area initially
  autoResizeTextArea();
});

async function checkBackendConfiguration() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = await res.json();
      STATE.useBackend = true;
      
      const badge = document.getElementById('backend-status-badge');
      if (badge) badge.classList.remove('hidden');
      
      // 1. Password Protection Check & Redirect
      if (config.requiresPassword) {
        const savedPass = sessionStorage.getItem('access_password');
        
        if (!savedPass) {
          // No saved password, redirect to login page
          window.location.href = '/login.html';
          return;
        } else {
          // Verify saved password (token)
          const loginVerify = await verifyAccessPassword(savedPass);
          if (!loginVerify) {
            sessionStorage.removeItem('access_password');
            sessionStorage.removeItem('access_role');
            sessionStorage.removeItem('access_username');
            window.location.href = '/login.html';
            return;
          }
          
          // 2. Role-Based Access Control (RBAC): Show admin options only for Head Admins
          const role = sessionStorage.getItem('access_role');
          const adminLinkBox = document.getElementById('admin-link-box');
          if (role === 'head-admin') {
            if (adminLinkBox) adminLinkBox.classList.remove('hidden');
            if (elements.btnClearHistory) elements.btnClearHistory.classList.remove('hidden');
          } else {
            if (adminLinkBox) adminLinkBox.classList.add('hidden');
            if (elements.btnClearHistory) elements.btnClearHistory.classList.add('hidden');
          }
        }
      }
      
      if (config.hasGeminiKey || config.hasOpenaiKey) {
        elements.apiKeyInput.value = '••••••••••••••••••••';
        elements.apiKeyInput.disabled = true;
        elements.apiKeyInput.placeholder = 'เซิร์ฟเวอร์ตั้งค่ากุญแจความปลอดภัยแล้ว';
        STATE.apiKey = 'backend-secured';
        
        // Hide password toggle button since it's disabled
        const toggleBtn = elements.apiKeyInput.parentElement.querySelector('.btn-toggle-password');
        if (toggleBtn) toggleBtn.style.display = 'none';
      }
      
      if (config.hasWebappUrl) {
        elements.webappUrlInput.value = 'https://script.google.com/macros/s/backend-secured/exec';
        elements.webappUrlInput.disabled = true;
        elements.webappUrlInput.placeholder = 'เซิร์ฟเวอร์ตั้งค่าชีตแล้ว';
        STATE.webappUrl = 'backend-secured';
      }
      
      // Initialize Socket.IO connection and start polling fallback
      if (STATE.useBackend) {
        initializeSocketIO();
        syncChatMessages();
        setInterval(syncChatMessages, 3000);
      }

      // Update UI Status indicators
      updateStatusIndicators();
    } else {
      STATE.useBackend = false;
      updateStatusIndicators();
    }
  } catch (err) {
    console.log('Running in client-only fallback mode (Backend server offline):', err);
    STATE.useBackend = false;
    updateStatusIndicators();
  }
}

async function verifyAccessPassword(token) {
  try {
    const response = await fetch('/api/verify-token', {
      method: 'GET',
      headers: {
        'Authorization': token
      }
    });
    if (response.ok) {
      const data = await response.json();
      sessionStorage.setItem('access_role', data.role);
      sessionStorage.setItem('access_username', data.username);
      sessionStorage.setItem('access_nickname', data.nickname || data.username);
      sessionStorage.setItem('access_profile_image', data.profileImage || '');
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ==========================================================================
// THEME MANAGEMENT
// ==========================================================================
function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
    elements.themeToggleText.textContent = 'โหมดกลางคืน';
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
    elements.themeToggleText.textContent = 'โหมดกลางวัน';
  }
  STATE.theme = theme;
  try {
    localStorage.setItem('vision_sheet_theme', theme);
  } catch (e) {
    console.error('Failed to save theme to localStorage:', e);
  }
}

function toggleTheme() {
  const nextTheme = STATE.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
}

// Password visibility helper
function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  const icon = input.nextElementSibling.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  }
}

// ==========================================================================
// STATUS MANAGEMENT
// ==========================================================================
function updateStatusIndicators() {
  // API Status Indicator
  if (STATE.apiKey && (STATE.apiKey.trim().length > 5 || STATE.apiKey === 'backend-secured')) {
    elements.statusGemini.className = 'status-value online';
    elements.statusGemini.innerHTML = '<i class="fa-solid fa-circle"></i> เชื่อมต่อแล้ว';
  } else {
    elements.statusGemini.className = 'status-value offline';
    elements.statusGemini.innerHTML = '<i class="fa-solid fa-circle"></i> ยังไม่ตั้งค่า';
  }

  // Google Sheet Webapp Status Indicator
  if (STATE.webappUrl && (STATE.webappUrl.trim().startsWith('https://script.google.com') || STATE.webappUrl === 'backend-secured')) {
    elements.statusSheet.className = 'status-value online';
    elements.statusSheet.innerHTML = '<i class="fa-solid fa-circle"></i> เชื่อมต่อแล้ว';
  } else {
    elements.statusSheet.className = 'status-value offline';
    elements.statusSheet.innerHTML = '<i class="fa-solid fa-circle"></i> ยังไม่ตั้งค่า';
  }
}

// ==========================================================================
// UI AUTO-RESIZE & TEXTAREA HELPERS
// ==========================================================================
function autoResizeTextArea() {
  const textarea = elements.textInput;
  textarea.style.height = 'auto';
  textarea.style.height = (textarea.scrollHeight - 4) + 'px';
}

// ==========================================================================
// EVENT LISTENERS SETUP
// ==========================================================================
function setupEventListeners() {
  // Save settings button click
  elements.btnSaveSettings.addEventListener('click', saveConfigurations);
  
  // Theme Toggle Button
  elements.btnThemeToggle.addEventListener('click', toggleTheme);
  
  // Clear History Button
  elements.btnClearHistory.addEventListener('click', clearChatHistory);
  
  // Log Out Button
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
        sessionStorage.removeItem('access_password');
        sessionStorage.removeItem('access_role');
        sessionStorage.removeItem('access_username');
        window.location.href = '/login.html';
      }
    });
  }
  
  // Set up event listeners for change password modal
  setupChangePasswordModalListeners();
  
  // Auto resizing text area as user types
  elements.textInput.addEventListener('input', autoResizeTextArea);
  
  // Support pasting image from clipboard (Ctrl+V) directly inside text input
  elements.textInput.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        e.preventDefault();
        processUploadedFile(file);
        break;
      }
    }
  });
  
  // Trigger file dialog
  elements.btnUploadTrigger.addEventListener('click', () => elements.fileUploader.click());
  
  // File change event handler
  elements.fileUploader.addEventListener('change', handleFileSelection);
  
  // Cancel/Remove image attachment
  elements.btnCancelImage.addEventListener('click', removeImageAttachment);
  
  // Text input hotkey (Enter to submit, Shift+Enter for new line)
  elements.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elements.chatInputForm.dispatchEvent(new Event('submit'));
    }
  });
  
  // Form submission
  elements.chatInputForm.addEventListener('submit', handleFormSubmit);
  
  // Drag and drop event listeners on document
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  
  const chatMessagesBox = elements.chatMessagesBox;
  chatMessagesBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatMessagesBox.classList.add('drag-over-effect');
  });
  
  chatMessagesBox.addEventListener('dragleave', () => {
    chatMessagesBox.classList.remove('drag-over-effect');
  });
  
  chatMessagesBox.addEventListener('drop', (e) => {
    e.preventDefault();
    chatMessagesBox.classList.remove('drag-over-effect');
    if (e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
      if (files.length > 0) {
        processUploadedFiles(files.slice(0, 5));
        if (e.dataTransfer.files.length > 5) {
          appendAlertMessage('ระบบรองรับการส่งรูปภาพได้สูงสุดทีละ 5 รูปครับ (รูปส่วนเกินถูกตัดออก)', 'info');
        }
      } else {
        appendAlertMessage('ขออภัยครับ ระบบรองรับเฉพาะไฟล์รูปภาพเท่านั้นครับ', 'error');
      }
    }
  });
  
  // Mobile sidebar open action
  elements.btnSidebarToggle.addEventListener('click', () => {
    elements.sidebar.classList.add('open');
  });
  
  // Mobile sidebar close action
  elements.btnSidebarClose.addEventListener('click', () => {
    elements.sidebar.classList.remove('open');
  });
  
  // Auto close sidebar when clicking inside the chat messaging box on mobile
  document.querySelector('.chat-container').addEventListener('click', (e) => {
    // Only close if it's not a click on the hamburger toggle itself
    if (elements.sidebar.classList.contains('open') && !elements.btnSidebarToggle.contains(e.target)) {
      elements.sidebar.classList.remove('open');
    }
  });
}

// ==========================================================================
// CONFIGURATION LOGIC
// ==========================================================================
function saveConfigurations() {
  const apiKey = elements.apiKeyInput.value.trim();
  const webappUrl = elements.webappUrlInput.value.trim();
  const selectedModel = elements.modelSelect.value;
  
  if (webappUrl && !webappUrl.startsWith('https://script.google.com')) {
    alert('รูปแบบ Google Sheets Web App URL ไม่ถูกต้อง');
    return;
  }
  
  STATE.apiKey = apiKey;
  STATE.webappUrl = webappUrl;
  STATE.model = selectedModel;
  
  try {
    localStorage.setItem('vision_sheet_gemini_key', apiKey);
    localStorage.setItem('vision_sheet_webapp_url', webappUrl);
    localStorage.setItem('vision_sheet_model', selectedModel);
  } catch (e) {
    console.error('Failed to save configurations to localStorage:', e);
  }
  
  updateStatusIndicators();
  
  appendAlertMessage('บันทึกข้อมูลการตั้งค่าเข้ากับเบราว์เซอร์ของคุณเรียบร้อยแล้ว!', 'success');
}

// ==========================================================================
// IMAGE ATTACHMENT HANDLING
// ==========================================================================
function handleFileSelection(e) {
  if (e.target.files.length > 0) {
    const files = Array.from(e.target.files).slice(0, 5);
    processUploadedFiles(files);
    if (e.target.files.length > 5) {
      appendAlertMessage('ระบบรองรับการส่งรูปภาพได้สูงสุดทีละ 5 รูปครับ (รูปส่วนเกินถูกตัดออก)', 'info');
    }
  }
}

function processUploadedFiles(files) {
  // Clear any existing preview
  elements.previewBodyContainer.innerHTML = '';
  STATE.currentImages = [];
  
  let loadedCount = 0;
  
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Data = event.target.result.split(',')[1];
      const mimeType = file.type;
      const name = file.name;
      const sizeKB = (file.size / 1024).toFixed(1) + ' KB';
      
      const imgObject = {
        base64: base64Data,
        mimeType: mimeType,
        name: name,
        size: sizeKB,
        dataUrl: event.target.result
      };
      
      STATE.currentImages.push(imgObject);
      
      // Render thumbnail dynamically
      const previewItem = document.createElement('div');
      previewItem.style.cssText = 'display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); padding: 6px 10px; border-radius: var(--radius-sm); max-width: 220px;';
      previewItem.innerHTML = `
        <img src="${event.target.result}" style="width: 42px; height: 42px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border-color);" alt="Preview">
        <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0;">
          <span style="font-size: 11px; font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${name}</span>
          <span style="font-size: 10px; color: var(--text-muted);">${sizeKB}</span>
        </div>
      `;
      elements.previewBodyContainer.appendChild(previewItem);
      
      loadedCount++;
      if (loadedCount === files.length) {
        elements.imagePreviewPanel.classList.remove('hidden');
        scrollToBottom();
      }
    };
    reader.readAsDataURL(file);
  });
}

function removeImageAttachment() {
  STATE.currentImages = [];
  elements.fileUploader.value = '';
  elements.previewBodyContainer.innerHTML = '';
  elements.imagePreviewPanel.classList.add('hidden');
}

// ==========================================================================
// CHAT MESSAGE DOM CREATION & RENDERING
// ==========================================================================
function appendMessage(sender, text, imageSrc = null, transactions = null, msgObject = null) {
  const messageElement = document.createElement('div');
  
  let isMe = true;
  if (sender === 'user') {
    const msgUsername = msgObject ? msgObject.username : (sessionStorage.getItem('access_username') || 'user');
    const currentUsername = sessionStorage.getItem('access_username') || '';
    if (msgUsername.toLowerCase() !== currentUsername.toLowerCase()) {
      isMe = false;
    }
  }

  // Set message class based on sender and alignment
  if (sender === 'user') {
    messageElement.className = `message ${isMe ? 'user-msg' : 'other-user-msg'}`;
  } else {
    messageElement.className = `message system-msg`;
  }

  if (transactions && transactions.length > 0) {
    messageElement.classList.add('transaction-message-wrapper');
  }
  
  let avatarHtml = '';
  let nickname = '';
  if (sender === 'user') {
    const senderUsername = msgObject ? msgObject.username : (sessionStorage.getItem('access_username') || 'user');
    messageElement.setAttribute('data-username', senderUsername.toLowerCase());
    
    const profileImg = msgObject ? msgObject.profileImage : sessionStorage.getItem('access_profile_image');
    nickname = msgObject ? msgObject.nickname : (sessionStorage.getItem('access_nickname') || sessionStorage.getItem('access_username') || 'ผู้ใช้งาน');
    if (profileImg) {
      avatarHtml = `<img src="${profileImg}" class="user-avatar-img" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" alt="User Avatar">`;
    } else {
      avatarHtml = '<i class="fa-solid fa-user"></i>';
    }
  } else {
    nickname = msgObject && msgObject.nickname ? msgObject.nickname : 'MT-TOPUP AI';
    avatarHtml = '<i class="fa-solid fa-robot"></i>';
  }
    
  let imageHtml = '';
  if (imageSrc) {
    imageHtml = `
      <div class="chat-image-thumbnail-container">
        <img src="${imageSrc}" class="chat-image-thumbnail" alt="Uploaded Receipt" />
        <div class="chat-image-hover-overlay">
          <i class="fa-solid fa-magnifying-glass-plus"></i>
          <span>คลิกเพื่อดูรูปใหญ่</span>
        </div>
      </div>
    `;
  }
  
  let bubbleClass = 'msg-bubble';
  let contentHtml = '';
  
  if (transactions && transactions.length > 0) {
    bubbleClass += ' transaction-container';
    const textHtml = text ? `<div class="msg-text-content" style="margin-bottom: 12px;">${parseMarkdown(text)}</div>` : '';
    const cardsHtml = transactions.map((tx, idx) => `
      <div class="transaction-card">
        <div style="font-size: 11px; color: var(--accent-secondary); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-clock-rotate-left"></i> วันที่ในรูป: ${tx.slip_date || 'ไม่ระบุ'}
        </div>
        <div>เกม: ${tx.game || 'ไม่ระบุ'}</div>
        <div>UID: ${tx.uid || 'ไม่ระบุ'}</div>
        <div>แพ็กเกจ: ${tx.package || 'ไม่ระบุ'}</div>
        <div>ยอดเงิน: ${tx.amount || '0'}</div>
        <div>สถานะ: ${tx.status || 'โอนเสร็จ'}</div>
      </div>
    `).join('');
    contentHtml = textHtml + cardsHtml;
  } else {
    contentHtml = `<div class="msg-text-content">${parseMarkdown(text)}</div>`;
  }
  
  // Align items left or right based on whether it is my message or not
  const alignStyle = (sender === 'user' && isMe) ? 'align-items: flex-end;' : 'align-items: flex-start;';
  
  messageElement.innerHTML = `
    <div class="msg-avatar">
      ${avatarHtml}
    </div>
    <div class="msg-content-wrapper" style="display: flex; flex-direction: column; gap: 4px; ${alignStyle} flex: 1;">
      <span class="msg-nickname" style="font-size: 11px; color: var(--text-muted); font-weight: 500; opacity: 0.8; padding: 0 4px;">${nickname}</span>
      <div class="${bubbleClass}">
        ${imageHtml}
        ${contentHtml}
      </div>
    </div>
  `;

  // Bind programmatic click handler securely to avoid inline browser escaping issues
  if (imageSrc) {
    const thumbnail = messageElement.querySelector('.chat-image-thumbnail-container');
    if (thumbnail) {
      thumbnail.addEventListener('click', () => {
        openLightbox(imageSrc);
      });
    }
  }

  // Append Google Sheet Status Badge if present in the msgObject!
  if (msgObject && msgObject.sheetStatus) {
    const statusBadge = document.createElement('div');
    if (msgObject.sheetStatus === 'success') {
      statusBadge.className = 'status-badge success';
      statusBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> บันทึกข้อมูลเติมเงิน ${transactions ? transactions.length : 0} รายการลง Google Sheet สำเร็จ!`;
    } else if (msgObject.sheetStatus === 'failed') {
      statusBadge.className = 'status-badge error';
      statusBadge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> บันทึกข้อมูลล้มเหลว: ${msgObject.sheetError || ''}`;
    } else if (msgObject.sheetStatus === 'no_url') {
      statusBadge.className = 'status-badge error';
      statusBadge.innerHTML = `<i class="fa-solid fa-circle-info"></i> ข้ามการบันทึก: ยังไม่ได้ตั้งค่า Web App URL บนเซิร์ฟเวอร์`;
    } else {
      statusBadge.className = 'status-badge';
      statusBadge.innerHTML = `<i class="fa-solid fa-circle-info"></i> ดำเนินการวิเคราะห์เสร็จสิ้น`;
    }
    messageElement.querySelector('.msg-bubble').appendChild(statusBadge);
  }
  
  elements.chatMessagesBox.appendChild(messageElement);
  scrollToBottom();
  saveChatHtmlToLocalStorage();
  return messageElement;
}

function appendAlertMessage(text, type = 'info') {
  const alertClass = `alert-${type}`;
  const iconClass = type === 'success' 
    ? 'fa-circle-check' 
    : type === 'error' 
      ? 'fa-circle-exclamation' 
      : 'fa-circle-info';
      
  const messageElement = document.createElement('div');
  messageElement.className = 'message system-msg';
  messageElement.innerHTML = `
    <div class="msg-avatar">
      <i class="fa-solid fa-robot"></i>
    </div>
    <div class="msg-content-wrapper" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start; flex: 1;">
      <span class="msg-nickname" style="font-size: 11px; color: var(--text-muted); font-weight: 500; opacity: 0.8; padding: 0 4px;">MT-TOPUP AI</span>
      <div class="msg-bubble">
        <div class="alert ${alertClass}">
          <i class="fa-solid ${iconClass}"></i>
          <div>${parseMarkdown(text)}</div>
        </div>
      </div>
    </div>
  `;
  elements.chatMessagesBox.appendChild(messageElement);
  scrollToBottom();
  saveChatHtmlToLocalStorage();
}

function createTypingIndicator() {
  const typingElement = document.createElement('div');
  typingElement.className = 'message system-msg';
  typingElement.innerHTML = `
    <div class="msg-avatar">
      <i class="fa-solid fa-robot"></i>
    </div>
    <div class="msg-content-wrapper" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start; flex: 1;">
      <span class="msg-nickname" style="font-size: 11px; color: var(--text-muted); font-weight: 500; opacity: 0.8; padding: 0 4px;">MT-TOPUP AI</span>
      <div class="msg-bubble">
        <div class="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;
  elements.chatMessagesBox.appendChild(typingElement);
  scrollToBottom();
  return typingElement;
}

function scrollToBottom() {
  elements.chatMessagesBox.scrollTop = elements.chatMessagesBox.scrollHeight;
}

function saveChatHtmlToLocalStorage() {
  try {
    localStorage.setItem('vision_sheet_chat_html', elements.chatMessagesBox.innerHTML);
  } catch (e) {
    console.error('Failed to save chat HTML to localStorage:', e);
  }
}

function saveChatHistoryToLocalStorage() {
  try {
    localStorage.setItem('vision_sheet_chat_history', JSON.stringify(STATE.chatHistory));
  } catch (e) {
    console.error('Failed to save chat history to localStorage:', e);
  }
}

async function clearChatHistory() {
  const username = sessionStorage.getItem('access_username') || 'admin';
  const role = sessionStorage.getItem('access_role');
  
  if (role !== 'head-admin') {
    alert('❌ ขออภัยครับ เฉพาะผู้ดูแลระบบสูงสุด (Head Admin) เท่านั้นที่มีสิทธิ์ล้างประวัติการสนทนาได้!');
    return;
  }
  
  const password = prompt('🔑 กรุณากรอกรหัสผ่านบัญชีผู้ดูแลระบบ (Admin Password) ของคุณเพื่อยืนยันการล้างประวัติการสนทนาทั้งหมด:');
  if (password === null) return; // User cancelled
  
  const trimmed = password.trim();
  if (!trimmed) {
    alert('❌ กรุณากรอกรหัสผ่านเพื่อดำเนินการ!');
    return;
  }
  
  try {
    // Verify password via login endpoint
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password: trimmed })
    });
    
    if (response.ok) {
      const result = await response.json();
      if (result.role === 'head-admin') {
        if (confirm('⚠️ คำเตือน: คุณต้องการลบข้อความและประวัติการแชททั้งหมดออกจากเซิร์ฟเวอร์แบบถาวรใช่หรือไม่?')) {
          try {
            // WIPE ON SERVER!
            const clearRes = await fetch('/api/messages/clear', {
              method: 'POST',
              headers: {
                'Authorization': sessionStorage.getItem('access_password') || ''
              }
            });
            if (!clearRes.ok) {
              const errData = await clearRes.json().catch(() => ({}));
              throw new Error(errData.error || 'Server error clearing history');
            }
          } catch (clearErr) {
            console.error('Failed to clear server messages:', clearErr);
            alert('❌ ไม่สามารถล้างข้อมูลบนเซิร์ฟเวอร์ได้: ' + clearErr.message);
            return;
          }

          STATE.chatHistory = [];
          try {
            localStorage.removeItem('vision_sheet_chat_history');
          } catch (e) {}
          
          STATE.localMessagesCount = 0;
          
          // Clear everything except initial welcoming message
          elements.chatMessagesBox.innerHTML = `
            <div class="message system-msg">
              <div class="msg-avatar">
                <i class="fa-solid fa-robot"></i>
              </div>
              <div class="msg-bubble">
                <p>ประวัติการแชทถูกล้างเรียบร้อยแล้วครับ 🤖🧹</p>
                <p>คุณสามารถพิมพ์แชทคุยกับผมใหม่ หรือลากวางไฟล์รูปภาพเพื่อบันทึกขึ้น Google Sheet ต่อได้เลยครับ!</p>
              </div>
            </div>
          `;
          saveChatHtmlToLocalStorage();
          alert('✅ ล้างประวัติการสนทนาสำหรับทุกคนบนระบบเรียบร้อยแล้ว!');
        }
      } else {
        alert('❌ ขออภัยครับ เฉพาะผู้ดูแลระบบสูงสุด (Head Admin) เท่านั้นที่มีสิทธิ์ดำเนินการล้างประวัติ!');
      }
    } else {
      alert('❌ รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง! ไม่สามารถล้างประวัติการสนทนาได้');
    }
  } catch (err) {
    console.error('Verify admin password failed:', err);
    alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อยืนยันสิทธิ์ผู้ดูแลระบบ');
  }
}

// ==========================================================================
// CHAT & SUBMISSION HANDLING (API WORKFLOWS)
// ==========================================================================
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const text = elements.textInput.value.trim();
  const hasImages = STATE.currentImages.length > 0;
  
  // Prevent sending empty requests
  if (!text && !hasImages) return;
  
  // If sending an image, we require AI API Key and Sheets URL configurations
  if (hasImages) {
    if (!STATE.apiKey) {
      appendAlertMessage('กรุณากรอก **AI API Key** ในการตั้งค่าด้านซ้ายมือก่อนใช้งานนะครับ', 'error');
      return;
    }
    if (!STATE.webappUrl) {
      appendAlertMessage('กรุณากรอก **Google Sheets Web App URL** ในการตั้งค่าด้านซ้ายมือ เพื่อบันทึกภาพขึ้นชีตนะครับ', 'error');
      return;
    }
  }
  
  STATE.isSendingMessage = true;
  
  // Keep values for processing and clear attachments immediately
  const processingImages = [...STATE.currentImages];
  removeImageAttachment();
  
  // Clear input area
  elements.textInput.value = '';
  autoResizeTextArea();
  
  try {
    if (processingImages.length > 0) {
      // IMAGE SCAN WORKFLOW (AI-Powered, Sequential Queue)
      for (let i = 0; i < processingImages.length; i++) {
        const img = processingImages[i];
        
        // Render User Message immediately in UI
        const userText = text && i === 0 ? text : `อัปโหลดรูปภาพ "${img.name}" เพื่อวิเคราะห์และบันทึกข้อมูลเข้าร้านเติมเงิน`;
        const imagePreviewUrl = img.dataUrl;
        appendMessage('user', userText, imagePreviewUrl);
        
        const typingIndicator = createTypingIndicator();
        try {
          await handleImageOcrWorkflow(userText, img, typingIndicator);
        } catch (error) {
          console.error(error);
          typingIndicator.remove();
          
          // Quota exceeded / high demand messages
          if (error.message.includes('quota') || error.message.includes('Quota exceeded') || error.message.includes('429') || error.message.includes('exceeded your current quota')) {
            appendAlertMessage(`
**⚠️ โควต้าการใช้งานโมเดลเต็มชั่วคราว (Rate Limit / Quota Exceeded)**

บัญชีแบบฟรีของ Gemini API (Free Tier) จะมีการจำกัดจำนวนครั้งในการส่งคำขอต่อนาที หรือโควต้าประจำวันของคุณเต็มแล้ว

**💡 วิธีการแก้ไขง่ายๆ:**
1. โปรดรอประมาณ 30 วินาที ถึง 1 นาที แล้วทดลองส่งรูปภาพใหม่อีกครั้ง
2. หรือแผงการตั้งค่าด้านซ้าย สลับประเภทโมเดลเป็น **Google: Gemini 1.5 Flash (โมเดลสำรอง)** ซึ่งเป็นรุ่นก่อนหน้าที่มีโควต้าการใช้งานแยกจากกัน ทำให้ทำงานประมวลผลต่อได้ทันทีครับ!
            `, 'error');
          } else if (error.message.includes('high demand') || error.message.includes('temporary') || error.message.includes('503') || error.message.includes('experiences')) {
            appendAlertMessage(`
**⚠️ โมเดลนี้กำลังมีผู้ใช้งานหนาแน่นชั่วคราว (High Demand / Spikes in Demand)**

ขณะนี้โมเดลที่คุณเลือกมีผู้ใช้ทั่วโลกเข้าใช้งานพร้อมกันเป็นจำนวนมากทำให้ระบบฝั่งเซิร์ฟเวอร์เต็มชั่วคราว

**💡 วิธีการแก้ไขง่ายๆ:**
1. สลับรุ่นโมเดล AI ในแผงตั้งค่าด้านซ้ายให้เป็น **Google: Gemini 1.5 Flash (โมเดลสำรอง)** ซึ่งเป็นรุ่นที่มีเครื่องเซิร์ฟเวอร์แยกต่างหากและมักจะไม่ค่อยเต็มครับ!
2. หรือรอประมาณ 10-20 วินาทีแล้วลองกดส่งใหม่อีกครั้งครับ
            `, 'error');
          } else {
            appendAlertMessage(`เกิดข้อผิดพลาดในการวิเคราะห์สลิป "${img.name}": ${error.message}`, 'error');
          }
        }
        
        // Add a slight 200ms delay between sequential requests to prevent API rate limit congestion
        if (i < processingImages.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    } else {
      // PURE TEXT CONVERSATION WORKFLOW (Pure Human-to-Human Live Chat!)
      appendMessage('user', text, null);
      if (STATE.useBackend) {
        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': sessionStorage.getItem('access_password') || ''
            },
            body: JSON.stringify({ message: text })
          });
          
          if (!response.ok) {
            const errorJson = await response.json().catch(() => ({}));
            throw new Error(errorJson.error || `HTTP error ${response.status}`);
          }
        } catch (backendChatError) {
          console.error('Failed to sync text message with backend:', backendChatError);
        }
      }
    }
  } finally {
    STATE.isSendingMessage = false;
    syncChatMessages();
  }
}

// --- WORKFLOW A: Multimodal OCR & Sheets Upload ---
async function handleImageOcrWorkflow(userText, imageObj, typingIndicator) {
  if (STATE.useBackend) {
    updateLoaderStatus(typingIndicator, `🔄 กำลังวิเคราะห์ข้อมูลผ่านเซิร์ฟเวอร์แบบปลอดภัย...`);
    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionStorage.getItem('access_password') || ''
        },
        body: JSON.stringify({
          image: {
            base64: imageObj.base64,
            mimeType: imageObj.mimeType
          },
          userText: userText,
          model: STATE.model
        })
      });
      
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP error ${response.status}`);
      }
      
      const result = await response.json();
      let rawAiResult = result.text;
      const transactions = result.transactions;
      
      // Clean up the text shown to the user so the technical sheet data tags aren't cluttering the chat bubble
      if (rawAiResult) {
        rawAiResult = rawAiResult.replace(/---SHEET_DATA_START---[\s\S]*?---SHEET_DATA_END---/g, '').trim();
      }
      
      typingIndicator.remove();
      const finalMsgBubble = appendMessage('bot', rawAiResult, null, transactions);
      
      const statusBadge = document.createElement('div');
      if (result.sheetStatus === 'success') {
        statusBadge.className = 'status-badge success';
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> บันทึกข้อมูลเติมเงิน ${transactions.length} รายการลง Google Sheet สำเร็จ!`;
      } else if (result.sheetStatus === 'failed') {
        statusBadge.className = 'status-badge error';
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> บันทึกข้อมูลล้มเหลว: ${result.sheetError}`;
      } else if (result.sheetStatus === 'no_url') {
        statusBadge.className = 'status-badge error';
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-info"></i> ข้ามการบันทึก: ยังไม่ได้ตั้งค่า Web App URL บนเซิร์ฟเวอร์`;
      } else {
        statusBadge.className = 'status-badge';
        statusBadge.innerHTML = `<i class="fa-solid fa-circle-info"></i> ดำเนินการวิเคราะห์เสร็จสิ้น`;
      }
      
      finalMsgBubble.querySelector('.msg-bubble').appendChild(statusBadge);
      saveChatHtmlToLocalStorage();
      return;
      
    } catch (backendOcrError) {
      console.error(backendOcrError);
      throw backendOcrError;
    }
  }

  // Update indicator text in UI showing OCR progress
  updateLoaderStatus(typingIndicator, `🔄 กำลังวิเคราะห์ข้อมูลด้วย ${STATE.model}...`);
  
  // Prepare Gemini Prompt targeting detailed data extraction and custom format for the sheet columns
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

4. ผลลัพธ์ของคุณต้องมี **เฉพาะ** บล็อกข้อมูล JSON Array ด้านล่างนี้เท่านั้น ห้ามมีคำอธิบายใดๆ นอกบล็อกเด็ดขาด:

---SHEET_DATA_START---
[
  {
    "game": "[ชื่อเกม]",
    "uid": "[UID ของผู้เล่น]",
    "package": "[แพ็กเกจ]",
    "amount": [ยอดเงินตัวเลขเท่านั้น],
    "status": "โอนเสร็จ"
  }
]
---SHEET_DATA_END---
  `;

  const finalPrompt = `${systemPrompt}\nคำขอเพิ่มเติมจากผู้ใช้: ${userText}`;
  
  try {
    let rawAiResult = '';
    const isOpenAi = STATE.model.startsWith('gpt');

    if (isOpenAi) {
      const openaiUrl = 'https://api.openai.com/v1/chat/completions';
      const payload = {
        model: STATE.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: finalPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageObj.mimeType};base64,${imageObj.base64}`
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
          'Authorization': `Bearer ${STATE.apiKey}`
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
      // 1. Call Gemini API Multimodal Generate Content using the dynamically selected model
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${STATE.model}:generateContent?key=${STATE.apiKey}`;
      
      const requestPayload = {
        contents: [{
          parts: [
            { text: finalPrompt },
            {
              inlineData: {
                mimeType: imageObj.mimeType,
                data: imageObj.base64
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
        body: JSON.stringify(requestPayload)
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
    
    // 2. Parse out Google Sheets Columns from AI's specific format
    let transactions = [];
    
    const dataMatch = rawAiResult.match(/---SHEET_DATA_START---([\s\S]*?)---SHEET_DATA_END---/);
    if (dataMatch) {
      try {
        const jsonData = JSON.parse(dataMatch[1].trim());
        if (Array.isArray(jsonData)) {
          transactions = jsonData;
        } else {
          transactions = [jsonData];
        }
      } catch (jsonErr) {
        console.error("Failed to parse JSON sheet data from Gemini", jsonErr);
      }
      
      // Clean up the text shown to the user so the technical sheet data tags aren't cluttering the chat bubble
      rawAiResult = rawAiResult.replace(/---SHEET_DATA_START---[\s\S]*?---SHEET_DATA_END---/g, '').trim();
    }
    
    // If rawAiResult is empty after removing the JSON blocks, make it empty so we only show the gorgeous transaction cards
    if (!rawAiResult) {
      rawAiResult = "";
    }
    
    // 3. Remove typing indicator and show Gemini analysis in chat
    typingIndicator.remove();
    const finalMsgBubble = appendMessage('bot', rawAiResult, null, transactions);
    
    // Add sheets loading badge to this message bubble
    const statusBadge = document.createElement('div');
    statusBadge.className = 'status-badge working';
    statusBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกข้อมูลเข้า Google Sheets...';
    finalMsgBubble.querySelector('.msg-bubble').appendChild(statusBadge);
    saveChatHtmlToLocalStorage();
    
    // 4. Send Extracted Data to Google Apps Script Web App
    try {
      // Format current Date Time in the exact format shown in the user's screenshot e.g. "29/05/2026 11:24"
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const formattedDateTime = `${day}/${month}/${year} ${hours}:${minutes}`;

      const sheetPayload = {
        datetime: formattedDateTime,
        transactions: transactions,
        base64: imageObj.base64,
        mimeType: imageObj.mimeType
      };
      
      // We send it using text/plain to entirely avoid CORS preflight options requests!
      await fetch(STATE.webappUrl, {
        method: 'POST',
        mode: 'no-cors', // Opaque response, but succeeds in writing to Sheet and Drive
        headers: {
          'Content-Type': 'text/plain'
        },
        body: JSON.stringify(sheetPayload)
      });
      
      statusBadge.className = 'status-badge success';
      statusBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> บันทึกข้อมูลเติมเงิน ${transactions.length} รายการลง Google Sheet สำเร็จ!`;
      saveChatHtmlToLocalStorage();
      
    } catch (sheetError) {
      console.error(sheetError);
      statusBadge.className = 'status-badge error';
      statusBadge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> บันทึกข้อมูลล้มเหลว: ${sheetError.message}`;
      saveChatHtmlToLocalStorage();
    }
    
  } catch (error) {
    throw error;
  }
}

// --- WORKFLOW B: Standard Text Chat ---
async function handleTextChatWorkflow(userText, typingIndicator) {
  updateLoaderStatus(typingIndicator, `🤖 กำลังประมวลผลด้วย ${STATE.model}...`);
  
  // Store user message in history
  STATE.chatHistory.push({ role: 'user', parts: [{ text: userText }] });
  
  // Limit history size to prevent context bloat (keep last 10 messages)
  if (STATE.chatHistory.length > 20) {
    STATE.chatHistory = STATE.chatHistory.slice(-20);
  }
  saveChatHistoryToLocalStorage();
  
  if (STATE.useBackend) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionStorage.getItem('access_password') || ''
        },
        body: JSON.stringify({
          history: STATE.chatHistory,
          message: userText,
          model: STATE.model
        })
      });
      
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP error ${response.status}`);
      }
      
      const result = await response.json();
      const aiResult = result.text;
      
      // Save AI response in history
      STATE.chatHistory.push({ role: 'model', parts: [{ text: aiResult }] });
      saveChatHistoryToLocalStorage();
      
      typingIndicator.remove();
      appendMessage('bot', aiResult);
      return;
      
    } catch (backendChatError) {
      STATE.chatHistory.pop(); // Remove last user message as it failed
      saveChatHistoryToLocalStorage();
      throw backendChatError;
    }
  }
  
  try {
    const isOpenAi = STATE.model.startsWith('gpt');
    let aiResult = '';

    if (isOpenAi) {
      const openaiUrl = 'https://api.openai.com/v1/chat/completions';
      
      // Map Gemini format to OpenAI messages format
      const openAiMessages = STATE.chatHistory.map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.parts[0].text
      }));
      
      openAiMessages.unshift({
        role: 'system',
        content: "คุณคือบอตผู้ช่วยส่วนตัวอัจฉริยะที่แชทพูดคุยทั่วไปได้อย่างเป็นกันเองและให้คำแนะนำที่มีประโยชน์ ภาษาหลักของคุณคือภาษาไทย เขียนตอบให้สุภาพ มีการใช้ Emoji ตกแต่งให้น่าอ่านและกระชับพอเหมาะ"
      });
      
      const payload = {
        model: STATE.model,
        messages: openAiMessages
      };
      
      const response = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${STATE.apiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || `OpenAI HTTP error ${response.status}`);
      }
      
      const responseData = await response.json();
      aiResult = responseData.choices?.[0]?.message?.content || '';
    } else {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${STATE.model}:generateContent?key=${STATE.apiKey}`;
      
      // Build context payload
      const requestPayload = {
        contents: STATE.chatHistory,
        systemInstruction: {
          parts: [{ text: "คุณคือบอตผู้ช่วยส่วนตัวอัจฉริยะที่แชทพูดคุยทั่วไปได้อย่างเป็นกันเองและให้คำแนะนำที่มีประโยชน์ ภาษาหลักของคุณคือภาษาไทย เขียนตอบให้สุภาพ มีการใช้ Emoji ตกแต่งให้น่าอ่านและกระชับพอเหมาะ" }]
        }
      };
      
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });
      
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || `Gemini HTTP error ${response.status}`);
      }
      
      const responseData = await response.json();
      aiResult = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    
    if (!aiResult) {
      throw new Error('ไม่ได้รับการตอบกลับข้อความจาก AI');
    }
    
    // Save AI response in history
    STATE.chatHistory.push({ role: 'model', parts: [{ text: aiResult }] });
    saveChatHistoryToLocalStorage();
    
    // Remove typing indicator and show AI response
    typingIndicator.remove();
    appendMessage('bot', aiResult);
    
  } catch (error) {
    // Remove last user message from history as it failed
    STATE.chatHistory.pop();
    saveChatHistoryToLocalStorage();
    throw error;
  }
}

function updateLoaderStatus(typingElement, statusText) {
  const bubble = typingElement.querySelector('.msg-bubble');
  bubble.innerHTML = `
    <div class="typing-indicator">
      <i class="fa-solid fa-spinner fa-spin" style="color: var(--accent-secondary); margin-right: 8px;"></i>
      <span style="animation: none; width: auto; height: auto; background: none; font-size: 13px; color: var(--text-secondary);">${statusText}</span>
    </div>
  `;
}

// ==========================================================================
// LIGHTWEIGHT MARKDOWN PARSER (HTML Helper)
// ==========================================================================
function parseMarkdown(text) {
  if (!text) return '';
  
  // Escape raw HTML strings to avoid security issues (XSS)
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  // 1. Triple backticks - Code blocks
  escaped = escaped.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  
  // 2. Single backticks - Inline code
  escaped = escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  
  // 3. Bold text **text**
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // 4. Bullet points (starting with "- " or "* " at the beginning of a line)
  escaped = escaped.replace(/^(?:-|\*)\s+(.+)$/gm, '<li>$1</li>');
  // Wrap sequential <li> tags with <ul>
  escaped = escaped.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Fix double wrap nesting if any
  escaped = escaped.replace(/<\/ul>\s*<ul>/g, '');
  
  // 5. Line breaks
  escaped = escaped.replace(/\n/g, '<br>');
  
  return escaped;
}

// ==========================================================================
// AVATAR UPLOAD & CROP FUNCTIONS (Shared Canvas logic)
// ==========================================================================
function resizeToSquareBase64(file, size, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      
      const ctx = canvas.getContext('2d');
      
      let srcX = 0;
      let srcY = 0;
      let srcSize = Math.min(img.width, img.height);
      
      if (img.width > img.height) {
        srcX = Math.round((img.width - img.height) / 2);
      } else {
        srcY = Math.round((img.height - img.width) / 2);
      }
      
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      callback(dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function triggerAvatarUpload(inputId) {
  document.getElementById(inputId).click();
}

function clearAvatar(imgId, placeholderId, clearBtnId, fileInputId) {
  const img = document.getElementById(imgId);
  const placeholder = document.getElementById(placeholderId);
  const clearBtn = document.getElementById(clearBtnId);
  const fileInput = document.getElementById(fileInputId);
  
  img.src = '';
  img.style.display = 'none';
  placeholder.style.display = 'flex';
  clearBtn.style.display = 'none';
  if (fileInput) fileInput.value = '';
}

function handleAvatarFileChange(input, imgId, placeholderId, clearBtnId) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      alert('❌ กรุณาเลือกไฟล์รูปภาพเท่านั้น!');
      input.value = '';
      return;
    }
    
    const placeholder = document.getElementById(placeholderId);
    const originalIcon = placeholder.innerHTML;
    placeholder.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size: 32px;"></i>';
    
    resizeToSquareBase64(file, 120, (base64Url) => {
      const img = document.getElementById(imgId);
      const clearBtn = document.getElementById(clearBtnId);
      
      img.src = base64Url;
      img.style.display = 'block';
      
      placeholder.innerHTML = originalIcon;
      placeholder.style.display = 'none';
      clearBtn.style.display = 'inline-flex';
    });
  }
}

// ==========================================================================
// EDIT PROFILE MODAL LOGIC
// ==========================================================================
function setupChangePasswordModalListeners() {
  if (!elements.btnChangePassword) return;

  // Open modal
  elements.btnChangePassword.addEventListener('click', () => {
    // Prefill user details from sessionStorage
    if (elements.profileUsernameInput) {
      elements.profileUsernameInput.value = sessionStorage.getItem('access_username') || '';
    }
    if (elements.profileNicknameInput) {
      elements.profileNicknameInput.value = sessionStorage.getItem('access_nickname') || '';
    }
    if (elements.newPasswordInput) {
      elements.newPasswordInput.value = '';
    }
    
    // Draw current avatar image preview
    const currentAvatar = sessionStorage.getItem('access_profile_image') || '';
    if (currentAvatar) {
      if (elements.profileAvatarPreview) {
        elements.profileAvatarPreview.src = currentAvatar;
        elements.profileAvatarPreview.style.display = 'block';
      }
      if (elements.profileAvatarPlaceholder) {
        elements.profileAvatarPlaceholder.style.display = 'none';
      }
      if (elements.profileClearAvatarBtn) {
        elements.profileClearAvatarBtn.style.display = 'inline-flex';
      }
    } else {
      clearAvatar('profile-avatar-preview', 'profile-avatar-placeholder', 'profile-clear-avatar-btn', 'profile-avatar-file');
    }

    elements.changePasswordModal.classList.remove('hidden');
    if (elements.profileNicknameInput) {
      elements.profileNicknameInput.focus();
    }
  });

  // Close modal (X button)
  elements.btnCloseModal.addEventListener('click', () => {
    elements.changePasswordModal.classList.add('hidden');
  });

  // Close modal (Cancel button)
  elements.btnCancelPassword.addEventListener('click', () => {
    elements.changePasswordModal.classList.add('hidden');
  });

  // Close modal when clicking on overlay background
  elements.changePasswordModal.addEventListener('click', (e) => {
    if (e.target === elements.changePasswordModal) {
      elements.changePasswordModal.classList.add('hidden');
    }
  });

  // Handle Form Submit
  elements.changePasswordForm.addEventListener('submit', handlePasswordChangeSubmit);
}

async function handlePasswordChangeSubmit(e) {
  e.preventDefault();

  const nickname = elements.profileNicknameInput.value.trim();
  const password = elements.newPasswordInput.value.trim();
  const username = elements.profileUsernameInput.value;
  
  // profileImage from preview src or empty if none
  const imgPreview = elements.profileAvatarPreview;
  const profileImage = imgPreview.src.startsWith('data:image/') 
    ? imgPreview.src 
    : (imgPreview.style.display === 'none' ? '' : sessionStorage.getItem('access_profile_image') || '');

  // Validate nickname
  if (!nickname) {
    alert('❌ กรุณากรอกชื่อเล่นของคุณ!');
    return;
  }

  // Validate password (if they filled it)
  if (password && password.length < 4) {
    alert('❌ รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร!');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-password');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกข้อมูล...';

  try {
    const response = await fetch('/api/admin/accounts/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': sessionStorage.getItem('access_password') || ''
      },
      body: JSON.stringify({ 
        username,
        nickname, 
        password: password || undefined,
        profileImage
      })
    });

    const result = await response.json();

    if (response.ok && result.status === 'success') {
      // Update sessionStorage so user stays authenticated and details are synced
      if (result.newToken) {
        sessionStorage.setItem('access_password', result.newToken);
      }
      sessionStorage.setItem('access_nickname', result.nickname);
      sessionStorage.setItem('access_profile_image', result.profileImage);
      
      // Update all chat messages avatars and nicknames real-time!
      updateChatAvatarsAndNicknames();
      
      elements.changePasswordModal.classList.add('hidden');
      appendAlertMessage('🎉 **แก้ไขโปรไฟล์ของคุณเรียบร้อยแล้ว!** ระบบอัปเดตข้อมูลและรูปโปรไฟล์ใหม่เรียบร้อยครับ', 'success');
    } else {
      alert('❌ ไม่สามารถแก้ไขโปรไฟล์ได้: ' + (result.error || 'ข้อผิดพลาดที่ไม่รู้จัก'));
    }
  } catch (err) {
    console.error('Change profile fetch error:', err);
    alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

// ==========================================================================
// REAL-TIME CHAT AVATARS & NICKNAMES SYNCHRONIZATION
// ==========================================================================
function updateChatAvatarsAndNicknamesWithData(profiles) {
  if (!profiles) return;
  try {
    // Find all user and other-user messages in the chat box
    const userMessages = elements.chatMessagesBox.querySelectorAll('.message.user-msg, .message.other-user-msg');
    userMessages.forEach(msg => {
      const usernameAttr = msg.getAttribute('data-username');
      if (!usernameAttr) return;
      
      const userProfile = profiles[usernameAttr.toLowerCase()];
      if (!userProfile) return;
      
      // 1. Update the avatar element
      const avatarContainer = msg.querySelector('.msg-avatar');
      if (avatarContainer) {
        if (userProfile.profileImage) {
          avatarContainer.innerHTML = `<img src="${userProfile.profileImage}" class="user-avatar-img" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" alt="User Avatar">`;
        } else {
          avatarContainer.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
      }
      
      // 2. Update the nickname element
      const nicknameSpan = msg.querySelector('.msg-nickname');
      if (nicknameSpan) {
        nicknameSpan.textContent = userProfile.nickname;
      }
    });
    
    // Also save the updated HTML back to localStorage so it persists across refreshes!
    saveChatHtmlToLocalStorage();
  } catch (err) {
    console.error('Failed to sync chat nicknames and avatars with local data:', err);
  }
}

async function updateChatAvatarsAndNicknames() {
  try {
    const response = await fetch('/api/users/profiles', {
      headers: {
        'Authorization': sessionStorage.getItem('access_password') || ''
      }
    });
    
    if (!response.ok) return;
    const result = await response.json();
    if (result.status !== 'success' || !result.profiles) return;
    
    updateChatAvatarsAndNicknamesWithData(result.profiles);
  } catch (err) {
    console.error('Failed to sync chat nicknames and avatars:', err);
  }
}

// ==========================================================================
// SOCKET.IO REAL-TIME INTEGRATION & CONNECTION HANDLERS
// ==========================================================================
function initializeSocketIO() {
  if (typeof io !== 'undefined' && STATE.useBackend) {
    socket = io();
    
    socket.on('connect', () => {
      console.log('[Socket.IO] Connected to backend real-time server securely.');
    });

    socket.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected from real-time server. Fallback polling enabled.');
    });

    // Listen for real-time messages update from server
    socket.on('chat_messages_updated', (messages) => {
      console.log('[Socket.IO] Received real-time chat messages update');
      
      // Skip rendering if the user is currently sending a message to prevent race conditions
      if (STATE.isSendingMessage) return;
      
      if (messages.length !== STATE.localMessagesCount) {
        renderAllMessages(messages);
        STATE.localMessagesCount = messages.length;
      }
    });

    // Listen for real-time user profiles update
    socket.on('profiles_updated', (profiles) => {
      console.log('[Socket.IO] Received real-time profile details update');
      updateChatAvatarsAndNicknamesWithData(profiles);
    });
  } else {
    console.log('[Socket.IO] Library not found or backend disabled. Fallback to HTTP polling.');
  }
}

// ==========================================================================
// SERVER-SIDE CHAT SYNCHRONIZATION (Real-Time Polling & Socket Fallback)
// ==========================================================================
async function syncChatMessages() {
  if (!STATE.useBackend) return;
  
  // BANDWIDTH OPTIMIZATION: If Socket.IO is actively connected, skip HTTP polling completely!
  if (socket && socket.connected) return;
  
  // Skip polling if the user is currently submitting a message to avoid race conditions
  if (STATE.isSendingMessage) return;

  try {
    const response = await fetch('/api/messages', {
      headers: {
        'Authorization': sessionStorage.getItem('access_password') || ''
      }
    });
    
    if (!response.ok) {
      // If token expired or unauthorized, redirect to login
      if (response.status === 401) {
        sessionStorage.removeItem('access_password');
        sessionStorage.removeItem('access_role');
        sessionStorage.removeItem('access_username');
        window.location.href = '/login.html';
      }
      return;
    }
    
    const result = await response.json();
    if (result.status !== 'success' || !result.messages) return;

    const serverMessages = result.messages;
    
    // Trigger full rendering if message count has changed
    if (serverMessages.length !== STATE.localMessagesCount) {
      renderAllMessages(serverMessages);
      STATE.localMessagesCount = serverMessages.length;
    }
  } catch (err) {
    console.error('Failed to synchronize chat messages with server:', err);
  }
}

function renderAllMessages(messages) {
  // Clear chat box except welcome banner
  elements.chatMessagesBox.innerHTML = `
    <!-- Welcoming Message -->
    <div class="message system-msg">
      <div class="msg-avatar">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="msg-bubble">
        <p>สวัสดีครับ! ยินดีต้อนรับสู่ **MT-TOPUP AI** 🤖✨</p>
        <p>ผมช่วยคุณแปลงข้อความจากรูปภาพ เช่น ใบเสร็จ ใบส่งของ ป้ายข้อมูล หรือเอกสารต่าง ๆ จากนั้นจะส่งข้อมูลขึ้นสู่ **Google Sheets** ของคุณทันที!</p>
        <div class="alert alert-info mt-3">
          <i class="fa-solid fa-circle-info"></i> กรุณากรอก **Gemini API Key** และ **Google Sheets Web App URL** ในแผงการตั้งค่าด้านซ้ายมือก่อนเริ่มต้นใช้งานนะครับ
        </div>
      </div>
    </div>
  `;

  // Render each message retrieved from server
  messages.forEach(msg => {
    appendMessage(msg.sender, msg.text, msg.imageSrc, msg.transactions, msg);
  });

  // Update chatHistory context for standard conversations
  const updatedHistory = [];
  messages.forEach(msg => {
    if (msg.sender === 'user') {
      updatedHistory.push({ role: 'user', parts: [{ text: msg.text }] });
    } else if (msg.sender === 'bot') {
      updatedHistory.push({ role: 'model', parts: [{ text: msg.text }] });
    }
  });

  STATE.chatHistory = updatedHistory.slice(-20);
  saveChatHistoryToLocalStorage();
  
  scrollToBottom();
}

// ==========================================================================
// LIGHTBOX IMAGE ZOOM MODAL (Facebook-Style Preview)
// ==========================================================================
function openLightbox(imageSrc) {
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImage = document.getElementById('lightbox-image');
  if (lightboxModal && lightboxImage) {
    lightboxImage.src = imageSrc;
    lightboxModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Lock background scrolling
  }
}

function closeLightbox() {
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImage = document.getElementById('lightbox-image');
  if (lightboxModal && lightboxImage) {
    lightboxModal.classList.add('hidden');
    lightboxImage.src = '';
    document.body.style.overflow = ''; // Unlock background scrolling
  }
}


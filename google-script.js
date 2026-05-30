/**
 * โค้ดนี้สำหรับนำไปวางใน Google Apps Script ใน Google Sheets (เวอร์ชันรองรับการเติมเงินหลายรายการพร้อมกัน)
 * 
 * วิธีการตั้งค่า:
 * 1. เปิด Google Sheets เปล่าของคุณขึ้นมา
 * 2. ไปที่เมนู "ส่วนขยาย" (Extensions) -> "Apps Script"
 * 3. ลบโค้ดเดิมทั้งหมดในโปรเจกต์ออก แล้วนำโค้ดด้านล่างนี้ไปวางทั้งหมด
 * 4. กดปุ่มบันทึก (รูปแผ่นดิสก์)
 * 5. กดปุ่ม "การทำให้ใช้งานได้" (Deploy) ที่มุมขวาบน -> "การทำให้ใช้งานได้ใหม่" (New deployment)
 * 6. เลือกประเภทการจัดวางเป็น "เว็บแอป" (Web app)
 * 7. ตั้งค่า:
 *    - คำอธิบาย: AI Topup Bot Batch
 *    - เรียกใช้ในฐานะ: ฉัน (อีเมลของคุณ)
 *    - ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน (Anyone) <-- *สำคัญมาก*
 * 8. กด "ทำให้ใช้งานได้" (Deploy) และกดยอมรับสิทธิ์ของบัญชีและกูเกิลไดรฟ์
 * 9. คัดลอก "URL เว็บแอป" (Web app URL) ตัวใหม่มาใส่ในหน้าต่างแชทบอตบนหน้าเว็บของคุณ
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var requestData = JSON.parse(e.postData.contents);
    
    // หากหน้าชีตว่างเปล่า ให้สร้างหัวคอลัมน์ให้ตรงตามตารางที่คุณแนะนำ
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "วันที่เวลา", 
        "วันที่ของรูปภาพ/สลิป", 
        "เกม", 
        "UID", 
        "แพ็กเกจ",
        "ยอดเงิน",
        "สถานะ",
        "รูปภาพ"
      ]);
      
      // ตกแต่งหัวข้อตารางให้สวยงาม
      var headerRange = sheet.getRange(1, 1, 1, 8);
      headerRange.setBackground("#0f172a"); // สี Slate เข้มหรูหรา
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      
      sheet.setColumnWidth(1, 150); // วันที่เวลา
      sheet.setColumnWidth(2, 150); // วันที่ของรูปภาพ/สลิป
      sheet.setColumnWidth(3, 120); // เกม
      sheet.setColumnWidth(4, 200); // UID
      sheet.setColumnWidth(5, 120); // แพ็กเกจ
      sheet.setColumnWidth(6, 100); // ยอดเงิน
      sheet.setColumnWidth(7, 100); // สถานะ
      sheet.setColumnWidth(8, 300); // รูปภาพ
    }
    
    // จัดการอัปโหลดรูปภาพใบเสร็จ/สลิป ขึ้น Google Drive
    var fileUrl = "แนบลิงก์รูป (ไม่มีภาพ)";
    if (requestData.base64 && requestData.mimeType) {
      var folderName = "MT-TOPUP AI Receipts";
      var folders = DriveApp.getFoldersByName(folderName);
      var folder;
      
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder(folderName);
      }
      
      var decoded = Utilities.base64Decode(requestData.base64);
      var timestamp = new Date().getTime();
      var extension = requestData.mimeType.split("/")[1] || "jpg";
      var filename = "receipt_batch_" + timestamp + "." + extension;
      
      var blob = Utilities.newBlob(decoded, requestData.mimeType, filename);
      var file = folder.createFile(blob);
      
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileUrl = file.getUrl();
    }
    
    // ดึงรายการธุรกรรมที่ได้จาก AI (รองรับทั้งส่งมาเป็นรายการเดี่ยว หรือมาเป็น Array หลายรายการ)
    var txList = requestData.transactions || [];
    if (!Array.isArray(txList)) {
      txList = [txList];
    }
    
    // วนลูปเพื่อเขียนแถวใหม่ลง Sheet สำหรับแต่ละรายการที่ AI อ่านพบ
    for (var i = 0; i < txList.length; i++) {
      var tx = txList[i];
      sheet.appendRow([
        requestData.datetime,
        tx.slip_date || "ไม่ระบุ",
        tx.game || "",
        tx.uid || "",
        tx.package || "",
        tx.amount || "",
        tx.status || "โอนเสร็จ",
        fileUrl // แนบลิงก์สลิปรูปภาพอันเดียวกันให้ทุกคอลัมน์เนื่องจากสกัดมาจากรูปเดียวกัน
      ]);
      
      // ตกแต่งฟอร์แมตข้อมูลในแถวล่าสุด
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, 1).setHorizontalAlignment("center"); // วันที่เวลา
      sheet.getRange(lastRow, 2).setHorizontalAlignment("center"); // วันที่ของรูปภาพ/สลิป
      sheet.getRange(lastRow, 3).setHorizontalAlignment("center"); // เกม
      sheet.getRange(lastRow, 6).setHorizontalAlignment("right");  // ยอดเงิน
      sheet.getRange(lastRow, 7).setHorizontalAlignment("center"); // สถานะ
      sheet.getRange(lastRow, 8).setHorizontalAlignment("left");   // ลิงก์รูปภาพ
      
      // ใส่สีเขียวอ่อนตรงสถานะ "โอนเสร็จ"
      var statusCell = sheet.getRange(lastRow, 7);
      statusCell.setBackground("#d1fae5");
      statusCell.setFontColor("#065f46");
      statusCell.setFontWeight("bold");
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "บันทึก " + txList.length + " รายการลง Google Sheet สำเร็จ!",
      count: txList.length
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "ระบบ Google Apps Script (Batch Version) พร้อมใช้งานแล้ว!"
  })).setMimeType(ContentService.MimeType.JSON);
}

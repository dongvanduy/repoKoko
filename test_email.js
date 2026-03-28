// test-email.js
const nodemailer = require("nodemailer");

// ⚠️ ĐIỀN THÔNG TIN CỦA BẠN VÀO ĐÂY ĐỂ TEST
const SMTP_USER = "duy.dv7388@gmail.com"; // Email dùng để gửi đi
const SMTP_PASS = "wxfs lbas hsjp oidk"; // Mật khẩu ứng dụng (không phải pass đăng nhập)
const EMAIL_NHAN = "dongduy261299@gmail.com"; // Email bạn dùng để check xem có nhận được thư không

// 1. Cấu hình Transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // Nếu bạn dùng dịch vụ khác (như Outlook, Sendgrid), hãy thay đổi host này
  port: 465, // Port cho SSL (hoặc 587 cho TLS)
  secure: true, // true cho port 465, false cho 587
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// 2. Tùy chọn Email
const mailOptions = {
  from: `"Test Hệ Thống Booking" <${SMTP_USER}>`,
  to: EMAIL_NHAN,
  subject: "✅ Kiểm tra cấu hình SMTP",
  text: "Nếu bạn đọc được dòng này, cấu hình SMTP của bạn đã hoàn toàn chính xác!",
  html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
            <h2 style="color: #2563eb;">Xin chào!</h2>
            <p>Nếu bạn nhận được email này, điều đó có nghĩa là cấu hình SMTP (User, Pass, Host, Port) của bạn đang <b>hoạt động cực kỳ hiệu quả</b>.</p>
            <p>Bây giờ bạn có thể tự tin áp dụng cấu hình này vào file <code>server.js</code> hoặc file xử lý booking của bạn.</p>
        </div>
    `,
};

// 3. Thực thi gửi thử
console.log("⏳ Đang tiến hành kết nối đến máy chủ email...");

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.log("\n❌ GỬI EMAIL THẤT BẠI!");
    console.log("Lý do lỗi chi tiết:");
    console.log(error.message);

    if (error.responseCode === 535) {
      console.log(
        '=> Gợi ý: Lỗi 535 thường do Sai Email hoặc Sai Mật khẩu (SMTP_PASS). Hãy kiểm tra lại "Mật khẩu ứng dụng" của bạn.',
      );
    }
  } else {
    console.log("\n✅ GỬI EMAIL THÀNH CÔNG!");
    console.log("Thông điệp ID:", info.messageId);
    console.log(
      "Hãy kiểm tra hộp thư đến (và cả thư mục Spam) của email:",
      EMAIL_NHAN,
    );
  }
});

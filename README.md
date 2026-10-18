# Kokoro — Express / EJS / MongoDB

Ứng dụng giữ cả form đặt nhanh và luồng đặt nhiều bước. **Ngày/giờ chọn là giờ cửa hàng Tokyo**, không phụ thuộc múi giờ thiết bị. Chọn `19/10/2026 08:00` lưu `date=2026-10-19`, `time=08:00`, `timeZone=Asia/Tokyo`, `startsAt=2026-10-18T23:00:00.000Z`. Được chọn mọi khung giờ còn chỗ trong hôm nay Tokyo, kể cả giờ đã qua; chỉ chặn ngày quá khứ.

## Chạy cục bộ

Yêu cầu Node >= 22.13.1 và MongoDB replica set (Atlas hoặc replica set cục bộ). MongoDB standalone không hỗ trợ transaction cần thiết.

1. Chạy `npm ci` với cả devDependencies, rồi `npm run build`.
2. Sao chép `.env.example` thành `.env` nếu chưa có; điền tài khoản, URI và secret ít nhất 32 ký tự ngẫu nhiên.
3. Để đổi mật khẩu cũ sang hash, đặt tạm `ADMIN_PASS` trong `.env`, chạy `node scripts/hash-admin.js --write`. Lệnh giữ mật khẩu hiện tại, lưu Argon2id, xóa plaintext, không in secret. Nếu chưa có hash, khởi động sẽ bị chặn.
4. Với DB mới hoàn toàn: tùy chọn `node scripts/seed.js --apply`. Script chỉ chấp nhận collection Plan trống, không chạy lúc khởi động.
5. Khởi tạo bộ đếm theo hướng dẫn migration bên dưới, kể cả DB mới.
6. `npm start`. Lệnh prestart kiểm tra tài nguyên đã build. Upload cần Cloudinary; gửi email cần SMTP.

Không dùng biến `TZ` của máy chủ để chuyển giờ đặt lịch. Form nhận chuỗi ngày Tokyo do máy chủ cấp; UTC chỉ là trường bổ sung phục vụ truy vấn và nhắc lịch.

## Kiểm thử

```text
npm test
npx playwright install chromium
npm run test:browser
npm audit --omit=dev
npm run check:deploy -- --booking
```

Các test tạo **replica set tạm riêng**, không dùng MONGO_URI Atlas trong .env; không gửi SMTP hoặc upload Cloudinary thật. Lần đầu cần tải MongoDB test binary và Chromium. Browser test bao gồm Việt Nam, Tokyo, UTC, Los Angeles; cả hai luồng, session/CSRF, gửi lại sau mất phản hồi và lỗi dịch vụ. Ảnh kiểm tra nằm trong `test-results/`.

Xem [hướng dẫn triển khai](docs/deployment.md) trước khi bật nhận đặt lịch trên dữ liệu hiện có.

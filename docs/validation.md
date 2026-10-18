# Kết quả kiểm tra — 18/10/2026

- `npm run build`: thành công, 26 tài nguyên có hash.
- `npm test`: **49/49 đạt**, gồm toàn bộ bộ CSRF cũ, transaction sức chứa, idempotency, kiểm tra dữ liệu, worker, migration và upload.
- `npm run test:browser`: **13/13 đạt**, Chromium; 16 lượt đặt qua hai luồng trong Asia/Ho_Chi_Minh, Asia/Tokyo, UTC, America/Los_Angeles. Tất cả giữ `2026-10-19 08:00 JST`. Không có lỗi JS/CSP được phát hiện trong những trang được kiểm tra.
- Đã tái hiện mất phản hồi sau commit và gửi lại: chỉ một đơn, một job email khách.
- Giá thay đổi trả 409, giữ thông tin liên hệ, chỉ lưu sau khi khách xác nhận tổng mới.
- 21 yêu cầu đồng thời cho 20 chỗ: 20 đơn, 1 xung đột; hủy/lưu trữ/khôi phục đồng bộ bộ đếm.
- Upload PNG thật được chấp nhận; nội dung giả ảnh, thiếu CSRF, ảnh quá 5 MiB bị từ chối trước Cloudinary; thư mục tạm được dọn.
- Giả lập transaction, SMTP, dịch thuật lỗi và DB disconnected: xử lý an toàn, retry tương ứng; không có email hoặc upload thật trong test.
- Cấu hình .env cục bộ đã chuyển ADMIN_PASS sang Argon2id; validateConfig đạt, không in secret.
- `npm audit --omit=dev`: **0**. Audit đầy đủ còn **5 high** ở công cụ build Tailwind 3 và dependency gián tiếp; xem deployment.md.
- Đã tạo 8 nhóm nội dung SEO đủ en/vi/jp/zh; ngôn ngữ thiếu hoặc nguồn đổi dùng tiếng Anh mà không gọi dịch trong request.
- `git diff --check` và kiểm tra syntax/manifest đạt.

## Đo cục bộ

Dữ liệu thô và phạm vi: [performance-local.json](performance-local.json). Năm lượt mỗi trang, viewport 390×844, CPU 4×, RTT 150ms, download 200 kB/s, cache lạnh. Dùng replica set và nội dung thử riêng; loại tài nguyên bên thứ ba.

| Chỉ số | Trước tối ưu ảnh/logo | Sau |
|---|---:|---:|
| Dữ liệu tài nguyên nội bộ trang chủ, p75 | 3.301.288 byte | 160.188 byte |
| LCP trang chủ, p75 | 1.268 ms | 1.268 ms |
| CLS trang chủ | 0 | 0 |

Dung lượng giảm khoảng **95,1%**, chủ yếu do thay logo SVG 4,12 MB bằng bản WebP 320px khoảng 29 kB và favicon nhỏ. Giữ file hình gốc. Đây là so sánh bước tối ưu ảnh/logo trên bản đã refactor, không phải mốc trước/sau toàn bộ dự án. Không kết luận LCP nhanh hơn vì kết quả tại mốc so sánh bằng nhau. Sau tối ưu, trang chi tiết có LCP p75 992 ms, CLS 0 trong fixture này. interactionDuration ghi nhận không đại diện cho INP thực tế.

## Việc cần làm ở môi trường triển khai

Chưa chạy migration apply, chưa deploy lên Atlas/staging và chưa xác minh SMTP/Cloudinary thật. Cần backup, dừng writer, đối soát và dựng bộ đếm trước khi bật nhận đặt lịch. Phải kiểm tra CSP với dịch vụ ngoài và quyền transaction trên staging. Các chỉ tiêu LCP/INP/CLS p75 thực tế cần đo sau triển khai; kết quả local không thay thế nghiệm thu này.

Quy tắc cập nhật: chấp nhận mọi khung giờ còn chỗ trong hôm nay Tokyo, kể cả giờ đã qua; ngày quá khứ trả past_date. Migration CLI tự sao lưu EJSONL trước khi ghi; test xác minh ObjectId/Date, SHA-256 và chạy lại không tăng bộ đếm. Xem booking-recovery.md để khôi phục đúng PM2 kokoro. Chưa áp dụng migration hoặc restart production do chưa có truy cập SSH.

Đã bổ sung smoke test khởi động production thật trên replica set test: chạy từ working directory khác, health/login trả 200. server.js nạp .env theo thư mục source; hướng dẫn PM2 truyền SITE_URL rõ ràng khi bật production. Log VPS đã xác nhận thiếu SITE_URL gây Startup failed; đã xác nhận phục hồi public sau restart từ terminal của người vận hành: /health và / trả 200, /admin chuyển 302 về /login và /login trả 200. API khung giờ hôm nay/ngày mai trả 200. API VPS vẫn trả reason=lead_time cho giờ 08:00 hôm nay, cho thấy phần bỏ giới hạn 60 phút chưa được nạp trên VPS; cần cập nhật toàn bộ bản sửa rồi restart.

Đã sửa booking với ADMIN_EMAIL: hai job email được tạo ordered:true trong transaction, retry không thêm đơn/job. Kiểm thử browser xác nhận tạo gói mô tả trống và ảnh PNG hợp lệ; Cloudinary giả lập, không upload thật. Ảnh hơn 5 MiB trả 413 upload_too_large với thông báo rõ ràng; trước đó log chung chỉ trả invalid_request. .env cục bộ đã được sửa lỗi dán lệnh PM2 vào SITE_URL; secret không bị thay đổi.

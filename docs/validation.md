# Kết quả kiểm tra — 18/10/2026

- `npm run build`: thành công, 26 tài nguyên có hash.
- `npm test`: **62/62 đạt**, gồm toàn bộ bộ CSRF cũ, transaction sức chứa, idempotency, kiểm tra dữ liệu, worker, migration và upload.
- `npm run test:browser`: **13/13 đạt**, Chromium; 16 lượt đặt qua hai luồng trong Asia/Ho_Chi_Minh, Asia/Tokyo, UTC, America/Los_Angeles. Tất cả giữ `2026-10-19 08:00 JST`. Không có lỗi JS/CSP được phát hiện trong những trang được kiểm tra.
- Đã tái hiện mất phản hồi sau commit và gửi lại: chỉ một đơn, một job email khách và một job email admin.
- Giá thay đổi trả 409, giữ thông tin liên hệ, chỉ lưu sau khi khách xác nhận tổng mới.
- 21 yêu cầu đồng thời cho 20 chỗ: 20 đơn, 1 xung đột; hủy/lưu trữ/khôi phục đồng bộ bộ đếm.
- Upload PNG thật hơn 5 MiB được chấp nhận qua middleware và form thêm gói; nội dung giả ảnh, thiếu CSRF vẫn bị từ chối trước Cloudinary; thư mục tạm được dọn.
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

Đã sửa booking với ADMIN_EMAIL: hai job email được tạo ordered:true trong transaction, retry không thêm đơn/job. Kiểm thử browser xác nhận tạo gói mô tả trống và ảnh PNG hợp lệ; Cloudinary giả lập, không upload thật. Theo yêu cầu mới, đã bỏ giới hạn dung lượng 5 MiB trong form và middleware. Kiểm thử sử dụng PNG thật hơn 5 MiB và Cloudinary giả lập; không xác minh giới hạn tài khoản Cloudinary/proxy production. .env cục bộ đã được sửa lỗi dán lệnh PM2 vào SITE_URL; secret không bị thay đổi.


Kiểm tra email admin: DB đang cấu hình có 2 job admin và 2 job khách đã done; không ghi dữ liệu hoặc gửi lại thông báo. Kết nối/xác thực SMTP thật qua check:mail thành công, không gửi email. Chưa thể kết luận thư đã vào Inbox. Bản sửa luôn giữ job admin ngay cả khi chưa có ADMIN_EMAIL, retry và hiển thị lỗi riêng; kiểm thử worker của cả hai luồng dùng SMTP giả lập xác minh đúng địa chỉ, thư admin riêng, Reply-To của khách và không done khi SMTP chưa chấp nhận người nhận. Địa chỉ nhận thực tế và trạng thái tắt gửi thông báo được hiển thị trên dashboard có đăng nhập. Chưa triển khai lên VPS.


Ngày 22/10/2026: tái hiện đăng nhập production thiếu cookie Secure khi Nginx kết thúc TLS và Node không tin cậy proxy. Log VPS cũng xác nhận thiếu X-Forwarded-Proto. Test production mới thất bại trước sửa với secure_session_cookie_missing, đạt sau sửa; kiểm tra đăng nhập thật bằng tài khoản test, session rotation, CSRF và mật khẩu sai. Bổ sung check:login chỉ GET trang công khai, không gửi thông tin đăng nhập. Chưa chỉnh Nginx hoặc restart VPS trực tiếp.

Hồi quy sau sửa login ngày 22/10/2026: npm test 56/56 đạt; npm run test:browser 13/13 đạt. Check login qua proxy giả lập đạt; HTTP không có header HTTPS bị phát hiện thiếu cookie như dự kiến.


Ngày 23/10/2026: tái hiện ảnh JPEG 24 MP khoảng 140 KB bị bộ kiểm tra 20 MP cũ chặn và báo nhầm upload_failed. Bản sửa xử lý ảnh tới 64 MP, xoay EXIF và tối ưu WebP tối đa 2560px; test kiểm tra ảnh >5 MiB, ảnh hỏng, guard độ phân giải, alpha, dọn tạm và rollback upload dở. Cloudinary ping cục bộ đạt bằng cấu hình hiện có; không upload/xóa tài nguyên thật và không ghi production DB. Log VPS chưa có upstreamStatus nên chưa xác nhận nguyên nhân chính xác của ảnh người dùng; cần kiểm tra trên VPS sau cập nhật mã.

Kết quả sau sửa ảnh 23/10/2026: npm test 62/62 đạt; npm run test:browser 13/13 đạt; build 26 tài nguyên thành công; check:uploads xác thực Cloudinary chỉ đọc đạt.

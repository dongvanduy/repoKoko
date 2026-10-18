# Triển khai và đối soát

## Khi VPS báo `asset is not defined`

Template mới gọi helper được đăng ký trong server mới. Lỗi này có thể xảy ra khi EJS đã đổi trên ổ đĩa nhưng tiến trình Node vẫn giữ JavaScript cũ trong bộ nhớ, hoặc PM2/systemd chạy entrypoint/cwd khác. Thiếu file CSS build là lỗi khác: thường trả 404 tài nguyên, không gây ReferenceError helper.

Bản hiện tại đăng ký asset/responsiveImage/jsonLd trong app.locals ngay khi tạo ứng dụng. Cả `npm start` và `node server.js` đều kiểm tra assets trước khi kết nối DB. Sau khi đưa **toàn bộ release** lên VPS, kiểm tra trong đúng thư mục:

```bash
cd /var/www/kokorokimono/repoKoko
node --version
npm ci --include=dev
npm run build
node scripts/hash-admin.js --write
NODE_ENV=production npm run check:deploy
```

Lệnh hash chạy lại được nếu đã có ADMIN_PASSWORD_HASH. Các lệnh kiểm tra không migrate hoặc ghi booking. Nếu check:deploy báo thiếu SITE_URL/secret/hash, sửa cấu hình trước khi restart; không tắt kiểm tra bảo mật để chạy tiếp. Node tối thiểu 22.13.1. Build ở thư mục release riêng nếu hệ thống có quy trình atomic deploy.

Với PM2, chạy `pm2 list`, chọn đúng tên/ID website, kiểm tra `pm2 describe TEN_APP` để bảo đảm script path là server.js trong thư mục trên, rồi `NODE_ENV=production pm2 restart TEN_APP --update-env`. Không restart all nếu VPS chạy dịch vụ khác. Nếu dùng ecosystem file, đặt NODE_ENV trong cấu hình tương ứng. Với systemd, restart đúng unit website. Tiến trình Node phải được khởi động lại sau cập nhật JavaScript; tải lại Chrome không làm việc này.

Xác minh `curl -I https://kokorokimono.com/` trả 200 và kiểm tra log riêng ứng dụng nếu không khởi động được. `/health` chỉ kiểm tra kết nối DB; đặt lịch vẫn cần migration bộ đếm như hướng dẫn bên dưới. Chưa kiểm tra hoặc sửa trực tiếp tiến trình VPS từ workspace này.

## Trạng thái và quy tắc dữ liệu

Giá JPY, tên gói, tùy chọn được tra lại trên máy chủ. Báo giá có chữ ký và gắn với session; thay đổi giá trả 409 để khách xác nhận lại. Các trạng thái chiếm chỗ là Mới, Đã đặt (Chờ đến), Đã xác nhận, Đã đến khi chưa lưu trữ. Hoàn tất, Đã hủy và đơn lưu trữ không chiếm chỗ, giữ quy tắc hiện có.

Booking, bộ đếm SlotInventory và tác vụ email được ghi cùng transaction. Unique index bảo vệ khóa khung giờ và khóa yêu cầu. Hủy/lưu trữ/khôi phục cập nhật chỗ trong transaction; khôi phục có thể trả 409 nếu đầy. Các đơn lịch sử trước hôm nay không tạo thêm bộ đếm quá khứ.

Trang kết quả chỉ mở bằng session đã đặt, kể cả có mã đơn. Session hết hạn sau 8 giờ hoặc thay đổi SESSION_SECRET sẽ mất quyền mở trang đó; email vẫn chứa thông tin xác nhận. Không thay secret tuỳ tiện giữa các instance.

## Migration lần đầu

**Chưa chạy migration lên Atlas trong quá trình phát triển.** Chỉ chạy khi đã có backup và cửa sổ bảo trì:

1. Thử toàn bộ quy trình trên staging replica set với bản sao dữ liệu đã loại thông tin cá nhân. Kiểm tra quyền tạo index và transaction.
2. Backup DB, ghi lại phiên bản ứng dụng. Dừng **tất cả** instance đang ghi booking, admin trạng thái và worker; không chạy song song mã cũ và mã mới.
3. Trong môi trường chạy migration, đặt `BOOKING_WRITES_ENABLED=false`. Chạy `node scripts/migrate-bookings.js` để đối soát chỉ đọc.
4. Báo cáo chỉ chứa ID, số lượng và mã lỗi. Sửa riêng các bản ghi bất thường sau đối soát; script không tự đoán ngày, giờ hoặc cửa hàng. Bản ghi đang chiếm chỗ nhưng sai dữ liệu sẽ chặn apply. Khung giờ đã vượt sức chứa được báo cáo và giữ nguyên số khách thực tế, không tự xóa đơn.
5. Chạy `node scripts/migrate-bookings.js --apply`. Script giữ nguyên date/time, bổ sung startsAt/guestCount/timeZone, dựng lại bộ đếm, đánh dấu Config `booking_inventory_v1.value.ready=true` **sau cùng**.
6. Nếu gián đoạn giữa chừng, giữ mọi writer dừng và chạy lại apply. Marker false chặn nhận đơn cho tới khi hoàn tất. Không chạy apply khi còn writer hoạt động.
7. Khởi động bản mới với `BOOKING_WRITES_ENABLED=true`, kiểm tra /health, form nhanh, nhiều bước, hủy/khôi phục và queue email. Mở traffic sau nghiệm thu.

Không chạy script seed vào DB có Plan. Không dùng booking hoặc slot test để sửa dữ liệu thật.

Rollback: dừng writer trước, backup phần dữ liệu mới, đối soát trước khi khôi phục. Mã cũ không cập nhật SlotInventory; nếu quay lại mã cũ, phải giữ đặt lịch tắt hoặc dựng lại bộ đếm từ toàn bộ Booking trước khi quay lại bản mới.

## Build, proxy, cookie và CSP

Build bằng `npm ci && npm run build` trong CI hoặc máy build có devDependencies. Triển khai cùng `public/assets/` và `locales/seo-prepared.json`; chỉ cài dependency production ở runtime nếu cần. Assets có hash và cache immutable một năm; giữ assets của release trước khi chuyển traffic để trang đang mở vẫn tải được.

Production cần `NODE_ENV=production`, `SITE_URL=https://...`, HTTPS và `TRUST_PROXY` là danh sách IP/CIDR proxy thực tế. Không đặt true hoặc số hop tùy ý. Kiểm tra X-Forwarded-Proto=https, cookie Secure/HttpOnly/SameSite=Lax và IP client chính xác trước nghiệm thu rate limit. Bí mật giống nhau giữa các instance; không lưu vào log.

Đặt `CSP_REPORT_ONLY=true` trên staging, xem vi phạm CSP trong trình duyệt cho trang chủ, blog, hai form, đăng nhập, drawer và upload quản trị. Sau khi sửa hết, đặt false để chặn. JS nội tuyến dùng nonce; handler HTML đã chuyển sang listener. style-src còn unsafe-inline để tương thích style/Swiper đang có; script-src không dùng unsafe-inline hoặc unsafe-eval. Chống nhúng trang qua frame-ancestors và X-Frame-Options.

## Tác vụ nền

Worker bật mặc định; có thể tắt bằng WORKER_ENABLED=false trong môi trường thử. Queue MongoDB có khóa duy nhất, lease 120 giây, heartbeat, retry tối đa 5 lần và backoff. Quản trị hiển thị pending/running/failed và cho retry job failed. Dịch nội dung theo version; kết quả cũ không ghi đè chỉnh sửa mới.

Nhắc lịch từ 07:00 Tokyo, quét bù mỗi phút cho lịch hôm nay chưa đến giờ. Đơn đã hủy/lưu trữ hoặc đã qua giờ sẽ bị bỏ qua. Sau khi downtime qua giờ hẹn, không gửi nhắc muộn.

SMTP có cơ chế **ít nhất một lần**: mất kết nối ngay sau khi nhà cung cấp nhận mail có thể khiến retry gửi lại. Message-ID cố định hỗ trợ nhận diện nhưng không bảo đảm nhà cung cấp khử trùng. Không có transaction chung giữa SMTP và MongoDB. Khi đổi cấu hình SMTP, khởi động lại worker.

Nội dung SEO dịch sẵn bằng `npm run seo:prepare` rồi đưa file JSON cùng release. Script tiếp tục phần còn thiếu, giữ bản đã hoàn tất. Nguồn thay đổi làm hash khác, website dùng tiếng Anh đến khi chuẩn bị lại. Dịch tự động cần người biên tập rà soát thuật ngữ trước xuất bản. Lỗi dịch không làm request khách chờ.

## Kiểm tra và theo dõi

Theo dõi /health, tỉ lệ 400/409/429/503, độ trễ route, số lỗi login và queue pending/failed. Log không ghi password, secret, email, số điện thoại hoặc request body. Xung đột sức chứa là 409 slot_full; maintenance/transaction lỗi là 503.

Nghiệm thu staging: hai luồng ở bốn múi giờ; đúng ranh giới 60 phút; sửa giá/gói; 21 yêu cầu cho 20 chỗ; gửi lại sau mất phản hồi; hủy và khôi phục; CSRF multipart; ảnh giả/ảnh quá 5 MiB; SMTP/Mongo/translation lỗi; không có CSP violation.

Đo hiệu năng trước/sau cùng thiết bị, cùng dữ liệu và cấu hình mạng trên staging. Chạy tối thiểu 5 lần cho mỗi trang, giữ báo cáo thô. Dữ liệu thật p75 mục tiêu LCP <= 2,5s, INP <= 200ms, CLS <= 0,1 cần theo dõi sau triển khai; kiểm thử local không chứng minh được các chỉ số này.

## Dependency

Runtime đã nâng Cloudinary 2.11.0, Multer 2.4.0, Mongoose 9.11.2, Nodemailer 10.1.2; bỏ adapter Cloudinary cũ. Audit production tại thời điểm kiểm tra: 0 cảnh báo.

Tailwind giữ dòng 3 theo yêu cầu. Audit đầy đủ hiện còn cảnh báo high ở chuỗi glob/braces của công cụ build. Chỉ build từ source tin cậy trong CI, không nhận glob từ người dùng; công cụ này không cần có trên runtime. Nâng Tailwind major cần công việc tương thích riêng; không dùng npm audit fix --force để đổi major ngoài ý muốn. Luôn chạy audit lại khi build release.

Đo local có thể lặp lại bằng `node scripts/measure-performance.js` (cần Chromium và MongoDB test binary). Báo cáo `test-results/performance.json` dùng 5 lượt mỗi trang, viewport 390×844, CPU 4×, RTT 150ms và tải xuống 200 kB/s. Đây là fixture nội bộ, loại tài nguyên bên thứ ba; interactionDuration của thao tác thử không thay thế INP thực tế.

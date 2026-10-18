# Khôi phục đặt lịch cho ứng dụng PM2 kokoro

Quy tắc mới: được đặt mọi khung giờ còn chỗ trong hôm nay Tokyo, kể cả giờ đã qua; chỉ chặn ngày quá khứ. Ngày mặc định vẫn là ngày mai Tokyo.

API khung giờ trả 503 khi BOOKING_WRITES_ENABLED=false hoặc Config booking_inventory_v1 chưa ready. Bỏ giới hạn 60 phút không tự khởi tạo bộ đếm. Không sửa marker bằng tay.

## Phân biệt .env với terminal

Trong .env, mỗi biến nằm trên một dòng riêng:

```dotenv
SITE_URL=https://kokorokimono.com
BOOKING_WRITES_ENABLED=true
NODE_ENV=production
```

Các lệnh npm, node và pm2 chạy trong terminal. Không dán nguyên lệnh `SITE_URL=... pm2 restart ...` vào .env. Secret và tài khoản giữ nguyên; không đưa .env lên Git.

## Booking POST 503 hoặc thêm gói 400

Nếu API khung giờ đã trả 200 nhưng POST /booking trả 503 khi ADMIN_EMAIL có cấu hình, cần bản sửa tạo tác vụ email với ordered:true trong transaction Mongoose. Không chạy lại migration chỉ để sửa lỗi batch email này. Gửi lại form cũ sau khi cập nhật mã không tạo thêm đơn nếu lần trước đã lưu thành công.

Form thêm gói cho phép mô tả trống. Ảnh JPEG/PNG/WebP tối đa 10 ảnh, mỗi ảnh không quá 5 MiB. Bản sửa kiểm tra giới hạn ở trình duyệt và trả thông báo cụ thể khi server từ chối, thay vì invalid_request chung. Log chỉ ghi loại/mã lỗi, không ghi request body hoặc tên file. Cloudinary không được gọi cho ảnh quá giới hạn.

## Nếu restart xong báo 502

502 cho biết proxy không nhận được phản hồi hợp lệ từ ứng dụng. Kiểm tra process trước; không chạy lại migration chỉ vì 502:

```bash
pm2 list
pm2 logs kokoro --lines 40 --nostream
```

Nếu log báo `Production requires an HTTPS SITE_URL.`, thiết lập SITE_URL cho cả lệnh kiểm tra và PM2:

```bash
cd /var/www/kokorokimono/repoKoko
SITE_URL=https://kokorokimono.com NODE_ENV=production node scripts/check-deploy.js
SITE_URL=https://kokorokimono.com BOOKING_WRITES_ENABLED=true NODE_ENV=production pm2 restart kokoro --update-env
curl -i http://127.0.0.1:3000/health
```

Chỉ restart sau khi kiểm tra thành công. Cổng 3000 là mặc định; dùng PORT của ứng dụng nếu đã đổi. Nếu health nội bộ trả 200 nhưng website vẫn 502, kiểm tra proxy_pass/port trong Nginx và log Nginx. Nếu health nội bộ không kết nối được, xử lý lỗi startup PM2 trước.

Sau khi health nội bộ đạt 200, chạy riêng `SITE_URL=https://kokorokimono.com BOOKING_WRITES_ENABLED=true NODE_ENV=production node scripts/check-deploy.js --booking` để xác minh bộ đếm. Nếu còn báo inventory chưa sẵn sàng, thực hiện phần migration bên dưới trong cửa sổ bảo trì; lỗi này trả 503 cho đặt lịch và không chặn khởi động các trang khác.

Lưu `SITE_URL=https://kokorokimono.com` và NODE_ENV=production trong cấu hình PM2/.env để lần khởi động sau dùng cùng cấu hình. Với Nginx, kiểm tra proxy tin cậy theo hướng dẫn deployment.md. Nếu log báo lỗi khác, dùng đúng dòng lỗi đó để chẩn đoán; không bỏ kiểm tra cấu hình hoặc đổi cổng ngẫu nhiên.

## Thực hiện trên VPS

Đưa toàn bộ bản sửa lên đúng release tại /var/www/kokorokimono/repoKoko trước khi chạy. Dùng Node >=22.13.1. Kiểm tra pm2 describe kokoro: script path phải là server.js trong release này, DB phải là DB muốn khôi phục. Nếu PM2 đặt MONGO_URI riêng, đồng bộ URI với .env dùng cho công cụ migration; không gửi URI vào chat/log.

Nếu có worker hoặc instance khác ghi cùng DB, dừng chúng trong cùng cửa sổ bảo trì. Không dùng pm2 stop all cho dịch vụ không liên quan.

Chạy theo thứ tự; chỉ chuyển bước khi lệnh trước thành công:

```bash
cd /var/www/kokorokimono/repoKoko
npm ci --include=dev
npm run build
SITE_URL=https://kokorokimono.com NODE_ENV=production npm run check:deploy
pm2 describe kokoro
pm2 stop kokoro
BOOKING_WRITES_ENABLED=false node scripts/migrate-bookings.js
BOOKING_WRITES_ENABLED=false node scripts/migrate-bookings.js --apply
BOOKING_WRITES_ENABLED=true SITE_URL=https://kokorokimono.com NODE_ENV=production node scripts/check-deploy.js --booking
BOOKING_WRITES_ENABLED=true SITE_URL=https://kokorokimono.com NODE_ENV=production pm2 restart kokoro --update-env
```

Lệnh dry-run chỉ đọc. Lệnh apply sao lưu bookings, slotinventories và Config marker trước khi ghi; giữ nguyên date/time, bổ sung startsAt/timeZone/guestCount và dựng lại bộ đếm. Nếu sao lưu hoặc đối soát thất bại, migration dừng. Marker chỉ ready sau khi hoàn tất; nếu bị gián đoạn, giữ writer dừng rồi chạy apply lại. Các bản sao lưu nằm ngoài public, được gitignore, file có quyền 0600 và thư mục riêng 0700 trên Linux; giữ lại để đối soát/khôi phục.

Manifest ghi số bản ghi và SHA-256 mỗi file EJSONL; BSON ObjectId/Date được giữ bằng Extended JSON canonical. Khôi phục phải dừng writer trước, xác minh hash và đúng DB; không dùng mongoimport JSON thường làm mất kiểu dữ liệu. Backup chỉ bao phủ collection migration tác động.

Đặt BOOKING_WRITES_ENABLED=true trong cấu hình khởi động PM2/.env sau khôi phục. Không đặt lại false ở lần deploy kế tiếp.

Kiểm tra production bằng GET, không tạo đơn giả cho khách:

```bash
curl -fsS https://kokorokimono.com/health
curl -fsS "https://kokorokimono.com/api/available-slots?date=$(node -p 'require("./lib/time").bookingCalendar().tomorrow')&shopId=1&totalQuantity=1"
pm2 logs kokoro --lines 50 --nostream
```

API phải trả 200 và mảng khung giờ; giao diện phải xuất hiện giờ và bật nút xác nhận khi chọn giờ còn chỗ.

## Đối soát đã thực hiện

Kiểm tra chỉ đọc DB từ cấu hình workspace ngày 18/10/2026: 59 đơn hợp lệ, 6 bộ đếm cần khởi tạo, không có blocker; MongoDB hỗ trợ transaction. Không có SSH key/agent từ workspace để dừng PM2. Vì vậy chưa áp dụng migration production hoặc restart VPS trong quá trình sửa mã; cần chạy các lệnh trên trong terminal VPS.

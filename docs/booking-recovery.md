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

Form thêm gói cho phép mô tả trống. Ảnh JPEG/PNG/WebP tối đa 10 ảnh cho mỗi gói. Đã bỏ giới hạn dung lượng mỗi ảnh ở trình duyệt và máy chủ; vẫn kiểm tra định dạng thật, ảnh tĩnh và tối đa 20 triệu điểm ảnh khi đọc metadata. Timeout gửi Cloudinary là 120 giây. Log chỉ ghi loại/mã lỗi, không ghi request body hoặc tên file. Cloudinary không được gọi khi nội dung không phải ảnh hợp lệ.

Giới hạn ngoài ứng dụng: Cloudinary áp dụng giới hạn theo tài khoản/API, Cloudflare và Nginx có thể giới hạn request upload. Nếu bị HTTP 413 trước khi request tới Node, kiểm tra cấu hình proxy trên VPS; thay đổi mã Node không tự sửa cấu hình này. Xem [Cloudinary upload](https://cloudinary.com/documentation/node_image_and_video_upload) và [Cloudflare upload limits](https://developers.cloudflare.com/network/maximum-upload-size/).

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

## Không nhận email thông báo cho admin

- `ADMIN_EMAIL` là địa chỉ nhận thông báo; `SMTP_USER` là tài khoản gửi. Hai địa chỉ có thể khác nhau. Không tự đổi người nhận hoặc gửi lại các job đã `done`.
- Mỗi đơn mới luôn có hai tác vụ riêng (khách và admin), ghi cùng transaction. Nếu thiếu địa chỉ admin, tác vụ vẫn được giữ để retry; email khách vẫn gửi độc lập. Thiếu cấu hình hoặc SMTP từ chối được hiển thị riêng là Email admin trong trang quản trị.
- Thư admin có tiêu đề “[Kokoro] Có đặt lịch mới — mã đơn”, lịch Tokyo và liên hệ khách. Nút trả lời hướng tới email khách.
- Chạy `npm run check:mail` trên VPS để kiểm tra địa chỉ nhận, worker và kết nối/xác thực SMTP mà không gửi thư. Công cụ đọc môi trường shell và .env; cần đối chiếu cấu hình tiến trình PM2 nếu kết quả khác.
- Sau khi cập nhật mã/cấu hình, chạy `pm2 restart kokoro --update-env`. Trong dashboard, mở “Email và bản dịch đang xử lý”; sau khi sửa cấu hình có thể nhấn “Thử lại” cho job failed.
- Dashboard hiển thị địa chỉ nhận thực tế trong tiến trình đang chạy. Nếu khác .env, cần cập nhật biến môi trường PM2 rồi restart; kiểm tra lại địa chỉ ngay trên dashboard.
- Log `email_accepted` chỉ xác nhận SMTP đã chấp nhận đúng người nhận. Nó không chứng minh thư vào Inbox; kiểm tra Spam, bộ lọc và thư trả lại tại hộp thư gửi nếu job đã done. Không tự gửi lại để tránh trùng thông báo.

## Đăng nhập admin bị 403 — cookie phiên và HTTPS

Log ngày 22/10/2026 cho thấy POST /login trả 403 trước bước kiểm tra mật khẩu. Trang login công khai có token CSRF nhưng không đặt cookie phiên. Nginx đang proxy về localhost:3000 và thiếu X-Forwarded-Proto; cấu hình trước đó cũng chưa tin cậy proxy. Không cần đổi mật khẩu, tắt CSRF hoặc bỏ Secure.

Bản sửa dùng danh sách proxy mặc định của production là `127.0.0.1/32,::1/128`. Cấu hình TRUST_PROXY hiện có vẫn được ưu tiên; có thể dùng `false` nếu Node nhận HTTPS trực tiếp. Proxy ở máy/container khác phải được khai báo IP/CIDR thực tế. Không dùng true hoặc số hop.

Trên VPS, tìm đúng file Nginx phục vụ tên miền:

```bash
sudo nginx -T 2>/dev/null | grep -E '^# configuration file|server_name|proxy_pass'
```

Sao lưu file đó trước khi sửa. Trong khối location đang chứa `proxy_pass http://localhost:3000;` của server HTTPS cho kokorokimono.com, giữ các dòng hiện có và bổ sung:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Host $host;
```

Các header này phải được Nginx ghi đè theo kết nối thực tế; không chuyển thẳng header từ trình duyệt. Bản mẫu đầy đủ cho riêng khối location:

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Giữ cấu hình TLS và các location khác. Sau khi cập nhật toàn bộ mã và Nginx, chạy trong terminal:

```bash
cd /var/www/kokorokimono/repoKoko
sudo nginx -t && sudo systemctl reload nginx
TRUST_PROXY=127.0.0.1/32,::1/128 pm2 restart kokoro --update-env
npm run check:login
```

Có thể lưu `TRUST_PROXY=127.0.0.1/32,::1/128` vào .env trên một dòng riêng. Lệnh restart ở trên cập nhật cả biến môi trường PM2 để tránh giữ giá trị cũ. Công cụ check:login chỉ GET trang public; không gửi username/password và không in token hoặc cookie. Nếu báo LOGIN_COOKIE_MISSING, kiểm tra lại server HTTPS của Nginx và cấu hình proxy đang chạy. Nếu Cloudflare đứng trước Nginx, kết nối từ Cloudflare tới origin cần dùng HTTPS cho khối TLS này.

Khi check:login đạt, tải lại /login để nhận token và cookie mới rồi đăng nhập. Form cũ mở trước thay đổi vẫn có thể bị từ chối. Kiểm thử production dùng replica set test đã xác nhận cookie Secure/HttpOnly/SameSite=Lax, POST hợp lệ vào /admin, đổi session sau login, từ chối token/session thiếu và mật khẩu sai.

Nguồn: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/), [Express session cookie](https://expressjs.com/en/resources/middleware/session/).

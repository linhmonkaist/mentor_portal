# SEM Scholars: cổng mentor

Trang web tĩnh (HTML, CSS, JS thuần, không cần build) để mentor xem mentee của mình. Dữ liệu lấy từ Google Sheet qua một API Apps Script. Xem [docs/API.md](docs/API.md) để biết chi tiết API.

```
Mentor (trình duyệt)  ->  GitHub Pages (trang tĩnh này)  ->  API Apps Script  ->  Google Sheet
```

## Mentor thấy gì
- Mentee của mình theo trạng thái: Active, Bảo lưu, Hoàn thành, Hủy.
- Mỗi mentee: tên, email, gói, thanh toán cho mentor, link mạng xã hội, link CV, số Zalo.
- Trong tab Active có bộ lọc "Chưa thanh toán" và "Đợt 1" (thanh toán cho mentor).
- Không thấy: Code, số tiền mentee đã đóng, hình thức thanh toán của mentee.
- Admin (email trong `ADMIN_EMAILS`): xem toàn bộ, hoặc chọn "Xem như mentor: …" để kiểm tra giao diện của một mentor (chỉ xem).

## Cài đặt

### 1. Backend (Google Sheet + Apps Script)
1. Mở Google Sheet "[SEM DB] Mentor" > Tiện ích mở rộng > Apps Script.
2. Dán ba file trong thư mục `backend/`: `Code.gs`, `MentorView.gs`, `Api.gs` (ba file riêng trong cùng dự án Apps Script).
3. Chạy hàm `setup` một lần và cấp quyền. Hàm này tạo các tab còn thiếu, đặt tiêu đề "Link MXH" và "Link CV" cho cột O và R nếu đang trống, và thêm các dòng cấu hình vào tab `Config`.
4. Trong tab `Config`, điền:
   - `ADMIN_EMAILS`: email của bạn (nhiều email cách nhau bằng dấu phẩy).
   - `FRONTEND_URL`: URL trang này, ví dụ `https://linhmonkaist.github.io/mentor_portal/`.
5. Triển khai > Tùy chọn triển khai mới > Ứng dụng web. **Thực thi dưới tên: Tôi. Người có quyền truy cập: Bất kỳ ai.** Chép URL kết thúc bằng `/exec`.
6. Mỗi khi sửa code Apps Script, tạo **phiên bản triển khai mới** thì thay đổi mới có hiệu lực.

### 2. Frontend (GitHub Pages)
1. Mở `assets/config.js`, điền `API_URL` bằng URL `/exec` ở bước trên, rồi commit.
2. Repo > Settings > Pages > Source: **Deploy from a branch**, chọn nhánh `main`, thư mục `/ (root)`.
3. Mở `https://<tài khoản>.github.io/mentor_portal/` và đăng nhập thử bằng email admin.

Muốn thử cục bộ: `python3 -m http.server 8000` rồi mở `http://localhost:8000`. Email đăng nhập vẫn trỏ về `FRONTEND_URL`, nên khi thử cục bộ hãy nhập mã 6 số thay vì bấm nút trong email.

## Bảo mật
- Địa chỉ API công khai là điều không thể tránh với trang tĩnh. An toàn dựa vào đăng nhập, không dựa vào việc giấu địa chỉ: mọi lệnh lấy dữ liệu cần token, token chỉ cấp sau khi người đó mở được email của mentor.
- Token ký HMAC bằng khóa bí mật nằm trong Script Properties (không có trong repo). Có thể thu hồi mọi phiên bằng menu trong Sheet.
- Giới hạn: 3 lần xin mã mỗi email mỗi 10 phút, 40 email đăng nhập mỗi giờ toàn hệ thống, khóa sau 5 lần nhập sai mã.
- Link trong email dùng phần sau dấu `#` nên token không gửi lên máy chủ và không lọt vào Referer. Mở link chỉ hiện trang xác nhận; phải bấm nút mới đăng nhập (tránh phần mềm quét email tự bấm).
- Trang dùng `textContent`, không dùng `innerHTML`, không nạp script bên thứ ba, có Content-Security-Policy giới hạn kết nối tới `script.google.com`.
- Repo này không chứa dữ liệu mentee hay khóa bí mật. Đừng commit bất kỳ dữ liệu thật nào vào đây.
- Phiên được lưu trong `localStorage` của trình duyệt. Mentor dùng máy chung nên bấm "Đăng xuất".

## Cấu trúc
```
index.html          Giao diện
assets/styles.css   Kiểu dáng
assets/app.js       Logic (đăng nhập, gọi API, hiển thị, bộ lọc)
assets/config.js    API_URL
docs/API.md         Đặc tả API
```

(Thư mục `backend/` chứa mã Apps Script để tiện sao chép. Hai bản phải luôn giống nhau với bản đang chạy trong Sheet.)

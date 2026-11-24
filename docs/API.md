# API của cổng mentor

Một địa chỉ duy nhất (URL `/exec` của ứng dụng web Apps Script). Mọi lệnh là `POST`, nội dung là JSON, gửi với `Content-Type: text/plain` (trình duyệt tự đặt khi body là chuỗi) để không cần bước kiểm tra CORS trước. Token đi trong nội dung gửi lên, không để trên URL.

`GET` trả về `{ "ok": true, "data": { "service": "sem-mentor-api", "status": "ok" } }` để kiểm tra sống, không có dữ liệu nào khác.

## Khuôn phản hồi

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "SESSION_EXPIRED", "message": "Phiên đăng nhập đã hết hạn." } }
```

Mã lỗi: `INVALID_EMAIL`, `RATE_LIMITED`, `INVALID_CODE`, `LINK_INVALID`, `SESSION_EXPIRED`, `NOT_FOUND`, `BAD_REQUEST`, `SERVER_ERROR`. Frontend dựa vào `code`; `message` là chữ tiếng Việt để hiển thị.

## Lệnh

### `requestLogin` (không cần token)
```json
{ "action": "requestLogin", "email": "mentor@gmail.com" }
```
```json
{ "ok": true, "data": { "message": "Nếu email có trong danh sách, chúng tôi đã gửi email đăng nhập. Email có hiệu lực 10 phút." } }
```
Trả lời giống nhau dù email có được phép hay không. Giới hạn 3 lần mỗi email trong 10 phút và 40 email mỗi giờ cho toàn hệ thống (`RATE_LIMITED`).

### `verifyCode` (không cần token)
```json
{ "action": "verifyCode", "email": "mentor@gmail.com", "code": "123456" }
```
```json
{ "ok": true, "data": { "token": "…", "expiresAt": "2026-12-24T01:00:00.000Z" } }
```
Sai thì `INVALID_CODE`. Sai 5 lần thì khóa (`RATE_LIMITED`).

### `redeemLink` (không cần token)
Dùng khi mentor bấm nút trong email (link dạng `https://…/#login=<64 ký tự hex>`). Frontend chỉ gọi lệnh này sau khi mentor bấm "Xác nhận đăng nhập".
```json
{ "action": "redeemLink", "linkToken": "<64 ký tự hex>" }
```
Phản hồi giống `verifyCode`. Link dùng một lần, hết hạn sau 10 phút (`LINK_INVALID`).

### `getMentees` (cần token)
```json
{ "action": "getMentees", "token": "…", "asMentor": "" }
```
```json
{ "ok": true, "data": {
  "me": "mentor@gmail.com",
  "role": "mentor",
  "view": { "mode": "mentor", "mentorNames": ["Linh Mon"] },
  "mentorList": [],
  "counts": { "Active": 3, "Bảo lưu": 0, "Hoàn thành": 5, "Hủy": 1 },
  "activePayment": { "unpaid": 1, "installment1": 2 },
  "mentees": [{
    "name": "Nguyễn An",
    "email": "a@x.com",
    "plan": "Gói Focus - GKS",
    "payment": "Đợt 1",
    "paymentGroup": "installment1",
    "status": "Active",
    "holdUntil": "",
    "cvUrl": "https://drive.google.com/…",
    "zalo": "0889141747"
  }]
} }
```
- `payment`: thanh toán **cho mentor** (cột Payment của sheet). Ô trống hiện là `"Chưa thanh toán"`.
- `paymentGroup`: `unpaid` (trống), `installment1` (Đợt 1), `done` (Done/Thưởng), `other`.
- `status`: `Active`, `Bảo lưu`, `Hoàn thành`, `Hủy`.
- `holdUntil`: chỉ có giá trị khi `status` là `Bảo lưu`.
- `cvUrl` lấy từ cột "Link CV" (cột R), `zalo` lấy từ cột "Zalo" (cột V). Link mạng xã hội của mentee không có trong API.
- `activePayment`: số mentee Active theo nhóm thanh toán (dùng cho chip lọc).
- Mentor chỉ nhận mentee của mình, không có `code`, không có số tiền, không có hình thức thanh toán của mentee.
- `role: "admin"` (email trong `ADMIN_EMAILS`):
  - `asMentor` trống: `view.mode = "all"`, toàn bộ mentee, mỗi mentee có thêm `code` và `mentorText`; `mentorList` là danh sách mentor để chọn.
  - `asMentor` là tên mentor: `view.mode = "impersonate"`, đúng dữ liệu mentor đó thấy (không có `code`). Tên không tồn tại thì `NOT_FOUND`.
  - Người không phải admin gửi `asMentor` thì bị bỏ qua.

### `logout`
Trả `{ "ok": true, "data": {} }`. Phiên được xóa phía trình duyệt. Muốn thu hồi mọi phiên, dùng menu **SEM Scholars > Đăng xuất mọi thiết bị** trong Google Sheet.

## Phiên đăng nhập
Token có dạng `payload.chữ ký` (HMAC-SHA256 với khóa bí mật chỉ nằm trong Script Properties), hiệu lực 30 ngày. Quyền được kiểm tra lại ở mỗi lần gọi: mentor bị xóa khỏi tab mentor sẽ mất quyền ngay dù token còn hạn.

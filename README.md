# Vehicle Care

Ứng dụng local-first gồm React frontend và Go API mock. Backend hiện dùng bộ nhớ trong process để frontend có thể được kiểm thử qua HTTP thật mà chưa cần PostgreSQL hoặc Redis.

## Yêu cầu

- Go 1.24+
- Node.js 22+
- npm
- GNU Make và Bash

## Chạy nhanh

```bash
make install
make dev
```

Các địa chỉ mặc định:

- Frontend: http://localhost:5173
- Backend: http://localhost:8080
- Liveness: http://localhost:8080/health/live
- Readiness: http://localhost:8080/health/ready

`make dev` tự tắt MSW và cấu hình frontend gọi backend Go. Nhấn `Ctrl+C` để dừng cả hai process.

Tài khoản demo:

```text
Email: demo@vehicle.app
Password: demo12345
```

Sau khi đăng nhập, frontend tự đăng ký `device_id`, push dữ liệu local và pull changefeed. Có thể mở tab hoặc browser profile thứ hai, đăng nhập cùng tài khoản và đồng bộ để kiểm tra dữ liệu đa thiết bị.

## Chạy riêng

Backend:

```bash
make dev-be
```

Frontend kết nối backend thật thay cho MSW:

```bash
make dev-fe
```

Frontend dùng MSW như trước:

```bash
npm run dev --prefix client
```

Backend tự đọc `.env` ở `server/` hoặc repository root nếu file tồn tại nhưng không ghi đè environment variables đã có. Có thể dùng `.env.example` làm danh sách cấu hình tham khảo. Với Kubernetes, inject environment variables trực tiếp và không mount `.env`.

## Kiểm tra

```bash
make test
make lint
make build
```

`make test-be` chạy Go tests với race detector. HTTP contract tests bao phủ login, cookie, CSRF, device registration, push dedupe và pull.

## API mock hiện tại

- Auth: signup, verify/resend email, login, session, logout, forgot/reset password.
- Google: `GET /auth/google/start` tạo tài khoản demo và redirect về frontend khi `MOCK_AUTH_ENABLED=true`.
- Device: `POST /devices/register`.
- Sync: `POST /sync/push` và `GET /sync/pull`.
- Session dùng cookie `sid`; request ghi đã xác thực cần cookie và header `X-CSRF-Token`.
- Push hỗ trợ idempotency, sequence theo account và LWW cho mutable entity.
- Pull dùng stable watermark trong suốt một phiên phân trang.

## Giới hạn phase này

- Toàn bộ account, session và dữ liệu sync mất khi backend restart.
- Email verification, password reset và Google OAuth chưa gửi email hoặc gọi provider thật.
- Chưa kết nối PostgreSQL hoặc Redis.
- Chưa có rate limiting và persistence production.
- Readiness hiện chỉ thể hiện process đã khởi tạo.
- Process từ chối khởi động với `APP_ENV=production` cho đến khi adapter PostgreSQL/Redis được triển khai, tránh deploy nhầm mock backend.

Nếu frontend không giữ session, kiểm tra frontend đang ở đúng `http://localhost:5173`, `FRONTEND_ORIGIN` khớp chính xác và `COOKIE_SECURE=false` khi chạy HTTP local. Nếu port frontend thay đổi, cập nhật cả `FRONTEND_ORIGIN` và URL frontend.

## Hướng phát triển backend

Domain và application chỉ phụ thuộc các port trong `server/internal/ports`. Phase persistence sẽ thêm PostgreSQL adapter dùng sqlc cho static typed query, sqlx cho connection/transaction orchestration, Redis adapter cho session và command migration trong `server/cmd/migrate`. API process không tự chạy migration khi startup.

Chi tiết contract nằm tại `.docs/sync-api-contract.md`; định hướng adapter nằm tại `server/ARCHITECTURE.md`.

# Vehicle Care

Ứng dụng local-first gồm React frontend và Go API. Backend dùng PostgreSQL (account + sync data) và Redis (session/token) thật; xem mục "Chạy nhanh" để khởi động cả hai qua Docker Compose trước khi chạy backend.

## Yêu cầu

- Go 1.24+
- Node.js 22+
- npm
- GNU Make và Bash

## Chạy nhanh

```bash
make install
make dev-infra    # docker compose up -d cho postgres + redis (xem server/docker-compose.yml)
make migrate-up   # áp dụng schema (đọc DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME)
make dev
```

Các địa chỉ mặc định:

- Frontend: http://localhost:5173
- Backend: http://localhost:8080
- Liveness: http://localhost:8080/health/live
- Readiness: http://localhost:8080/health/ready

`make dev` cấu hình frontend gọi backend Go thật. Nhấn `Ctrl+C` để dừng cả hai process.

Muốn khỏi phải nhớ chạy `make migrate-up` mỗi lần đổi migration lúc dev, set `AUTO_MIGRATE=true` trong `.env` (xem `.env.example`) — backend tự áp dụng schema còn thiếu ngay lúc khởi động, trước khi bắt đầu lắng nghe request. Mặc định tắt và chỉ nên bật ở local: production/Kubernetes vẫn giữ migration là một bước deploy tách biệt, tự chạy (xem `.docs/architecture.md`).

Tạo tài khoản mới qua màn hình đăng ký (không còn tài khoản demo dựng sẵn). Signup tự seed sẵn 10 `part_types` mặc định cho account mới (sửa/tắt/thêm tự do sau đó, không phải danh mục đóng cứng). Sau khi đăng nhập, frontend tự đăng ký `device_id`, push dữ liệu local và pull changefeed. Có thể mở tab hoặc browser profile thứ hai, đăng nhập cùng tài khoản và đồng bộ để kiểm tra dữ liệu đa thiết bị.

## Chạy riêng

Backend:

```bash
make dev-be
```

Frontend (kết nối backend thật):

```bash
make dev-fe
```

hoặc chạy trực tiếp Vite (cần backend đã chạy sẵn, hoặc set `VITE_API_BASE_URL` trỏ backend khác):

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
- Google: `GET /auth/google/start` hiện luôn trả lỗi 400 `validation_failed` ("not implemented yet") — OAuth thật chưa được build.
- Device: `POST /devices/register`.
- Sync: `POST /sync/push` và `GET /sync/pull`.
- Session dùng cookie `sid`; request ghi đã xác thực cần cookie và header `X-CSRF-Token`.
- Push hỗ trợ idempotency, sequence theo account và LWW cho mutable entity.
- Pull dùng `until_seq` stateless trong suốt một phiên phân trang.

## Persistence

Backend luôn dùng PostgreSQL (account + sync data) và Redis (session/token) thật — không còn backend giả lập trong process. Cần chạy trước khi `make dev-be`:

```bash
make dev-infra    # docker compose up -d cho postgres + redis (xem server/docker-compose.yml)
make migrate-up   # áp dụng schema (đọc DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME)
```

Biến môi trường liên quan xem `.env.example` (`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_SSLMODE`, `REDIS_*`). `/health/ready` ping cả Postgres và Redis, trả 503 nếu 1 trong 2 không sẵn sàng.

## Giới hạn phase này

- Email verification, password reset và Google OAuth chưa gửi email hoặc gọi provider thật.
- Chưa có rate limiting.
- `ApplyMutations` ở adapter Postgres chỉ hỗ trợ đúng 1 mutation/lần gọi (khớp caller thực tế hiện tại là `application.Service.Push`); xem plan tại `.claude/plans` để biết trade-off nếu cần batch thật sau này.
- `notification_deliveries` đã có migration nhưng chưa có code nào dùng (schema chuẩn bị cho tính năng nhắc lịch/notification, chưa implement).

Nếu frontend không giữ session, kiểm tra frontend đang ở đúng `http://localhost:5173`, `FRONTEND_ORIGIN` khớp chính xác và `COOKIE_SECURE=false` khi chạy HTTP local. Nếu port frontend thay đổi, cập nhật cả `FRONTEND_ORIGIN` và URL frontend.

## Hướng phát triển backend

Domain và application chỉ phụ thuộc các port trong `server/internal/ports` (`AccountStore`, `SyncStore`, `SessionStore`, `TokenStore`, gộp lại thành `Store`). PostgreSQL adapter (`server/internal/adapters/postgres`) dùng sqlc cho typed query, sqlx cho connection/transaction orchestration. Redis adapter (`server/internal/adapters/redis`) đảm nhiệm session/token. Migration chạy qua `go run ./cmd/migrate up|down|status|create <name>` (hoặc
`make migrate-up`/`migrate-down`/`migrate-status`/`migrate-create
name=<name>`) — API process không tự chạy migration khi startup. `part_types` không còn
seed global qua migrate nữa — mỗi account tự có bộ 10 dòng mặc định riêng, được tạo
trong transaction lúc signup (`postgres.Store.CreateAccount`, xem
`internal/adapters/postgres/seed`). File migration đặt
tên theo unix timestamp (`<unix_timestamp>_<name>.up.sql`/`.down.sql`, ví dụ
`1789663949_create_accounts.up.sql`) để tránh xung đột số thứ tự khi nhiều người cùng
thêm migration trên các branch khác nhau; `migrate create` tự sinh timestamp và tên đã
chuẩn hoá snake_case.

Chi tiết contract nằm tại `.docs/sync-api-contract.md`; định hướng adapter nằm tại `.docs/ARCHITECTURE.md`.

## Tài liệu hệ thống và review

- [Hệ thống và luồng nghiệp vụ hiện tại](.docs/system-flow.md): kiến trúc, mô hình dữ liệu, nghiệp vụ và vòng đời push/pull theo implementation ngày 23/09/2026.
- [Review structure, convention và giải pháp sync](.docs/structure-sync-review.md): phát hiện ưu tiên, các phương án đơn giản hóa và lộ trình breaking changes đề xuất.
- [Plan incremental sync A](.docs/incremental-sync-plan.md): invariants, checklist nghiệm thu và runbook reset dev thủ công.

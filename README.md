# Vehicle Care

Ứng dụng quản lý KM, bảo dưỡng và chi phí xe máy, local-first: React/TypeScript +
IndexedDB, Go/Gin API, PostgreSQL (account/sync) và Redis (session/token).

**Tài liệu cập nhật 2026-10-26:** [Quyết định, kiến trúc, dữ liệu và API](.docs/decision.md).
Đây là tài liệu Markdown có thẩm quyền duy nhất trong `.docs/`; hai HTML chỉ là prototype.

## Chạy nhanh

Yêu cầu Go 1.25.11, Node.js 22+, npm, GNU Make/Bash và Docker Compose.

```bash
make install
make dev-infra
make migrate-up
make dev
```

Tham khảo [`.env.example`](.env.example) cho DB/Redis/cookie/origin. Backend đọc `.env`
ở server/root nếu có, không override environment có sẵn. FE http://localhost:5173,
API http://localhost:8080, health `/health/live` và `/health/ready` (ping PG + Redis).
Ctrl+C dừng hai process; hạ tầng dừng riêng bằng `make dev-infra-down`.

`make dev-be`/`make dev-fe` chạy riêng; Vite trực tiếp `npm run dev --prefix client`
vẫn cần backend thật, không MSW. `make dev` cấu hình FE gọi localhost:8080.
Không có demo account: signup mới sẽ seed 10 hạng mục riêng account, sửa/tắt/thêm được.
Đăng nhập cùng account ở profile thứ hai để kiểm tra sync đa thiết bị.

Google login là tùy chọn, mặc định tắt. Tạo Google OAuth **Web application** client,
đăng ký callback local `http://localhost:8080/auth/google/callback`, rồi cấu hình
`GOOGLE_OAUTH_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL`
ở backend. Xem [hướng dẫn cấu hình và rollout](.docs/decision.md#cấu-hình-google-auth-platform).
Tài khoản email/password liên kết Google trong Settings sau khi nhập lại password;
không tự liên kết theo email. Không đưa Client Secret vào frontend hay Git.

Nếu không giữ session, kiểm tra FRONTEND_ORIGIN khớp origin/port frontend và
COOKIE_SECURE=false khi dùng HTTP local. Production inject env trực tiếp, không mount
`.env`; chạy migration bước deploy riêng. AUTO_MIGRATE mặc định false, true chỉ tiện local.

## Kiểm tra

```bash
make test
make lint
make build
make test-integration
npm run test:coverage:contracts --prefix client
npm run test:e2e --prefix client
```

Go tests dùng race detector. Test PG tùy chọn trong `make test` có thể skip nếu Docker
thiếu; `make test-integration` bắt buộc PG testcontainers thật, tắt cache và fail nếu
Docker không chạy. Vitest sync-flow mock HTTP không thay browser E2E.
Playwright cần browser đã cài: `cd client && npx playwright install chromium` (và FFmpeg
cho video nếu chưa có). Nếu dùng Google Chrome hệ thống, chạy
`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e --prefix client` từ repository root.
E2E dùng API mock, không kiểm thử backend/PWA offline navigation thật. Coverage gate
chỉ áp dụng contract/persistence; không phải coverage toàn source hoặc gate timezone riêng.
Xem [phạm vi và tình trạng kiểm chứng](.docs/decision.md#9-kiểm-chứng-và-nghiệm-thu).

## Contract và giới hạn

- Email/password hoặc Google OIDC, cookie sid HttpOnly; protected POST cần cookie + X-CSRF-Token.
- Account timezone là fixed UTC offset, không IANA/DST; save online có stale-account guard.
- Entity + immutable outbox atomic local; push FIFO từng mutation, idempotent retry,
  mutable full-record server-order LWW. Pull phân trang cùng until_seq, canonical equal-seq.
- Odometer chỉ thêm; Fuel/Service sửa/xóa mềm không cascade sửa/xóa KM.
- Có repair blocked và restore local từ server cần xác nhận; không tự reset dữ liệu.
- Chưa email delivery/notification worker, export/import, guest, OCR, Plus hoặc fuel
  efficiency. reminder_notification mới có schema. Google thật cần cấu hình credentials
  và nghiệm thu trên staging; browser mock không thay xác minh Google/cookie thật.
- Contract TS dùng const-derived types, sáu payload map và discriminated push/pull/enqueue;
  tăng kiểm tra compile-time, không thay wire/storage, không thay runtime validation.

## Migration và tài liệu

- [Contract, payload/constraints, auth/security, sync và recovery](.docs/decision.md)
- [Runbook migration/deploy và reset dev thủ công](.docs/decision.md#8-local-migration-deploy-và-reset)
- [Quy trình migration/query/sqlc](server/db/README.md)

Baseline `1790121600_baseline` chỉ cho DB sạch. DB dùng lịch sử cũ (kể cả
`20260923000000`) hoặc đã apply cùng version trước khi sửa không tự upgrade bằng
migrate-up. Cảnh báo upgrade không tương thích: `received_at_server`, `cost_vnd`,
`name_vi`/`seed_version` cũ thay bằng server_synced_at, cost (VND), name; device UUID,
Fuel bỏ shop. Outbox legacy bất biến không được giữ lại khi thay DB. Chỉ chủ động dùng
DB/workspace dev sạch sau backup, theo runbook; **không tự drop schema khi deploy**.

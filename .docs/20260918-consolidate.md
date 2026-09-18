# Tổng hợp kỹ thuật — App Nhắc bảo dưỡng xe máy

*Tài liệu này ĐÚC KẾT lại các quyết định/kế hoạch đang nằm rải rác trong `.docs/*` và
README, đối chiếu với code thực tế tại thời điểm viết (2026-09-18), để có 1 điểm vào
duy nhất trả lời "hiện tại hệ thống thế nào, còn thiếu gì". Tài liệu này KHÔNG thay thế
các file nguồn — `decision.md` vẫn là nguồn sự thật nghiệp vụ, `design.html` +
`design-decoded-reference.html` vẫn là nguồn sự thật về UI prototype. Khi có mâu thuẫn
giữa tài liệu này và `decision.md`, `decision.md` thắng; hãy sửa `decision.md` trước
rồi cập nhật lại đây.

Xem đề xuất giữ/bỏ các file cũ ở [mục 6](#6-đề-xuất-giữ--bỏ-file-cũ).

---

## 1. Kiến trúc hiện tại (đã build, không còn là "kế hoạch")

```
client/  — React 19 + TS + Vite + Tailwind v4 + shadcn/ui + Zustand + Dexie.js + MSW
server/  — Go, hexagonal:
  cmd/api                    composition root
  cmd/migrate                go run ./cmd/migrate up|down|status|seed
  internal/domain            model độc lập transport
  internal/application       use case: auth, device, sync
  internal/ports             interface AccountStore/SyncStore/SessionStore/TokenStore (Store)
  internal/adapters/httpapi  Gin, cookie, CSRF, CORS
  internal/adapters/memory   store trong process (mock/dev)
  internal/adapters/postgres sqlc (typed query) + sqlx (transaction) — account + sync data
  internal/adapters/redis    session/token
  internal/platform          config, logging
  db/migrations, db/queries, sqlc.yaml
```

**Đã cập nhật (2026-09-18):** tài liệu kiến trúc backend đã được move từ
`server/ARCHITECTURE.md` sang [`.docs/ARCHITECTURE.md`](ARCHITECTURE.md), và đã sửa
phần "Planned persistence layout" trong đó — layout Postgres/Redis đã tồn tại và chạy
được, không còn là "planned" nữa.

Backend chọn persistence qua `STORE_DRIVER`:
- `memory` (mặc định dev/test): mọi thứ sống trong process, mất khi restart.
- `live`: Postgres (account + sync data) + Redis (session/token) thật, cần
  `make dev-infra && make migrate-up && make migrate-seed`. `APP_ENV=production` bắt
  buộc `live` (từ chối boot nếu không).

## 2. Trạng thái triển khai — đã xong vs còn thiếu

### 2.1. Đã xong (verify qua code + `npm run build`/`test`, `make test`)

- **Domain thuần** (`client/src/domain/*`): reminder status, odometer, validation,
  partType, datetime — có test, không phụ thuộc DOM/DB.
- **Local-first data layer** (`client/src/data/*`): Dexie schema, seed PartType cố
  định, mapper camelCase↔snake_case, outbox (mọi write tự enqueue outbox cùng
  transaction), repositories theo entity, queries kết hợp domain logic.
- **UI đầy đủ các trang chính**: Auth (sign up/in, quên mật khẩu, verify email),
  onboarding thêm xe, AppShell responsive (sidebar desktop / bottom tab mobile),
  VehicleSwitcher, Home (odometer card, overdue/due-soon/recently-logged), History,
  Costs, Settings (account, garage, reminder management, app settings), Log Entry
  (2 bước Fuel/Service). Route `/v/:vehicleId/reminders` + `ReminderEditor`/
  `ReminderManagement` cũng đã có — **không được nhắc trong bất kỳ tài liệu plan nào**,
  đây là phần đã "mọc" thêm ngoài kế hoạch gốc, cần nhớ khi đọc lại `decision.md`/
  `implementation-plan-section-5.md`.
- **Sync engine** (`client/src/sync/*`): push (coalesce theo entity, xử lý đủ 5 status),
  pull (phân trang theo `after_seq`/`watermark`/`has_more`, chỉ nâng `last_seen_seq` sau
  khi transaction lưu xong 1 trang), `syncOrchestrator`, `autoSync` (foreground + online +
  quá 15 phút, đúng D-09/6.4 của `decision.md`).
- **Backend Go**: toàn bộ endpoint auth + `/devices/register` + `/sync/push` +
  `/sync/pull` theo đúng shape của `sync-api-contract.md`; áp dụng transaction 1 lock
  (allocate seq + update entity + append changefeed + ghi processed-mutation) — mock
  adapter (`memory`) và Postgres adapter đều tuân theo cùng bất biến này. Có Go contract
  test cho login/cookie/CSRF/device/push-dedupe/pull.
- **Đối chiếu với `decision.md`**: LWW theo thời điểm server nhận, append-only cho
  3 loại log, tombstone qua `deleted_at`, ngưỡng due_soon = 10% (hằng số hệ thống, không
  cho user chỉnh), danh sách 10 PartType — tất cả đã implement khớp 100% với file
  `client/src/domain/constants.ts`, `client/src/data/seed.ts`,
  `server/internal/adapters/postgres/seed/manifest.go`.
- **Đã chủ động lệch khỏi prototype `design.html` đúng như yêu cầu**: không có UI
  Scan (OCR) hay Upgrade/Plus, không có card "Fuel efficiency" ở Costs, không có nút
  Download ở History, "Warn me ahead by" hiển thị read-only.

### 2.2. Còn thiếu / biết trước là gap (không phải bug, là scope đã cắt cho MVP)

- **Google OAuth thật**: chỉ có `GET /auth/google/start` gọi `LoginGoogleDemo` (mock,
  gate bằng `MOCK_AUTH_ENABLED`) — **không có `/auth/google/callback`**. Hợp đồng ở
  `sync-api-contract.md` §2.5-2.6 mô tả flow redirect/callback thật nhưng chưa build.
- **Không gửi email thật** cho verify-email / reset password / OAuth — README tự nhận
  đây là giới hạn phase này.
- **Chưa có rate limiting** ở bất kỳ endpoint nào (`sync-api-contract.md` §3, §5 yêu
  cầu rate-limit theo email/IP cho auth và độc lập cho sync — chưa làm).
- **Postgres `ApplyMutations` chỉ nhận đúng 1 mutation/lần gọi** — khớp với caller
  hiện tại (`application.Service.Push` gọi từng mutation), nhưng KHÔNG đúng với
  batch-100-mutation/request mà cả `decision.md` D-08 và `sync-api-contract.md` §2.12
  mô tả ở mức API. Nói cách khác: **API contract cho phép client gửi batch 100, nhưng
  bên trong, Postgres adapter xử lý tuần tự từng cái một** — không sai về hành vi (vẫn
  atomic từng mutation, vẫn đúng LWW/dedupe) nhưng chưa tối ưu cho throughput cao. Xem
  `README.md` mục "Giới hạn phase này" nếu cần đổi.
- **Không có `domain-user-flows.md` riêng** như Workstream B của
  `implementation-plan-section-5.md` đề ra — logic flow nằm trực tiếp trong
  `client/src/domain/*` + repositories, không có tài liệu happy/offline/error-path
  dạng văn xuôi riêng. Có thể coi là đã "làm thay bằng code + test" thay vì bằng doc.
  Nếu cần tài liệu hoá lại, đây là phần duy nhất của Workstream B chưa có output rõ.
- **Chưa có `vite-plugin-pwa`** (service worker/manifest) — biết trước, không bắt buộc
  cho MVP theo agent-handoff.md.

## 3. Data model & business rules — tóm tắt để tra nhanh

*(Nguồn đầy đủ: [`decision.md`](decision.md) — đọc file đó khi cần chi tiết/lý do.)*

- **Append-only** (không sửa/xoá): `OdometerLog`, `FuelLog`, `ServiceLog`.
- **Mutable, LWW theo thời điểm server nhận** (không dùng client clock), xoá bằng
  `deleted_at`: `Vehicle`, `ReminderConfig`.
- **Static seed**: `PartType` — 10 code cố định (`engine_oil`, `front_tire`,
  `rear_tire`, `front_brake_pad`, `rear_brake_pad`, `spark_plug`, `air_filter`,
  `drive_belt`, `chain_sprocket_set`, `battery`), UUID/code không tái sử dụng, ngừng
  dùng bằng `active=false` chứ không xoá cứng.
- **Odometer hiện tại** = suy ra từ `OdometerLog.recorded_at` mới nhất (tie-break bằng
  thứ tự server nhận). **Lần bảo dưỡng gần nhất** = suy ra từ `ServiceLog` mới nhất —
  không lưu field mutable riêng cho 2 giá trị này.
  Cho phép lưu KM thấp hơn giá trị hiện tại (không âm thầm loại bỏ dữ liệu offline)
  nhưng phải cảnh báo trước khi xác nhận.
- **Trạng thái reminder**: `insufficient_data` / `not_due` / `due_soon` / `overdue`.
  Quá hạn nếu MỘT TRONG HAI điều kiện (KM/thời gian) quá hạn; tiến độ tính riêng từng
  điều kiện. Ngưỡng due_soon = 10% chu kỳ còn lại, là hằng số hệ thống
  (`DUE_SOON_REMAINING_RATIO`), không phải setting per-reminder.
- **Reminder chưa có ServiceLog**: dùng mốc KM/ngày ban đầu do user nhập lúc tạo.
- **Timezone**: timestamp lưu UTC; reminder theo ngày tính theo timezone của Account.
- **Sync**: push batch tối đa 100 mutation/request; pull page size 100; auto-sync
  best-effort khi foreground + online + lần sync gần nhất > 15 phút.
- **Email reminder**: job định kỳ server-side, chỉ dựa dữ liệu đã sync, 1 lần / mốc đến
  hạn (idempotency key chống gửi trùng).
- **Auth (đã SUPERSEDE đề xuất OTP/magic-link ban đầu ở `decision.md` §3.2)**: hiện tại
  là email+password hoặc Google OAuth, session cookie (`sid` httpOnly + `csrf_token`
  không httpOnly, double-submit CSRF), lưu Redis. Xem mục 4.

## 4. API / Auth / Sync contract — tóm tắt

*(Nguồn đầy đủ, có ví dụ request/response, sequence diagram: [`sync-api-contract.md`](sync-api-contract.md).
File đó vẫn là bản hợp đồng chi tiết — sửa nó TRƯỚC nếu đổi shape, rồi đồng bộ
`client/src/api/contract.types.ts` SAU.)*

- **Cookie**: `sid` (HttpOnly, Secure, SameSite=Lax) đối chiếu Redis;
  `csrf_token` (không HttpOnly) — mọi request state-changing phải gửi lại giá trị này ở
  header `X-CSRF-Token`.
- **Endpoint auth**: `POST /auth/signup|login|logout|verify-email[/resend]`,
  `POST /auth/password/forgot|reset`, `GET /auth/session`,
  `GET /auth/google/start` (**mock ở production thật, chưa có callback thật**).
- **Device**: `POST /devices/register`. Không có API "merge" riêng cho first-login —
  push toàn bộ outbox local như mutation mới rồi pull `after_seq=0` là đủ, vì dedupe
  theo UUID + LWW theo server-time tự nhiên tạo ra kết quả merge.
- **`POST /sync/push`**: mỗi mutation trả 1 trong 5 status —
  `applied` / `duplicate` (trả lại đúng kết quả gốc, không LWW lại) /
  `rejected` (không retry) / `retryable_error` / `conflict_resolved` (vẫn apply theo
  LWW, kèm `server_snapshot` để client biết có xen ngang).
- **`GET /sync/pull?after_seq&limit&watermark`**: watermark cố định trong 1 phiên phân
  trang để tránh mutation mới chen vào giữa lúc đang lấy nhiều trang; client chỉ nâng
  `last_seen_seq` sau khi 1 trang đã lưu xong trong local transaction (lỗi giữa chừng →
  rollback, cursor giữ nguyên).
- **Error envelope chung**: `{ error: { code, message, retryable, request_id } }` với
  7 code cố định (`auth_invalid`, `session_expired`, `validation_failed`,
  `ownership_invalid`, `unsupported_version`, `rate_limited`, `internal_error`).
- **Bảo mật**: mọi query scope theo `account_id` suy từ session, KHÔNG BAO GIỜ nhận từ
  payload client; entity account khác → xử lý như không tồn tại.

## 5. Vận hành / dev

- `make install && make dev` — chạy full stack, FE :5173, BE :8080.
- `make dev-be` / `make dev-fe` — chạy riêng backend/frontend (frontend nối backend
  Go thật thay MSW).
- `npm run dev --prefix client` — frontend dùng MSW như cũ, không cần backend.
- `make test` / `make lint` / `make build` — CI gate; `make test-be` chạy race detector.
- `STORE_DRIVER=live` cần `make dev-infra` (docker compose Postgres+Redis) +
  `make migrate-up` + `make migrate-seed`.
- Tài khoản demo: `demo@vehicle.app` / `demo12345`.

## 6. Đề xuất giữ / bỏ file cũ

**Đã xử lý trong lượt cập nhật này (2026-09-18):**
- `agent-handoff.md` — **đã xoá** (theo yêu cầu). Lưu ý: vài quy tắc convention hữu
  ích của file này (không dùng TS `enum`, `verbatimModuleSyntax`, alias `@/`, layering
  rule domain→data→sync→api→stores→pages) chưa được chuyển sang nơi nào khác trước
  khi xoá — nếu cần tra lại, phải lấy từ git history (`git log -- .docs/agent-handoff.md`).
- `client/README.md` — **đã xoá** (theo yêu cầu). File này mô tả convention i18n
  (`vi-VN`, `src/i18n/locales/vi.ts`, không hardcode string) và theming (semantic
  Tailwind token, `next-themes`) — cũng chưa được chuyển sang nơi khác, chỉ còn trong
  git history nếu cần.
- `server/ARCHITECTURE.md` → **đã move** thành [`ARCHITECTURE.md`](ARCHITECTURE.md)
  (cùng cấp với các file `.docs/*` khác) và đã sửa phần "Planned persistence layout"
  — layout Postgres/Redis đã tồn tại và chạy được, không còn là "planned".
- [`sync-api-contract.md`](sync-api-contract.md) — đã sửa dòng mở đầu (không còn nói
  "backend thật CHƯA được xây dựng") và đánh dấu rõ §2.5-2.6 (Google OAuth callback)
  là "spec cho tương lai, hiện tại chỉ có mock start-endpoint".

**Không đổi (theo yêu cầu, và vẫn còn giá trị làm nguồn sự thật):**
- [`decision.md`](decision.md) — nguồn sự thật nghiệp vụ. Chỉ 1 điểm đã lỗi thời:
  §3.2 (đề xuất OTP/magic-link) — đã bị đổi hướng bởi `sync-api-contract.md`. Có thể
  thêm 1 dòng note "xem sync-api-contract.md — auth đã đổi sang session cookie +
  Google OAuth" ngay tại §3.2 để người đọc sau không hiểu nhầm, nhưng không cần viết
  lại cả file.
- [`design.html`](design.html) + [`design-decoded-reference.html`](design-decoded-reference.html) —
  giữ nguyên, là artifact prototype gốc + bản giải mã đi kèm 1-1, không phải prose nên
  không có gì để "rút gọn".

**Cân nhắc archive/xoá (giá trị còn lại thấp, nội dung hữu ích đã được đúc kết vào tài liệu này hoặc đã thành code):**
- [`implementation-plan-section-5.md`](implementation-plan-section-5.md) — đây là kế
  hoạch triển khai cho 4 đầu việc đã được triển khai xong (schema, seed PartType, API
  contract). Phần còn giá trị lâu dài (quy ước field `account_id`/`created_at_client`/
  `received_at_server`/`server_seq`/`deleted_at`, invariant transaction changefeed) đã
  được tóm ở mục 3-4 tài liệu này. Phần ước lượng thời gian (mục 14) và mốc M1-M7 (mục
  11) đã hết tác dụng vì việc đã xong. Có thể archive toàn file, chỉ giữ lại mục 9
  (kế hoạch test) và mục 10 (observability) làm checklist QA nếu còn cần.

Gợi ý cách làm nếu muốn dọn: tạo 1 thư mục `.docs/archive/` và di chuyển 2 file trên
vào đó (không xoá vĩnh viễn), thay vì `rm` — vẫn tra được lịch sử quyết định khi cần
mà không làm rối `.docs/` hiện tại. Mình chưa di chuyển/xoá gì — đợi bạn xác nhận.

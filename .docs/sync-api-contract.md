# Sync API Contract — App Nhắc bảo dưỡng xe máy

*Đây là hợp đồng dùng chung frontend/backend. Sửa tài liệu này TRƯỚC, rồi đồng bộ tay
`client/src/api/contract.types.ts` SAU — không được để 2 nơi lệch shape nhau. Tài liệu
này mở rộng mục D (D1-D8) của `implementation-plan-section-5.md`, áp dụng quyết định
auth mới (session cookie + Redis + Google OAuth) thay cho đề xuất OTP/magic-link ban
đầu trong `decision.md`.*

Trạng thái triển khai hiện tại: **frontend/backend đã implement contract sync tuần tự A**.
Một số ví dụ lịch sử bên dưới vẫn giữ shape cũ để tham khảo; các override ở mục 2.15
là nguồn sự thật cho implementation hiện tại. Frontend đã implement UI + client API layer đúng
theo tài liệu này. Backend Go thật (bao gồm adapter Postgres + Redis) đã được xây
dựng và implement gần như toàn bộ hợp đồng này** — xem `.docs/TONG-HOP-KY-THUAT.md`
mục 2 để biết chi tiết trạng thái đã xong/còn thiếu. Hai gap còn lại so với hợp đồng:
(1) `GET /auth/google/callback` ở mục 2.6 — hiện `GET /auth/google/start` chỉ trả lỗi
400 `validation_failed` ("not implemented yet"), CHƯA có flow đổi `code` lấy Google
profile thật; (2) chưa gửi email thật cho verify-email/
password reset. Mục tiêu của tài liệu vẫn là để backend dev triển khai đúng ngay từ
đầu mà không phải đổi shape phía frontend — sửa tài liệu này trước khi đổi shape.

## 1. Auth model

Email+password hoặc Google OAuth. Xác thực bằng **session cookie**, KHÔNG dùng bearer
token trong `Authorization` header.

- Server lưu session trong **Redis**: `session:<session_id> → { account_id, device_id, created_at, expires_at, user_agent }`, TTL trượt (đề xuất 30 ngày, gia hạn mỗi request có xác thực thành công).
- Cookie session (`sid`) chỉ mang 1 chuỗi opaque đối chiếu với Redis — KHÔNG mã hoá thông tin nhạy cảm trong cookie (không phải JWT tự chứa claim).
- Thuộc tính cookie bắt buộc:
  ```
  Set-Cookie: sid=<opaque-session-id>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
  ```
- **CSRF (double-submit cookie)**: vì `HttpOnly` khiến JS không đọc được `sid` (đúng mục đích chống XSS đánh cắp session), server phải đồng thời set 1 cookie thứ 2 **KHÔNG** `HttpOnly`:
  ```
  Set-Cookie: csrf_token=<opaque>; Secure; SameSite=Lax; Path=/; Max-Age=2592000
  ```
  Mọi request state-changing (POST/PUT/PATCH/DELETE) client phải đọc cookie `csrf_token` và gửi lại ở header `X-CSRF-Token`; server so khớp header với giá trị cookie/Redis. Request GET không cần (chỉ đọc, không đổi state). Request thiếu hoặc sai CSRF token → 403 `validation_failed`.
- Đăng nhập thành công (signup/login/google callback) → set cả 2 cookie cùng lúc, rotate `csrf_token` mỗi lần đăng nhập mới.
- Đăng xuất / reset password thành công → xoá session khỏi Redis + clear cả 2 cookie. Reset password nên revoke **toàn bộ** session khác của account đó (đăng xuất mọi thiết bị) vì mật khẩu đã đổi.

### 1.1. Chính sách verify email — 2 phương án, backend chọn 1

- **A. Đăng nhập ngay sau signup** (khuyến nghị cho MVP để giảm friction): `POST /auth/signup` set cookie session ngay, `email_verified=false`. App vẫn dùng được, nhưng 1 số hành động nhạy cảm sau này (nếu có) có thể yêu cầu verified.
- **B. Chặn đến khi verify**: `POST /auth/signup` KHÔNG set cookie, chỉ trả `verification_required`; phải verify xong mới login được.

Frontend hiện implement theo giả định **A** (UX mượt hơn) nhưng route `CheckEmailPage`
vẫn hiển thị sau signup ở cả 2 phương án — nếu backend chọn B thì chỉ cần đổi hành vi
set-cookie, không đổi UI.

## 2. Endpoints

### 2.1. `POST /auth/signup`

```json
// Request
{ "email": "minh@gmail.com", "password": "matkhau123", "name": "Minh Trần" }
// Response 201
{ "status": "verification_required", "email": "minh@gmail.com" }
```
Set-Cookie: `sid`, `csrf_token` (nếu chọn phương án A ở mục 1.1).
Lỗi: `validation_failed` (email sai định dạng/mật khẩu quá ngắn <8 ký tự), `409` nếu email đã tồn tại (dùng code `validation_failed`, message riêng — không tạo mã lỗi mới chỉ cho case này).

### 2.2. `POST /auth/verify-email`
```json
{ "token": "eyJhbGciOi..." } → { "status": "verified" }
```
Token hết hạn/không hợp lệ → `validation_failed`.

### 2.3. `POST /auth/verify-email/resend`
```json
{ "email": "minh@gmail.com" } → 200 (body rỗng)
```
Luôn trả 200 kể cả email không tồn tại (không lộ thông tin tài khoản). Rate-limit theo email (chống spam).

### 2.4. `POST /auth/login`
```json
// Request
{ "email": "minh@gmail.com", "password": "matkhau123" }
// Response 200
{ "account": { "id": "acc_1", "email": "minh@gmail.com", "name": "Minh Trần", "timezone": "Asia/Ho_Chi_Minh", "email_verified": true } }
```
Set-Cookie: `sid`, `csrf_token`. Sai email/password → 401 `auth_invalid` (KHÔNG phân biệt "email không tồn tại" vs "sai mật khẩu" trong message, tránh lộ thông tin).

### 2.5. `GET /auth/google/start?redirect_uri=...`
302 redirect sang Google OAuth consent screen. `state` param CSRF-safe do backend tự sinh và lưu tạm (Redis, TTL ngắn ~10 phút), verify lại ở callback.

### 2.6. `GET /auth/google/callback?code=...&state=...`
Backend đổi `code` lấy Google profile, tạo account nếu email Google chưa tồn tại
(auto-verified vì Google đã verify email hộ), set-cookie `sid`+`csrf_token`, 302
redirect về frontend (vd `/v/{lastVehicleId}/home` hoặc `/onboarding/add-vehicle`
nếu account mới chưa có xe nào).

> **Ghi chú triển khai hiện tại:** callback thật ở mục 2.6 CHƯA được build. Backend Go
> (`server/internal/adapters/httpapi`) hiện chỉ có `GET /auth/google/start` trả lỗi
> 400 `validation_failed` ("not implemented yet") — route được giữ nguyên vị trí
> trong contract nhưng không set-cookie, không đổi `code` lấy Google profile thật.
> Không còn nhánh mock/demo nào (đã xóa `LoginGoogleDemo`, `MOCK_AUTH_ENABLED`, và
> đường tắt MSW ở frontend cùng toàn bộ `client/src/mocks/**`). Khi build callback
> thật, giữ đúng shape ở mục 2.5/2.6 và thay handler hiện tại bằng flow OAuth thật.

### 2.7. `POST /auth/password/forgot`
```json
{ "email": "minh@gmail.com" } → 200 (rỗng)
```
Luôn trả 200 generic — không lộ email có tồn tại hay không. Rate-limit theo email + IP.

### 2.8. `POST /auth/password/reset`
```json
{ "token": "...", "new_password": "matkhaumoi123" } → { "status": "reset" }
```
Revoke toàn bộ session Redis của account sau khi reset thành công.

### 2.9. `GET /auth/session`
```json
// 200 — còn phiên hợp lệ
{ "account": { "id": "acc_1", "email": "minh@gmail.com", "name": "Minh Trần", "timezone": "Asia/Ho_Chi_Minh", "email_verified": true } }
// 401 — chưa đăng nhập/hết hạn
{ "error": { "code": "session_expired", "message": "Session expired or missing.", "retryable": false, "request_id": "req_abc" } }
```
Gọi 1 lần lúc app khởi động để hydrate `useSessionStore`.

### 2.10. `POST /auth/logout`
Header bắt buộc: `X-CSRF-Token`. 204 No Content, clear cả 2 cookie, xoá session khỏi Redis.

### 2.11. `POST /devices/register`
```json
// Request (cần session hợp lệ)
{ "device_id": "3f2a...", "platform": "web", "app_version": "0.1.0" }
// Response 200
{ "device_id": "3f2a...", "registered_at": "2026-09-17T10:00:00.000Z" }
```
Không có endpoint "merge" riêng cho first-login: sau khi đăng nhập + đăng ký device,
client push toàn bộ mutation local hiện có (kể cả data tạo trước khi có account) như
mutation mới, rồi pull `after_seq=0`. Vì log dedupe theo UUID và mutable dùng LWW theo
thời điểm server nhận, đây tự nhiên chính là merge — không cần thuật toán riêng.

### 2.12. `POST /sync/push` (D2)

Header bắt buộc: `X-CSRF-Token`. Batch tối đa `100` mutation/request (D-08, giới hạn cấu hình được).

```json
// Request
{
  "device_id": "3f2a...",
  "api_version": "1",
  "mutations": [
    {
      "mutation_id": "9c1e...",
      "entity_type": "reminder_config",
      "operation": "update",
      "entity_id": "rc_1",
      "base_server_seq": 40,
      "payload": { "interval_km": 5000, "interval_days": null, "enabled": true, "deleted_at": null }
    },
    {
      "mutation_id": "a71b...",
      "entity_type": "odometer_log",
      "operation": "create",
      "entity_id": "ol_9",
      "payload": { "odometer_km": 42180, "recorded_at": "2026-09-17T03:00:00.000Z", "source": "manual", "note": null }
    }
  ]
}
```

```json
// Response — mỗi mutation trả đúng 1 kết quả, theo thứ tự request
{
  "results": [
    { "mutation_id": "9c1e...", "status": "applied", "server_seq": 42, "received_at_server": "2026-09-17T10:00:00.000Z" },
    { "mutation_id": "a71b...", "status": "applied", "server_seq": 43, "received_at_server": "2026-09-17T10:00:00.001Z" }
  ]
}
```

Ví dụ `duplicate` (retry sau khi mất response — client gửi lại nguyên `mutation_id`):
```json
{ "mutation_id": "9c1e...", "status": "duplicate", "server_seq": 42, "received_at_server": "2026-09-17T10:00:00.000Z" }
```
Server PHẢI trả lại **đúng kết quả gốc** đã lưu khi mutation đó lần đầu applied — không được LWW lại lần thứ 2 dù dữ liệu hiện tại đã khác.

Ví dụ `rejected` (payload sai/ownership sai — vd sửa `vehicle_id` không thuộc account):
```json
{ "mutation_id": "b2c3...", "status": "rejected", "error_code": "ownership_invalid", "error_message": "Vehicle does not belong to this account." }
```

Ví dụ `retryable_error` (lỗi tạm thời phía server, client giữ nguyên `mutation_id` gửi lại sau):
```json
{ "mutation_id": "c3d4...", "status": "retryable_error", "error_code": "internal_error", "retryable": true }
```

Ví dụ `conflict_resolved` (client push dựa trên `base_server_seq=40`, nhưng thiết bị
khác đã đẩy 1 bản mới hơn — `server_seq=41` — TRƯỚC mutation này; mutation của client
vẫn được áp dụng như bản MỚI NHẤT theo đúng LWW-theo-thời-điểm-server-nhận, server chỉ
kèm thêm snapshot hiện tại để client biết đã có thay đổi xen giữa mà mình chưa pull):
```json
{
  "mutation_id": "9c1e...",
  "status": "conflict_resolved",
  "server_seq": 42,
  "received_at_server": "2026-09-17T10:00:00.000Z",
  "server_snapshot": { "interval_km": 5000, "interval_days": null, "enabled": true, "deleted_at": null }
}
```
Vì `server_snapshot` ở đây trùng với payload vừa gửi (do mutation của client là bản
thắng), client không cần làm gì thêm ngoài ghi nhận `server_seq`. `server_snapshot`
CHỈ khác payload gửi lên trong trường hợp — theo đúng thiết kế LWW-by-server-receipt —
sẽ không xảy ra ở model này (mutation luôn thắng chính nó); field này tồn tại chủ yếu
để tương lai nếu đổi sang model 3-way-merge phức tạp hơn thì shape response không đổi.

### 2.13. `GET /sync/pull?after_seq&limit&watermark` (D4)

```
GET /sync/pull?after_seq=41&limit=100&watermark=
```

```json
{
  "changes": [
    {
      "server_seq": 42,
      "entity_type": "reminder_config",
      "entity_id": "rc_1",
      "operation": "update",
      "payload": { "vehicle_id": "veh_1", "part_type_id": "engine_oil-uuid", "interval_km": 5000, "interval_days": null, "enabled": true, "deleted_at": null },
      "received_at_server": "2026-09-17T10:00:00.000Z"
    },
    {
      "server_seq": 43,
      "entity_type": "odometer_log",
      "entity_id": "ol_9",
      "operation": "create",
      "payload": { "vehicle_id": "veh_1", "odometer_km": 42180, "recorded_at": "2026-09-17T03:00:00.000Z", "source": "manual", "note": null },
      "received_at_server": "2026-09-17T10:00:00.001Z"
    }
  ],
  "next_cursor": 43,
  "watermark": "wm_9f8e7d",
  "has_more": false,
  "server_time": "2026-09-17T10:00:05.000Z"
}
```

`watermark`: để trống ở request ĐẦU của 1 phiên pull; server sinh và trả về, client
TÁI SỬ DỤNG watermark này cho các trang tiếp theo trong CÙNG phiên (để tập kết quả
nhất quán dù có mutation mới chen vào giữa lúc đang phân trang — change mới hơn
watermark sẽ đợi phiên pull SAU). Khi `has_more=false`, phiên pull kết thúc, watermark
bỏ đi (phiên sau để trống lại).

Client chỉ nâng `last_seen_seq` cục bộ = `next_cursor` SAU KHI đã lưu xong toàn bộ
`changes` của trang đó trong 1 local transaction — lỗi giữa chừng thì rollback,
`last_seen_seq` giữ nguyên, lần pull sau tự động lấy lại từ chỗ cũ.

### 2.14. `GET /part-types`

```json
// Response 200
{
  "part_types": [
    { "id": "649e41d9-00f8-4929-b343-407e4896060d", "code": "engine_oil", "name_vi": "Dầu nhớt động cơ", "display_order": 1, "active": true, "seed_version": "v1", "account_id": "acc_1" },
    { "id": "b2f1...", "code": "b2f1...", "name_vi": "Phanh đĩa sau (độ)", "display_order": 999, "active": true, "seed_version": "custom", "account_id": "acc_1" }
  ]
}
```

Không còn khái niệm dòng global dùng chung mọi account. `part_type` LÀ entity mutable
thật trong change-feed (có `server_seq`, đi qua `sync/push`/`sync/pull` như `vehicle`),
luôn thuộc về đúng 1 account (`account_id` không bao giờ `null`) — kể cả 10 dòng "mặc
định" cũng chỉ là dữ liệu được server tự copy vào account lúc signup (transaction cùng
lúc tạo account), sửa/tắt được y hệt hạng mục tự thêm sau đó. Endpoint này trả TOÀN BỘ
danh mục của account gọi request (kể cả `active=false`) — client tự lọc theo `active`
khi hiển thị picker; đây vẫn là cách bootstrap/full-refresh, còn tạo/sửa/xoá (soft, qua
`active`) đi qua `POST /sync/push` với `entity_type: "part_type"`. Quy ước bắt buộc CHỈ
áp dụng cho `operation: "create"`: `payload.code` PHẢI bằng chính `entity_id` của mutation
(server từ chối `validation_failed` nếu sai) — cách này tránh đụng độ với ràng buộc
`UNIQUE(account_id, code)` mà không cần thêm 1 query kiểm tra riêng (vì `entity_id` luôn
là UUID mới, không trùng ai). Ràng buộc này KHÔNG áp dụng cho `update` — hạng mục seed có
`code` (vd `"engine_oil"`) khác hẳn `id` (UUID) và vẫn phải sửa/tắt được bình thường; quy
tắc "code == entity_id" chỉ có ý nghĩa lúc tạo mới. `UpsertPartType` cũng không cho phép
đổi `code` qua nhánh update (chỉ `name_vi`/`active` được ghi đè). Server chỉ chấp nhận `update` khi `part_type` đó thuộc
đúng account gửi request (`ownership_invalid` nếu không).

## 3. Error model (D6)

Mọi lỗi 4xx/5xx trả cùng envelope:
```json
{ "error": { "code": "rate_limited", "message": "Too many requests.", "retryable": true, "request_id": "req_9f8e7d" } }
```

| code | Khi nào | HTTP status | retryable |
|---|---|---|---|
| `auth_invalid` | Sai email/password, token OAuth không hợp lệ | 401 | false |
| `session_expired` | Cookie session thiếu/hết hạn/không còn trong Redis | 401 | false |
| `validation_failed` | Payload sai định dạng/constraint | 400 | false |
| `ownership_invalid` | Entity không thuộc account của session hiện tại (coi như không tồn tại) | 403 | false |
| `unsupported_version` | `api_version` client gửi quá cũ, server không còn hỗ trợ | 400 | false |
| `rate_limited` | Vượt giới hạn request | 429 | true (kèm `Retry-After` header) |
| `internal_error` | Lỗi tạm thời phía server | 500 | true |

## 4. Sequence diagram (dạng text)

### 4.1. Retry push sau khi mất response

```
Client                                   Server
  |--- POST /sync/push (mutation_id=X) --->|
  |                                        |-- apply, ghi server_seq=42, lưu kết quả
  |<---------- (kết nối rớt trước khi client nhận response) -----|
  |  (client KHÔNG BIẾT server đã apply hay chưa)
  |--- POST /sync/push (mutation_id=X, retry) --->|
  |                                        |-- thấy mutation_id=X đã xử lý (dedupe)
  |<--- { status: "duplicate", server_seq: 42, ... } (kết quả GỐC, không LWW lại) ---|
```

### 4.2. Pull nhiều trang bị ngắt giữa chừng

```
Client (last_seen_seq=0)                 Server
  |--- GET /sync/pull?after_seq=0&watermark= --->|
  |<--- { changes: [1..100], next_cursor:100, watermark:"wm_A", has_more:true } ---|
  |-- lưu 100 change trong 1 transaction, transaction OK --> last_seen_seq=100
  |--- GET /sync/pull?after_seq=100&watermark=wm_A --->|
  |         (transaction lưu trang này BỊ LỖI giữa chừng — vd tab đóng đột ngột)
  |-- rollback, last_seen_seq VẪN LÀ 100 (không tăng)
  |--- GET /sync/pull?after_seq=100&watermark=wm_A (retry, watermark cũ vẫn dùng được) --->|
  |<--- { changes: [101..150], next_cursor:150, watermark:"wm_A", has_more:false } ---|
  |-- lưu OK --> last_seen_seq=150, phiên pull kết thúc
```

### 4.3. First-login merge (thiết bị có data local trước khi có account)

```
Client (đã dùng offline, có Vehicle/OdometerLog local, chưa có account)
  |--- POST /auth/signup hoặc /auth/login --->|  (set-cookie sid+csrf)
  |--- POST /devices/register --->|
  |-- gắn account_id vào mọi outbox item local hiện có (data tạo trước khi có account)
  |--- POST /sync/push (toàn bộ outbox, coi như mutation mới) --->|
  |<--- results (applied cho từng mutation) ---|
  |--- GET /sync/pull?after_seq=0 --->| (full pull — có thể đã có data từ thiết bị khác cùng account)
  |<--- changes (log dedupe theo UUID, mutable ghi đè theo LWW) ---|
  |-- kết quả: local giờ chứa hợp nhất data của cả 2 nguồn, không cần thuật toán merge riêng
```

## 5. Bảo mật & giới hạn (D7)

- Mọi query entity/changefeed scope theo `account_id` suy từ session — KHÔNG BAO GIỜ nhận `account_id` từ payload client.
- Entity thuộc account khác → xử lý như không tồn tại (`ownership_invalid`, không tiết lộ nó có tồn tại ở account khác).
- `device_id` phải đã đăng ký với đúng account của session hiện tại.
- Client không tự gán `server_seq`, `received_at_server`, hay trạng thái gửi email.
- Rate-limit auth endpoints (login/signup/forgot) và sync endpoints (push/pull) độc lập nhau.
- Validate payload ở cả API layer lẫn database constraint (không tin tưởng riêng 1 lớp).
- Log có request_id/mutation_id/server_seq nhưng KHÔNG log password, token, OTP, hay nội dung payload nhạy cảm.

## 6. Current implementation override — incremental sync A

Mục này là nguồn sự thật cho code hiện tại; các ví dụ cũ ở mục 2.12–4.3 về
`base_server_seq`, `conflict_resolved` và `watermark` được xem là historical.

### 6.1. Push tuần tự và recovery

- Request vẫn giữ `{ mutations: [...] }` để không phải đổi HTTP envelope, nhưng client gửi một mutation mỗi request.
- Server xử lý theo thứ tự và trả prefix kết quả. Khi một mutation trả `rejected` hoặc `retryable_error`, server dừng, các mutation phía sau chưa được xử lý.
- `applied` và `duplicate` là terminal-success. `duplicate` trả acknowledgment đã lưu của mutation ID cũ.
- `rejected` là terminal failure. Client chuyển item thành `blocked`, không tự gửi lại payload đó.
- `retryable_error` là temporary failure. Client giữ item `pending`, chỉ gửi lại khi người dùng bấm **Thử lại**.
- Timeout/mất response giữ nguyên mutation ID và payload để retry idempotent; không được sửa envelope khi chưa biết server đã commit hay chưa.
- Device ID cũng giữ nguyên theo workspace IndexedDB. Server khóa account sequence trước lookup idempotency để concurrent retry trả ACK cũ thay vì reject do unique-key race.
- Item blocked có nguyên nhân và có hai đường: repair bằng mutation ID mới hoặc khôi phục toàn account từ server.
- Repair thay blocked envelope bằng mutation ID mới ngay tại vị trí FIFO cũ; nếu entity đã có revision local mới hơn, repair không ghi đè snapshot mới đó.
- Sync và restore dùng chung account lock. Restore đang chạy hoặc đã lỗi sẽ chặn local entity write cho đến khi tiếp tục thành công hoặc người dùng đăng xuất.

### 6.2. Pull với `until_seq`

Request hiện tại:

```text
GET /sync/pull?after_seq=41&limit=100
GET /sync/pull?after_seq=100&limit=100&until_seq=150
```

Response có:

```json
{
  "changes": [],
  "next_cursor": 150,
  "until_seq": 150,
  "has_more": false,
  "server_time": "2026-09-23T10:00:00Z"
}
```

Server không còn tạo/lưu watermark. Trang đầu chụp sequence hiện tại làm `until_seq`; các trang sau dùng lại đúng bound đó. Change mới sau bound chờ phiên pull tiếp theo.

Client chỉ apply một page khi outbox account vẫn sạch trong cùng Dexie transaction với entity và cursor. Nếu có pending/blocked, page không được apply và cursor không tăng.

Ví dụ response rỗng trên tương ứng request đã ở `after_seq=150`. Trang `has_more=true` phải có tiến triển cursor. Edit local trong lúc chờ response làm lượt sync chuyển `pending`, không thành lỗi retryable. Canonical fields được áp dụng kể cả khi `server_seq` bằng metadata từ push ACK; ACK chỉ xác nhận mutation, không chứa business fields đã chuẩn hóa.

### 6.3. Trạng thái thành công

`last_synced_at` chỉ được cập nhật sau khi push hết queue, pull hoàn tất và không còn
pending/blocked. Một mutation local mới làm trạng thái quay về chưa đồng bộ; timestamp
thành công cũ chỉ còn là thông tin lịch sử.

### 6.4. PartType seed

Mười PartType mặc định được tạo cùng account sequence và append vào changefeed trong
transaction signup. Thiết bị mới pull từ `after_seq=0` sẽ nhận cả seed catalog; endpoint
`GET /part-types` chỉ còn là endpoint đọc phụ trợ, không phải replication path bắt buộc.
PartType inactive không xuất hiện trong picker tạo mới, nhưng server vẫn chấp nhận reference
từ record offline nếu PartType đó thuộc đúng account. ReminderConfig ID được sinh xác định
từ account + vehicle + PartType để concurrent offline create cùng scope hội tụ về một ID.

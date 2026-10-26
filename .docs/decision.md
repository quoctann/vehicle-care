# Vehicle Care — quyết định và hệ thống hiện hành

**Cập nhật: 2026-10-26.** Tài liệu Markdown có thẩm quyền duy nhất trong `.docs/`;
thay thế các bản contract, tổng hợp, review và plan cũ. Đối chiếu working tree và SQL,
không coi có code là đã nghiệm thu. Phạm vi kiểm chứng riêng tại mục 9.

## 1. Phạm vi

Một account quản lý nhiều xe máy, nhập KM, ghi đổ xăng/bảo dưỡng, đặt chu kỳ KM/ngày,
xem reminder, lịch sử và chi phí. **Local-first, eventual consistency**, không realtime:
UI đọc/ghi IndexedDB trước; chỉ sau sync thành công dữ liệu mới có trên server/thiết bị khác.
Không nội suy KM, không tự điền chu kỳ theo thông số hãng.

Đã triển khai: email/password và Google OIDC + session cookie, liên kết Google có
xác thực lại password, catalog riêng account, xe/reminder,
Odometer chỉ thêm, Fuel/Service sửa/xóa mềm, outbox FIFO, push/pull, repair/restore,
PWA app-shell cache, healthcheck, migration và regression tests. Màn hình chính: Auth,
onboarding, Home, History, Costs, Settings và Log Entry. Hạng mục đặt trong Settings,
không cần tab điều hướng chính thứ năm.

**Chưa triển khai:** email delivery (verify/reset/nhắc lịch), notification worker,
export/import, guest trước lần đăng nhập đầu tiên
và guest-to-account merge, OCR/Scan, Plus/Upgrade, fuel efficiency.
Schema/token/placeholder không phải tính năng hoàn chỉnh. Không còn memory backend,
MSW hoặc tài khoản demo dựng sẵn.

[design.html](design.html) và [design-decoded-reference.html](design-decoded-reference.html)
là artifact prototype giữ nguyên byte, tham khảo bố cục chứ không cam kết chức năng.

## 2. Kiến trúc và nguồn implementation

```text
React UI → repositories → Dexie entity + immutable outbox (một transaction)
   ↑            ↓
queries + domain thuần          FIFO sync → cookie/CSRF HTTP
                                              ↓
Go/Gin → application user/datasync → PostgreSQL (entity/sequence/feed/ACK)
                                  → Redis (session/token)
```

| Vùng | Nguồn / trách nhiệm |
|---|---|
| Entry, UI | `client/src/App.tsx`, `routes`, `pages`, `components`, `hooks`: hydrate, route guard, form/live query |
| Domain | `client/src/domain`: types, validation, datetime, odometer, reminder thuần |
| Local data | `client/src/data/db.ts`, `mappers.ts`, `outbox.ts`, `repositories`, `queries` |
| Sync | `client/src/sync`: bootstrap, push/pull/applyChange, autoSync, restore, accountLock/sessionGuard |
| API/session | `client/src/api/contract.types.ts`, `client.ts`, `client/src/stores/useSessionStore.ts` |
| Backend entry | `server/cmd/api`: config, composition, graceful shutdown; `cmd/migrate`: migration CLI |
| Application | `server/internal/application/{user,datasync}`; port ở `port.go`, không có tầng `internal/ports` |
| HTTP | `server/internal/adapters/httpapi`: Gin, cookies, CSRF/CORS, errors |
| Persistence | `server/internal/adapters/postgres`: sqlc typed SQL + sqlx transaction; Redis adapter: session/token |
| SQL | `server/db/{migrations,queries}`, `server/sqlc.yaml`; generated models nằm trong adapter |

Application không phụ thuộc adapter; generated SQL models không vượt boundary.
Frontend domain không phụ thuộc DOM/DB; store UI mỏng, entity ở IndexedDB.
Wire snake_case, domain/local camelCase qua mapper. UI dùng i18n, semantic theme tokens;
alias `@/` là `client/src`. TypeScript dùng const-derived types thay enum runtime.
Không cần CRDT, command bus, generic registry/repository hay queue phân tán trong scope này.

## 3. Mô hình và từ điển dữ liệu

### 3.1. Entity và metadata

| Entity | Quy tắc |
|---|---|
| Account | Email duy nhất không phân biệt hoa/thường, bcrypt hash nullable (Google-only), tên, timezone, verified |
| Device | UUID đăng ký theo account trước push; PK `(account_id,id)` |
| Vehicle | Mutable; tên, biển số, ngưỡng; archive có thể mở lại; tombstone `deleted_at` |
| PartType | Mutable, riêng account; thêm/sửa/tắt `active`, không xóa cứng |
| ReminderConfig | Mutable; một scope xe+hạng mục chưa tombstone, kể cả khi disabled |
| OdometerLog | Append-only, chỉ create, dedupe entity ID; không sửa/xóa |
| FuelLog | Mutable/xóa mềm; link Odometer tùy chọn, không cascade sửa/xóa KM |
| ServiceLog | Mutable/xóa mềm; log chưa xóa mới nhất làm mốc reminder |

Entity UUID sinh trên client ngay khi tạo; mutation UUID riêng cho mỗi thao tác.
Reminder ID xác định từ account + xe + hạng mục để concurrent offline create hội tụ.
PartType seed có UUID riêng từng account, không dùng ID global cố định.

| Metadata | Ý nghĩa |
|---|---|
| `account_id` | Authorization lấy từ session, không tin payload làm nguồn quyền |
| `server_seq` | Thứ tự/phiên bản tăng theo account, không phải timestamp/KM |
| `server_synced_at` | Thời điểm server ghi nhận; local `serverSyncedAt` |
| `lastSeenSeq` | Cursor local pull đã commit; ACK push không nhảy cursor |
| `localSeq` | FIFO tăng theo account trong workspace, không xếp theo đồng hồ |
| `deviceId` | Cố định trong IndexedDB syncMeta; mất/đổi localStorage không đổi retry identity |
| `createdAtClient` | Metadata local, không quyết định conflict mutable trên server |

### 3.2. Sáu payload snapshot hiện hành

Business payload **toàn bản ghi, không phải patch**; IDs/type/operation ở envelope,
server metadata không do client tự gán. `T?` dưới đây nghĩa `T | null` (outgoing TS
vẫn khai báo đầy đủ nullable keys). Timestamp RFC3339 lưu UTC; date `YYYY-MM-DD`.

| `entity_type` | Payload |
|---|---|
| `vehicle` | `name: string`, `plate_number: string?`, `archived_at: timestamp?`, `deleted_at: timestamp?`, `due_soon_ratio: number?` |
| `reminder_config` | `vehicle_id: UUID`, `part_type_id: UUID`, `interval_km: number?`, `interval_days: integer?`, `baseline_odometer_km: number?`, `baseline_date: date?`, `enabled: boolean`, `deleted_at: timestamp?` |
| `odometer_log` | `vehicle_id: UUID`, `odometer_km: number`, `recorded_at: timestamp`, `source: "manual" | "fuel"`, `note: string?` |
| `fuel_log` | `vehicle_id: UUID`, `recorded_at: timestamp`, `liters: number?`, `cost: number?`, `note: string?`, `odometer_log_id: UUID?`, `is_full_tank: boolean`, `deleted_at: timestamp?` |
| `service_log` | `vehicle_id: UUID`, `part_type_id: UUID`, `serviced_at: timestamp`, `odometer_km_snapshot: number?`, `cost: number?`, `note: string?`, `deleted_at: timestamp?` |
| `part_type` | `code: string`, `name: string`, `display_order: integer`, `active: boolean` |

Ràng buộc (đối chiếu `application/datasync/validation.go` và baseline SQL):

- Device/entity/mutation/reference UUID; number hữu hạn. Tên/code không rỗng, API tối
  đa 500 byte, DB 1–500 ký tự; nullable plate/note API tối đa 2.000 byte, DB 2.000 ký tự.
  Form client có thể chặt hơn; đây không phải giới hạn UX duy nhất.
- KM/baseline/service KM `[0,99999999.99]`; interval KM `(0,99999999.99]`.
  SQL `numeric(10,2)` có thể làm tròn; feed lấy row canonical đã lưu.
- Interval ngày nguyên `[1,2147483647]`; ít nhất một chu kỳ KM/ngày.
  Baseline null được phép, có thể dẫn đến thiếu dữ liệu tính reminder.
- Liters `(0,9999.99]` nếu có, SQL `numeric(6,2)`; cost `[0,99999999.99]` nếu có,
  tối đa hai chữ số thập phân. Hiện diễn giải/hiển thị **VND**, chưa có currency field.
  Fuel không có `shop`.
- `due_soon_ratio` null dùng 0.9, nếu có thuộc `(0,1]`, SQL `numeric(4,3)`;
  `display_order` nguyên `[0,2147483647]`.
- Repository client kiểm tra KM/baseline/service KM, interval ngày/KM, liters và
  note/name UTF-8 byte limits trước ghi entity/outbox; form không đổi nonblank invalid
  thành null. KM thấp hơn hiện tại vẫn chỉ cảnh báo, KM/liters thập phân vẫn được
  server làm tròn canonical; không rewrite payload đã enqueue.
- Reference cùng account; Fuel link Odometer cùng xe. SQL upsert hiện cho thay reference
  xe/hạng mục/link trên mutable snapshot nếu hợp lệ; không có invariant create-only
  cho các reference này như Odometer. Server kiểm tra ownership/reference trong transaction.
- PartType custom create: `code == entity_id`; update giữ code, kể cả seed code.
  SQL update hiện chỉ đổi name/active và metadata, giữ cả display_order dù có trong payload.
  Unique `(account_id,code)`; inactive ẩn khỏi picker mới nhưng vẫn hợp lệ cho record
  offline thuộc account. Không reject chỉ vì thiết bị khác vừa tắt hạng mục.
- Unique reminder `(account_id,vehicle_id,part_type_id)` khi `deleted_at IS NULL`;
  `enabled=false` không giải phóng scope. Compound FK chống tham chiếu xuyên account.

`SyncEntityType`, `SyncOperation`, `MutationResultStatus`, `ApiErrorCode` const-derived.
`SyncPayloadMap` ánh xạ sáu payload; `PushMutation`, `PullChange`, `EnqueueMutationParams`
là discriminated contracts gắn entity/operation/payload. Odometer create-only ở type
level và runtime server. Đây là tăng độ chắc kỹ thuật, **không đổi wire/storage**.
TS types không tự validate JSON mạng/IndexedDB; runtime checks/mapper vẫn cần thiết.
PartType code là vocabulary mở, không enum đóng chỉ gồm seed.

### 3.3. Seed và bảng PostgreSQL

Signup transaction tạo account + sequence + 10 PartType có seq/changefeed:

| Code | Tên |
|---|---|
| `engine_oil` | Dầu nhớt động cơ |
| `front_tire` / `rear_tire` | Lốp trước / Lốp sau |
| `front_brake_pad` / `rear_brake_pad` | Má phanh trước / Má phanh sau |
| `spark_plug` | Bugi |
| `air_filter` | Lọc gió |
| `drive_belt` | Dây curoa |
| `chain_sprocket_set` | Nhông, sên, đĩa |
| `battery` | Ắc quy |

Sáu bảng nghiệp vụ: `vehicles`, `part_types`, `reminder_configs`, `odometer_logs`,
`fuel_logs`, `service_logs`; danh tính: `accounts`, `devices`, `auth_identities`.
`auth_identities` liên kết Google `sub` với account, unique provider/subject và
account/provider; thêm bằng migration riêng, không thay baseline.
`account_sequences` giữ current seq; `change_feed` là canonical changes cho pull,
có nhiều dòng cho cùng entity; `processed_mutations` lưu ACK theo account/device/mutation
cho retry push. `reminder_notification` chỉ schema dự phòng idempotency lần gửi,
chưa worker. Session/token ở Redis; outbox/cursor ở IndexedDB. Không lưu trạng thái
reminder tính sẵn thành bảng nghiệp vụ thứ hai.

## 4. Luồng nghiệp vụ và timezone

- Thêm/sửa xe: entity + mutation atomic local. Archive có thể khôi phục; tombstone
  không xóa vật lý/cascade log con.
- Fuel không bắt buộc KM. Có KM: tạo Odometer trước, Fuel tham chiếu ID, hai entity +
  hai mutation trong **một local transaction**. Server áp dụng từng mutation riêng,
  không atomic cả cặp. Sửa/xóa Fuel/thời gian Fuel không đổi Odometer đã liên kết.
- Service KM snapshot không tự tạo Odometer. Không update ReminderConfig để reset;
  derive từ Service chưa xóa mới nhất. Xóa log mới nhất có thể lộ lại mốc cũ hơn.
- Odometer hiện tại lấy `recordedAt` mới nhất; bằng nhau so `serverSyncedAt` (giữ phần
  micro/nanosecond), ưu tiên log đã sync, rồi `createdAtClient`, cuối cùng vị trí input
  ổn định. Chưa phải total order độc lập input. KM thấp hơn được phép với cảnh báo;
  chưa có correction/delete Odometer.
- Reminder lấy service chưa xóa mới nhất theo xe/hạng mục. Nếu service mới nhất thiếu
  KM thì fallback baseline config, **không tìm service cũ có KM**. Đổi hành vi này cần
  quyết định nghiệp vụ và test riêng.
- `used=max(0,current-baseline)` cho từng chiều. Mọi chiều cấu hình đều thiếu dữ liệu
  → `insufficient_data`; một chiều `remaining<=0` → `overdue`; chưa quá hạn mà một chiều
  `ratioUsed>=dueSoonRatio` → `due_soon`; còn lại `not_due`. Một chiều thiếu dữ liệu
  không chặn chiều kia. Ngưỡng mặc định **đã dùng 90%**, override theo xe, không theo
  reminder. Reminder disabled được lọc ở query/UI. Hook refresh mỗi phút/visibility;
  domain nhận `now` để test deterministic.
- History/chi phí bỏ Fuel/Service tombstone. Nhóm tháng theo timezone account;
  cost/KM dùng `max(KM)-min(KM)` trong cửa sổ gần đây, chỉ tham khảo, không phải
  quãng đường thực đo hoặc fuel efficiency.

### Timezone cố định theo account

Canonical `UTC±HH:MM`, zero `UTC+00:00`, mặc định account/DB mới `UTC+07:00`.
Chỉ nhận danh sách offset hardcoded; không search/dataset/enumerate zones.
Nhãn `UTC+07:00 — Bangkok, Hanoi, Jakarta` chỉ giải thích; **không IANA địa lý/DST**,
không tự đổi mùa/travel. Intl/Temporal nhận runtime `±HH:MM` qua helper chung.
Tên type legacy `IanaTimezone` không hàm ý hành vi DST.

Nút dùng timezone thiết bị chụp offset tại lúc bấm, kể cả phần lẻ được hỗ trợ;
không làm tròn offset ngoài danh sách, vẫn phải Lưu online với session/CSRF.
Preference dùng chung cho ngày reminder, lịch sử, tháng chi phí và wall-clock input.
Không sửa UTC instants/date-only baselines; ngày hiển thị/tháng nhóm có thể đổi.
Edit date/time không đổi giữ instant chính xác. Cache dùng offline; thiết bị khác
nhận preference lúc refresh session, không changefeed. Không migration/backfill legacy.

## 5. Auth, API và account/session guards

Email/password bcrypt 8–72 byte; signup lowercase/trim email, tạo session ngay dù
`email_verified=false`. Account/seed PostgreSQL atomic nhưng Redis token/session
không cùng distributed transaction: Redis lỗi có thể để account đã tạo.

`sid` opaque HttpOnly và `csrf_token` JS đọc được: Path `/`, SameSite=Lax, Secure theo
config. Redis session sliding TTL mặc định 30 ngày; request xác thực refresh cookie.
Không bearer/JWT. Protected POST so cookie và `X-CSRF-Token` với CSRF token session;
public auth POST không qua middleware CSRF này. CORS origin chính xác/credentials,
body tối đa 1 MiB. Authorization lấy account từ session, device đăng ký cùng account;
không lộ entity account khác. Không log password/token/payload nhạy cảm; trace bằng
request ID, không trả lỗi SQL. Auth có rate limiting qua Redis, lỗi limiter fail closed;
không coi đây là rate limiting toàn bộ API sync/account.
Các auth POST công khai, Google start và link chung quota 30 request/IP/phút;
link thêm quota 5 request/account/15 phút. Vượt quota trả 429 `rate_limited`, Redis
limiter lỗi trả 503 `internal_error`; Google start redirect `unavailable` trong cả
hai trường hợp. Callback không tiêu quota IP, nhưng phải consume state hợp lệ trước
mọi token exchange hoặc ghi danh tính.

Account response chung:

```json
{"account":{"id":"<UUID>","email":"user@example.com","name":null,"timezone":"UTC+07:00","email_verified":false}}
```

| Endpoint | Request | Thành công / lưu ý |
|---|---|---|
| `POST /auth/signup` | `{email,password,name?}` | 201 `{status:"verification_required",email}`, hai cookie; email trùng 409 validation_failed |
| `POST /auth/login` | `{email,password}` | 200 account + cookie; sai credentials 401 auth_invalid chung |
| `POST /auth/verify-email` | `{token}` | 200 `{status:"verified"}`; token sai/hết hạn 400 |
| `POST /auth/verify-email/resend` | `{email}` | 200 `{}` kể cả không tồn tại, chưa gửi email |
| `POST /auth/password/forgot` | `{email}` | 200 `{}` generic, chưa gửi email |
| `POST /auth/password/reset` | `{token,new_password}` | 200 `{status:"reset"}`, revoke mọi session account, clear cookie hiện tại |
| `GET /auth/google/start` | — | Redirect toàn trang tới Google; không dùng fetch |
| `GET /auth/google/callback` | `code,state` hoặc lỗi provider | Xác minh OIDC, tạo session hiện có rồi redirect về frontend; không chuyển token sang client |
| `GET /auth/google/status` | cookie + `?expected_account_id=<account ID>` | `{enabled,linked,has_password}` cho Settings; thiếu precondition 400, account khác phiên 409 |
| `POST /auth/google/link` | `{password,expected_account_id}` + cookie/CSRF | Xác thực lại password; trả `{authorization_url}` để điều hướng toàn trang |
| `GET /auth/session` | cookie | 200 account; thiếu/hết phiên 401 session_expired |
| `POST /auth/logout` | cookie + CSRF | 204, xóa session/cookie |
| `POST /account/timezone` | `{timezone,expected_account_id?}` + cookie/CSRF | 200 account; timezone sai 400; stale expected account 409 trước write |
| `POST /devices/register` | `{expected_account_id,device_id,platform,app_version}` + cookie/CSRF | 200 `{account_id,device_id,registered_at}`, device UUID |
| `GET /part-types` | cookie | 200 `{part_types:[...]}` toàn catalog account kể cả inactive, chỉ đọc phụ trợ |

PartType DTO: `id,code,name,display_order,active,account_id,server_seq,server_synced_at`.
Verification token TTL 24 giờ, reset 30 phút, single-use; chưa có email delivery nên
không tuyên bố flow email end-to-end đã vận hành.

```json
{"error":{"code":"validation_failed","message":"...","retryable":false,"request_id":"req_..."}}
```

| Error code | HTTP / retryable |
|---|---|
| `auth_invalid`, `session_expired` | 401 / false |
| `validation_failed` | 400; CSRF 403; body quá lớn 413; duplicate email/stale account 409 / false |
| `ownership_invalid` | 403 / false; có thể là per-mutation error trong push HTTP 200 |
| `internal_error` | 500; unknown error/panic trả true, nhưng application error qua writeError hiện trả false |
| `rate_limited` | 429 cho auth JSON endpoints; OAuth redirect dùng mã lỗi frontend allowlist |

Health có body riêng: `/health/live` 200 `{status:"ok"}`;
`/health/ready` ping PG+Redis, 200 ready hoặc 503 unavailable.

Hydrate thành công mở workspace; network/5xx không phải auth failure có thể dùng
account cache. 401 yêu cầu login lại nhưng không xóa entity/outbox. Cache không cấp
quyền API. Logout chủ động bỏ cache hiện tại/session UI kể cả API lỗi; entity/outbox
vẫn giữ theo account. Chưa guest workspace trước lần login đầu.

`sessionGeneration` đổi khi login/logout, kể cả relogin cùng account; revision guard
loại hydrate response cũ. Timezone save single-flight, kiểm tra generation/account
trước apply và trong cache transaction; response không làm sống lại account đã logout.
`expected_account_id` server là stale-tab precondition, không authorization source.
Register/push/pull bắt buộc expected account UUID: thiếu/sai định dạng trả 400,
khác account session trả 409 `validation_failed` trước application work. Success
response chứa `account_id` từ session; client phải kiểm tra identity trước cache,
ACK, apply feed hoặc cursor. Cookie/CSRF chung giữa các tab không thay thế precondition.
Deploy frontend/backend contract cùng đợt; bundle cũ thiếu expected account sẽ bị từ
chối an toàn và cần cập nhật/reload. Không chữa mismatch bằng cách bỏ/xóa outbox.
Save server thành công/cache lỗi báo cảnh báo cache, không giả server save thất bại.
Bootstrap dùng account metadata hiện tại, không ghi timezone/nextLocalSeq snapshot cũ
sau network. Sync/restore capture account + generation trước khi đợi lock và giữ context
xuyên operation; guard cả transaction, metadata/UI và auth cleanup. Response 401 cũ
không được xóa cache/session của login mới, kể cả relogin cùng account. Guard trong
tab không tự đồng bộ Zustand giữa các tab; server precondition là boundary bắt buộc.
**Giới hạn đã chọn giữ:** authenticated middleware vẫn gia hạn `sid`/CSRF cookies
trên mọi request để giữ sliding expiry. Response A cũ đến sau login B có thể ghi đè
cookie B; expected-account chặn request lệch workspace/session, không giải quyết
thứ tự `Set-Cookie`. Bỏ cookie renewal sẽ đổi browser expiry và chưa được chọn.
Generation guard cũng không phân biệt được login mới cùng account ở tab khác;
không coi #1/#6 là bảo đảm mọi race đăng nhập xuyên tab đã được loại bỏ.

### 5.1. Google login và liên kết danh tính

Google là phương thức xác thực bổ sung, không thay session opaque/CSRF bằng JWT.
Chỉ xin `openid email profile`, không xin quyền Gmail/Drive, không giữ access/refresh
token lâu dài. Khóa danh tính là `(provider, subject)` với Google `sub`,
không phải email. Mỗi account tối đa một danh tính Google.

- Danh tính đã liên kết đăng nhập đúng account, kể cả khi email Google thay đổi;
  không tự ghi đè email account.
- Danh tính mới/email mới tạo account không password cùng sequence, catalog mặc định,
  changefeed và identity trong một transaction PostgreSQL.
- Account Google-only không được thêm password thông qua forgot/reset password;
  cần một luồng thêm password có xác thực riêng nếu mở rộng sau này. Public forgot
  vẫn trả generic. Google `email_verified` bắt buộc cho danh tính, nhưng chỉ đánh dấu
  email account đã verified khi Google có thẩm quyền (Gmail hoặc Workspace `hd`);
  địa chỉ bên thứ ba không tự nhận quyền email-recovery dựa vào claim đó.
- Email đã thuộc account khác: từ chối đăng nhập Google (`email_exists`), **không tự
  liên kết theo email**, không gộp account/dữ liệu. Người dùng đăng nhập bằng password,
  vào Settings và chủ động liên kết sau khi nhập lại password.
- Luồng liên kết ràng buộc account và session đã xác thực lại; callback có session
  khác hoặc phiên đã hết hạn không được gắn danh tính. Không có unlink trong phạm vi này.
- OAuth transaction ngắn hạn ở Redis, single-use atomic, browser-bound cookie
  HttpOnly/SameSite=Lax, mỗi transaction có cookie riêng (suffix SHA-256 của state);
  production dùng prefix `__Host-`. Callback chỉ xóa cookie transaction của mình,
  không làm mất binding của tab khác; đổi session vẫn làm flow cũ hết hiệu lực an toàn.
  Dùng state, nonce và PKCE S256. Xác minh chữ ký ID token,
  issuer, audience, expiry, nonce và email đã verified tại backend.
- Callback thành công login về `/`, link về `/settings?google=linked`. Lỗi chỉ đưa
  mã allowlist lên query `google_error`: `cancelled`, `expired`, `email_exists`,
  `identity_linked`, `already_linked`, `unavailable`, `failed`. UI không dùng query
  để kết luận authenticated, vẫn hydrate `/auth/session` như trước.
- Không log code/state/token/secret; reverse proxy callback không ghi query vào
  access/error log, kể cả upstream lỗi. Hạ tầng ingress/CDN ngoài repo cũng phải
  tắt/redact query callback. Backend giữ request ID/path/status để quan sát lỗi.
- Đổi phương thức đăng nhập không xóa IndexedDB/outbox và không đổi sync protocol.

## 6. Sync A — FIFO và full-record server-order LWW

```text
local transaction → immutable outbox → register device → push FIFO sạch
                 → pull pages cùng until_seq → synced
```

Queue có account, localSeq, mutation ID, payload/operation bất biến; trạng thái pending
hoặc blocked. Không coalesce/reorder theo timestamp, không bypass item đầu lỗi.
Push chốt localSeq đầu lượt để hữu hạn khi user tiếp tục edit.

Client gửi **một mutation/request**; API giữ mảng, limit cấu hình mặc định 100:

```json
{"expected_account_id":"<account UUID>","device_id":"<UUID>","mutations":[{"mutation_id":"<UUID>","entity_type":"part_type","operation":"create","entity_id":"<UUID>","payload":{"code":"<cùng entity_id>","name":"Hạng mục mới","display_order":10,"active":true}}]}
```

Không `api_version`, `base_server_seq`, `conflict_resolved` hoặc persisted watermark.
Mutable dùng **last server-applied write wins toàn bản ghi**, không client clock/merge
field. A sửa tên, B sửa biển số từ snapshot cũ: B sync sau có thể mất tên A; đây là
đánh đổi hiện hành. Server từng mutation/transaction, prefix results theo request;
gặp rejected/retryable dừng, item sau chưa xử lý. Batch không atomic toàn bộ.

```text
BEGIN
  lock account_sequences
  lookup processed_mutations(account,device,mutation)
  đã có → duplicate ACK gốc, không apply/validate stateful lại
  mutation mới → validate ownership/reference/scope
  persist entity + allocate seq + canonical feed + processed ACK
COMMIT
```

Envelope/payload validation cơ bản trước adapter; dedupe trước validation phụ thuộc
DB. Concurrent retry serialize bằng account lock; unique idempotency collision không
thành terminal payload rejection. Lỗi DB giữ infrastructure/retryable, không giả
missing ownership. Duplicate giữ seq/timestamp gốc (microsecond PostgreSQL).

```json
{"account_id":"<account UUID>","results":[{"mutation_id":"<UUID>","status":"applied","server_seq":11,"server_synced_at":"2026-10-19T00:00:00Z"}]}
```

| Result | Client |
|---|---|
| `applied`, `duplicate` | Xóa đúng item, update metadata; ACK cũ không hạ version/overwrite revision local mới |
| `retryable_error` | Giữ pending, dừng, chỉ retry khi user yêu cầu; lỗi mạng/timeout tương tự |
| `rejected` | Blocked, nguyên nhân/action rõ; không resend nguyên terminal payload |

Per-item lỗi có `error_code,error_message,retryable`; success ACK có seq/timestamp.
Mất response có thể server đã commit: retry giữ nguyên mutation ID, payload,
operation, entity và device. Không sửa envelope để thử lại, không auto-loop lỗi thật.

### Pull bounded và canonical

```text
GET /sync/pull?expected_account_id=<account UUID>&after_seq=0&limit=100
GET /sync/pull?expected_account_id=<account UUID>&after_seq=100&limit=100&until_seq=150
```

```json
{"account_id":"<account UUID>","changes":[],"next_cursor":150,"until_seq":150,"has_more":false,"server_time":"2026-10-19T00:00:00Z"}
```

Ví dụ rỗng ứng với cursor đã ở 150. Change gồm
`server_seq,entity_type,entity_id,operation,payload,server_synced_at`.
Trang đầu chụp current account seq làm bound, trang sau giữ bound;
query `after_seq < server_seq <= until_seq` tăng dần, change mới hơn chờ lượt sau.
`after_seq>=0`, `limit>=1` clamp max cấu hình (mặc định 100), bound hợp lệ;
`has_more=true` phải tiến cursor. `server_time` chỉ observability, không conflict.

Chỉ pull khi outbox account sạch. Trong **cùng Dexie transaction**, kiểm tra sạch rồi
apply toàn page + cursor; lỗi rollback cả hai. Có edit khi đợi network → không apply
page/cursor, pending, không lưu lỗi, không chặn auto-sync sau. Không skip dirty entity
rồi vẫn tăng cursor. Feed canonical từ row persist, không echo giá trị chưa làm tròn.
**Seq bằng ACK vẫn apply business fields**, kể cả Odometer; chỉ bỏ seq thấp hơn.
ACK không thay pull/không nhảy lastSeenSeq. Thiết bị mới/storage trống pull từ 0 nhận
đủ seed và business data; `GET /part-types` không replication/bootstrap pipeline thứ hai.

Sync thủ công hoặc best-effort auto khi authenticated, online, foreground, lần thành
công trước hơn 15 phút; có timer kiểm tra tab mở, không push mỗi local write.
Lỗi thật lưu lastSyncError chặn auto retry đến action user; edit mới chỉ là việc chờ.
Synced cần bootstrap ready + queue sạch + pull xong. lastSyncedAt cũ chỉ lịch sử nếu
lại pending/blocked. Sync/restore chung Web Lock theo account; fallback chỉ trong JS
runtime, **không bảo đảm xuyên tab** nếu browser thiếu Web Locks.

## 7. Recovery

- Retryable: user bấm Thử lại, một lượt có kiểm soát với envelope cũ.
- Blocked: JSON editor sửa payload, mutation ID mới **tại localSeq cũ**, không overwrite
  entity snapshot nếu có revision local mới hơn. Form entity thường không tự giải
  blocked cũ. Repair có thể offline.
- Khôi phục từ server: online + xác nhận bỏ dữ liệu chưa sync, xóa local entity/outbox
  **của account**, reset cursor 0, pull lại; không sửa server.
- Persist restore operation; local writes bị chặn trong transaction khi restore chạy
  hoặc failed. Lỗi/reload giữ page/cursor đã commit để resume, không xóa lại page đã tải.
  Repair/restore thành công có thể về synced.
- Onboarding có sync/recovery cả khi chưa xe; recovery riêng mở được cho pull failure
  retryable, không cần đợi blocked mutation. Không bắt tạo xe để thoát bootstrap lỗi.
- Browser có thể dọn IndexedDB/PWA; chỉ dữ liệu đã sync phục hồi được từ server.
  Logout không phải reset và cache offline không phải backup.

## 8. Local, migration, deploy và reset

Go 1.25.11, Node 22+, npm, GNU Make/Bash; Docker Compose cho PG/Redis, Docker cho testcontainers.

```bash
make install
make dev-infra
make migrate-up
make dev
```

FE `http://localhost:5173`, API `http://localhost:8080`; `make dev-fe`/`make dev-be`
chạy riêng. Vite trực tiếp vẫn cần API thật. `make dev` ép FE gọi localhost:8080.
Backend đọc `.env` server/root nếu có, không override env inject;
tham khảo [`.env.example`](../.env.example). HTTP local: COOKIE_SECURE=false và
FRONTEND_ORIGIN đúng origin frontend, cả port.

Frontend image dùng nginx reverse proxy cùng origin; `/account/` được proxy như
`/auth/`, `/devices/`, `/sync/` để timezone POST không rơi vào SPA fallback. Smoke
test nginx thật: `python3 client/tests/nginx-routing/smoke.py` (Python 3 + Docker).
Fixture upstream kiểm tra routing/headers/status, không thay real-backend auth test.

PWA dùng `registerType: 'prompt'`, kiểm tra update mỗi giờ/khi foreground. Worker mới
chờ user; reload cần xác nhận riêng của **từng tab**, kể cả khi tab khác đã activate.
Hủy xác nhận giữ prompt/draft. Chấp nhận update cảnh báo có thể mất dữ liệu chưa lưu.
Tab còn chạy registration auto-update cũ vẫn có thể reload trong lần chuyển đầu;
bảo đảm mới chỉ áp dụng sau khi load code registration mới, chưa nghiệm thu iOS.

`make migrate-up/down/status`, `make migrate-create name=...`; tương ứng
`cd server && go run ./cmd/migrate up|down|status|create <name>`.
Tên Unix timestamp + snake_case, cặp up/down. Down có thể destructive.
AUTO_MIGRATE mặc định false, true tiện local; production/Kubernetes inject env,
không mount `.env`, migrate bước deploy riêng, backup trước destructive change,
kiểm tra readiness. golang-migrate advisory lock serialize concurrent callers;
deploy step riêng để kiểm soát thay đổi, không phải thiếu locking.
Redis Compose tắt persistence, chỉ dành dev; production cần quyết định persistence/HA
phù hợp (ví dụ AOF) vì mất Redis làm mất session/token, không mất dữ liệu xe PostgreSQL.
SQL/codegen: [server/db/README.md](../server/db/README.md).

### Cấu hình Google Auth Platform

1. Tạo/chọn Google Cloud project, khuyến nghị tách development và production.
   Chỉ đăng nhập không cần bật Gmail/Drive/People API, API key hoặc service account.
2. Google Auth Platform → Branding: tên app, support/developer email; production
   thêm homepage, privacy policy và domain sở hữu theo yêu cầu Google.
3. Audience: External cho Gmail thông thường; Internal chỉ dùng cho tổ chức Workspace
   phù hợp. Nếu Console yêu cầu trong Testing, thêm tài khoản thử vào Test users.
4. Data Access: chỉ `openid`, `email`, `profile`. Hoàn tất verification/publishing
   theo yêu cầu thực tế của Console, không suy luận basic scopes miễn mọi xác minh.
5. Clients → Create client → **Web application**. Authorized redirect URIs:
   - Local: `http://localhost:8080/auth/google/callback`.
   - Production: `https://<public-api-origin>/auth/google/callback`; với nginx cùng
     origin dùng domain frontend công khai, không dùng hostname backend nội bộ.
   URI phải khớp chính xác scheme, host, port, path và trailing slash. Không wildcard;
   `localhost` khác `127.0.0.1`. Authorized JavaScript origins không cần cho redirect
   backend này; không đặt callback là frontend `/sign-in`.
6. Inject riêng backend: `GOOGLE_OAUTH_ENABLED=true`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL` đúng URI đã đăng ký.
   `FRONTEND_REDIRECT_URL` là origin frontend (local `http://localhost:5173`),
   `FRONTEND_ORIGIN` khớp origin đó. Production HTTPS và `COOKIE_SECURE=true`;
   local HTTP dùng `false`. Tham khảo `.env.example`, không ghi đè `.env` đang có.
   Không đưa secret vào `VITE_*`, Git, log hoặc chat; lưu bằng secret manager/inject env.
   Lưu Client Secret ngay khi tạo: Google chỉ hiển thị/cho tải secret tại thời điểm
   tạo, không thể xem hoặc tải lại sau đó; mất secret thì tạo/rotate secret mới.
7. Apply migration mới riêng trước deploy backend, production `AUTO_MIGRATE=false`.
   Cấu hình credentials rồi bật flag; thiếu cấu hình khi bật phải fail startup.
   Rollback bằng tắt flag trước, giữ nguyên bảng identity và dữ liệu đã tạo;
   không chạy down migration để tắt đăng nhập Google. Khi tắt, account Google-only
   không thể đăng nhập mới đến khi bật lại; email/password vẫn hoạt động. Không
   chữa tình huống này bằng reset password hoặc xóa account/dữ liệu.

CI repo này chỉ build/publish images rồi dispatch sang `quoctann/pisces-infra`;
Google credentials và public callback phải được inject ở hạ tầng deploy bên đó.
Không bake secret vào image hoặc truyền Google secret làm frontend build argument.
Backend cần outbound HTTPS tới Google discovery, token và JWKS endpoints
(`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`); hạn chế egress
phải cho phép các endpoint đó và DNS tương ứng.
Production dùng nginx cùng origin như cấu hình repo, hoặc frontend/API cùng site
đã kiểm chứng cookie và CSRF. Hai domain khác site không được hỗ trợ chỉ bằng CORS:
cookie `SameSite=Lax` không đi theo cross-site fetch; hỗ trợ topology đó cần thiết kế
cookie/CSRF riêng, không đổi tùy tiện sang `SameSite=None` để bỏ qua kiểm chứng.
Rate limiting auth dùng IP kết nối mặc định. Sau nginx/load balancer cần inject
`TRUSTED_PROXIES` (IP/CIDR phân cách dấu phẩy) chỉ gồm proxy/network hẹp tin cậy,
để Gin lấy đúng client IP từ forwarding headers; để trống thì bỏ qua các header đó
và mọi request sau cùng proxy sẽ chung IP bucket. Không dùng `0.0.0.0/0` hoặc `::/0`.

Kiểm tra staging Google thật: tài khoản mới/đăng nhập lại, hủy consent, email trùng,
liên kết sau password, đổi phiên giữa start/callback và nhiều tab. Browser mock không
chứng minh provider/cookie topology thật. `redirect_uri_mismatch` thường do URI sai;
`invalid_client` do credentials sai; `org_internal` do audience; đăng nhập Google xong
nhưng session lỗi cần kiểm tra cookie/domain/HTTPS/CORS và `/auth/session`.
Kiểm tra ingress/proxy/CDN không log query callback. Rotation secret theo Google Console,
inject secret mới và restart rollout; không yêu cầu người dùng cung cấp token.

Tham khảo: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[OAuth Web Server](https://developers.google.com/identity/protocols/oauth2/web-server).

### Baseline không tương thích / reset dev thủ công

`1790121600_baseline` dành DB sạch. DB có lịch sử thay thế, kể cả `20260923000000`,
hoặc **đã áp dụng cùng version trước khi sửa schema**, không tự upgrade bằng migrate-up.
Cảnh báo upgrade không tương thích: field cũ `received_at_server`, `cost_vnd`,
`name_vi`/`seed_version` thay bằng `server_synced_at`, `cost`, `name`; device UUID,
Fuel bỏ shop, notification table hiện là `reminder_notification`. Payload legacy bị
reject thay vì mất dữ liệu âm thầm; không tự convert immutable outbox cũ. Dùng DB và
workspace dev sạch sau bảo toàn dữ liệu cần giữ, không coi đây là upgrade production.

Chỉ khi chủ động muốn reset môi trường dev dùng một lần:

1. Dừng API và mọi frontend tab, sao lưu dữ liệu cần giữ; app chưa có export.
2. Compose disposable: `docker compose -f server/docker-compose.yml down -v`
   **xóa vĩnh viễn PostgreSQL volume**; không dùng với DB cần giữ. Hoặc tạo DB mới.
3. `make dev-infra`, `make migrate-up`.
4. Redis Compose không persistent được tạo lại; Redis ngoài chỉ xóa session/token
   app này, không flush shared Redis.
5. Mọi browser/profile test clear site data frontend: IndexedDB, Cache Storage,
   service worker. Không giữ cursor/outbox cũ sau reset PostgreSQL.
6. Mở app, signup mới, test hai browser/profile.

App/migration **không tự drop/reset**; tài liệu không thực thi reset.

## 9. Kiểm chứng và nghiệm thu

```bash
make test              # Vitest + Go -race; PG có thể skip khi Docker thiếu
make lint              # Oxlint + Go vet
make build             # TS/Vite + Go
make test-integration  # REQUIRE_POSTGRES_TESTS=1, -count=1, PG thật; thiếu Docker fail
npm run test:coverage:contracts --prefix client
npm run test:e2e --prefix client
python3 client/tests/nginx-routing/smoke.py
# PWA worker thật, production A/B builds; working directory client/
PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.pwa.config.ts
```

**Báo cáo Google OAuth 26/10/2026:** login/signup và Settings link có password
reauth đã triển khai; không auto-link email, không sửa sync/outbox hoặc prototype HTML.
`make lint`, `make build`, frontend 325 tests và toàn bộ Go `-race` pass;
`make test-integration` pass PostgreSQL bắt buộc, Redis integration thật pass trong
Go suite. Chrome E2E mock toàn bộ 15/15 pass khi chạy tuần tự; lỗi mạng tải module
ở lượt chạy song song trước đó không được coi là lỗi OAuth hay bỏ qua kiểm thử.
Lượt kiểm tra cuối chạy browser đồng thời Docker testcontainers có 3 test cũ lỗi,
trace cả ba có `ERR_NETWORK_CHANGED` khi tải module; rerun riêng browser sau Docker
đạt 15/15. Không chạy hai nhóm này đồng thời trong môi trường hiện tại.
Nginx thật smoke pass cả callback thành công và upstream 502; kiểm tra cả stdout/stderr
không chứa code/state. Review Go, client, DB và security không còn finding medium+.

Coverage tập Google mới: frontend 98.98% statements / 96.20% branches / 100% functions
trên `googleAuth.ts`, `googleAccount.ts`, `useGoogleCallback.ts`, `GoogleAccountCard.tsx`;
Go 89.73% statements (297/331) trên năm file implementation Google application,
provider, HTTP, Redis và PostgreSQL. Đây **không phải coverage toàn source ≥80%**.
Contract gate vẫn 91.70% statements / 86.30% branches / 100% functions / 93.82% lines.
Google thật, branding/consent và cookie topology staging chưa nghiệm thu vì chưa có
credentials; Chrome mock và fake OIDC issuer/JWKS không thay bước đó.

**Báo cáo phiên 2026-10-25–26 (client review fixes):** register/push/pull đã có required
expected-account precondition, success response identity và client runtime check;
sync/restore có generation/transaction guards và stale-safe 401 cleanup. HTTP tests
kiểm tra server enforcement; two-tab browser test dùng shared cookies thật nhưng mock
API, không được gọi là real-backend sync nghiệm thu.

`make lint`, `make build`, `make test` (frontend 283 tests và toàn bộ Go `-race`) pass;
`make test-integration` pass PostgreSQL bắt buộc với Docker. Contract gate đạt 91.70%
statements / 86.30% branches / 100% functions / 93.82% lines trên tập file được chọn.
Chrome E2E 7/7 pass: 2 sync và 5 native numeric-input cases cho tạo/sửa reminder,
bao gồm `1e` có value rỗng nhưng `badInput=true`, không ghi state khi reject và save
được sau sửa input. PWA production A/B worker 1/1 pass, cả hai tab đã nhận prompt
trước khi chỉ một tab đồng ý, tab còn lại giữ draft/document. Nginx thật smoke pass
method/path/query/body/headers, upstream status/JSON và SPA/assets fallback.

Sliding cookie renewal và rủi ro response cookie đến sai thứ tự được **giữ theo lựa
chọn chủ dự án**, xem mục 5; không tuyên bố đã loại mọi race auth xuyên tab. Default
Playwright Chromium chưa có trong môi trường này, dùng Chrome hệ thống; iOS chưa test.
Ba Fast Refresh warnings, bundle-size warning và React dev script warning còn hiện hữu.

**Báo cáo phiên 2026-10-19:** frontend 154 tests pass (baseline đầu phiên 112), gồm
negative type checks trong build và regression upgrade IndexedDB v4→v9. `make lint build`,
full `go test -race ./...` và `make test-integration` với PostgreSQL thật đều pass.
Full Go race lượt đầu vượt timeout 120 giây; rerun với giới hạn dài hơn pass.
Ba Fast Refresh warnings và bundle-size warning hiện hữu còn giữ.

Gate `test:coverage:contracts` đạt 92.43% statements, 84.73% branches, 100% functions,
94.52% lines cho contract/persistence/push đã chọn (config `client/vitest.contract.config.ts`).
Gate yêu cầu ≥80% mỗi metric toàn tập chọn; **không tuyên bố toàn source 80%**.
Script coverage timezone cũ trỏ config không tồn tại đã được thay bằng gate này,
không phải một gate timezone chuyên biệt. Vitest sync-flow dùng HTTP mock.

Chromium E2E có config/project và một flow API-mocked: login/cookie/CSRF, bootstrap,
tạo xe offline, IndexedDB còn sau reload online, lỗi push retryable giữ envelope,
explicit retry cùng ID/payload/device, push trước pull và queue/cursor sau ACK.
Payload push được so đúng snapshot outbox; tên canonical từ pull được kiểm tra ở
IndexedDB và UI ngay cả khi seq bằng ACK.
Stability run 5/5 pass trên Google Chrome hệ thống (`PLAYWRIGHT_CHANNEL=chrome`);
đây không phải real-backend, PWA offline navigation, multi-tab hay iOS acceptance.
Service worker bị chặn trong test để isolate API mocks.
React vẫn cảnh báo script tag trong dev; không coi E2E pass là đã xử lý cảnh báo đó.

Playwright mặc định dùng Chromium bundle: `cd client && npx playwright install chromium`;
cài FFmpeg nếu môi trường chưa có để ghi video. Hoặc chạy từ root:
`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e --prefix client` khi đã có Google Chrome.
Artifacts ở `client/playwright-report` và `client/test-results` (gitignored).

**Lịch sử, không bằng chứng working tree hiện tại:** review 23/09 ghi 64 rồi 80 tests,
PG integration skip/không start Docker; báo cáo 06/10 ghi 85 frontend tests,
Go race/lint và PG Docker integration gồm baseline up/down thành công. Chưa có
nghiệm thu toàn diện real-backend multi-tab/auth races, iOS hoặc load benchmark.
Phiên 25–26/10 bổ sung phạm vi Chrome multi-tab/mock sync, numeric inputs và PWA
worker thật như trên; không thay bằng nghiệm thu toàn diện real-backend/auth/iOS.

Checklist trước đóng thay đổi/phát hành:

- [x] Full unit/integration test, lint/build và PG bắt buộc trên snapshot client-review
  25–26/10 báo cáo ở trên; không dùng kết quả này thay kiểm chứng thay đổi OAuth.
- [ ] Google thật trên staging: credentials, consent, callback, cookie và liên kết
  account; **chưa nghiệm thu vì chưa có Google Client ID/Secret trong phiên triển khai**.
- [ ] Google account mới có đúng một identity/account/catalog; callback đồng thời
  không để account mồ côi; lỗi Redis sau PG commit không tạo thêm account khi thử lại.
- [ ] State replay/hết hạn/browser khác, nonce sai và link sau logout/reset/relogin
  bị từ chối; email trùng không tự liên kết; danh tính cũ vẫn resolve qua `sub`.
- [ ] Browser thật: offline cold start/cache vs 401/logout, PWA iOS/install/update.
- [ ] Xe → KM → đổi tên offline: FIFO cha trước con kể cả timestamp bằng nhau.
- [ ] Mất push response/concurrent retry: một feed change, ACK gốc, device ổn định.
- [ ] Retryable không auto-loop; blocked không bypass; repair/restore trở lại synced.
- [ ] Edit trong push/pull giữ local revision/cursor, không chặn auto-sync sau.
- [ ] Canonical equal-seq pull kể cả Odometer rounding, page/cursor atomic, bound ổn định.
- [ ] Hai tab/account switch/late response, relogin cùng account, Web Locks/fallback.
- [ ] Storage trống bootstrap đủ seed; restore reload/mất mạng resume page đúng.
- [ ] Concurrent reminder cùng scope hội tụ; inactive PartType reference offline hợp lệ.
- [ ] Fuel/Service edit/delete nhất quán history/cost/reminder, không cascade KM.
- [ ] Timezone online save/cache failure/stale tab, ngày lịch/tháng chi phí đúng offset.
- [ ] Security: auth/CSRF/ownership/secrets/logs; rate limiting trước public release.

## 10. Bài học review và đề xuất chưa triển khai

F1–F10 trong review cũ là **lịch sử trước refactor**, không danh sách lỗi hiện tại:
offline hydration, coalesce sai dependency, dirty pull, lỗi DB thành ownership,
dedupe sau state validation, rejected không recovery, cost tính log xóa, feed không
canonical, catalog replication kép, single-flight một tab. Invariants mục 5–7 và
checklist mục 9 giữ bài học/tiêu chí, không giữ ví dụ protocol lỗi thời.

Correctness/observability trước tối ưu; chưa benchmark throughput. Một mutation mỗi
transaction không phải lỗi batch contract. Chỉ tối ưu batching, lazy-load bundle,
query latest/group service khi có số đo. Không dọn feed/dedupe tùy tuổi khi chưa có
retry horizon/retention/bootstrap-reset protocol. Odometer correction, total-order
tie-break và service thiếu KM cần quyết định/test riêng nếu đổi hành vi.

Phương án chưa chọn: snapshot account pull (đắt khi lịch sử lớn), online-first cache
(bỏ offline write), field merge/replay/CRDT (phức tạp), chuyển session Redis sang PG
(giảm hạ tầng nhưng cần đo refresh/cleanup). Devices/sequence/feed/dedupe là chi phí
offline đa thiết bị, không phải tính năng bảo dưỡng riêng; không bỏ một bảng tùy tiện.

Export tương lai nên có schema_version, phân biệt backup account/chia sẻ cấu hình;
chưa API/UI hay restore file. Email reminder tương lai chỉ dùng dữ liệu đã sync,
idempotency theo mốc đến hạn. Google OAuth có contract riêng tại mục 5.1; nghiệm thu
provider thật trên staging vẫn bắt buộc. Đề xuất không
thay contract hiện hành và không cho phép tự reset/sửa migration đã áp dụng.

## 11. Inventory hợp nhất tài liệu

Đã đọc đủ chín Markdown trước khi xóa bản trùng; nội dung hữu ích được ánh xạ như sau.
Ví dụ lỗi thời không giữ như contract hiện tại; báo cáo kiểm chứng chỉ giữ dạng lịch sử.

| Nguồn cũ | Đích trong tài liệu này |
|---|---|
| `decision.md` | 1, 3–7, 10: phạm vi, seed, entity, reminder, timezone, sync và export tương lai |
| `architecture.md` | 2, 6, 8: hexagonal ports, sqlc/sqlx, transaction, migration/deploy |
| `sync-api-contract.md` | 3, 5–7: payload dictionary/constraints, auth/status, wire hiện hành, security/retry |
| `system-flow.md` | 2–8: luồng nghiệp vụ, session/timezone guards, sync, recovery, vận hành |
| `incremental-sync-plan.md` | 6–9: invariants FIFO, trade-off, recovery, manual reset và acceptance |
| `structure-sync-review.md` | 9–10: F1–F10 lịch sử, regression/QA, performance và các phương án chưa chọn |
| `tong-quan-de-chot-giai-phap.md` | 1, 3–4, 8–10: giải thích 12 bảng, giới hạn, baseline incompatibility, lịch sử 06/10 |
| `20260918-consolidate.md` | 1–2, 5, 8–10: layering/conventions, scope cắt, setup, thay mock/store cũ |
| `note.md` | 3, 6: ý nghĩa account sequence và cursor changefeed |

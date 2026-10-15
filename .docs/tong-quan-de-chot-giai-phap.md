# Vehicle Care — một tài liệu để hiểu hệ thống và chốt hướng đi

> Tổng hợp từ `README.md` và toàn bộ tài liệu trong `.docs/` (bao gồm hai bản mẫu giao diện HTML). Đây là bản **để rà soát và ra quyết định**, không phải cam kết rằng các đề xuất chưa kiểm thử đã hoàn thành. Mốc mô tả triển khai mới nhất trong tài liệu nguồn là 23/09/2026; nếu cần kết luận về code sau mốc đó, phải kiểm tra code và chạy thử lại.

## 1. Ứng dụng làm gì?

Một tài khoản quản lý nhiều xe máy: nhập số km, ghi lần đổ xăng và bảo dưỡng, đặt chu kỳ theo km/ngày cho từng hạng mục, xem trạng thái đến hạn, lịch sử và chi phí. Ứng dụng ưu tiên **ghi và đọc trên máy trước**; dữ liệu chỉ có ở server/thiết bị khác sau khi đồng bộ thành công. Không phải hệ thống đồng bộ thời gian thực.

Màn hình chính: đăng ký/đăng nhập, thêm xe, Home (km + nhắc bảo dưỡng), History, Costs, Settings (xe, danh mục, nhắc bảo dưỡng, tài khoản), ghi đổ xăng/bảo dưỡng và quản lý reminder. Bản mẫu `design.html`/`design-decoded-reference.html` còn có Scan/OCR, Plus/Upgrade, fuel efficiency và các điều khiển minh họa: **đó không phải cam kết tính năng hiện tại**. UI hiện không có Scan, Plus, fuel efficiency hay tải lịch sử như prototype. Phần điều hướng chính chỉ cần 4 mục; quản lý hạng mục đặt trong Settings → Hạng mục, không cần tab thứ năm.

## 2. Hệ thống đang được thiết kế/triển khai thế nào?

```text
React + TypeScript + Vite (client/)
  UI → domain/queries → IndexedDB (Dexie) → outbox → sync HTTP
                                                  ↓
Go + Gin (server/) → application (user, datasync) → PostgreSQL (account, entities, changefeed)
                                             └────→ Redis (session, token)
```

- UI cập nhật ngay từ IndexedDB; mỗi thao tác ghi entity và mutation vào outbox **trong cùng transaction**.
- Backend giữ ranh giới application/adapter: port nằm trong `server/internal/application/{user,datasync}/port.go`; PostgreSQL dùng sqlc + sqlx, Redis chỉ phục vụ phiên/token. Không còn memory store, `STORE_DRIVER`, demo account hoặc mock MSW của những tài liệu cũ.
- Signup tạo account và 10 hạng mục mặc định **riêng cho account** trong một PostgreSQL transaction; seed cũng có sequence/changefeed để thiết bị mới pull được. Không dùng UUID PartType cố định dùng chung toàn hệ thống; hạng mục do người dùng thêm có ID riêng.
- Email/mật khẩu + cookie `sid` (HttpOnly) và CSRF cookie/header `X-CSRF-Token`. Đăng ký được dùng app ngay; xác minh email/reset password chưa gửi email thật; Google OAuth chưa có (route `/auth/google/start` trả 400); chưa có rate limiting.
- Khi mở app offline sau lần đăng nhập thành công, account cache cho phép vào workspace local nếu lỗi mạng/server; **401 vẫn đòi đăng nhập lại**. Chưa có guest workspace trước lần đăng nhập đầu tiên. Logout bỏ account cache, không xóa toàn bộ entity/outbox local.

## 3. Dữ liệu và quy tắc nghiệp vụ cần hiểu

| Dữ liệu | Quy tắc hiện hành |
|---|---|
| Vehicle | Thuộc account, có thể sửa, archive/khôi phục; xóa mềm (`deleted_at`). |
| PartType | Danh mục thuộc account: 10 mục seed ban đầu, có thể thêm/sửa/tắt; mục đã tắt ẩn khỏi lựa chọn mới nhưng vẫn giữ tham chiếu lịch sử. |
| ReminderConfig | Một cấu hình cho mỗi cặp xe + hạng mục, đặt chu kỳ km/ngày và mốc khởi đầu; sửa/bật-tắt/xóa mềm. ID xác định theo account + xe + hạng mục để hai thiết bị tạo cùng cặp có thể hội tụ. |
| OdometerLog | Chỉ thêm, không sửa/xóa; km hiện tại suy ra từ lần ghi phù hợp mới nhất, không giữ thêm một số km mutable. |
| FuelLog | Có thể sửa/xóa mềm; có thể kèm OdometerLog khi nhập km. **Sửa/xóa FuelLog không tự sửa/xóa OdometerLog** đã tạo. |
| ServiceLog | Có thể sửa/xóa mềm; lần bảo dưỡng chưa xóa mới nhất quyết định mốc reset reminder. KM trong ServiceLog không tự tạo OdometerLog. |

- Ban đầu `decision.md` xem **mọi log** là append-only và ngưỡng cảnh báo cố định; quyết định cập nhật tại mục 7 cùng `system-flow.md` thay thế: FuelLog/ServiceLog sửa/xóa mềm được, OdometerLog vẫn append-only; ngưỡng mặc định khi **đã dùng 90%** chu kỳ (còn 10%) và xe có thể tùy chỉnh. Đây là ngưỡng theo xe, không phải một cài đặt cho từng reminder.
- Reminder theo km và/hoặc ngày: quá hạn nếu **ít nhất một** chiều đã tới hạn; nếu chưa quá hạn nhưng một chiều đạt ngưỡng thì “sắp đến hạn”; không đủ dữ liệu thì “thiếu dữ liệu”. Ngày tính theo timezone của account, timestamp lưu UTC. Không nội suy km; nhập km thấp hơn vẫn được, cần cảnh báo người dùng.
- Nếu chưa có ServiceLog, dùng mốc ban đầu ở ReminderConfig. Nếu service mới nhất thiếu km, code đang fallback về baseline config cho chiều km — đây là hành vi **còn cần chốt**.
- Chi phí/lịch sử bỏ các FuelLog/ServiceLog đã xóa. Chi phí/km chỉ là ước tính tham khảo, không phải đo quãng đường thực tế tuyệt đối.

### 3.1. Vì sao PostgreSQL có tới 12 bảng?

Nhìn theo nghiệp vụ, không phải 12 tính năng. Schema trong `server/db/migrations/1790121600_baseline.up.sql` chia thành **6 bảng nội dung**, **2 bảng danh tính**, **3 bảng hạ tầng đồng bộ** và **1 bảng dự phòng**:

| Nhóm | Bảng | Hiểu đơn giản |
|---|---|---|
| Danh tính | `accounts` | Người dùng sở hữu dữ liệu, email/mật khẩu đã băm, múi giờ để tính ngày đến hạn. |
| Danh tính | `devices` | Những thiết bị đã đăng ký với tài khoản; xác thực nguồn mutation, hỗ trợ phân biệt các lượt gửi từ từng thiết bị. Không chứa dữ liệu xe. |
| Nội dung | `vehicles` | Danh sách xe; `archived_at` là ẩn có thể mở lại, `deleted_at` là xóa mềm. `due_soon_ratio` là ngưỡng cảnh báo riêng cho xe. |
| Nội dung | `part_types` | Danh mục hạng mục như dầu nhớt/lốp; 10 mục mẫu được **copy cho từng account**; người dùng thêm/sửa/tắt mà tham chiếu từ log cũ vẫn hợp lệ (đổi tên hạng mục có thể đổi tên hiển thị của lịch sử). Tên cột hiện là `name`, không còn `name_vi`/`seed_version`. |
| Nội dung | `reminder_configs` | Quy tắc nhắc cho **một xe + một hạng mục**: chu kỳ, mốc km/ngày ban đầu, bật/tắt. Không lưu trạng thái “sắp đến hạn” cố định; trạng thái được tính lại từ log. |
| Nội dung | `odometer_logs` | Lịch sử các lần nhập km (thủ công hoặc lúc đổ xăng). Tách riêng để lịch sử km không phụ thuộc vào việc sửa/xóa hóa đơn đổ xăng. |
| Nội dung | `fuel_logs` | Các lần đổ xăng: thời điểm, lít, chi phí (`cost`, hiện hiển thị VND), ghi chú; *có thể* trỏ tới lần nhập km đi kèm. Không còn trường nơi đổ `shop`. |
| Nội dung | `service_logs` | Các lần bảo dưỡng theo xe + hạng mục: thời điểm, km lúc bảo dưỡng, tiền, ghi chú. Dùng để xác định mốc bảo dưỡng gần nhất của reminder. |
| Đồng bộ | `account_sequences` | Bộ đếm phiên bản tăng dần **theo tài khoản**. Mỗi thay đổi được chấp nhận nhận một `server_seq`; không phải số km hay ID bản ghi. |
| Đồng bộ | `change_feed` | Nhật ký **các thay đổi đã được server chấp nhận** để thiết bị khác hỏi “từ phiên bản N đến nay có gì mới?”. Có thể có nhiều dòng cho cùng một xe; không phải bảng xe thứ hai. |
| Đồng bộ | `processed_mutations` | Sổ xác nhận các lệnh đã xử lý theo tài khoản + thiết bị + `mutation_id`. Mất phản hồi mạng thì gửi lại cùng lệnh sẽ nhận ACK cũ, **không tạo thay đổi trùng**. Khác `change_feed`: một bảng để trả lời retry push, một bảng để phục vụ pull. |
| Dự phòng | `reminder_notification` | Dự định ghi lần gửi email nhắc lịch và khóa chống gửi trùng. **Mới có bảng, chưa có worker gửi email**, nên hiện chưa cần cho luồng nhắc trên màn hình. |

Sơ đồ quan hệ nghiệp vụ: `Account → Vehicle → ReminderConfig ← PartType`; `Vehicle → OdometerLog/FuelLog/ServiceLog`; `ServiceLog → PartType`; `FuelLog → OdometerLog` (liên kết tùy chọn). Các bảng nghiệp vụ đều được gắn `account_id`; khóa ngoại `(account_id, id)` giúp ngăn một xe của tài khoản này tham chiếu phụ tùng/log của tài khoản khác. Cookie phiên và token **ở Redis**, không phải các bảng PostgreSQL trên. `last_seen_seq`/outbox chờ push thuộc **IndexedDB trên từng thiết bị**, không phải `account_sequences` hay `change_feed`.

**Ví dụ thực tế:** Bạn tạo xe và đặt nhắc thay dầu mỗi 3.000 km: một `vehicle`, một `reminder_config` tham chiếu `part_type` dầu nhớt. Khi nhập 5.000 km, có `odometer_log`; khi thay dầu ở 5.000 km, có `service_log`. Ứng dụng lấy 5.000 + 3.000 = 8.000 km để tính đến hạn, **không cần bảng `reminders` ghi kết quả tính sẵn**. Mỗi mutation từ client được server chấp nhận sẽ làm tăng `account_sequences`, thêm một dòng `change_feed` và lưu xác nhận trong `processed_mutations` để thiết bị thứ hai nhận dữ liệu, đồng thời retry không ghi đúp.

**Đánh giá độ phức tạp:** Nếu chỉ dùng **một thiết bị và luôn có mạng**, 6 bảng nội dung + `accounts` đã thể hiện gần như toàn bộ nghiệp vụ; ba bảng đồng bộ (`account_sequences`, `change_feed`, `processed_mutations`) cùng `devices` là chi phí của yêu cầu **ghi offline và hợp nhất an toàn giữa nhiều thiết bị**, không phải do bài toán thay dầu tự nó phức tạp. Có thể cân nhắc bỏ `reminder_notification` khỏi schema *nếu* quyết định hoãn hoàn toàn email; không nên bỏ riêng một bảng đồng bộ trong khi vẫn giữ giao thức sync hiện tại. Muốn giảm đáng kể độ phức tạp phải chốt lại yêu cầu sản phẩm (ví dụ online-first, hoặc một thiết bị), chứ không chỉ gộp bảng. Đây là đánh đổi để quyết định, **không phải đề xuất xóa dữ liệu hay tự sửa migration hiện hành**.

## 4. Đồng bộ: một luồng đơn giản, có thể phục hồi

```text
Ghi local → outbox FIFO → đăng ký device → push hết queue → pull feed phân trang → đã đồng bộ
```

1. Mỗi thao tác giữ `mutation_id` và payload bất biến, kèm `local_seq` tăng dần theo account. Không gộp/coalesce các mutation: xe cha phải lên trước log con. `device_id` của workspace lưu bền trong IndexedDB cho các lần retry.
2. Client gửi **một mutation mỗi request** `POST /sync/push` (API vẫn nhận mảng). Server xử lý tuần tự; mỗi mutation được chấp nhận ghi entity + cấp `server_seq` theo account + changefeed + kết quả dedupe trong **một PostgreSQL transaction**. Server khóa account trước khi kiểm tra mutation đã xử lý, trả ACK cũ nếu retry sau mất response; dữ liệu mutable dùng **last server-applied write wins trên toàn bản ghi**, không trộn từng field hay dùng đồng hồ client. Một batch có thể thành công một phần; gặp lỗi thì dừng các item sau.
3. `applied`/`duplicate`: hoàn tất item; `retryable_error`/lỗi mạng: giữ pending, **chỉ thử lại khi người dùng yêu cầu** với ID/payload cũ; `rejected`: chặn queue, sửa tạo mutation ID mới tại vị trí cũ hoặc chọn **Khôi phục từ server**. Không âm thầm retry vô hạn.
4. Chỉ pull khi outbox account sạch. `GET /sync/pull` nhận `after_seq`, `limit` và `until_seq` (trang đầu lấy bound, các trang sau dùng lại); client chỉ tăng cursor khi **toàn bộ trang và cursor được commit cùng transaction IndexedDB**, sau khi kiểm tra queue vẫn sạch. Local edit xuất hiện giữa chừng → hoãn pull, trạng thái pending, không ghi đè chỉnh sửa local.
5. ACK push không thay thế pull: pull đem về payload chuẩn hóa của server, kể cả khi sequence bằng ACK. “Đã đồng bộ” chỉ hiện sau khi push sạch, bootstrap xong và pull hoàn tất. Khôi phục từ server **có xác nhận** sẽ bỏ mọi thay đổi local chưa đồng bộ, reset cursor và kéo lại toàn bộ feed; không đụng tới dữ liệu server.

Thiết bị mới đăng nhập cùng account pull từ seq 0 để nhận cả hạng mục seed và dữ liệu khác. `GET /part-types` là API đọc phụ trợ, **không** là đường bootstrap thứ hai. Auth/account scope lấy từ session, không tin `account_id` từ payload. `POST /devices/register` đăng ký thiết bị trước sync. Auto-sync best-effort khi online, foreground và lần thành công trước cách hơn 15 phút; nút đồng bộ thủ công luôn sẵn có. Đa tab dùng Web Locks nếu trình duyệt hỗ trợ; fallback trong process **không bảo đảm khóa xuyên tab**.

**Lưu ý hợp đồng:** `sync-api-contract.md` mục 2/4 vẫn giữ ví dụ cũ với `watermark`, `base_server_seq`, `conflict_resolved` và merge guest. Đừng copy các ví dụ đó vào implementation mới; **mục 6** của file đó và mục 7 `decision.md` mới là phiên bản sync A. Ở phiên bản hiện hành không có `watermark`, `base_server_seq` hay `conflict_resolved`.

## 5. Tình trạng thực tế và giới hạn

| Đã được mô tả là có | Chưa có / chưa nghiệm thu đủ |
|---|---|
| Trang nghiệp vụ chính, PWA app-shell cache, IndexedDB/outbox, sync A, cookie/CSRF, Postgres + Redis, healthcheck, migration, unit/regression tests. | Gửi email thật, job nhắc lịch qua email (`notification_deliveries` mới là schema), Google OAuth, rate limiting, export/import, guest-to-account merge, OCR/Plus/fuel efficiency của prototype. |
| Fuel/Service edit/xóa mềm; PartType riêng từng account, sửa/tắt được; khôi phục từ server, repair mutation blocked. | E2E trình duyệt thực/multi-tab và integration PostgreSQL trong môi trường có Docker chưa được xác nhận bởi lần kiểm chứng 23/09. |

Theo lần kiểm chứng ghi trong `incremental-sync-plan.md` ngày 23/09: frontend 80 tests và Go race tests (chế độ integration tùy chọn), lint/build qua; **`make test-integration` đã thử nhưng không khởi động được Docker**, không được diễn giải thành DB integration đã pass. Không có bằng chứng coverage ≥80% hay kết quả browser E2E trong các tài liệu này. Backend xử lý một mutation/storage transaction, chưa tối ưu batch lớn: chỉ tối ưu nếu đo thấy cần.

**Kiểm chứng sau lần cập nhật schema này (06/10/2026):** `make test` (85 frontend tests + Go race), `make lint` và `make test-integration` với Docker/PostgreSQL thật đã chạy thành công, bao gồm test baseline up/down. Đây là kết quả mới hơn báo cáo 23/09 ở trên; vẫn chưa phải browser E2E hoặc xác nhận coverage ≥80%.

## 6. Chạy và kiểm tra tại local

Yêu cầu: Go 1.24+, Node.js 22+, npm, Make/Bash và Docker cho Postgres/Redis và integration.

```bash
make install
make dev-infra
make migrate-up
make dev

make test
make lint
make build
make test-integration  # cần Docker chạy được; thiếu Docker là thất bại
```

Frontend `http://localhost:5173`; API `http://localhost:8080`; `/health/live`, `/health/ready` (ready kiểm tra cả Postgres và Redis). `make dev-be`/`make dev-fe` chạy riêng. Cấu hình ở `.env.example`; `AUTO_MIGRATE=true` chỉ tiện cho local, production nên migrate ở bước deploy riêng. Nếu cookie không hoạt động qua HTTP local, kiểm tra `FRONTEND_ORIGIN` và `COOKIE_SECURE=false`.

Migration hiện là baseline `1790121600_baseline`, chỉ cho DB mới. **Không tự reset dữ liệu**. Nếu DB dev đã dùng migration cũ, dùng DB mới hoặc theo runbook trong `incremental-sync-plan.md` sau khi sao lưu cần thiết: reset Postgres dev, Redis session và dữ liệu IndexedDB/PWA của **mọi** browser/profile test cùng nhau. Không giữ outbox/cursor cũ khi thay server database.

Sau khi đổi baseline cùng version (device UUID, `name`, `cost`, `server_synced_at`), DB **đã áp dụng đúng version đó trước khi sửa** cũng không được tự nâng cấp; browser cũ với outbox và dữ liệu theo tên field cũ không được tự chuyển đổi. Chỉ dùng DB/workspace dev sạch sau khi đã lưu lại mọi thay đổi cần giữ. Currency vẫn được hiển thị là VND; trường tiền `cost` hỗ trợ tối đa hai chữ số thập phân, currency riêng là việc cho phase sau.

## 7. Những điều cần bạn chốt trước giải pháp cuối cùng

1. **Sửa sai số km:** có cần cho phép sửa/xóa OdometerLog? Hiện không; muốn thay đổi phải thiết kế nghiệp vụ correction rõ ràng, nhất là log được tạo cùng FuelLog. Sửa/xóa FuelLog hiện **không** tự kéo theo thay đổi km — có chấp nhận không?
2. **Xung đột đa thiết bị:** chấp nhận toàn-record LWW (thiết bị sync sau có thể ghi đè cả field thiết bị trước vừa sửa) hay cần báo conflict/merge theo field? Giữ LWW là lựa chọn đơn giản nhất cho MVP nếu rủi ro được chấp nhận.
3. **Mốc bảo dưỡng thiếu km:** ServiceLog mới nhất không có km thì dùng baseline cũ, đánh dấu thiếu dữ liệu chiều km hay chọn mốc khác? Cần một quy tắc rõ và test theo quy tắc đó.
4. **Tắt/xóa hạng mục:** giữ inactive và lịch sử/reminder tham chiếu (đề xuất), không xóa cứng; có cho bật lại và xử lý reminder đang gắn như thế nào? Danh mục riêng account hiện đã hỗ trợ sửa/tắt; giao diện Settings → Hạng mục hợp lý hơn một tab chính mới.
5. **Phạm vi sản phẩm:** giữ offline-first cần queue/recovery như hiện tại, hay đơn giản hóa thành online-first và chấp nhận không ghi được khi mất mạng? Có ưu tiên triển khai email, Google login, PWA UX (safe-area iOS/icon/cập nhật bản cài home screen) và rate limiting trước khi phát hành không?
6. **Nghiệm thu trước phát hành:** cần chạy integration với Docker, test trình duyệt thực iOS/multi-tab, mất response khi push, tạo reminder cùng cặp trên hai thiết bị, restore mất mạng, sửa/xóa log và rà soát bảo mật. Báo cáo lỗi ngày 19/09 (`20260919-feedback.md`) mô tả FK PartType và UX iOS/PWA ở bản dev cũ; các tài liệu mới mô tả giải pháp sync/catalog và PWA, **không chứng minh** mọi lỗi deploy cũ đã được xác nhận hết trên thiết bị thật.

## 8. Nguồn và cách đọc khi có mâu thuẫn

- `README.md`: lệnh chạy, yêu cầu môi trường và giới hạn triển khai.
- `system-flow.md`, `architecture.md`: mô tả code theo mốc 23/09; `decision.md` **mục 7**, `sync-api-contract.md` **mục 6**: quyết định/contract sync A mới.
- `incremental-sync-plan.md`: bất biến sync, checklist nghiệm thu và runbook reset **thủ công**; `structure-sync-review.md`: review lịch sử trước refactor, **không phải danh sách lỗi còn tồn tại**.
- `20260919-feedback.md`: phản hồi deploy và yêu cầu người dùng tại thời điểm đó, không phải báo cáo trạng thái đã sửa; `20260918-consolidate.md` và các mục cũ của `decision.md`/`sync-api-contract.md`: tư liệu lịch sử, có chi tiết đã lỗi thời.
- `design.html`, `design-decoded-reference.html`: mẫu giao diện để tham khảo bố cục, không phải đặc tả chức năng phải triển khai.

**Quy tắc:** khi tài liệu xung đột, ưu tiên quyết định cập nhật/override mới và mô tả implementation mới hơn; trước khi đổi code hoặc tuyên bố tính năng đã chạy, đối chiếu code và kiểm thử trên môi trường thật. Không cần đọc hết các file nguồn để đánh giá hướng đi; dùng liên kết nguồn trên chỉ khi cần tra chi tiết.

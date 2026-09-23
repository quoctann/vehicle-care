# Review structure, solution, coding convention và sync

> Ngày review: 23/09/2026. Phạm vi: working tree hiện tại, gồm code đang dev.
> Tài liệu đồng hành: [Hệ thống và luồng nghiệp vụ hiện tại](./system-flow.md).
> Các đề xuất dưới đây chưa phải thay đổi đã triển khai.

**Historical review:** các finding bên dưới mô tả trạng thái trước refactor FIFO. Code đã triển khai phương án A tuần tự và các bản sửa tiếp theo; không dùng danh sách này như báo cáo lỗi hiện tại. Xem [system-flow](./system-flow.md) và [trạng thái kiểm chứng](./incremental-sync-plan.md#verification-status) cho implementation hiện hành. Các bản sửa mới gồm lock account trước dedupe, canonical odometer sau ACK, deferred sync khi có local edit, device ID ổn định theo IndexedDB, recovery trên onboarding và migration baseline Unix seconds. PostgreSQL integration còn chờ môi trường Docker để nghiệm thu.

## 1. Kết luận

**Kiến trúc nền phù hợp với bài toán sync đơn giản, nhưng implementation chưa đủ chắc về correctness để gọi là ổn và tối ưu.** Không cần thay bằng CRDT, event sourcing hoặc một hệ thống queue phân tán. Nên giữ local-first + outbox + account sequence + changefeed, giảm những nhánh đặc biệt và sửa retry/concurrency trước.

| Tiêu chí | Đánh giá |
|---|---|
| Structure | Phân tầng dễ hiểu, application/backend tương đối nhỏ; chưa cần rewrite toàn bộ |
| Solution | Push/pull incremental và LWW phù hợp nếu chấp nhận ghi đè toàn bản ghi giữa thiết bị |
| Độ đơn giản | Coalesce theo timestamp, catalog sync riêng, trạng thái outbox dư và port không trả error làm tăng độ phức tạp không cần thiết |
| Correctness | Có lỗi tái hiện được ở offline bootstrap, dependency ordering, reconciliation và rejected recovery |
| Hiệu năng | Đủ cơ sở cho quy mô cá nhân; chưa benchmark nên không kết luận throughput. Có scan/N+1 dễ cải thiện |
| Convention | Layering tốt hơn naming/comment/format consistency; tài liệu cũ đã lệch code |
| Kiểm thử | Có nền unit test, nhưng HTTP/auth coverage thiếu và integration có thể xanh do skip |

### Những điểm nên giữ

- Một local transaction cho entity + outbox: tránh lưu entity nhưng mất mutation.
- Một server transaction cho entity + sequence + changefeed + processed mutation.
- Pull page + cursor commit atomic; watermark tạo giới hạn ổn định cho phiên phân trang.
- UUID do client sinh; phân biệt entity ID và mutation ID.
- Tombstone thay vì xóa vật lý dữ liệu cần đồng bộ.
- Odometer/service-derived reminder giúp tránh duy trì nhiều nguồn sự thật.
- Hàm tính reminder thuần, truyền `now` và timezone vào để test.
- SQL nguồn tách khỏi generated sqlc models; generated models nằm trong adapter.
- Chưa ép HTTP batch thành một transaction khổng lồ: partial success có thể phù hợp MVP.

## 2. Các phát hiện cần ưu tiên

P1 = cần sửa trước khi tin cậy sync/use case chính. P2 = cần sửa tiếp để bảo đảm nghiệp vụ, phục hồi và khả năng bảo trì. Các bước tái hiện dưới đây là kịch bản cụ thể, không có nghĩa mọi lỗi đã được chạy qua HTTP/PostgreSQL thật.

### F1 — P1: Mở lại app offline bị mất quyền truy cập local

**Nguồn:** `client/src/stores/useSessionStore.ts:37–43`, `client/src/routes/RequireAuth.tsx:20`, `client/src/sync/bootstrap.ts:34–44`.

`hydrate()` chuyển mọi lỗi `GET /auth/session` thành anonymous. Cached account đã được lưu nhưng không được đọc để bootstrap offline.

**Tái hiện:** đăng nhập và có dữ liệu local → đóng/mở app khi mất mạng → route chuyển về sign-in. Đã xác nhận bằng chẩn đoán với network error và accountCache tồn tại.

**Đề xuất:** tách “account được phép mở workspace local” khỏi “session online đã xác minh”. Cho phép mở account cache khi network/5xx, chỉ gọi API sync sau xác thực hợp lệ. Phân biệt 401 với lỗi hạ tầng. Logout chủ động phải vô hiệu hóa lựa chọn cached account, tránh tự mở lại sau logout. Cache không có giá trị cấp quyền API.

### F2 — P1: Coalesce làm bản ghi con được gửi trước cha và bị reject vĩnh viễn

**Nguồn:** `client/src/sync/push.ts:27–53, 141–179`; `client/src/data/outbox.ts:30–31`; `server/internal/application/datasync/service.go:33–40`, `validation.go:51–60`.

```text
t1: tạo Vehicle V
t2: tạo OdometerLog O tham chiếu V
t3: đổi tên V
coalesce giữ V ở t3 → request thành [O, V]
server chưa có V khi validate O → ownership_invalid / rejected
```

Đã xác nhận client thực sự tạo thứ tự `[odometer_log, vehicle]`. Server áp dụng request tuần tự và validate ownership trước từng mutation, nên không tự giải được phụ thuộc này. Ngoài ra, timestamp bằng nhau được sort theo thứ tự đầu vào từ IndexedDB, không đảm bảo thứ tự nghiệp vụ theo UUID.

**Đề xuất ưu tiên cho MVP:** bỏ coalesce lúc push; dùng local sequence tăng dần và FIFO. Mutation immutable sau khi enqueue. Nếu cha chưa thành công, hoãn con thay vì biến missing dependency thành reject vĩnh viễn. Có thể gửi hết entity cha trước khi gửi nhóm con. Chỉ thêm coalesce sau khi chứng minh cần thiết, với dependency graph/ordering rõ ràng.

### F3 — P1: Pull/conflict ACK có thể ghi đè local edit chưa được chấp nhận

**Nguồn:** `client/src/sync/applyChange.ts:53–59, 77–83, 125–131, 149–155, 172–178`; `sync/push.ts:113–124`; `sync/syncOrchestrator.ts:23–28`.

Pull kiểm tra server sequence nhưng không kiểm tra pending mutations hoặc local revision. Push-before-pull không đủ vì user vẫn có thể sửa khi request đang chạy, và push có thể trả retryable per-item rồi tiếp tục pull.

**Tái hiện:** có local edit pending → pull snapshot remote của cùng entity → business fields local bị thay thế trong khi mutation cũ còn pending. Đã xác nhận bằng chẩn đoán. Nếu người dùng sửa thêm dựa trên snapshot remote đó, snapshot mới có thể không còn field họ sửa trước; coalesce tiếp tục loại bỏ bản cũ, dẫn tới mất ý định chỉnh sửa.

**Đề xuất:** phân biệt confirmed server snapshot/version và local optimistic state. Khi nhận remote, cập nhật confirmed state rồi replay pending snapshots theo local sequence; ACK một mutation chỉ xóa/hoàn tất đúng mutation đó. Không dùng ACK của revision cũ để ghi đè revision local mới hơn. Reconcile và cập nhật cursor phải atomic. Chỉ “skip dirty entity rồi tăng cursor” mà không giữ remote state hoặc kế hoạch replay là chưa đủ.

### F4 — P1: Lỗi DB bị biến thành lỗi nghiệp vụ không retry được

**Nguồn:** `server/internal/application/datasync/port.go:13–16`; `adapters/postgres/entity_exists.go:14–55`; `application/datasync/service.go:52–55`; `adapters/postgres/account_store.go:68–82`.

`EntityExists`/`PartTypeActive` trả `false` khi query lỗi. Một lỗi DB tạm thời lúc validate reference trở thành `ownership_invalid` hoặc “inactive” → client mark rejected và không retry. Mọi lỗi pull cũng bị đổi thành “watermark invalid”, kể cả DB unavailable. Account lookup nuốt error khiến lỗi hạ tầng có thể bị hiểu là login sai/session hết hạn.

**Đề xuất:** port trả `(value, error)` hoặc `(value, found, error)`. Dùng error code phân biệt validation, missing dependency, expired watermark và infrastructure failure. Chỉ lỗi nghiệp vụ xác định mới terminal; lỗi hạ tầng trả retryable/5xx. Log chi tiết lỗi server với request ID, không trả nguyên SQL error cho client.

### F5 — P1: Retry mutation đã commit có thể bị validate lại và reject

**Nguồn:** `application/datasync/service.go:35–39`, `validation.go:57–65`; `adapters/postgres/apply_mutations.go:55–78`.

Dedupe nằm sau validation phụ thuộc trạng thái hiện tại.

**Kịch bản:** service-log create đã commit nhưng response mất → thiết bị khác tắt PartType → client retry cùng mutation ID → validation của create thấy PartType inactive và reject, không đến processed-mutation lookup.

Idempotency khi đó không bảo đảm “retry trả kết quả đã commit” qua toàn bộ service flow, dù adapter riêng có dedupe.

**Đề xuất:** sau kiểm tra authentication/scope và envelope cơ bản, trả kết quả mutation đã xử lý trước khi chạy validation phụ thuộc trạng thái. Lookup/dedupe và apply cần xử lý concurrent retry an toàn trong transaction. Nếu kiểm tra payload fingerprint, retry cùng ID nhưng payload khác phải được phân loại rõ. Client nên giữ nguyên envelope đã gửi, bao gồm base version/operation, khi retry.

### F6 — P2: Rejected mutation không có vòng đời kết thúc tổng quát

**Nguồn:** `client/src/data/outbox.ts:65–75`; `sync/push.ts:103–106, 141`; `sync/syncOrchestrator.ts:28–31`.

Pending reader không lấy rejected. Sửa entity tạo mutation mới nhưng rejected cũ vẫn được tính vào unresolved. Đã xác nhận: sửa mới được accepted, unresolved vẫn là 1. Ngoại lệ repair PartType trong `data/seed.ts` không xử lý các entity khác.

**Hậu quả:** “hãy thử lại” nhưng sync bao nhiêu lần cũng không hết lỗi; chưa có UI tổng quát để sửa/bỏ/resolve từng item.

**Đề xuất:** định nghĩa `blocked`/`rejected` rõ ràng; có action sửa payload và tạo mutation mới, bỏ thay đổi local hoặc reconcile với server. Với snapshot thay thế được chấp nhận, đánh dấu các rejected revision cũ đã được giải quyết theo rule rõ ràng. Không đánh dấu chúng applied như thể server từng chấp nhận payload sai.

### F7 — P2: Log đã xóa vẫn được tính vào chi phí

**Nguồn:** `client/src/data/queries/costQueries.ts:15–17, 30–40, 58–66`; đối chiếu `historyQueries.ts:20–21`.

`getMonthlyCosts()` và `getCostPerKm()` không lọc `deletedAt`; History đã lọc. Xóa một lần đổ xăng/bảo dưỡng khiến lịch sử và báo cáo tiền không nhất quán.

**Đề xuất:** tập trung query “visible/non-deleted logs”, dùng chung cho history/cost. Thêm test xóa log có tiền rồi kiểm tra cả tháng và cost/KM. Với odometer được phép giảm, công thức `max-min` chỉ nên được ghi rõ là chỉ số tham khảo, không đồng nhất với quãng đường thực tế.

### F8 — P2: Changefeed có thể khác row thực tế đã lưu

**Nguồn:** `server/internal/adapters/postgres/apply_mutations.go:271–285`; `mapping.go:101–122, 206, 231, 278`; `db/queries/fuel_logs.sql:14–24`, `service_logs.sql:19–27`; `application/datasync/validation.go:80–110`.

Feed và conflict snapshot lấy trực tiếp `mutation.Payload`, trong khi storage ép kiểu/giữ bất biến một số field:

- `interval_days=1.5` được validation hiện tại chấp nhận nhưng bị cast thành `1` trong DB; feed vẫn là `1.5`.
- `cost_vnd` dạng số lẻ bị truncate khi map sang int64.
- Update fuel/service với một `vehicle_id` khác vẫn thuộc account có thể qua ownership validation, nhưng SQL giữ vehicle cũ; feed lại mang vehicle mới.

**Đề xuất:** typed payload cho từng entity, validate UUID/integer/range và immutable references. Tạo canonical payload từ row đã lưu (`RETURNING` hoặc mapping canonical duy nhất) để ghi feed/ACK. Không để database normalization và sync serialization cho ra hai trạng thái khác nhau. Dữ liệu không hợp lệ cố định phải bị reject có chủ đích, không retry mãi vì constraint error.

### F9 — P2: PartType có hai đường replication, bootstrap chưa đầy đủ

**Nguồn:** `server/internal/adapters/postgres/seed/seed.go:13–18, 34`; `client/src/data/seed.ts:24–67`; `App.tsx:18–23`; `sync/bootstrap.ts`.

Seed có seq 0 và không có trong changefeed. `GET /part-types` có logic merge/repair riêng chạy ngoài orchestrator, còn các update vẫn xuất hiện trong pull. Fetch catalog thất bại có thể để picker/reminder thiếu phụ tùng, dù `runSync()` sau đó báo thành công. Snapshot fetch và pull cũng không chia sẻ một cơ chế chống stale overwrite.

**Đề xuất:** seed PartType cùng sequence + changefeed ngay trong transaction signup. Cho pull từ 0 khôi phục đủ mọi entity, bỏ catalog refresh path riêng khỏi client. `GET /part-types` nếu giữ chỉ là endpoint đọc, không làm đường replication thứ hai.

### F10 — P2: Single-flight chưa xử lý multi-tab và ACK replay hợp lệ

**Nguồn:** `client/src/sync/syncOrchestrator.ts:11, 51–65`; `sync/bootstrap.ts:16–36`; `sync/push.ts:95–98`.

Hai tab có cùng IndexedDB nhưng hai biến `inFlight`. Tab này có thể ACK/pull phiên bản mới trong lúc tab kia retry một mutation cũ. `duplicate` ACK có seq thấp hơn current entity seq là kết quả hợp lệ của idempotency, nhưng client hiện throw trước khi mark mutation done; mutation có thể kẹt retry. Bootstrap cũng có thể ghi lại syncMeta đọc từ trước khi tab khác tiến cursor.

**Đề xuất:** dùng Web Locks theo account, hoặc lease trong IndexedDB nếu target browser cần fallback. Metadata update không được làm cursor lùi. ACK cũ hoàn tất đúng mutation nhưng không hạ version/ghi đè entity mới. Kèm account/session generation để phân biệt các phiên đăng nhập, thay vì chỉ so account ID.

## 3. Các quyết định nghiệp vụ cần chốt

Các mục này chưa nên tự đổi chỉ vì kỹ thuật cho phép:

1. **Toàn-record LWW có chấp nhận được không?** Thiết bị A sửa tên, B sửa biển số dựa trên bản cũ: B sync sau có thể làm mất tên A. Nếu chấp nhận thì giữ và mô tả rõ; nếu không, dùng expected-version conflict hoặc patch/field merge có quy tắc.
2. **Có thật sự cần sửa/xóa fuel/service?** Nếu có, chúng là mutable; phải đồng nhất tombstone ở mọi query. Nếu không, append-only giảm đáng kể nhánh update/delete nhưng đánh đổi khả năng sửa nhập nhầm.
3. **Sửa/xóa lần đổ xăng có tác động KM không?** Hiện không; OdometerLog riêng vẫn tồn tại. Muốn khác cần nghiệp vụ correction/void rõ ràng, không xóa dây chuyền ngầm.
4. **Bảo dưỡng không biết KM:** hiện quay về baseline config cho chiều KM. Có thể hợp lý hơn khi đánh dấu thiếu dữ liệu chiều KM hoặc tìm một mốc được định nghĩa riêng; không nên âm thầm coi reset KM đã hoàn tất.
5. **Hai thiết bị cùng tạo reminder cho một phụ tùng:** hiện UUID khác nhau dẫn đến một bản bị reject, không phải LWW. Có thể dùng identity tự nhiên `(vehicleId, partTypeId)` hoặc UUID v5 deterministic theo cặp; recreate thành cập nhật/restore cùng identity. Nếu tiếp tục random ID, phải có luồng merge/reconcile bản bị reject.
6. **Người dùng guest offline trước đăng ký:** tài liệu cũ đề cập merge nhưng routes/repositories hiện dựa trên account đã xác thực. Hoặc bỏ khỏi scope MVP, hoặc thiết kế workspace guest và bước chuyển ownership riêng.
7. **Reminder theo ngày khi app mở lâu:** `hooks/useReminders.ts` chỉ chạy lại theo dữ liệu/dependency; cần clock tick theo ngày account và refresh lúc foreground.
8. **Tie-break log:** `domain/odometer.ts` dùng timestamp nhận/array index; service query chỉ so `servicedAt`. Nên chuẩn hóa timestamp UTC và dùng thứ tự xác định, ví dụ `(businessTime, serverSeq)` với local sequence/ID fallback được định nghĩa. Không dùng thứ tự UUID ngẫu nhiên làm “tạo sau”.

## 4. Structure và coding convention

### 4.1. Backend

Giữ cấu trúc hiện có là đủ. Hai application package `user` và `datasync` chưa cần thêm command bus, generic repository, use-case class cho mỗi thao tác hay framework dependency injection.

Đề xuất cụ thể:

- `IDependencies` → `Store`/`SyncStore`, `IPinger` → `Pinger`: bỏ prefix `I` để gần Go convention; tên mô tả capability.
- Port được khai báo tại consumer application. Comment “owned by PostgreSQL adapter” hiện gây nhầm giữa nơi định nghĩa contract và nơi implement.
- `ApplyMutations([]Mutation) []Result` chỉ cho đúng một item → `ApplyMutation(Mutation) (Result, error)`. Loại bỏ nhánh unsupported batch và flatten mảng một phần tử.
- Giữ error return qua tất cả adapter boundary. Không lấy “in-memory trước kia không lỗi” làm contract cho PostgreSQL thật.
- Parse `json.RawMessage`/typed payload một lần theo entity; tránh `map[string]any` với nhiều helper type assertion trả default zero.
- Validation nghiệp vụ phụ thuộc DB và các invariant khi ghi nên có ranh giới transaction rõ. Unique/FK database vẫn là lớp bảo vệ cuối.
- Enum/constants cho entity type, operation, status và error code để tránh string literals lặp lại.
- `sqlx` hiện dùng nhiều cho orchestration transaction; có thể dùng `database/sql` + sqlc hoặc pgx + sqlc trực tiếp khi refactor. Đây là cleanup, không phải ưu tiên correctness.
- `domain` đang có cả data shape gắn transport; có thể tách request/response DTO tại HTTP adapter nếu bắt đầu gây coupling. Không cần tạo thêm layer chỉ để đạt sơ đồ “clean architecture”.

### 4.2. Frontend

Luồng `component → repository/query → Dexie`, domain thuần và store mỏng là hợp lý. Giữ structure hiện tại trước; feature folders chỉ đáng làm nếu navigation giữa file bắt đầu khó.

- Thêm `accountId` vào OutboxItem và compound index theo account/status/local sequence.
- Discriminated union cho mutation payload thay cho `unknown` + cast `Record<string, unknown>`.
- Tách `serverVersion`, `localRevision` và cursor; mỗi khái niệm có đúng một mục đích.
- Validation create/update dùng cùng rule; ví dụ create vehicle kiểm tra tên/biển số nhưng `writeVehiclePatch` hiện không kiểm tra tương ứng.
- Chọn một formatter cho TS/TSX, thêm format-check; hiện code có cả single/double quotes và có/không semicolon. Oxlint hiện chưa thay thế việc enforce formatting.
- UI text đi qua i18n; domain/data trả typed error/code, tránh trộn câu tiếng Việt/Anh và transport text xuyên tầng.
- Comment mô tả invariant/lý do, giảm tham chiếu `B4`, `D7`, “feedback feature #...” và mô tả giả định từ các plan cũ.
- `DUE_SOON_REMAINING_RATIO = 0.9` nên đổi thành `DEFAULT_DUE_SOON_USED_RATIO`; comment của coalesce hiện nói mark applied ngay nhưng implementation đã đợi ACK.
- Tránh generic hóa sáu entity thành một registry phức tạp chỉ để bớt switch; helper dùng chung chỉ nên gom logic thật sự giống nhau.

### 4.3. Tài liệu và phần chuẩn bị trước nhu cầu

- README/architecture cũ còn nhắc `internal/ports`, memory adapter và HTTP contract tests chưa tồn tại ở package hiện tại.
- `decision.md` còn nói log append-only, chỉ hai mutable entity, ngưỡng cố định toàn hệ thống; implementation đã khác.
- OAuth state adapter và `notification_deliveries` chưa phục vụ flow hoàn chỉnh; có thể hoãn khỏi baseline dev mới hoặc ghi rõ planned.
- Giữ một tài liệu “as-built” làm điểm vào, còn decision/plan nên có trạng thái historical/proposed/accepted để tránh hiểu nhầm.

## 5. Hiệu năng: tối ưu phần đáng làm

Chưa có load benchmark; những đánh giá dưới đây dựa trên đường đi dữ liệu và số query, không phải số liệu latency đo được.

| Hiện tại | Chi phí | Hướng gọn hơn |
|---|---|---|
| Push load toàn pending, rồi lookup entity từng item để biết account, lặp lại mỗi batch | N+1 và scan lặp; backlog lớn có thể tiến gần chi phí bậc hai theo số batch | `accountId` trực tiếp trong outbox, compound index + page FIFO |
| Count unresolved đọc row rồi lookup ownership từng entity | Tốn I/O cho badge/trạng thái | Count bằng index account/status |
| Reminder query scan service logs của xe cho từng reminder | Khoảng R lần scan cùng tập log | Dùng compound index đã có hoặc load một lần, group theo PartType |
| KM hiện tại load mọi odometer log của xe | Tăng theo lịch sử | Index và tie-break rõ để lấy latest, sau khi chốt ordering |
| Giữ applied outbox, processed mutations và full feed vô hạn | Dung lượng tăng theo số thao tác | Dọn applied outbox an toàn; retention server phải kèm retry horizon và snapshot/reset protocol |
| Watermark là row có TTL, cleanup/write cả khi pull | Extra writes cho thao tác đọc | Xem phương án stateless bound ở mục 6 |
| 100 mutation = 100 transaction | Nhiều round-trip DB | Giữ trước cho MVP; chỉ chuyển batch/savepoint khi đo thấy bottleneck |
| Bundle JS chính khoảng 763 kB minified / 234 kB gzip trong lần build review | Initial load/cache update tương đối lớn | Lazy-load pages/sheets ít dùng nếu cần; không phải bottleneck correctness của sync |

Không nên xóa processed mutations/changefeed chỉ dựa trên tuổi: thiết bị offline lâu có thể retry mutation hoặc cần pull lịch sử cũ. Không nên bỏ account sequence transaction để dùng một sequence DB không bảo đảm commit-order rồi mặc định cursor luôn an toàn.

## 6. Các cách tiếp cận tốt hơn

### A. Giữ incremental sync, làm gọn protocol — khuyến nghị

Phù hợp nhất nếu vẫn cần offline edits, nhiều thiết bị và lịch sử tăng dần.

**Client:**

```text
UI write transaction:
  validate → update optimistic entity → append immutable mutation(localSeq++)

Sync dưới account-level browser lock:
  bootstrap/auth
  push FIFO hữu hạn theo localSeq, bảo toàn dependency
  ACK đúng mutation/revision
  pull incremental
  lưu confirmed remote + replay pending trong transaction cùng cursor
  cập nhật trạng thái theo pending/blocked/last success
```

Mutation đã thử gửi phải giữ nguyên ID và envelope khi retry. Bản sửa mới là mutation mới. Không coalesce trên một queue có cả item đã gửi nhưng chưa nhận ACK. Nếu một parent chưa thành công, child giữ blocked/pending để thử lại khi dependency đã có; lỗi input thật phải có recovery action.

**Server:**

```text
authenticate + validate envelope
transaction:
  kiểm tra kết quả mutation đã xử lý
  validate stateful rules/ownership cho mutation mới
  write canonical entity + allocate account seq
  append canonical change + save acknowledgment
commit
```

Seed mọi entity vào cùng feed. Có thể rút outcome xuống `applied | duplicate | rejected | retryable_error`; nếu LWW luôn chấp nhận snapshot mới thì `conflict_resolved`/snapshot echo chỉ nên giữ khi thật sự phục vụ UI/telemetry. `base_server_seq` nếu giữ phải gắn với revision lúc edit, không đọc lại tùy ý khi retry.

Watermark có thể đổi thành **stateless upper bound**: trang đầu trả `until_seq=currentSeq`, các trang sau dùng cùng bound. Server kiểm tra range và account scope; có thể ký token nếu cần ràng buộc bound do server phát hành. Do feed immutable và seq cấp trong transaction theo account, không cần row TTL chỉ để cố định range. Điều này không tự giải bài toán retention; phải định nghĩa reset nếu feed đã bị compact.

**Đánh đổi:** vẫn cần logic outbox/reconciliation, nhưng ít ngoại lệ và dễ viết test theo invariant hơn hiện tại.

### B. Push mutations + pull toàn bộ snapshot account

Phù hợp nếu chắc chắn mỗi tài khoản chỉ có tập dữ liệu nhỏ và ưu tiên code dễ hiểu hơn tiết kiệm băng thông.

- Giữ UUID, outbox, retry/dedupe và server transaction.
- Pull trả một snapshot nhất quán cùng account revision; có thể dùng ETag để bỏ qua khi không đổi.
- Client reconcile snapshot với local pending, không replace local DB mù quáng.
- Có thể bỏ changefeed, cursor và watermark pagination nếu snapshot có giới hạn nhỏ được chấp nhận.

**Đánh đổi:** dữ liệu lớn dần làm mỗi lượt sync đắt; vẫn không được bỏ reconciliation/idempotency. Snapshot phân trang phải có isolation/version cố định hoặc sẽ mất ưu điểm đơn giản. Không khuyến nghị mặc định khi app có lịch sử nhiều năm.

### C. Online-first CRUD + read cache

Đơn giản nhất nếu bỏ yêu cầu **ghi khi offline**: CRUD server, client cache để đọc, refetch khi online. Không cần local mutation queue đầy đủ.

**Đánh đổi:** đây là thay đổi yêu cầu sản phẩm, không thay thế tương đương cho local-first hiện tại. Chỉ chọn nếu offline write không quan trọng.

### Redis có cần không?

Redis chỉ đang phục vụ auth/session/token, không cần cho sync. Nếu mục tiêu là giảm hạ tầng cho MVP, có thể lưu session/token có expiry trong PostgreSQL và chạy một DB; kiểm tra chi phí refresh session và cleanup. Nếu Redis đã là hạ tầng sẵn có thì giữ cũng hợp lý. Không cần chuyển sang JWT chỉ để bỏ Redis.

## 7. Lộ trình breaking changes đề xuất

### Bước 1 — Chốt semantics và khóa các regression

- Chốt toàn-record LWW, fuel/service mutable, odometer correction và guest scope.
- Viết test hồi quy cho F1–F10 theo hành vi mong muốn; ưu tiên ordering, network retry và dirty merge.
- Thêm test HTTP cookie/CSRF/push/pull thực sự qua application, không chỉ test adapter bypass validation.
- CI integration phải báo lỗi khi môi trường yêu cầu Docker mà container không chạy; tránh “xanh do skip”.

### Bước 2 — Protocol v2/client schema mới

- Outbox: account scope, monotonic local sequence, immutable attempted envelope, trạng thái có đường kết thúc.
- Bỏ coalesce runtime; account-level multi-tab lock; reconciliation theo revision.
- Server port trả error đầy đủ, single-mutation method, dedupe trước stateful validation.
- Typed/canonical payload và immutable-reference rules.
- Seed PartType vào feed; bootstrap chỉ dùng một sync pipeline.
- Có thể đổi reminder identity theo natural key để tránh duplicate creation cross-device.

### Bước 3 — Giảm trạng thái và tối ưu nhỏ

- Cân nhắc stateless bound, bỏ endpoint replication phụ và những status không dùng (`sent`, persisted `retryable_error` hiện không phải đường retry thực tế).
- Index query/outbox, dọn acknowledged local history theo policy.
- Cập nhật docs, naming, formatter; chỉ sau đó benchmark để quyết định batching/retention.

Vì đang dev và chấp nhận breaking changes, có thể reset dữ liệu dev, đổi API version và tăng Dexie schema version thay vì giữ nhiều đường compatibility. Cần chủ động thống nhất việc reset với người dùng/dev đang có dữ liệu local chưa sync; không tự xóa dữ liệu khi deploy code mới.

### Bộ tiêu chí nghiệm thu nên có

1. Tạo xe → ghi KM → đổi tên khi offline, sync không reject bản con.
2. Server commit nhưng response mất: retry không tạo thêm change và trả ACK cũ dù PartType đổi trạng thái.
3. Edit khi push/pull đang chạy: UI và lần sync tiếp theo giữ đúng ý định chỉnh sửa local.
4. Retryable parent không biến child thành rejected vĩnh viễn.
5. Sửa một rejected item xong, account có thể về synced; thông tin lỗi còn truy vết được.
6. Hai tab sync cùng account không làm cursor lùi hoặc kẹt stale duplicate ACK.
7. Mất IndexedDB rồi login: một bootstrap phục hồi đủ cả seed catalog và business data.
8. Pull nhiều trang trong lúc thiết bị khác push: không thiếu/trùng hiệu ứng và cursor atomic.
9. Xóa fuel/service: history, cost và reminder phản ánh cùng semantics đã chốt.
10. Cold-start offline với cached account dùng được; explicit logout không tự mở lại cached workspace.
11. Concurrent create reminder cùng natural scope có kết quả hội tụ được định nghĩa.
12. DB down/timeout trả retryable, không ghi rejected ownership; canonical feed khớp row lưu thật.

## 8. Kiểm chứng trong lần review này

| Kiểm tra | Kết quả |
|---|---|
| `make test` | Frontend 14 files / 64 tests pass; Go `-race` command pass |
| `go test -race -v ./internal/adapters/postgres/...` | 10 tests Postgres + 1 seed test đều **skip** do không tạo được Docker provider |
| `make lint` | Pass; 3 warning Fast Refresh ở UI button/badge/toggle; Go vet pass |
| `make build` | Frontend TypeScript/Vite và Go build pass; cảnh báo bundle >500 kB |
| 4 kiểm tra chẩn đoán tạm thời bằng Vitest/fake-indexeddb | Xác nhận thứ tự con trước cha sau coalesce; pull ghi đè dirty local; rejected cũ vẫn unresolved sau edit accepted; offline hydration chuyển anonymous |

Các kiểm tra chẩn đoán dùng mock HTTP để xác nhận hành vi client hiện tại, không thay thế regression tests cho bản sửa. File chẩn đoán đã được gỡ sau review. Các nhận định server transaction/concurrency ở trên được đối chiếu code/SQL, **chưa xác minh integration trong môi trường này**. Chưa chạy browser E2E hoặc load benchmark. Không suy ra phần trăm coverage từ số test pass.

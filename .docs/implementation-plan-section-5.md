# Kế hoạch triển khai mục 5 - App Nhắc Bảo Dưỡng Xe Máy

## 1. Mục tiêu

Tài liệu này chuyển các quyết định trong `decision.md` thành kế hoạch triển khai cho bốn đầu việc kỹ thuật tại mục 5:

1. Thiết kế chi tiết schema từng bảng.
2. Đặc tả user flow nghiệp vụ từ thêm xe đến ghi nhận bảo dưỡng.
3. Xác định danh sách `PartType` mặc định và cơ chế seed.
4. Thiết kế API push/pull cho mô hình local-first và đồng bộ đa thiết bị.

Thiết kế UI progress bar không thuộc phạm vi tài liệu này. Các nội dung về trạng thái reminder chỉ mô tả quy tắc nghiệp vụ và dữ liệu đầu vào/đầu ra, không mô tả giao diện.

Xem thêm về thiết kế prototype ở design.html

## 2. Nguyên tắc phải giữ nguyên

Các bước triển khai không được làm thay đổi những quyết định nền tảng sau:

- Mọi thao tác đọc và ghi của người dùng thực hiện trên local storage trước.
- UUID của entity được sinh tại client trước khi đồng bộ.
- `OdometerLog`, `FuelLog` và `ServiceLog` là append-only, không sửa hoặc xóa trong MVP.
- `Vehicle` và `ReminderConfig` là mutable, xóa bằng tombstone.
- Odometer hiện tại được suy ra từ `OdometerLog`; lần bảo dưỡng gần nhất được suy ra từ `ServiceLog`.
- Xung đột mutable entity dùng LWW theo thứ tự server tiếp nhận, không dùng đồng hồ client.
- Push phải idempotent; pull dùng changefeed và con trỏ `last_seen_seq`.
- Dữ liệu luôn được cô lập theo account đã xác thực.
- Export/import chưa được triển khai, nhưng entity phải có thể serialize ổn định về sau.

## 3. Các quyết định đã chốt trước khi code

Những quyết định dưới đây ảnh hưởng trực tiếp đến schema, domain logic và API contract. Các giá trị mặc định đã được chấp thuận và được ghi chính thức tại mục 6 của `decision.md`.

| Mã | Quyết định | Giá trị đã chốt cho MVP | Ảnh hưởng |
|---|---|---|---|
| D-01 | Odometer hiện tại khi log đến không đúng thứ tự | Chọn log có `recorded_at` mới nhất; nếu trùng thời điểm, dùng thứ tự server nhận để phân định | Schema, reminder calculation |
| D-02 | Có chấp nhận KM thấp hơn dữ liệu trước đó không | Cho lưu nhưng đánh dấu validation warning; không âm thầm loại bỏ dữ liệu offline | User flow, validation |
| D-03 | Trạng thái reminder theo KM và thời gian | Quá hạn nếu một trong các điều kiện đã cấu hình bị quá hạn; phần trăm tiến độ tính riêng cho từng điều kiện | Domain logic |
| D-04 | Ngưỡng sắp đến hạn | Cấu hình ở cấp hệ thống, ban đầu 10% chu kỳ còn lại; không lưu trên từng reminder | Domain logic, email |
| D-05 | Reminder chưa có `ServiceLog` | Dùng mốc bắt đầu do user nhập khi tạo reminder; cần field mốc KM/ngày ban đầu | Schema, flow |
| D-06 | Loại sự kiện bảo dưỡng | MVP chỉ cần sự kiện hoàn tất có tác dụng reset mốc; ghi chú là tùy chọn | ServiceLog schema |
| D-07 | Timezone cho reminder theo ngày | Lưu timestamp UTC và timezone của account; tính ngày đến hạn theo timezone account | Schema, scheduler |
| D-08 | Push batch và pull page size | Giới hạn cấu hình server; giá trị khởi đầu là 100 mutation/trang | API, vận hành |
| D-09 | Chu kỳ auto-sync | Best-effort khi foreground nếu lần sync gần nhất quá 15 phút | Sync engine |
| D-10 | Khi nào gửi email | Job server định kỳ, gửi một lần cho mỗi reminder và mỗi mốc đến hạn | Notification schema |

Các quy tắc trên vẫn phải được đặt sau interface/domain policy có thể kiểm thử, không hard-code rải rác ở client và server. Mọi thay đổi sau này cần được cập nhật trước trong `decision.md`.

## 4. Thứ tự triển khai tổng thể

| Giai đoạn | Nội dung | Điều kiện bắt đầu | Đầu ra chính |
|---|---|---|---|
| 0 | Chốt nghiệp vụ | Hoàn tất | Decision D-01 đến D-10 tại mục 6 của `decision.md` |
| 1 | Schema server và local | Giai đoạn 0 hoàn tất | Data dictionary, ERD, migration plan |
| 2 | Seed `PartType` | Khóa định danh trong schema | Seed manifest có version |
| 3 | User flow và domain rules | Có draft schema | Flow specification và state transition |
| 4 | API và sync protocol | Schema và flow ổn định | OpenAPI/contract, quy tắc transaction |
| 5 | Domain/local implementation | Contract được review | Repository local, outbox, domain calculation |
| 6 | Server sync implementation | Migration và API contract được khóa | Push, changefeed, pull, auth scope |
| 7 | Tích hợp và hardening | Client/server cơ bản hoạt động | Multi-device tests, recovery, observability |

## 5. Workstream A - Thiết kế schema chi tiết

### A1. Lập data dictionary

Đặc tả tối thiểu các entity sau:

| Entity | Trách nhiệm | Loại đồng bộ |
|---|---|---|
| `Account` | Định danh người dùng, email, timezone | Server-owned mutable |
| `Device` | Định danh một cài đặt client và theo dõi hoạt động sync | Mutable, server-managed |
| `Vehicle` | Thông tin xe và trạng thái archive/delete | Mutable, LWW |
| `PartType` | Danh mục phụ tùng hệ thống | Static seed |
| `ReminderConfig` | Chu kỳ và mốc bắt đầu theo xe/phụ tùng | Mutable, LWW |
| `OdometerLog` | Một lần ghi nhận số KM | Append-only |
| `FuelLog` | Một lần đổ xăng | Append-only |
| `ServiceLog` | Một lần hoàn tất bảo dưỡng/thay phụ tùng | Append-only |
| `AccountSequence` | Cấp `server_seq` tuần tự theo account | Server internal |
| `ChangeFeed` | Lưu từng thay đổi để client pull | Server internal, append-only |
| `ProcessedMutation` | Dedupe retry theo client mutation | Server internal |
| `NotificationDelivery` | Chống gửi email trùng | Server internal |

Mỗi entity nghiệp vụ cần mô tả đầy đủ:

- Tên field và ý nghĩa nghiệp vụ.
- Kiểu dữ liệu logic và khả năng null.
- Primary key UUID và foreign key.
- Constraint, unique key và check constraint.
- Field thời gian do client ghi nhận và field thời gian server tiếp nhận.
- Ownership theo `account_id`.
- Chính sách mutable, append-only hoặc tombstone.
- Cách serialize cho API và export tương lai.
- Index phục vụ query chính.

### A2. Quy ước field chung

Các entity đồng bộ nên tuân thủ một bộ quy ước nhất quán:

| Field | Áp dụng | Mục đích |
|---|---|---|
| `id` | Mọi entity | UUID sinh phía client, trừ bảng nội bộ server |
| `account_id` | Dữ liệu thuộc người dùng | Cô lập tenant và kiểm tra ownership |
| `created_at_client` | Entity do client tạo | Thời điểm nghiệp vụ/tham khảo, không dùng phân xử conflict |
| `received_at_server` | Bản ghi trên server | Audit và sắp xếp theo thời điểm server nhận |
| `server_seq` | Phiên bản mới nhất của entity đã sync | Liên kết với changefeed và hỗ trợ chẩn đoán |
| `deleted_at` | Mutable entity có tombstone | Đồng bộ hành vi xóa |

Không dùng `updated_at_client` để quyết định bản ghi thắng. Push mutable entity phải có `mutation_id`; server chỉ áp dụng một mutation đúng một lần, kể cả khi client retry.

### A3. Quan hệ và constraint bắt buộc

- Mọi `Vehicle` thuộc đúng một `Account`.
- Mọi log và reminder phải tham chiếu một `Vehicle` cùng account.
- `ReminderConfig` là duy nhất theo `(account_id, vehicle_id, part_type_id)` khi chưa bị tombstone.
- `PartType.code` là stable identifier duy nhất và không được tái sử dụng.
- Giá trị odometer phải không âm.
- `interval_km` và `interval_days` phải dương nếu có giá trị; ít nhất một trong hai phải tồn tại trên reminder hoạt động.
- `FuelLog.odometer_log_id` là tùy chọn nhưng nếu có phải tham chiếu log cùng vehicle và account.
- `ServiceLog` phải tham chiếu `part_type_id`; odometer tại thời điểm service có thể được snapshot để việc tính reminder ổn định.
- Append-only entity không có API update/delete trong MVP.

### A4. Thiết kế changefeed

Mỗi mutation hợp lệ trên server phải thực hiện trong một transaction:

1. Xác thực account ownership và payload.
2. Dedupe `mutation_id` hoặc UUID theo loại entity.
3. Cấp `server_seq` tiếp theo trong phạm vi account với cơ chế an toàn khi concurrent.
4. Insert/update entity.
5. Insert một `ChangeFeed` event chứa entity type, entity ID, operation và snapshot cần pull.
6. Ghi kết quả mutation để cùng retry có thể trả lại cùng acknowledgment.
7. Commit transaction rồi mới trả response.

Không chỉ lưu `server_seq` mới nhất trên entity rồi query trực tiếp entity table cho pull, vì nhiều update liên tiếp trước khi client pull có thể làm hổng sequence và gây hành vi phân trang khó kiểm soát. `ChangeFeed` phải giữ từng event hoặc một cơ chế tương đương có semantics được chứng minh bằng test.

### A5. Local metadata

Local database cần thêm các cấu trúc không thuộc domain export:

- `device_id` bền vững theo lần cài app.
- `last_seen_seq` theo account.
- Outbox chứa `mutation_id`, entity reference, payload, trạng thái và số lần retry.
- Trạng thái lần push/pull gần nhất và lỗi gần nhất.
- Migration version của local database.
- Cờ bootstrap để phân biệt local storage mới, đang restore và đã đồng bộ đầy đủ.

Việc cập nhật domain entity và thêm outbox mutation phải nằm trong cùng local transaction. Một outbox item chỉ được đánh dấu hoàn tất sau acknowledgment từ server.

### A6. Index tối thiểu cần đánh giá

- Changefeed theo `(account_id, server_seq)`.
- Log theo `(account_id, vehicle_id, recorded_at)`.
- Service log theo `(account_id, vehicle_id, part_type_id, serviced_at)`.
- Reminder theo `(account_id, vehicle_id, part_type_id)`.
- Outbox theo trạng thái và thứ tự tạo.
- Processed mutation theo `(account_id, device_id, mutation_id)`.
- Notification delivery theo khóa idempotency của reminder/mốc đến hạn.

### A7. Đầu ra và tiêu chí hoàn thành

Đầu ra dự kiến:

- `data-schema.md`: data dictionary, quan hệ, constraint và index.
- ERD ở định dạng text có thể review trong source control.
- Migration order cho server và local database.
- Danh sách invariant dùng chung cho validation client/server.

Hoàn thành khi:

- Mỗi entity có ownership và lifecycle rõ ràng.
- Có phương án transaction an toàn cho `server_seq` và changefeed.
- Không dùng timestamp client để phân xử conflict.
- Schema hỗ trợ full restore, tombstone và export tương lai.
- Migration và constraint có test tự động.

## 6. Workstream B - Đặc tả user flow nghiệp vụ

### B1. Thêm và quản lý xe

Đặc tả các luồng tạo, sửa, archive, restore và tombstone xe. Mỗi flow phải mô tả:

- Preconditions và dữ liệu local cần có.
- Local transaction và outbox mutation phát sinh.
- Trạng thái khi offline.
- Kết quả sau push/pull.
- Hành vi khi một thiết bị khác đồng thời sửa cùng xe.

Archive là trạng thái nghiệp vụ có thể phục hồi; tombstone là xóa logic. Hai khái niệm phải được phân biệt trong schema và flow.

### B2. Thiết lập reminder

Flow phải hỗ trợ reminder theo KM, theo ngày hoặc cả hai. Cần xác định rõ:

- Mốc bắt đầu khi chưa có `ServiceLog`.
- Validation cho interval.
- Cách sửa reminder đang hoạt động.
- Cách tắt, bật lại hoặc xóa reminder.
- Ảnh hưởng của tombstone và LWW khi chỉnh sửa offline trên nhiều thiết bị.

### B3. Nhập odometer thủ công

Mỗi lần nhập tạo `OdometerLog` mới. Flow cần xử lý:

- Giá trị không hợp lệ hoặc thấp hơn odometer đang hiển thị.
- Hai log có cùng `recorded_at`.
- Log offline được server nhận sau một log mới hơn.
- Retry push mà không sinh bản ghi trùng.
- Tính lại reminder sau khi local transaction hoàn tất.

### B4. Ghi nhận đổ xăng

Một thao tác có thể tạo cả `FuelLog` và `OdometerLog`. Hai record phải được tạo atomically tại local và đẩy bằng các mutation idempotent có liên kết ổn định.

Flow phải mô tả hành vi khi:

- Chỉ nhập thông tin đổ xăng mà không nhập KM.
- Nhập KM cùng lần đổ xăng.
- Server chấp nhận một record nhưng từ chối record còn lại.
- Client retry toàn bộ nhóm mutation.

Ưu tiên thiết kế push hỗ trợ transaction group cho cặp record liên quan. Nếu API chỉ hỗ trợ partial success, client phải giữ record thất bại trong outbox và không tạo UUID mới khi retry.

### B5. Tính trạng thái reminder

Reminder calculation nên là domain function thuần, nhận snapshot dữ liệu và trả về trạng thái có thể kiểm thử. Đầu vào tối thiểu:

- `ReminderConfig` đang hoạt động.
- Odometer hiện tại hoặc trạng thái chưa có odometer.
- `ServiceLog` gần nhất hoặc mốc bắt đầu.
- Thời điểm hiện tại và timezone account.

Đầu ra tối thiểu:

- Trạng thái `insufficient_data`, `not_due`, `due_soon` hoặc `overdue`.
- KM đã dùng, KM còn lại và tỷ lệ theo KM nếu áp dụng.
- Số ngày đã qua, ngày còn lại và tỷ lệ theo thời gian nếu áp dụng.
- Mốc dữ liệu được dùng để tính, phục vụ giải thích và debug.

### B6. Ghi nhận bảo dưỡng

Mỗi lần hoàn tất tạo `ServiceLog`, không sửa trực tiếp `ReminderConfig`. Flow cần xác định:

- Thời điểm hoàn tất.
- Odometer snapshot tại thời điểm bảo dưỡng.
- Phụ tùng liên quan.
- Ghi chú tùy chọn.
- Việc chọn service log mới nhất khi log đến không theo thứ tự.
- Cách trạng thái reminder được tính lại ngay tại local.

### B7. Email reminder

Email được tính từ dữ liệu đã có trên server, do đó flow phải nêu rõ dữ liệu offline chưa push chưa thể ảnh hưởng email. Scheduler cần:

- Bỏ qua vehicle archived/deleted và reminder disabled/deleted.
- Dùng timezone account khi đánh giá reminder theo ngày.
- Có idempotency key để không gửi trùng cùng một mốc.
- Cho phép một service log mới kết thúc chu kỳ nhắc hiện tại.
- Ghi lại trạng thái gửi, lỗi retryable và lỗi permanent.

### B8. Sync, bootstrap và recovery

Đặc tả riêng các kịch bản:

- Người dùng chưa có account và chỉ dùng local.
- Đăng nhập lần đầu khi local và server đều có dữ liệu.
- Thiết bị mới pull dữ liệu từ đầu.
- Local storage bị xóa nhưng session/account vẫn còn.
- Push bị mất response sau khi server đã commit.
- Push thành công một phần.
- Pull nhiều trang bị ngắt giữa chừng.
- Hai thiết bị sửa cùng mutable entity.
- Một thiết bị tombstone trong khi thiết bị khác đang offline.

Con trỏ chỉ được cập nhật sau khi toàn bộ change trong một trang đã được lưu local atomically. Khi pull nhiều trang, dùng watermark của phiên pull để có tập kết quả nhất quán; change mới hơn watermark được lấy ở phiên tiếp theo.

### B9. Đầu ra và tiêu chí hoàn thành

Đầu ra dự kiến:

- `domain-user-flows.md` với happy path, offline path và error path.
- Bảng state transition cho outbox, bootstrap và reminder.
- Sequence diagram dạng text cho push, pull và first-login merge.

Hoàn thành khi mọi flow chỉ rõ local write, outbox, server effect, pull effect và recovery; không yêu cầu thiết kế màn hình để hiểu hoặc kiểm thử hành vi.

## 7. Workstream C - Danh mục `PartType`

### C1. Danh sách MVP đề xuất

| Code đề xuất | Tên hiển thị | Ghi chú |
|---|---|---|
| `engine_oil` | Dầu nhớt động cơ | Phổ biến cho mọi loại xe máy |
| `front_tire` | Lốp trước | Tách trước/sau vì chu kỳ có thể khác nhau |
| `rear_tire` | Lốp sau | Tách trước/sau vì chu kỳ có thể khác nhau |
| `front_brake_pad` | Má phanh trước | Không giả định loại phanh |
| `rear_brake_pad` | Má phanh sau | Không giả định loại phanh |
| `spark_plug` | Bugi | Danh mục chung |
| `air_filter` | Lọc gió | Danh mục chung |
| `drive_belt` | Dây curoa | Chủ yếu dành cho xe tay ga |
| `chain_sprocket_set` | Nhông, sên, đĩa | Chủ yếu dành cho xe số/côn tay |
| `battery` | Ắc quy | Danh mục chung |

Danh sách này đã được chấp thuận cho MVP. Không gộp `drive_belt` và `chain_sprocket_set` thành một code vì đây là hai hệ truyền động khác nhau và có chu kỳ bảo dưỡng khác nhau.

### C2. Cấu trúc seed

Mỗi seed item tối thiểu gồm:

- UUID cố định, không sinh mới ở mỗi lần chạy seed.
- Stable `code` không phụ thuộc ngôn ngữ hiển thị.
- Tên tiếng Việt.
- `display_order`.
- Trạng thái `active`.
- `seed_version` hoặc version của manifest.

Không lưu chu kỳ mặc định mang tính áp đặt. Nếu sản phẩm cần placeholder tham khảo, nội dung gợi ý phải tách khỏi interval user đã cấu hình và được gắn nhãn rõ là tham khảo.

### C3. Quy tắc versioning

- Chạy seed nhiều lần không tạo bản ghi trùng.
- Không đổi UUID hoặc code đã phát hành.
- Không xóa cứng `PartType` đã được tham chiếu.
- Ngừng sử dụng bằng `active = false`.
- Đổi tên hiển thị không làm thay đổi code.
- Thêm item mới bằng seed version mới.
- Client phải xử lý được item chưa biết từ server bằng code và tên hiển thị nhận được, không crash vì enum đóng cứng.

### C4. Đầu ra và tiêu chí hoàn thành

Đầu ra dự kiến:

- `part-type-seed.md` mô tả danh mục và quy tắc quản trị.
- Seed manifest dùng chung làm nguồn dữ liệu chuẩn.
- Test chạy seed lặp lại và test tham chiếu item inactive.

Hoàn thành khi danh mục được duyệt, định danh ổn định và seed có thể chạy lại an toàn trên database đã có dữ liệu.

## 8. Workstream D - API surface và sync protocol

### D1. Authentication và device registration

Contract cần bao phủ:

- Yêu cầu magic link hoặc OTP qua email.
- Xác nhận đăng nhập và phát hành session/token.
- Refresh/revoke session theo khả năng của hệ thống auth được chọn.
- Đăng ký `device_id` sau đăng nhập.
- Liên kết dữ liệu local chưa có account vào account hiện tại trong lần merge đầu tiên.

Không tin `account_id` trong payload client. Server luôn suy ra account từ session đã xác thực.

### D2. Push endpoint

Request tối thiểu cần có:

- `device_id`.
- Danh sách mutation có `mutation_id`, entity type, operation, entity ID và payload.
- Version của API/schema để phát hiện client quá cũ.
- Transaction group ID nếu một nghiệp vụ tạo nhiều record cần atomicity.

Response phải trả kết quả theo từng mutation:

- `applied`: server đã áp dụng mutation mới.
- `duplicate`: mutation đã được xử lý trước đó và trả lại acknowledgment cũ.
- `rejected`: payload hoặc ownership không hợp lệ, không retry nguyên trạng.
- `retryable_error`: lỗi tạm thời có thể gửi lại cùng mutation ID.
- `conflict_resolved`: mutable record đã qua LWW, kèm snapshot server cuối cùng nếu client cần reconcile.

Server không được biến cùng một retry thành một lần LWW mới. `mutation_id` đã xử lý phải trả lại cùng kết quả ban đầu.

### D3. LWW cho mutable entity

Thứ tự xử lý server là nguồn sự thật. Với mỗi mutation mutable chưa từng xử lý:

1. Server xác thực mutation.
2. Server cấp sequence.
3. Mutation được áp dụng như phiên bản mới nhất, kể cả timestamp client cũ hơn.
4. Snapshot mới được ghi vào changefeed.
5. Các thiết bị khác nhận snapshot qua pull.

Contract cần ghi rõ trade-off: một chỉnh sửa cũ được push muộn có thể ghi đè chỉnh sửa đã đồng bộ trước đó. Đây là hành vi MVP đã chấp nhận, không phải lỗi giao thức.

### D4. Pull endpoint

Request tối thiểu:

- `after_seq`, mặc định `0` cho full pull.
- `limit` trong giới hạn server.
- `watermark`, để trống khi bắt đầu phiên pull và tái sử dụng cho các trang tiếp theo.

Response tối thiểu:

- Danh sách change theo thứ tự `server_seq` tăng dần.
- `next_cursor`.
- `watermark` cố định cho toàn phiên phân trang.
- `has_more`.
- Server time để hỗ trợ quan sát, không dùng cho conflict client.

Khi đã lưu thành công một trang trong local transaction, client cập nhật `last_seen_seq` bằng sequence cuối của trang. Nếu trang lỗi giữa chừng, transaction rollback và cursor không đổi.

### D5. Snapshot, tombstone và compaction

Change payload phải đủ để client áp dụng mà không cần gọi API chi tiết cho từng entity. Tombstone phải chứa tối thiểu entity type, ID, account ownership ngầm định, `deleted_at` và sequence.

Trước khi triển khai compaction changefeed, phải có chính sách retention và cơ chế bootstrap snapshot. MVP nên giữ changefeed đầy đủ nếu dung lượng cho phép; không xóa event chỉ dựa trên `last_seen_seq` của thiết bị vì thiết bị có thể bị mất local storage hoặc offline dài ngày.

### D6. Error model và giới hạn

Chuẩn hóa tối thiểu:

- Mã lỗi ổn định cho auth, validation, ownership, unsupported version và rate limit.
- Cờ retryable hoặc mapping rõ theo HTTP status/error code.
- Giới hạn số mutation, kích thước payload và page size.
- Backoff có jitter cho lỗi tạm thời.
- Không log token, OTP hoặc payload nhạy cảm.
- Correlation/request ID cho chẩn đoán push/pull.

### D7. Security boundary

- Mọi query entity/changefeed đều scope theo account từ session.
- Entity ID tồn tại ở account khác phải được xử lý như không tồn tại.
- Device phải thuộc account hiện tại.
- Không cho client tự gán `server_seq`, `received_at_server` hoặc trạng thái delivery email.
- Rate limit auth và sync endpoint độc lập.
- Validate payload cả ở API layer và database constraint.

### D8. Đầu ra và tiêu chí hoàn thành

Đầu ra dự kiến:

- `sync-api-contract.md` mô tả endpoint và semantics.
- Machine-readable API schema khi tech stack đã được chọn.
- Ví dụ request/response cho success, duplicate, partial failure và pagination.
- Sequence diagram cho retry sau mất response và merge nhiều thiết bị.

Hoàn thành khi contract chứng minh được idempotency, account isolation, pull phân trang không mất change và recovery từ local database trống.

## 9. Kế hoạch kiểm thử

### 9.1. Schema và migration

- Foreign key, unique constraint và check constraint hoạt động đúng.
- Không thể tạo dữ liệu tham chiếu chéo account.
- Không thể update/delete append-only log qua repository/API.
- Tombstone vẫn được ghi vào changefeed.
- Migration server/local chạy được từ database trống và từ version trước.
- Seed `PartType` chạy lặp lại không thay ID hoặc tạo bản ghi trùng.

### 9.2. Domain logic

- Reminder chỉ theo KM, chỉ theo ngày và theo cả hai.
- Chưa có odometer hoặc service baseline.
- Đúng hạn, sắp đến hạn và quá hạn.
- Odometer giảm hoặc log đến không đúng thứ tự.
- Service log mới reset đúng chu kỳ.
- Timezone không làm lệch ngày đến hạn.

### 9.3. API contract

- Session không hợp lệ hoặc device không thuộc account.
- Payload vượt giới hạn, sai version hoặc sai constraint.
- Retry cùng `mutation_id` trả cùng kết quả.
- UUID log trùng không tạo record mới.
- Partial failure giữ nguyên kết quả từng mutation.
- Không đọc hoặc sửa được dữ liệu account khác.

### 9.4. Sync integration

- Push thành công nhưng response bị mất, sau đó retry.
- Hai thiết bị tạo log đồng thời.
- Hai thiết bị sửa cùng mutable entity khi offline.
- Tombstone trên một thiết bị được áp dụng trên thiết bị khác.
- Pull nhiều trang trong khi server tiếp tục nhận mutation mới.
- Dừng giữa một trang pull rồi chạy lại.
- First-login merge khi local và server đều có dữ liệu.
- Full restore khi local storage bị xóa.

### 9.5. Notification

- Không gửi trùng cùng một reminder cycle.
- Không gửi cho xe archived/deleted hoặc reminder disabled/deleted.
- Retry lỗi email tạm thời không tạo delivery trùng.
- Service log mới kết thúc chu kỳ nhắc cũ.
- Dữ liệu chưa sync không được giả định là đã có trên server.

## 10. Observability và vận hành

Tối thiểu cần theo dõi:

- Số mutation push theo trạng thái applied, duplicate, rejected và retryable error.
- Độ trễ và số trang của mỗi pull session.
- Chênh lệch giữa watermark và `last_seen_seq` của thiết bị đang hoạt động.
- Lỗi cấp sequence hoặc transaction rollback.
- Số email gửi thành công, retry và permanent failure.
- Số lần bootstrap/full restore.

Log phải có account/device dạng định danh an toàn, request ID, mutation ID và sequence liên quan; không chứa token, OTP hoặc nội dung nhạy cảm không cần thiết.

## 11. Mốc bàn giao

| Mốc | Phạm vi | Tiêu chí duyệt |
|---|---|---|
| M1 | Quyết định nghiệp vụ và schema draft | D-01 đến D-10 đã chốt; ERD được review |
| M2 | Schema final và seed | Migration plan, constraint, index và seed idempotency được duyệt |
| M3 | User flow và domain rules | Happy/offline/error path đầy đủ; reminder tests được xác định |
| M4 | API contract | Push/pull examples, idempotency, pagination và security review hoàn tất |
| M5 | Local-first vertical slice | Tạo xe, reminder, odometer và service hoạt động hoàn toàn local |
| M6 | Multi-device sync | Push/pull, merge, tombstone và recovery vượt integration tests |
| M7 | Email và hardening | Chống gửi trùng, observability và security tests đạt yêu cầu |

## 12. Phụ thuộc

- Lựa chọn local database có transaction, migration và index phù hợp cho PWA.
- Database server hỗ trợ transaction và cấp sequence an toàn khi concurrent.
- Hệ thống xác thực email magic link/OTP.
- Dịch vụ gửi email giao dịch.
- Scheduler/worker chạy kiểm tra reminder định kỳ.
- Công cụ migration, contract test và integration test sau khi chọn tech stack.
- Quyết định retention/backup cho database và changefeed.

Tài liệu này không chọn nhà cung cấp hoặc framework cụ thể. Việc chọn stack phải được đánh giá riêng dựa trên khả năng đáp ứng các invariant nêu trên.

## 13. Rủi ro và biện pháp giảm thiểu

| Mức | Rủi ro | Biện pháp |
|---|---|---|
| Cao | Cấp `server_seq` không atomic gây trùng hoặc mất change | Cấp sequence và ghi entity/changefeed trong cùng transaction; stress test concurrent push |
| Cao | Query thiếu account scope làm lộ dữ liệu | Repository bắt buộc account context; database policy nếu hỗ trợ; security integration test |
| Cao | Retry stale mutation trở thành lần ghi mới và thắng LWW | Dedupe bằng `mutation_id`, lưu và trả lại acknowledgment cũ |
| Cao | Thiếu field baseline khi triển khai reminder chưa từng service | Bổ sung baseline theo D-05 vào schema trước migration |
| Trung bình | Odometer không theo thứ tự làm trạng thái reminder sai | Áp dụng D-01, cảnh báo dữ liệu bất thường và test đầy đủ |
| Trung bình | Cặp `FuelLog`/`OdometerLog` bị ghi dở dang | Local transaction và server transaction group hoặc retry cùng UUID |
| Trung bình | LWW làm chỉnh sửa offline cũ ghi đè chỉnh sửa mới | Tài liệu hóa trade-off, trả snapshot cuối và bổ sung conflict UI ở phiên bản sau nếu cần |
| Trung bình | Email không phản ánh thay đổi chưa sync | Nêu rõ server-only semantics, hiển thị sync status và gửi sau khi dữ liệu đến server |
| Trung bình | Xóa IndexedDB bị hiểu là mất dữ liệu | Phát hiện bootstrap state và full pull từ `after_seq = 0` |
| Thấp | Danh mục phụ tùng thay đổi | Stable code/UUID, versioned seed và soft-disable |
| Thấp | Timezone làm lệch ngày nhắc | UTC cho timestamp, timezone account cho calendar calculation |

## 14. Ước lượng

Ước lượng cho một kỹ sư, chưa gồm thiết kế hoặc triển khai UI:

| Hạng mục | Ước lượng |
|---|---|
| Chốt nghiệp vụ và hoàn thiện bốn tài liệu đặc tả | 4-6 ngày làm việc |
| Schema, migration và seed | 4-6 ngày làm việc |
| Domain/local repository và outbox | 1-1.5 tuần |
| Auth, push, changefeed và pull | 1.5-2 tuần |
| Merge, recovery và email scheduler | 1-1.5 tuần |
| Integration, security và hardening | 1 tuần |

Tổng triển khai kỹ thuật dự kiến 4-6 tuần nếu hạ tầng auth/email và stack đã sẵn sàng. Biến số lớn nhất là lựa chọn local database, cách chạy background job và mức độ kiểm thử đa thiết bị.

## 15. Definition of Done toàn bộ mục 5

Phần triển khai được xem là hoàn thành khi:

- Schema server/local, constraint, index và migration đã được review và test.
- Seed `PartType` ổn định, có version và chạy lặp lại an toàn.
- Toàn bộ user flow có happy path, offline path và recovery path.
- Push idempotent kể cả khi mất response và retry.
- Pull phân trang không mất change, không nâng cursor trước khi local commit.
- First-login merge và full restore được kiểm thử tự động.
- Mutable conflict tuân thủ server-received LWW; append-only log không bị sửa/xóa.
- Account isolation vượt qua security tests.
- Email reminder không gửi trùng và bỏ qua dữ liệu inactive/deleted.
- Có metric/log đủ để điều tra lỗi sync mà không lộ dữ liệu nhạy cảm.
- Không có hạng mục thiết kế UI nào là điều kiện để kiểm thử hoặc nghiệm thu các nội dung trên.

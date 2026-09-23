# Decision Document — App Nhắc Bảo Dưỡng Xe Máy (MVP)

*Tổng hợp các quyết định nghiệp vụ & thiết kế dữ liệu, tập trung sâu vào offline sync. Không đề cập tech stack cụ thể — đây là quyết định về mô hình dữ liệu và luồng xử lý, có thể triển khai bằng bất kỳ stack nào.*

---

## 1. Phạm vi đã chốt cho MVP

**Trong scope:**
- Reminder theo phụ tùng phổ biến (danh sách tĩnh: lốp, má phanh, bugi, dầu nhớt, lọc gió, dây curoa/sên, ắc quy...), user tự nhập chu kỳ (không autofill, chỉ placeholder gợi ý tham khảo)
- Multi-vehicle trên 1 tài khoản
- Input KM thủ công + input qua lần đổ xăng
- Progress bar trực quan cho từng phụ tùng (theo KM và/hoặc theo thời gian)
- Notification qua email
- PWA, local-first, sync thủ công hoặc tự động khi mở app (non-realtime chấp nhận được)

**Ngoài scope (loại bỏ hoặc để sau):**
- Không chuẩn hóa tài liệu kỹ thuật hãng, không autofill thông số
- Không nội suy KM giữa hai lần nhập (bỏ hoàn toàn ở MVP này)
- Không tính fuel efficiency (chỉ dùng fuel log như kênh nhập KM phụ)
- Export/import: **chưa triển khai**, nhưng data model phải thiết kế sẵn sàng cho việc này (xem mục 4)

---

## 2. Mô hình dữ liệu — nguyên tắc nền tảng

Nguyên tắc quan trọng nhất: **tách rõ dữ liệu dạng log (append-only, bất biến) và dữ liệu dạng cấu hình (mutable state)**. Đây là quyết định nền tảng giúp toàn bộ bài toán sync trở nên đơn giản hơn nhiều.

| Entity | Loại | Ghi chú |
|---|---|---|
| Account | Mutable, ít thay đổi | email, tạo 1 lần |
| Device | Mutable, ít thay đổi | gắn với Account, sinh ra khi cài app |
| Vehicle | Mutable | tên, biển số, trạng thái archived (soft delete) |
| PartType | Mutable, seed-per-account | 10 dòng mặc định copy vào account lúc signup, user tự thêm/sửa/tắt như config khác |
| ReminderConfig | Mutable | interval_km, interval_days theo từng (vehicle, part_type) |
| OdometerLog | **Append-only** | mỗi lần nhập KM là 1 bản ghi mới, không sửa/xóa |
| FuelLog | **Append-only** | mỗi lần đổ xăng là 1 bản ghi, có thể liên kết OdometerLog |
| ServiceLog | **Append-only** | mỗi lần "đã thay/bảo dưỡng" là 1 bản ghi mới |

**Quyết định quan trọng:** ReminderConfig **không lưu** trực tiếp "lần thay gần nhất" như một field mutable. Giá trị này luôn được **suy ra (derive)** bằng cách lấy ServiceLog mới nhất theo (vehicle_id, part_type_id). Tương tự, "KM hiện tại của xe" luôn suy ra từ OdometerLog mới nhất.

Lợi ích: chỉ còn **2 loại entity thực sự cần xử lý conflict** khi sync (Vehicle, ReminderConfig) — toàn bộ log (chiếm phần lớn dữ liệu) chỉ cần "gộp không trùng", không bao giờ conflict về mặt cấu trúc.

---

## 3. Thiết kế Offline Sync (trọng tâm)

### 3.1. Nguyên tắc cốt lõi

- **Local-first**: mọi thao tác đọc/ghi xảy ra trên local storage của thiết bị trước; sync chỉ là hành động đẩy/kéo dữ liệu định kỳ, không chặn UI.
- **Không tin tưởng đồng hồ của thiết bị** để xử lý conflict giữa các thiết bị (client clock có thể sai lệch). Thứ tự "ai thắng ai" khi có conflict phải dựa trên **thời điểm server nhận được** bản ghi, không dựa trên timestamp do client tự ghi.
- **ID sinh phía client** (UUID) cho mọi bản ghi, sinh ra ngay khi tạo record, để việc gộp dữ liệu giữa các thiết bị an toàn và để retry sau lỗi mạng không tạo bản ghi trùng (idempotent).

### 3.2. Định danh & tài khoản

- Cần một Account nhẹ để liên kết dữ liệu giữa nhiều thiết bị của cùng 1 người (không có account thì không thể sync đa thiết bị). Đề xuất: email + magic link/OTP, không cần password ở MVP.
- Mỗi lần cài app trên 1 thiết bị mới → sinh `device_id` cục bộ, đăng ký thiết bị này với Account sau khi user đăng nhập.
- Khi 1 thiết bị đăng nhập lần đầu mà **đã có dữ liệu local từ trước** (VD: dùng offline trước khi tạo account) và server cũng đã có dữ liệu (từ thiết bị khác) → bắt buộc xử lý như một lần **merge**, không phải ghi đè. Đây là tình huống hay bị bỏ sót khi thiết kế, cần test kỹ.

### 3.3. Giao thức sync — mô hình "changefeed"

Áp dụng mô hình đơn giản, không cần hạ tầng phức tạp:

- Server gán một **số thứ tự tăng dần (server_seq)** cho mỗi bản ghi mỗi khi ghi nhận thay đổi (tạo mới hoặc update), theo từng Account.
- Mỗi thiết bị lưu **con trỏ `last_seen_seq`** cục bộ — vị trí đồng bộ gần nhất của chính nó.
- **Pull**: thiết bị hỏi server "cho tôi mọi bản ghi có server_seq > last_seen_seq của tôi", cập nhật con trỏ sau khi nhận xong (hỗ trợ phân trang nếu dữ liệu lịch sử dài).
- **Push**: thiết bị gửi lên mọi bản ghi log mới tạo cục bộ + mọi bản ghi mutable đã sửa kể từ lần push trước, kèm UUID đã sinh sẵn.

Cách này tránh hoàn toàn việc phải so sánh timestamp giữa các thiết bị để xác định thứ tự — thứ tự luôn do server quyết định.

### 3.4. Quy tắc xử lý conflict

**Với log (OdometerLog, FuelLog, ServiceLog):**
- Không có conflict thực sự. Insert nếu UUID chưa tồn tại, bỏ qua nếu đã tồn tại (dedupe). Xong.

**Với mutable (Vehicle, ReminderConfig):**
- Last-write-wins (LWW), nhưng **so sánh dựa trên thời điểm server nhận bản ghi**, không dựa trên timestamp do thiết bị tự khai.
- Không cần UI xử lý conflict phức tạp ở MVP — đây là dữ liệu cấu hình ít rủi ro (VD: chu kỳ thay dầu), chấp nhận rủi ro nhỏ là bản sửa sau ghi đè bản sửa trước nếu 2 thiết bị cùng sửa khi offline. Có thể để "hiển thị cảnh báo conflict" cho v2 nếu cần.

### 3.5. Xử lý xóa — dùng tombstone, không xóa cứng

- Không bao giờ xóa vật lý một bản ghi Vehicle hoặc ReminderConfig. Thay vào đó set field `deleted_at`.
- Việc "xóa" trở thành một bản update bình thường (mutable), đi theo đúng luồng LWW ở trên — không cần cơ chế riêng để đồng bộ hành vi xóa.
- Log (OdometerLog, ServiceLog...) không cho xóa ở UI MVP (đã ghi là ghi, tránh phức tạp hóa sync).

### 3.6. Trigger đồng bộ

- Nút **"Đồng bộ ngay"** thủ công, luôn có sẵn.
- **Tự động, best-effort**: khi app được mở lại (foreground) và có mạng, nếu lần sync gần nhất đã quá một khoảng thời gian nhất định (ví dụ 15–30 phút) → tự động sync nền, không chặn UI, không thông báo lỗi ồn ào nếu thất bại (chỉ hiển thị trạng thái "chưa đồng bộ" nhẹ nhàng).
- Luôn hiển thị rõ **"Đã đồng bộ lúc..."** để user tin tưởng vào dữ liệu đang xem trên màn hình.

### 3.7. Edge cases cần lưu ý khi triển khai

- **Retry sau lỗi mạng giữa chừng push**: nhờ UUID sinh sẵn phía client, việc gửi lại toàn bộ batch không tạo bản ghi trùng ở server (server chỉ cần upsert theo UUID).
- **Thiết bị iOS xóa dữ liệu cục bộ** (Safari có thể tự dọn IndexedDB nếu lâu không dùng/thiếu bộ nhớ): vì đây là local-first, cần đảm bảo lần mở app tiếp theo sẽ **pull toàn bộ dữ liệu từ đầu** nếu phát hiện local storage trống nhưng account đã có dữ liệu trên server (không được coi thiết bị trống = user mới, dễ gây hiểu lầm "mất hết dữ liệu").
- **Phân trang khi pull lần đầu** trên thiết bị mới hoặc sau thời gian dài không sync: dữ liệu log có thể lớn dần theo thời gian sử dụng, cần thiết kế pull theo trang ngay từ đầu, không load toàn bộ lịch sử một lần.

---

## 4. Chuẩn bị cho Export/Import (awareness — chưa triển khai)

Không code phần này ở giai đoạn hiện tại, nhưng để không phải sửa lại data model sau này:

- Mỗi entity nên có sẵn cấu trúc rõ ràng để dễ serialize sau này (không có field ẩn/tính toán runtime-only mà không thể export).
- Phân biệt sẵn trong đầu 2 loại export tương lai (không cần build ngay):
  - **Backup toàn bộ** (mọi entity, dùng để chuyển thiết bị)
  - **Chia sẻ cấu hình** (chỉ ReminderConfig, không kèm log cá nhân) — nhờ đã tách rõ mutable config khỏi log ngay từ mục 2, việc này về sau chỉ là filter theo entity type, không cần thiết kế lại.
- Khi cần triển khai, nên thêm field `schema_version` vào file export ngay từ phiên bản đầu tiên.

---

## 5. Việc cần làm tiếp theo

- [ ] Thiết kế chi tiết schema từng bảng (field, kiểu dữ liệu, ràng buộc)
- [ ] Vẽ user flow: thêm xe → set reminder → nhập KM/đổ xăng → nhận nhắc nhở → log đã thay
- [ ] Xác định danh sách PartType mặc định (seed data ban đầu)
- [ ] Thiết kế API surface cho push/pull (request/response shape, phân trang)
- [ ] Thiết kế UI progress bar (KM & thời gian) cho từng reminder

---

## 6. Quyết định bổ sung trước khi triển khai

Các mặc định dưới đây đã được chấp thuận và là quyết định chính thức cho MVP.

### 6.1. Odometer và reminder

- Odometer hiện tại được lấy từ `OdometerLog` có `recorded_at` mới nhất. Nếu nhiều log có cùng `recorded_at`, log được server tiếp nhận sau cùng được dùng để phân định.
- Cho phép lưu KM thấp hơn odometer hiện tại để không làm mất dữ liệu nhập offline, nhưng phải cảnh báo người dùng trước khi xác nhận.
- Khi reminder có cả chu kỳ KM và thời gian, reminder được xem là quá hạn nếu **một trong hai** điều kiện đã quá hạn. Tiến độ KM và thời gian được tính, hiển thị riêng.
- Ngưỡng "sắp đến hạn" mặc định là khi còn không quá 10% chu kỳ KM hoặc thời gian. Đây là cấu hình cấp hệ thống, không phải cấu hình riêng của từng reminder trong MVP.
- Reminder chưa có `ServiceLog` phải có mốc ban đầu do người dùng nhập. Mốc gồm KM ban đầu nếu reminder theo KM và ngày bắt đầu nếu reminder theo thời gian.
- Trạng thái reminder gồm `insufficient_data`, `not_due`, `due_soon` và `overdue`, tương ứng với "Thiếu dữ liệu", "Bình thường", "Sắp đến hạn" và "Quá hạn".
- MVP chỉ có một loại `ServiceLog` có tác dụng reset reminder: hoàn tất thay hoặc bảo dưỡng phụ tùng. Ghi chú là tùy chọn.
- Timestamp được lưu theo UTC. Reminder theo ngày được tính theo timezone của Account.

### 6.2. Vehicle và fuel log

- Thông tin xe trong MVP gồm tên xe và biển số; biển số có thể để trống.
- `archived` là trạng thái ẩn xe nhưng có thể khôi phục. Xóa là tombstone qua `deleted_at`; không xóa vật lý.
- Một lần đổ xăng không bắt buộc phải nhập KM. Nếu có nhập KM, `FuelLog` và `OdometerLog` liên quan phải được tạo trong cùng local transaction và dùng UUID ổn định khi retry sync.

### 6.3. Danh mục PartType mặc định

Không còn danh mục global dùng chung — mỗi account có bộ `part_types` riêng, được copy từ template dưới đây thành dữ liệu sở hữu bởi chính account đó ngay lúc signup (server, transaction cùng lúc tạo account). Từ đó user sửa tên/tắt-bật/thêm mới tự do, không còn phân biệt "mặc định" (chỉ xem) và "tuỳ chỉnh".

Template seed ban đầu gồm:

| Code | Tên hiển thị |
|---|---|
| `engine_oil` | Dầu nhớt động cơ |
| `front_tire` | Lốp trước |
| `rear_tire` | Lốp sau |
| `front_brake_pad` | Má phanh trước |
| `rear_brake_pad` | Má phanh sau |
| `spark_plug` | Bugi |
| `air_filter` | Lọc gió |
| `drive_belt` | Dây curoa |
| `chain_sprocket_set` | Nhông, sên, đĩa |
| `battery` | Ắc quy |

Lốp và má phanh được tách trước/sau. Dây curoa và nhông, sên, đĩa được tách thành hai loại vì thuộc các hệ truyền động khác nhau.

### 6.4. Đồng bộ và notification

- Push batch và pull page có giới hạn cấu hình phía server; giá trị khởi đầu là tối đa 100 mutation hoặc change mỗi request.
- Auto-sync chạy best-effort khi app vào foreground, có mạng và lần sync gần nhất đã quá 15 phút.
- Trạng thái sync tối thiểu gồm "Đang đồng bộ", "Đã đồng bộ lúc..." và "Chưa đồng bộ". Lỗi nền không hiển thị thông báo gây gián đoạn; lỗi cần hành động phải có thông tin retry phù hợp.
- Email reminder được đánh giá bởi job định kỳ trên server và chỉ dựa trên dữ liệu đã sync.
- Mỗi reminder chỉ được gửi một lần cho mỗi mốc đến hạn. Hệ thống phải lưu idempotency key để chống gửi trùng khi job retry.

---

*Tài liệu này là điểm chốt để bắt đầu triển khai từng phần theo checklist ở mục 5. Có thể cập nhật thêm khi phát sinh quyết định mới trong quá trình build.*

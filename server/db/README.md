# Database migration và sqlc guideline

Tài liệu này mô tả quy trình thay đổi schema/query PostgreSQL và cập nhật code Go trong project.

**Cập nhật: 2026-10-19.** Contract, schema nghiệp vụ, transaction invariants và runbook
vận hành có thẩm quyền tại [decision.md](../../.docs/decision.md), đặc biệt mục 3, 6, 8.
Baseline `1790121600_baseline` chỉ cho DB sạch; không tự upgrade DB đã áp dụng lịch sử
hoặc cùng version schema cũ. Không tự reset dữ liệu; xem cảnh báo không tương thích và
reset dev thủ công ở mục 8. Production dùng migration mới có kế hoạch backup/rollback.

## Các thư mục liên quan

- `server/db/migrations/`: lịch sử schema, mỗi migration có cặp `.up.sql`/`.down.sql`.
- `server/db/queries/`: câu SQL có annotation sqlc (`-- name: ...`).
- `server/sqlc.yaml`: cấu hình sqlc; schema input hiện lấy từ `db/migrations`.
- `server/internal/adapters/postgres/sqlcgen/`: code sinh tự động; không sửa tay.
- `server/internal/adapters/postgres/`: adapter thủ công dùng generated queries, map domain và điều phối transaction.

## Thay đổi schema / thêm nghiệp vụ dùng DB

1. Tạo migration mới từ thư mục repository root:

   ```bash
   make migrate-create name=add_service_notes
   ```

   Lệnh tạo hai file timestamp-prefixed trong `server/db/migrations/`, ví dụ
   `1791000000_add_service_notes.up.sql` và `.down.sql`. Nếu nhiều người tạo migration
   cùng lúc trên các branch, kiểm tra timestamp và giải quyết tên/trình tự trước khi merge.

2. Viết SQL trong `.up.sql` để tạo/đổi schema. Viết `.down.sql` tương ứng để hoàn tác
   thay đổi khi có thể. Với thay đổi dữ liệu/destructive, xác định rõ cách rollback và
   backup; không sửa migration đã được áp dụng ở môi trường dùng chung. Baseline là
   schema nền tảng, không phải nơi thêm thay đổi mới.

3. Nếu nghiệp vụ cần query, thêm query có tên và cardinality rõ ràng vào file phù hợp
   trong `server/db/queries/` (hoặc tạo file mới). Ví dụ:

   ```sql
   -- name: GetServiceLogNote :one
   SELECT id, vehicle_id, note
   FROM service_logs
   WHERE account_id = $1 AND id = $2;
   ```

   Dùng `:one`, `:many`, `:exec`, `:execrows` hoặc `:execresult` đúng theo kết quả mong
   muốn. Truyền giá trị bằng placeholder `$1`, `$2`, ...; không nối chuỗi từ input vào SQL.
   Tên query sẽ trở thành tên method trong code sinh.

4. Generate code từ `server/`:

   ```bash
   cd server
   sqlc generate
   ```

   Lệnh này yêu cầu `sqlc` CLI đã được cài và có trong `PATH`; cấu hình được đọc từ
   `server/sqlc.yaml`. Nếu chưa cài, cài sqlc theo hướng dẫn chính thức cho hệ điều hành
   của bạn rồi kiểm tra bằng `sqlc version`. Không chạy `go generate` — project hiện
   không khai báo directive đó.

5. Tích hợp code sinh vào adapter: khởi tạo/call method trong `sqlcgen.Queries` từ code
   `internal/adapters/postgres/`, map kiểu dữ liệu sang domain, và xử lý `sql.ErrNoRows`
   cùng transaction/error theo convention hiện hữu. sqlc chỉ sinh typed query; nó không
   tự tạo endpoint, application service, validation, authorization hay transaction flow.

6. Kiểm tra kết quả:

   ```bash
   make dev-infra
   make migrate-up
   make test-be
   make test-integration
   make lint-be
   make build-be
   ```

   `make test-integration` cần Docker. Xem lại diff trong `sqlcgen/`; commit cả query,
   migration up/down, code adapter và generated code liên quan.

## Khi chỉ đổi query

Sửa/thêm file trong `server/db/queries/`, chạy `cd server && sqlc generate`, rồi cập
nhật nơi gọi query trong adapter và chạy test/lint/build backend. Không cần tạo migration
nếu schema không thay đổi.

## Khi đổi schema

Luôn tạo migration mới trước (không chỉnh migration cũ đã dùng), cập nhật query nếu cần,
rồi chạy sqlc generate. Với thay đổi tương thích ngược hoặc triển khai nhiều phiên bản,
ưu tiên quy trình expand/contract: thêm cấu trúc mới, deploy code tương thích, migrate dữ
liệu nếu cần, rồi mới xóa cấu trúc cũ trong migration riêng.

Migration mới chỉ được áp dụng khi chạy `make migrate-up` (hoặc `AUTO_MIGRATE=true` ở
local). Generate sqlc không chạy migration và migrate không generate Go code.

Production nên giữ AUTO_MIGRATE=false và migrate ở bước deploy riêng. Account sequence,
entity, canonical changefeed và processed-mutation ACK phải commit trong cùng một
transaction, lock account trước dedupe/stateful validation. Không xóa feed/dedupe tùy
tuổi khi chưa có retention/retry horizon. Contract TS mới tăng type safety, không yêu
cầu đổi wire hoặc migration. Lệnh test ở trên là hướng dẫn chạy, không bằng chứng đã
nghiệm thu working tree; xem tình trạng kiểm chứng ở mục 9 của decision.md.

# Dexie

- `id` (đầu chuỗi): primary key
- `++id`: auto-increment primary key
- `name` (sau dấu phẩy): secondary index
- `&email`: unique index
- `*tags`: multi entry index
- `[vehicle+createdAt]`: compound index

---

- add(object): INSERT, lỗi nếu PK đã tồn tại
- put(object): Upsert theo Primary Key
- get(id): SELECT WHERE PK
- update(id, changes): UPDATE theo PK
- delete(id): DELETE theo PK
- bulkAdd(items): Batch INSERT
- bulkPut(items): Batch UPSERT
- toArray(): Materialize query result
- count(): COUNT
- transaction('rw', ...): Read-write transaction

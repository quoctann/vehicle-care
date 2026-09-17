// Polyfill IndexedDB cho vitest (chạy trong Node, không có trình duyệt thật) —
// cần để test `src/data/**` (Dexie) mà không phải mock thủ công từng bảng.
import 'fake-indexeddb/auto'

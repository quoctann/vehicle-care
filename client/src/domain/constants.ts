/**
 * Hằng số cấp hệ thống — theo D-04 (implementation-plan-section-5.md), ngưỡng
 * "sắp đến hạn" KHÔNG phải cấu hình theo từng reminder, mà cố định toàn hệ thống.
 */
export const DUE_SOON_REMAINING_RATIO = 0.9

/** Giới hạn push batch / pull page mặc định phía server — D-08. Dùng để test/mock. */
export const DEFAULT_SYNC_PAGE_SIZE = 100

/** Auto-sync best-effort khi foreground + online + quá khoảng này kể từ lần sync gần nhất — D-09. */
export const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000

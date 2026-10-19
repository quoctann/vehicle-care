/** Tỷ lệ chu kỳ ĐÃ DÙNG mặc định (90%); Vehicle.dueSoonRatio có thể ghi đè. */
export const DUE_SOON_REMAINING_RATIO = 0.9;

/** Page size client yêu cầu; server có thể giới hạn thấp hơn qua config. */
export const DEFAULT_SYNC_PAGE_SIZE = 100;

/** Auto-sync best-effort khi foreground + online, tính từ lần sync thành công. */
export const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

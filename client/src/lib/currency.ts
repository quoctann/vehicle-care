const VND_FORMATTER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function formatVnd(amountVnd: number): string {
  return `${VND_FORMATTER.format(amountVnd)}₫`;
}

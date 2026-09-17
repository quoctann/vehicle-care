/** Placeholder tạm cho các trang chưa triển khai ở giai đoạn hiện tại (M4-M8 của plan). */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Đang triển khai…</p>
      </div>
    </div>
  )
}

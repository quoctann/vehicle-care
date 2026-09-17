import type { ReactNode } from 'react'

/**
 * Layout dùng chung mọi màn auth (không có trong design.html — tự thiết kế theo
 * cùng ngôn ngữ thị giác: card trắng bo góc, border nhẹ, font Archivo).
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-b from-[#2C2C2C] to-[#141414] text-[13px] font-bold tracking-tight text-white">
            VC
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Nhắc bảo dưỡng xe</span>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-card p-6 shadow-[0_1px_1px_rgba(44,54,53,.025)]">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>

        {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  )
}

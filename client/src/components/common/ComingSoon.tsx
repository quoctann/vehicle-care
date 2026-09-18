/** Placeholder tạm cho các trang chưa triển khai ở giai đoạn hiện tại (M4-M8 của plan). */
import { useTranslation } from 'react-i18next'

export function ComingSoon({ title }: { title: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">{t('common.comingSoon')}</p>
      </div>
    </div>
  )
}

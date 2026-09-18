import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from 'react-i18next'
import type { LogEntryType } from './EntryTypeSelector'

type LogEntryDetailsCardProps = {
  entryType: LogEntryType
  occurredAt: string
  liters: string
  costVnd: string
  shop: string
  note: string
  errors: Record<string, string | undefined>
  onOccurredAtChange: (value: string) => void
  onLitersChange: (value: string) => void
  onCostVndChange: (value: string) => void
  onShopChange: (value: string) => void
  onNoteChange: (value: string) => void
}

export function LogEntryDetailsCard({
  entryType,
  occurredAt,
  liters,
  costVnd,
  shop,
  note,
  errors,
  onOccurredAtChange,
  onLitersChange,
  onCostVndChange,
  onShopChange,
  onNoteChange,
}: LogEntryDetailsCardProps) {
  const { t } = useTranslation()
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-[0_1px_1px_rgba(44,54,53,0.025)]">
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={t('logEntry.dateTime')} htmlFor="log-time" error={errors.occurredAt} className="sm:col-span-2">
          <Input
            id="log-time"
            type="datetime-local"
            required
            aria-invalid={Boolean(errors.occurredAt)}
            value={occurredAt}
            onChange={(event) => onOccurredAtChange(event.target.value)}
            className="h-10"
          />
        </Field>

        {entryType === 'fuel' ? (
          <Field label={t('logEntry.liters')} htmlFor="log-liters" error={errors.liters}>
            <Input
              id="log-liters"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder={t('common.optional')}
              aria-invalid={Boolean(errors.liters)}
              value={liters}
              onChange={(event) => onLitersChange(event.target.value)}
              className="h-10"
            />
          </Field>
        ) : null}

        <Field label={t('logEntry.cost')} htmlFor="log-cost" error={errors.costVnd} className={entryType === 'service' ? 'sm:col-span-2' : undefined}>
          <Input
            id="log-cost"
            type="number"
            min="0"
            step="1000"
            inputMode="numeric"
            placeholder={t('common.optional')}
            aria-invalid={Boolean(errors.costVnd)}
            value={costVnd}
            onChange={(event) => onCostVndChange(event.target.value)}
            className="h-10"
          />
        </Field>

        {entryType === 'fuel' ? (
          <Field label={t('logEntry.shop')} htmlFor="log-shop" className="sm:col-span-2">
            <Input
              id="log-shop"
              placeholder={t('common.optional')}
              value={shop}
              onChange={(event) => onShopChange(event.target.value)}
              className="h-10"
            />
          </Field>
        ) : null}

        <Field label={t('logEntry.note')} htmlFor="log-note" className="sm:col-span-2">
          <Textarea
            id="log-note"
            placeholder={t('common.optional')}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className="min-h-20 resize-none"
          />
        </Field>
      </div>
    </section>
  )
}

function Field({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

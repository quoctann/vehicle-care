import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { createPartType, updatePartTypeName } from '@/data/repositories/partTypeRepository'
import type { PartType } from '@/domain/types'

type PartTypeFormSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  /** null = tạo mới; có giá trị = sửa tên hạng mục đã có. */
  editingPartType?: PartType | null
}

export function PartTypeFormSheet({ open, onOpenChange, accountId, editingPartType = null }: PartTypeFormSheetProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(editingPartType?.displayName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEditing = editingPartType != null

  async function save() {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 200) {
      setError(t('partType.invalidName'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editingPartType) await updatePartTypeName(accountId, editingPartType.id, trimmed)
      else await createPartType(accountId, trimmed)
      onOpenChange(false)
      toast.success(isEditing ? t('partType.updated') : t('partType.created'))
    } catch {
      setError(t('partType.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[24px] border-x-0 border-b-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:inset-x-0 md:mx-auto md:max-w-[600px] lg:inset-auto lg:left-1/2 lg:top-1/2 lg:w-[440px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px] lg:border lg:p-[18px] lg:shadow-lg"
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-border lg:hidden" />
        <SheetTitle className="mx-0.5 text-[15px] font-semibold tracking-[-0.01em]">
          {isEditing ? t('partType.editTitle') : t('partType.addTitle')}
        </SheetTitle>
        <SheetDescription className="mx-0.5 mt-0.5 text-xs leading-5">{t('partType.formDescription')}</SheetDescription>

        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="part-type-name">{t('partType.nameLabel')}</Label>
          <Input id="part-type-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoFocus />
        </div>

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-display text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </SheetContent>
    </Sheet>
  )
}

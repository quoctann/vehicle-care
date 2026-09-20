import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Plus, Power, PowerOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PartTypeFormSheet } from '@/components/sheets/PartTypeFormSheet'
import { db } from '@/data/db'
import { setPartTypeActive } from '@/data/repositories/partTypeRepository'
import type { PartType } from '@/domain/types'
import { useSessionStore } from '@/stores/useSessionStore'

export function PartTypesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const accountId = useSessionStore((state) => state.account?.id)
  const allPartTypes = useLiveQuery(() => db.partTypes.toArray(), [], [])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingPartType, setEditingPartType] = useState<PartType | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const globalPartTypes = allPartTypes.filter((p) => p.accountId == null).sort((a, b) => a.displayOrder - b.displayOrder)
  const customPartTypes = allPartTypes
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => (a.createdAtClient < b.createdAtClient ? -1 : 1))

  function openCreate() {
    setEditingPartType(null)
    setSheetOpen(true)
  }

  function openEdit(partType: PartType) {
    setEditingPartType(partType)
    setSheetOpen(true)
  }

  async function toggleActive(partType: PartType) {
    if (!accountId) return
    setBusyId(partType.id)
    try {
      await setPartTypeActive(accountId, partType.id, !partType.active)
    } catch {
      toast.error(t('partType.saveFailed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-24 sm:px-6 lg:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label={t('common.back')} onClick={() => navigate('/settings')}>
            <ArrowLeft />
          </Button>
          <div>
            <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">{t('partType.eyebrow')}</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-[-0.03em]">{t('partType.title')}</h1>
          </div>
        </header>

        <section className="mb-5">
          <div className="mb-2 flex items-center justify-between px-0.5">
            <h2 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{t('partType.custom')}</h2>
            <Button variant="ghost" size="xs" onClick={openCreate}>
              <Plus /> {t('partType.add')}
            </Button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
            {customPartTypes.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('partType.emptyCustom')}</p>
            ) : (
              customPartTypes.map((partType, index) => (
                <div
                  key={partType.id}
                  className={`flex items-center gap-3 p-4 ${index > 0 ? 'border-t border-border-subtle' : ''}`}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openEdit(partType)}>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{partType.displayName}</span>
                      {!partType.active ? (
                        <Badge variant="outline" className="h-5 text-muted-foreground">
                          {t('partType.disabled')}
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === partType.id}
                    onClick={() => void toggleActive(partType)}
                    className={partType.active ? 'text-destructive hover:text-destructive' : ''}
                  >
                    {partType.active ? (
                      <>
                        <PowerOff /> {t('partType.disable')}
                      </>
                    ) : (
                      <>
                        <Power /> {t('partType.enable')}
                      </>
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t('partType.default')}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
            {globalPartTypes.map((partType, index) => (
              <div key={partType.id} className={`p-4 ${index > 0 ? 'border-t border-border-subtle' : ''}`}>
                <span className="text-sm font-medium text-muted-foreground">{partType.displayName}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {accountId ? (
        <PartTypeFormSheet
          key={editingPartType?.id ?? 'new'}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          accountId={accountId}
          editingPartType={editingPartType}
        />
      ) : null}
    </main>
  )
}

import { useState } from "react";
import { Fuel, History, Pencil, SlidersHorizontal, Trash2, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmActionDialog } from "@/components/settings/ConfirmActionDialog";
import type { HistoryEntry } from "@/data/queries/historyQueries";
import { formatDate, formatMonth, formatNumber } from "@/lib/formatters";
import { formatVnd } from "@/lib/currency";

type EntryFilter = "all" | HistoryEntry["kind"];

export function HistoryTimeline({
  entries,
  timezone,
  onEdit,
  onDelete,
}: {
  entries: HistoryEntry[];
  timezone: string;
  onEdit: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<HistoryEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filters: Array<{ value: EntryFilter; label: string }> = [
    { value: "all", label: t('history.all') },
    { value: "service", label: t('history.service') },
    { value: "fuel", label: t('history.fuel') },
  ];
  const [filter, setFilter] = useState<EntryFilter>("all");

  async function confirmDelete() {
    if (!pending) return;
    setBusyId(pending.id);
    try {
      await onDelete(pending);
      setPending(null);
    } catch {
      // Keep the confirmation open so the user can retry after the page reports the error.
    } finally {
      setBusyId(null);
    }
  }
  const visibleEntries =
    filter === "all"
      ? entries
      : entries.filter((entry) => entry.kind === filter);
  const groups = visibleEntries.reduce<
    Array<{ label: string; entries: HistoryEntry[] }>
  >((result, entry) => {
    const label = formatMonth(entry.occurredAt, "long", timezone);
    const lastGroup = result.at(-1);
    if (lastGroup?.label === label) lastGroup.entries.push(entry);
    else result.push({ label, entries: [entry] });
    return result;
  }, []);

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('history.entryCount', { count: entries.length })}
        </p>
        <div
          className="flex items-center gap-1 rounded-xl border border-border-subtle bg-card p-1 shadow-sm"
          aria-label={t('history.filter')}
        >
          <SlidersHorizontal
            className="mx-1 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {filters.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                filter === option.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <History className="size-5" aria-hidden="true" />
          </div>
          <p className="font-semibold">
            {t(filter === 'all' ? 'history.emptyAll' : filter === 'service' ? 'history.emptyService' : 'history.emptyFuel')}
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {t('history.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.label}
              aria-labelledby={`history-${group.label.replaceAll(" ", "-").toLowerCase()}`}
            >
              <h2
                id={`history-${group.label.replaceAll(" ", "-").toLowerCase()}`}
                className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
              >
                {group.label}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
                {group.entries.map((entry, index) => {
                  const Icon = entry.kind === "fuel" ? Fuel : Wrench;
                  return (
                    <article
                      key={`${entry.kind}-${entry.id}`}
                      className={`flex gap-3 px-4 py-3.5 ${index > 0 ? "border-t border-border-subtle" : ""}`}
                    >
                      <div
                        className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${
                          entry.kind === "fuel"
                            ? "bg-primary/10 text-primary"
                            : "bg-warn-bg text-warn-fg"
                        }`}
                      >
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold">
                              {entry.kind === 'fuel'
                                ? entry.liters == null
                                  ? t('history.fuel')
                                  : t('history.fuelWithLiters', { value: formatNumber(entry.liters) })
                                : entry.title || t('history.unknownService')}
                            </h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDate(entry.occurredAt, timezone)}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {entry.costVnd == null ? t('history.noCost') : formatVnd(entry.costVnd)}
                          </span>
                        </div>
                        {entry.note && (
                          <p className="mt-2 text-sm leading-5 text-muted-foreground">
                            {entry.note}
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label={t('history.editLabel')}
                            disabled={busyId === entry.id}
                            onClick={() => onEdit(entry)}
                            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={t('history.deleteLabel')}
                            disabled={busyId === entry.id}
                            onClick={() => setPending(entry)}
                            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <ConfirmActionDialog
        open={pending != null}
        title={t('history.deleteTitle')}
        description={t('history.deleteDescription')}
        confirmLabel={t('history.deleteLabel')}
        destructive
        busy={pending != null && busyId === pending.id}
        onOpenChange={(open) => !open && setPending(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

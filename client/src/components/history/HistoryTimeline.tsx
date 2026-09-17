import { useState } from "react";
import { Fuel, History, SlidersHorizontal, Wrench } from "lucide-react";
import type { HistoryEntry } from "@/data/queries/historyQueries";

type EntryFilter = "all" | HistoryEntry["kind"];

const FILTERS: Array<{ value: EntryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "service", label: "Service" },
  { value: "fuel", label: "Fuel" },
];

function formatCost(costVnd: number | null): string {
  if (costVnd == null) return "No cost";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(costVnd);
}

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}

function monthLabel(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}

export function HistoryTimeline({
  entries,
  timezone,
}: {
  entries: HistoryEntry[];
  timezone: string;
}) {
  const [filter, setFilter] = useState<EntryFilter>("all");
  const visibleEntries =
    filter === "all"
      ? entries
      : entries.filter((entry) => entry.kind === filter);
  const groups = visibleEntries.reduce<
    Array<{ label: string; entries: HistoryEntry[] }>
  >((result, entry) => {
    const label = monthLabel(entry.occurredAt, timezone);
    const lastGroup = result.at(-1);
    if (lastGroup?.label === label) lastGroup.entries.push(entry);
    else result.push({ label, entries: [entry] });
    return result;
  }, []);

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {entries.length} {entries.length === 1 ? "entry" : "entries"} recorded
        </p>
        <div
          className="flex items-center gap-1 rounded-xl border border-border-subtle bg-card p-1 shadow-sm"
          aria-label="Filter history"
        >
          <SlidersHorizontal
            className="mx-1 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {FILTERS.map((option) => (
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
            No {filter === "all" ? "" : `${filter} `}entries yet
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            New fuel and service logs will appear here automatically.
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
                              {entry.title}
                            </h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDate(entry.occurredAt, timezone)}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatCost(entry.costVnd)}
                          </span>
                        </div>
                        {entry.note && (
                          <p className="mt-2 text-sm leading-5 text-muted-foreground">
                            {entry.note}
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

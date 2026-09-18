import { BarChart3, Fuel, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MonthlyCost } from "@/data/queries/costQueries";
import { formatVnd } from "@/lib/currency";
import { formatMonth } from "@/lib/formatters";

export function CostOverview({
  monthlyCosts,
  currentMonth,
  costPerKm,
  units,
}: {
  monthlyCosts: MonthlyCost[];
  currentMonth: string;
  costPerKm: number | null;
  units: "km" | "mi";
}) {
  const { t } = useTranslation();
  const current = monthlyCosts.find((item) => item.month === currentMonth) ?? {
    month: currentMonth,
    fuelVnd: 0,
    serviceVnd: 0,
    totalVnd: 0,
  };
  const bars = monthlyCosts.slice(-6);
  const maxTotal = Math.max(...bars.map((item) => item.totalVnd), 1);
  const fuelShare =
    current.totalVnd > 0 ? (current.fuelVnd / current.totalVnd) * 100 : 0;
  const serviceShare =
    current.totalVnd > 0 ? (current.serviceVnd / current.totalVnd) * 100 : 0;
  const unitCost =
    costPerKm == null
      ? null
      : units === "mi"
        ? costPerKm * 1.609344
        : costPerKm;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border-subtle bg-card p-5 shadow-sm">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t('costs.monthSoFar', { month: formatMonth(currentMonth, "long") })}
        </p>
        <p className="mt-1.5 text-3xl font-bold tracking-[-0.04em] tabular-nums">
          {formatVnd(current.totalVnd)}
        </p>

        <div
          className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-muted"
          aria-label={t('costs.breakdown')}
        >
          {fuelShare > 0 && (
            <div className="bg-foreground" style={{ width: `${fuelShare}%` }} />
          )}
          {serviceShare > 0 && (
            <div
              className="bg-muted-foreground/45"
              style={{ width: `${serviceShare}%` }}
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-sm bg-foreground" />
            {t('costs.fuel')} {formatVnd(current.fuelVnd)}
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-sm bg-muted-foreground/45" />
            {t('costs.service')} {formatVnd(current.serviceVnd)}
          </span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t('costs.costPerUnit', { unit: units })}
          </p>
          <p className="mt-1.5 text-xl font-bold tracking-tight tabular-nums">
            {unitCost == null
              ? t('costs.notEnoughData')
              : formatVnd(Math.round(unitCost))}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('costs.lastThreeMonths')}</p>
        </div>
        <div className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t('costs.yearToDate')}
          </p>
          <p className="mt-1.5 text-xl font-bold tracking-tight tabular-nums">
            {formatVnd(
              monthlyCosts
                .filter((item) =>
                  item.month.startsWith(currentMonth.slice(0, 4)),
                )
                .reduce((sum, item) => sum + item.totalVnd, 0),
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('costs.fuelAndService')}
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t('costs.byMonth')}
        </h2>
        {bars.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 text-center">
            <BarChart3
              className="mb-3 size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="font-semibold">{t('costs.empty')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('costs.emptyDescription')}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border-subtle bg-card px-4 pt-5 pb-4 shadow-sm">
            <div className="flex h-36 items-end gap-2 sm:gap-4">
              {bars.map((item) => {
                const height = Math.max(8, (item.totalVnd / maxTotal) * 112);
                const fuelHeight =
                  item.totalVnd > 0
                    ? (item.fuelVnd / item.totalVnd) * height
                    : 0;
                const serviceHeight = Math.max(0, height - fuelHeight);
                return (
                  <div
                    key={item.month}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                  >
                    <div
                      className="group relative flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-t-md bg-muted"
                      style={{ height }}
                      title={t('costs.chartValue', { month: formatMonth(item.month, "long"), amount: formatVnd(item.totalVnd) })}
                    >
                      {fuelHeight > 0 && (
                        <div
                          className="w-full bg-foreground"
                          style={{ height: fuelHeight }}
                        />
                      )}
                      {serviceHeight > 0 && (
                        <div
                          className="w-full bg-muted-foreground/45"
                          style={{ height: serviceHeight }}
                        />
                      )}
                    </div>
                    <span className="truncate text-[10px] font-medium text-muted-foreground">
                      {formatMonth(item.month, "short")}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-center gap-5 border-t border-border-subtle pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Fuel className="size-3.5" /> {t('costs.fuel')}
              </span>
              <span className="flex items-center gap-1.5">
                <Wrench className="size-3.5" /> {t('costs.service')}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

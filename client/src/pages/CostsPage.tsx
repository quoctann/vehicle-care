import { useParams } from "react-router-dom";
import { CostOverview } from "@/components/costs/CostOverview";
import { readUnitsPreference } from "@/components/settings/preferences";
import { useCostPerKm, useMonthlyCosts } from "@/hooks/useCosts";
import { useSessionStore } from "@/stores/useSessionStore";
import { useTranslation } from "react-i18next";

function currentMonthInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date());
  const year =
    parts.find((part) => part.type === "year")?.value ??
    new Date().getUTCFullYear().toString();
  const month =
    parts.find((part) => part.type === "month")?.value ??
    String(new Date().getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function CostsPage() {
  const { t } = useTranslation();
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const account = useSessionStore((state) => state.account);
  const timezone = account?.timezone ?? "UTC";
  const monthlyCosts = useMonthlyCosts(account?.id, vehicleId, timezone);
  const costPerKm = useCostPerKm(account?.id, vehicleId);
  const units = readUnitsPreference();

  return (
    // min-h-0 + overflow-y-auto: AppShell's <main> là overflow-hidden nên page phải
    // tự cuộn nội dung của mình, thiếu 2 class này thì nội dung dài sẽ bị cắt cụt.
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-24 sm:px-6 lg:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4">
          <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
            {t('costs.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em]">{t('costs.title')}</h1>
        </header>
        <CostOverview
          monthlyCosts={monthlyCosts}
          currentMonth={currentMonthInTimezone(timezone)}
          costPerKm={costPerKm}
          units={units}
        />
      </div>
    </main>
  );
}

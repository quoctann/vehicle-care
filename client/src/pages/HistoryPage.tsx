import { useParams } from "react-router-dom";
import { HistoryTimeline } from "@/components/history/HistoryTimeline";
import { useHistoryEntries } from "@/hooks/useHistory";
import { useSessionStore } from "@/stores/useSessionStore";
import { useTranslation } from "react-i18next";

export function HistoryPage() {
  const { t } = useTranslation();
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const account = useSessionStore((state) => state.account);
  const timezone = account?.timezone ?? "UTC";
  const entries = useHistoryEntries(account?.id, vehicleId);

  return (
    // min-h-0 + overflow-y-auto: AppShell's <main> là overflow-hidden nên page phải
    // tự cuộn nội dung của mình, thiếu 2 class này thì nội dung dài sẽ bị cắt cụt.
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-24 sm:px-6 lg:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4">
          <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
            {t('history.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em]">
            {t('history.title')}
          </h1>
        </header>
        <HistoryTimeline entries={entries} timezone={timezone} />
      </div>
    </main>
  );
}

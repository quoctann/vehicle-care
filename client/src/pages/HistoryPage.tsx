import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { HistoryTimeline } from "@/components/history/HistoryTimeline";
import type { HistoryEntry } from "@/data/queries/historyQueries";
import { deleteFuelLog, deleteServiceLog } from "@/data/repositories";
import { useHistoryEntries } from "@/hooks/useHistory";
import { useSessionStore } from "@/stores/useSessionStore";
import { useTranslation } from "react-i18next";

export function HistoryPage() {
  const { t } = useTranslation();
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const account = useSessionStore((state) => state.account);
  const timezone = account?.timezone ?? "UTC";
  const entries = useHistoryEntries(account?.id, vehicleId);

  function handleEdit(entry: HistoryEntry) {
    navigate(`/v/${vehicleId}/log-entry/${entry.kind}/${entry.id}`);
  }

  async function handleDelete(entry: HistoryEntry) {
    if (!account) return;
    try {
      if (entry.kind === "fuel") await deleteFuelLog(account.id, entry.id);
      else await deleteServiceLog(account.id, entry.id);
      toast.success(t('history.deletedToast'));
    } catch (error) {
      toast.error(t('history.deleteFailed'));
      throw error;
    }
  }

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
        <HistoryTimeline entries={entries} timezone={timezone} onEdit={handleEdit} onDelete={handleDelete} />
      </div>
    </main>
  );
}

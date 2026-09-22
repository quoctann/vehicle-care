import { useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ReminderEditor } from "@/components/settings/ReminderEditor";
import { ReminderManagement } from "@/components/settings/ReminderManagement";
import { deleteReminderConfig, updateReminderConfig } from "@/data/repositories";
import { useCurrentOdometer, useReminderStatuses } from "@/hooks/useReminders";
import { usePartTypes } from "@/hooks/usePartTypes";
import { useVehicle } from "@/hooks/useVehicles";
import { useSessionStore } from "@/stores/useSessionStore";

export function RemindersPage() {
  const { t } = useTranslation();
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const account = useSessionStore((state) => state.account);
  const timezone = account?.timezone ?? "UTC";
  const { vehicle } = useVehicle(account?.id, vehicleId);
  const reminders = useReminderStatuses(account?.id, vehicleId, timezone, {
    includeDisabled: true,
  });
  const currentOdometerKm = useCurrentOdometer(account?.id, vehicleId);
  const partTypes = usePartTypes(account?.id);
  const [editorOpen, setEditorOpen] = useState(false);

  if (!account || !vehicleId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t('vehicle.chooseDashboard')}
      </div>
    );
  }

  return (
    // min-h-0 + overflow-y-auto: AppShell's <main> là overflow-hidden nên page phải
    // tự cuộn nội dung của mình, thiếu 2 class này thì nội dung dài sẽ bị cắt cụt.
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-24 sm:px-6 lg:pb-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4">
          <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
            {t('reminder.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em]">
            {t('reminder.pageTitle')}
          </h1>
        </header>
        <ReminderManagement
          vehicleName={vehicle?.name ?? ''}
          reminders={reminders}
          onUpdate={(id, intervalKm, intervalDays) =>
            updateReminderConfig(account.id, id, { intervalKm, intervalDays })
          }
          onDelete={(id) => deleteReminderConfig(account.id, id)}
          onToggle={(id, enabled) => updateReminderConfig(account.id, id, { enabled })}
          onAdd={() => setEditorOpen(true)}
        />
      </div>

      {editorOpen ? (
        <ReminderEditor
          key={vehicleId}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          accountId={account.id}
          vehicleId={vehicleId}
          currentOdometerKm={currentOdometerKm}
          partTypes={partTypes}
          configuredPartTypeIds={new Set(reminders.map((reminder) => reminder.config.partTypeId))}
        />
      ) : null}
    </main>
  );
}

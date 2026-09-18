import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AccountCard } from "@/components/settings/AccountCard";
import { AppSettings } from "@/components/settings/AppSettings";
import { GarageList } from "@/components/settings/GarageList";
import { ReminderManagement } from "@/components/settings/ReminderManagement";
import { ReminderEditor } from "@/components/settings/ReminderEditor";
import { Button } from "@/components/ui/button";
import * as api from "@/api/client";
import {
  archiveVehicle,
  deleteReminderConfig,
  deleteVehicle,
  restoreVehicle,
  updateReminderConfig,
} from "@/data/repositories";
import type { Vehicle } from "@/domain/types";
import { useReminderStatuses } from "@/hooks/useReminders";
import { useCurrentOdometer } from "@/hooks/useReminders";
import { usePartTypes } from "@/hooks/usePartTypes";
import { useVehicles } from "@/hooks/useVehicles";
import { getLastVehicleId, setLastVehicleId } from "@/lib/lastVehicle";
import { useSessionStore } from "@/stores/useSessionStore";

export function SettingsPage() {
  const account = useSessionStore((s) => s.account);
  const clear = useSessionStore((s) => s.clear);
  const navigate = useNavigate();
  const vehicleQuery = useVehicles(account?.id, { includeArchived: true });
  const vehicles = vehicleQuery ?? [];
  const [preferredVehicleId, setPreferredVehicleId] = useState(() =>
    account ? getLastVehicleId(account.id) : null,
  );
  const [signingOut, setSigningOut] = useState(false);
  const [reminderEditorOpen, setReminderEditorOpen] = useState(false);
  const activeVehicles = vehicles.filter(
    (vehicle) => vehicle.archivedAt == null,
  );
  const activeVehicleId = activeVehicles.some(
    (vehicle) => vehicle.id === preferredVehicleId,
  )
    ? preferredVehicleId
    : (activeVehicles[0]?.id ?? null);
  const activeVehicle =
    activeVehicles.find((vehicle) => vehicle.id === activeVehicleId) ?? null;
  const reminders = useReminderStatuses(
    account?.id,
    activeVehicle?.id,
    account?.timezone ?? "UTC",
    { includeDisabled: true },
  );
  const currentOdometerKm = useCurrentOdometer(account?.id, activeVehicle?.id);
  const partTypes = usePartTypes();

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await api.logout();
    } catch {
      // Clear the local session even when the remote session is already unavailable.
    } finally {
      clear();
      navigate("/sign-in", { replace: true });
    }
  }

  function selectVehicle(id: string) {
    if (!account) return;
    setLastVehicleId(account.id, id);
    setPreferredVehicleId(id);
  }

  async function handleArchive(vehicle: Vehicle) {
    try {
      if (!account) return;
      await archiveVehicle(account.id, vehicle.id);
      if (vehicle.id === activeVehicleId) {
        const replacement = activeVehicles.find(
          (candidate) => candidate.id !== vehicle.id,
        );
        if (replacement) selectVehicle(replacement.id);
        else navigate("/onboarding/add-vehicle", { replace: true });
      }
      toast.success(`${vehicle.name} archived`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive vehicle.",
      );
      throw error;
    }
  }

  async function handleRestore(vehicle: Vehicle) {
    try {
      if (!account) return;
      await restoreVehicle(account.id, vehicle.id);
      if (!activeVehicleId) selectVehicle(vehicle.id);
      toast.success(`${vehicle.name} restored`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not restore vehicle.",
      );
      throw error;
    }
  }

  async function handleDelete(vehicle: Vehicle) {
    try {
      if (!account) return;
      await deleteVehicle(account.id, vehicle.id);
      if (vehicle.id === activeVehicleId) {
        const replacement = activeVehicles.find(
          (candidate) => candidate.id !== vehicle.id,
        );
        if (replacement) selectVehicle(replacement.id);
        else navigate("/onboarding/add-vehicle", { replace: true });
      }
      toast.success(`${vehicle.name} deleted`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete vehicle.",
      );
      throw error;
    }
  }

  if (!account) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Button variant="outline" onClick={() => navigate("/sign-in")}>
          Return to sign in
        </Button>
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
            Account and app
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em]">
            Settings
          </h1>
        </header>
        <div className="space-y-5">
          <AccountCard
            account={account}
            signingOut={signingOut}
            onSignOut={() => void handleSignOut()}
          />
          <GarageList
            vehicles={vehicles}
            activeVehicleId={activeVehicleId}
            onOpen={(vehicle) => {
              if (vehicle.archivedAt == null) {
                selectVehicle(vehicle.id);
                navigate(`/v/${vehicle.id}/home`);
              }
            }}
            onAdd={() => navigate("/onboarding/add-vehicle")}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
          {activeVehicle && (
            <ReminderManagement
              vehicleName={activeVehicle.name}
              reminders={reminders}
              onUpdate={(id, intervalKm, intervalDays) =>
                updateReminderConfig(account.id, id, { intervalKm, intervalDays })
              }
              onDelete={(id) => deleteReminderConfig(account.id, id)}
              onToggle={(id, enabled) => updateReminderConfig(account.id, id, { enabled })}
              onAdd={() => setReminderEditorOpen(true)}
            />
          )}
          <AppSettings />
        </div>
      </div>
      {activeVehicle && reminderEditorOpen ? (
        <ReminderEditor
          key={activeVehicle.id}
          open={reminderEditorOpen}
          onOpenChange={setReminderEditorOpen}
          accountId={account.id}
          vehicleId={activeVehicle.id}
          currentOdometerKm={currentOdometerKm}
          partTypes={partTypes}
          configuredPartTypeIds={new Set(reminders.map((reminder) => reminder.config.partTypeId))}
        />
      ) : null}
    </main>
  );
}

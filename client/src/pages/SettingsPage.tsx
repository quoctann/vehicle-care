import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AccountCard } from "@/components/settings/AccountCard";
import { AppSettings } from "@/components/settings/AppSettings";
import { GarageList } from "@/components/settings/GarageList";
import { Button } from "@/components/ui/button";
import * as api from "@/api/client";
import {
  archiveVehicle,
  deleteVehicle,
  restoreVehicle,
} from "@/data/repositories";
import type { Vehicle } from "@/domain/types";
import { useVehicles } from "@/hooks/useVehicles";
import { getLastVehicleId, setLastVehicleId } from "@/lib/lastVehicle";
import { useSessionStore } from "@/stores/useSessionStore";

export function SettingsPage() {
  const { t } = useTranslation();
  const account = useSessionStore((s) => s.account);
  const clear = useSessionStore((s) => s.clear);
  const navigate = useNavigate();
  const vehicleQuery = useVehicles(account?.id, { includeArchived: true });
  const vehicles = vehicleQuery ?? [];
  const [preferredVehicleId, setPreferredVehicleId] = useState(() =>
    account ? getLastVehicleId(account.id) : null,
  );
  const [signingOut, setSigningOut] = useState(false);
  const activeVehicles = vehicles.filter(
    (vehicle) => vehicle.archivedAt == null,
  );
  const activeVehicleId = activeVehicles.some(
    (vehicle) => vehicle.id === preferredVehicleId,
  )
    ? preferredVehicleId
    : (activeVehicles[0]?.id ?? null);

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
      toast.success(t('settings.archivedToast', { name: vehicle.name }));
    } catch (error) {
      toast.error(
        t('settings.archiveFailed'),
      );
      throw error;
    }
  }

  async function handleRestore(vehicle: Vehicle) {
    try {
      if (!account) return;
      await restoreVehicle(account.id, vehicle.id);
      if (!activeVehicleId) selectVehicle(vehicle.id);
      toast.success(t('settings.restoredToast', { name: vehicle.name }));
    } catch (error) {
      toast.error(
        t('settings.restoreFailed'),
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
      toast.success(t('settings.deletedToast', { name: vehicle.name }));
    } catch (error) {
      toast.error(
        t('settings.deleteFailed'),
      );
      throw error;
    }
  }

  if (!account) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Button variant="outline" onClick={() => navigate("/sign-in")}>
          {t('settings.returnSignIn')}
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
            {t('settings.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em]">
            {t('settings.title')}
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
            accountId={account.id}
            onOpen={(vehicle) => {
              if (vehicle.archivedAt == null) selectVehicle(vehicle.id);
            }}
            onAdd={() => navigate("/onboarding/add-vehicle")}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
          <AppSettings />
        </div>
      </div>
    </main>
  );
}

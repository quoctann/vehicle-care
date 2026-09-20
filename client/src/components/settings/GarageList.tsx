import { useState } from "react";
import { Archive, Car, Plus, RotateCcw, Settings, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditVehicleSheet } from "@/components/sheets/EditVehicleSheet";
import type { Vehicle } from "@/domain/types";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

type PendingAction = { kind: "archive" | "delete"; vehicle: Vehicle } | null;

export function GarageList({
  vehicles,
  activeVehicleId,
  accountId,
  onOpen,
  onAdd,
  onArchive,
  onRestore,
  onDelete,
}: {
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  accountId: string;
  onOpen: (vehicle: Vehicle) => void;
  onAdd: () => void;
  onArchive: (vehicle: Vehicle) => Promise<void>;
  onRestore: (vehicle: Vehicle) => Promise<void>;
  onDelete: (vehicle: Vehicle) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAction>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  async function restore(vehicle: Vehicle) {
    setBusyId(vehicle.id);
    try {
      await onRestore(vehicle);
    } catch {
      // The page-level action reports repository failures and the row stays unchanged.
    } finally {
      setBusyId(null);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusyId(pending.vehicle.id);
    try {
      if (pending.kind === "archive") await onArchive(pending.vehicle);
      else await onDelete(pending.vehicle);
      setPending(null);
    } catch {
      // Keep the confirmation open so the user can retry after the page reports the error.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-0.5">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t('settings.garage')}
        </h2>
        <Button variant="ghost" size="xs" onClick={onAdd}>
          <Plus /> {t('vehicle.add')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
        {vehicles.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <Car className="mb-3 size-6 text-muted-foreground" />
            <p className="text-sm font-semibold">{t('settings.emptyGarage')}</p>
            <Button className="mt-4" size="sm" onClick={onAdd}>
              {t('vehicle.addTitle')}
            </Button>
          </div>
        ) : (
          vehicles.map((vehicle, index) => {
            const archived = vehicle.archivedAt != null;
            const isActive = vehicle.id === activeVehicleId && !archived;
            return (
              <div
                key={vehicle.id}
                className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${index > 0 ? "border-t border-border-subtle" : ""}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => onOpen(vehicle)}
                  disabled={archived}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${archived ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}
                  >
                    <Car className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {vehicle.name}
                      </span>
                      {isActive && (
                        <Badge variant="secondary" className="h-5">
                          {t('common.active')}
                        </Badge>
                      )}
                      {archived && (
                        <Badge
                          variant="outline"
                          className="h-5 text-muted-foreground"
                        >
                          {t('settings.archived')}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {vehicle.plateNumber || t('common.noPlate')}
                    </span>
                  </span>
                </button>
                <div className="flex items-center justify-end gap-1 pl-12 sm:pl-0">
                  {archived ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === vehicle.id}
                      onClick={() => void restore(vehicle)}
                    >
                      <RotateCcw /> {t('settings.restore')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === vehicle.id}
                      onClick={() => setPending({ kind: "archive", vehicle })}
                    >
                      <Archive /> {t('settings.archive')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('vehicle.settingsLabel', { name: vehicle.name })}
                    disabled={busyId === vehicle.id}
                    onClick={() => setEditingVehicle(vehicle)}
                  >
                    <Settings />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={t('settings.deleteVehicleLabel', { name: vehicle.name })}
                    disabled={busyId === vehicle.id}
                    onClick={() => setPending({ kind: "delete", vehicle })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmActionDialog
        open={pending != null}
        title={
          pending?.kind === "delete"
            ? t('settings.deleteVehicleTitle', { name: pending.vehicle.name })
            : t('settings.archiveVehicleTitle', { name: pending?.vehicle.name ?? '' })
        }
        description={
          pending?.kind === "delete"
            ? t('settings.deleteVehicleDescription')
            : t('settings.archiveVehicleDescription')
        }
        confirmLabel={
          pending?.kind === "delete" ? t('settings.deleteVehicle') : t('settings.archiveVehicle')
        }
        destructive={pending?.kind === "delete"}
        busy={pending != null && busyId === pending.vehicle.id}
        onOpenChange={(open) => !open && setPending(null)}
        onConfirm={() => void confirm()}
      />

      <EditVehicleSheet
        key={editingVehicle?.id ?? "none"}
        open={editingVehicle != null}
        onOpenChange={(open) => !open && setEditingVehicle(null)}
        accountId={accountId}
        vehicle={editingVehicle}
      />
    </section>
  );
}

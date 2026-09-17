import { useState } from "react";
import { toast } from "sonner";
import {
  BellRing,
  CalendarDays,
  Gauge,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReminderWithStatus } from "@/data/queries/reminderQueries";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

const STATUS_LABELS = {
  insufficient_data: "Needs data",
  not_due: "On track",
  due_soon: "Due soon",
  overdue: "Overdue",
} as const;

function optionalPositiveNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type ReminderManagementProps = {
  vehicleName: string;
  reminders: ReminderWithStatus[];
  onUpdate: (
    id: string,
    intervalKm: number | null,
    intervalDays: number | null,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onAdd?: () => void;
};

export function ReminderManagement({
  vehicleName,
  reminders,
  onUpdate,
  onDelete,
  onToggle,
  onAdd,
}: ReminderManagementProps) {
  const [editing, setEditing] = useState<ReminderWithStatus | null>(null);
  const [deleting, setDeleting] = useState<ReminderWithStatus | null>(null);
  const [intervalKm, setIntervalKm] = useState("");
  const [intervalDays, setIntervalDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing(reminder: ReminderWithStatus) {
    setEditing(reminder);
    setIntervalKm(reminder.config.intervalKm?.toString() ?? "");
    setIntervalDays(reminder.config.intervalDays?.toString() ?? "");
    setError(null);
  }

  async function save() {
    if (!editing) return;
    const km = optionalPositiveNumber(intervalKm);
    const days = optionalPositiveNumber(intervalDays);
    if (km == null && days == null) {
      setError("Enter a positive distance or day interval.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onUpdate(editing.config.id, km, days);
      setEditing(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update reminder.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await onDelete(deleting.config.id);
      setDeleting(null);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not delete reminder.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div>
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Vehicle reminders
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{vehicleName}</p>
        </div>
        {onAdd && (
          <Button variant="ghost" size="xs" onClick={onAdd}>
            <Plus /> Add reminder
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
        {reminders.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <BellRing className="mb-3 size-6 text-muted-foreground" />
            <p className="text-sm font-semibold">No active reminders</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Configured maintenance reminders for this vehicle will appear
              here.
            </p>
            {onAdd && (
              <Button className="mt-4" size="sm" onClick={onAdd}>
                Add reminder
              </Button>
            )}
          </div>
        ) : (
          reminders.map((reminder, index) => (
            <div
              key={reminder.config.id}
              className={`flex items-center gap-3 p-4 ${index > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warn-bg text-warn-fg">
                <BellRing className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">
                    {reminder.partType.displayName}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${reminder.result.status === "overdue" ? "bg-destructive/10 text-destructive" : reminder.result.status === "due_soon" ? "bg-warn-bg text-warn-fg" : "bg-muted text-muted-foreground"}`}
                  >
                    {reminder.config.enabled ? STATUS_LABELS[reminder.result.status] : "Paused"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {reminder.config.intervalKm != null && (
                    <span className="flex items-center gap-1">
                      <Gauge className="size-3" /> Every{" "}
                      {reminder.config.intervalKm.toLocaleString()} km
                    </span>
                  )}
                  {reminder.config.intervalDays != null && (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="size-3" /> Every{" "}
                      {reminder.config.intervalDays} days
                    </span>
                  )}
                </div>
              </div>
              <Switch
                checked={reminder.config.enabled}
                aria-label={`${reminder.config.enabled ? "Pause" : "Enable"} ${reminder.partType.displayName} reminder`}
                onCheckedChange={(enabled) => void onToggle(reminder.config.id, enabled)}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${reminder.partType.displayName} reminder`}
                onClick={() => startEditing(reminder)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                aria-label={`Delete ${reminder.partType.displayName} reminder`}
                onClick={() => setDeleting(reminder)}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={editing != null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.partType.displayName}</DialogTitle>
            <DialogDescription>
              Set a distance interval, a time interval, or both. The reminder is
              due when either interval is reached.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reminder-km">Every kilometres</Label>
              <Input
                id="reminder-km"
                inputMode="numeric"
                type="number"
                min="1"
                value={intervalKm}
                onChange={(event) => setIntervalKm(event.target.value)}
                placeholder="e.g. 5000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reminder-days">Every days</Label>
              <Input
                id="reminder-days"
                inputMode="numeric"
                type="number"
                min="1"
                value={intervalDays}
                onChange={(event) => setIntervalDays(event.target.value)}
                placeholder="e.g. 180"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleting != null}
        title={`Delete ${deleting?.partType.displayName ?? ""} reminder?`}
        description="This stops future due calculations for this reminder. Existing service history stays unchanged."
        confirmLabel="Delete reminder"
        destructive
        busy={busy}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createReminderConfig } from '@/data/repositories/reminderRepository';
import type { PartType } from '@/domain/types';
import { toCalendarDateInTimezone } from '@/domain/datetime';
import { useSessionStore } from '@/stores/useSessionStore';
import {
  isValidOdometerKm,
  MAX_INTERVAL_DAYS,
  MAX_ODOMETER_KM,
  parseOptionalNumber,
  validateReminderInterval,
} from '@/domain/validation';

type ReminderEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  vehicleId: string;
  currentOdometerKm: number | null;
  partTypes: PartType[];
  configuredPartTypeIds: Set<string>;
};

export function ReminderEditor({
  open,
  onOpenChange,
  accountId,
  vehicleId,
  currentOdometerKm,
  partTypes,
  configuredPartTypeIds,
}: ReminderEditorProps) {
  const { t } = useTranslation();
  const timezone = useSessionStore((state) => state.account?.timezone ?? 'UTC');
  const availablePartTypes = partTypes.filter(
    (partType) => partType.active && !configuredPartTypeIds.has(partType.id),
  );
  const [partTypeId, setPartTypeId] = useState(availablePartTypes[0]?.id ?? '');
  const [intervalKm, setIntervalKm] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const [baselineKm, setBaselineKm] = useState(
    currentOdometerKm == null ? '' : String(currentOdometerKm),
  );
  const [baselineDate, setBaselineDate] = useState(() =>
    toCalendarDateInTimezone(new Date().toISOString(), timezone),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const intervalKmInput = useRef<HTMLInputElement>(null);
  const intervalDaysInput = useRef<HTMLInputElement>(null);
  const baselineKmInput = useRef<HTMLInputElement>(null);

  async function save() {
    // Browsers expose incomplete numeric text (e.g. "1e") as an empty value.
    // Inspect native validity before interpreting an empty optional field as null.
    if (intervalKmInput.current?.validity.badInput) return setError(t('reminder.intervalKmRange'));
    if (intervalDaysInput.current?.validity.badInput)
      return setError(t('reminder.intervalDaysRange'));
    if (baselineKmInput.current?.validity.badInput) return setError(t('logEntry.odometerRange'));
    const km = parseOptionalNumber(intervalKm);
    const days = parseOptionalNumber(intervalDays);
    const startKm = parseOptionalNumber(baselineKm);

    if (!partTypeId) return setError(t('logEntry.choosePart'));
    const validation = validateReminderInterval(km, days);
    if (!validation.valid) {
      return setError(
        t(
          validation.error === 'missing_interval'
            ? 'reminder.positiveInterval'
            : validation.error === 'interval_km_not_positive'
              ? 'reminder.intervalKmRange'
              : 'reminder.intervalDaysRange',
        ),
      );
    }
    if (startKm != null && !isValidOdometerKm(startKm))
      return setError(t('logEntry.odometerRange'));
    if (km != null && startKm == null) return setError(t('reminder.startingOdometerRequired'));
    if (days != null && !baselineDate) return setError(t('reminder.startingDateRequired'));

    setSaving(true);
    setError(null);
    try {
      await createReminderConfig({
        accountId,
        vehicleId,
        partTypeId,
        intervalKm: km,
        intervalDays: days,
        baselineOdometerKm: km == null ? null : startKm,
        baselineDate: days == null ? null : baselineDate,
      });
      toast.success(t('reminder.added'));
      onOpenChange(false);
    } catch {
      setError(t('reminder.addFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reminder.addTitle')}</DialogTitle>
          <DialogDescription>{t('reminder.addDescription')}</DialogDescription>
        </DialogHeader>

        {availablePartTypes.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
            {t('reminder.allConfigured')}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-reminder-part">{t('reminder.part')}</Label>
              <Select value={partTypeId} onValueChange={setPartTypeId}>
                <SelectTrigger id="new-reminder-part" className="w-full">
                  <SelectValue placeholder={t('reminder.choosePart')} />
                </SelectTrigger>
                <SelectContent>
                  {availablePartTypes.map((partType) => (
                    <SelectItem key={partType.id} value={partType.id}>
                      {partType.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-reminder-km">{t('reminder.distanceInterval')}</Label>
                <Input
                  id="new-reminder-km"
                  ref={intervalKmInput}
                  type="number"
                  min="0"
                  max={MAX_ODOMETER_KM}
                  step="any"
                  inputMode="numeric"
                  value={intervalKm}
                  onChange={(event) => setIntervalKm(event.target.value)}
                  placeholder="VD: 5000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-reminder-days">{t('reminder.dayInterval')}</Label>
                <Input
                  id="new-reminder-days"
                  ref={intervalDaysInput}
                  type="number"
                  min="1"
                  max={MAX_INTERVAL_DAYS}
                  step="1"
                  inputMode="numeric"
                  value={intervalDays}
                  onChange={(event) => setIntervalDays(event.target.value)}
                  placeholder="VD: 180"
                />
              </div>
              {intervalKm ? (
                <div className="space-y-2">
                  <Label htmlFor="new-reminder-baseline-km">{t('reminder.startingOdometer')}</Label>
                  <Input
                    id="new-reminder-baseline-km"
                    ref={baselineKmInput}
                    type="number"
                    min="0"
                    max={MAX_ODOMETER_KM}
                    step="any"
                    inputMode="numeric"
                    value={baselineKm}
                    onChange={(event) => setBaselineKm(event.target.value)}
                  />
                </div>
              ) : null}
              {intervalDays ? (
                <div className="space-y-2">
                  <Label htmlFor="new-reminder-baseline-date">
                    {t('reminder.startingDate')} ({timezone})
                  </Label>
                  <Input
                    id="new-reminder-baseline-date"
                    type="date"
                    value={baselineDate}
                    onChange={(event) => setBaselineDate(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving || availablePartTypes.length === 0}>
            {saving ? t('reminder.adding') : t('reminder.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import {
  BatteryFull,
  CircleDot,
  Cog,
  Disc,
  Droplet,
  Link2,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { resolvePartTypeDisplay, type PartTypeIconKey } from '@/domain/partType';
import type { PartType } from '@/domain/types';

type PartTypeSelectorProps = {
  partTypes: PartType[];
  value: string | null;
  onChange: (partTypeId: string) => void;
  invalid?: boolean;
};

const icons: Record<PartTypeIconKey, LucideIcon> = {
  engine_oil: Droplet,
  front_tire: CircleDot,
  rear_tire: CircleDot,
  front_brake_pad: Disc,
  rear_brake_pad: Disc,
  spark_plug: Zap,
  air_filter: Wind,
  drive_belt: Link2,
  chain_sprocket_set: Cog,
  battery: BatteryFull,
  unknown: Wrench,
};

export function PartTypeSelector({ partTypes, value, onChange, invalid }: PartTypeSelectorProps) {
  const { t } = useTranslation();
  const selectedPartType = partTypes.find((partType) => partType.id === value);
  const selectedDisplay = selectedPartType
    ? resolvePartTypeDisplay(selectedPartType.code, partTypes)
    : null;
  const SelectedIcon = selectedDisplay ? icons[selectedDisplay.icon] : null;

  return (
    <fieldset>
      <legend className="mb-2 px-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {t('logEntry.partServiced')}
      </legend>
      {partTypes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-center text-sm text-muted-foreground">
          {t('logEntry.noPartTypes')}
        </div>
      ) : (
        <Select value={value ?? ''} onValueChange={onChange}>
          {/* `''` giữ Select luôn controlled (Radix coi rỗng = placeholder state). */}
          <SelectTrigger
            id="log-part-type"
            aria-label={t('logEntry.partServiced')}
            aria-invalid={invalid || undefined}
            className="h-12 w-full min-w-0 text-left data-[size=default]:h-12"
          >
            {/* Trigger render label thủ công (pattern TimezoneSetting) — SelectValue không
                tự resolve text của `value` đặt sẵn trước khi content mở lần đầu (luồng sửa). */}
            <SelectValue placeholder={t('logEntry.selectPartPlaceholder')}>
              {selectedDisplay && SelectedIcon ? (
                <span className="flex min-w-0 items-center gap-2">
                  <SelectedIcon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{selectedDisplay.displayName}</span>
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            className="max-h-[min(18rem,var(--radix-select-content-available-height))]"
          >
            {partTypes.map((partType) => {
              const display = resolvePartTypeDisplay(partType.code, partTypes);
              const Icon = icons[display.icon];

              return (
                <SelectItem
                  key={partType.id}
                  value={partType.id}
                  disabled={!partType.active}
                  textValue={display.displayName}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{display.displayName}</span>
                  {!partType.active ? (
                    <span className="ml-auto pl-2 text-[10px] font-medium text-muted-foreground">
                      {t('partType.disabled')}
                    </span>
                  ) : null}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
    </fieldset>
  );
}

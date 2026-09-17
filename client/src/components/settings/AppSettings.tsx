import { Gauge, Moon, Ruler, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DUE_SOON_REMAINING_RATIO } from "@/domain/constants";
import { PREFERENCE_KEYS, useLocalStoragePreference } from "./preferences";
import { SyncStatusBadge } from "./SyncStatusBadge";

function SettingsRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function AppSettings() {
  const [askForOdometer, setAskForOdometer] = useLocalStoragePreference(
    PREFERENCE_KEYS.askForOdometer,
    true,
  );
  const [quietHours, setQuietHours] = useLocalStoragePreference(
    PREFERENCE_KEYS.quietHours,
    true,
  );
  const [units, setUnits] = useLocalStoragePreference<"km" | "mi">(
    PREFERENCE_KEYS.units,
    "km",
  );
  const dueSoonPercent = Math.round(DUE_SOON_REMAINING_RATIO * 100);

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Reminders
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
          <SettingsRow
            icon={ShieldCheck}
            title="Warn me ahead by"
            description="Read-only system threshold for distance or time"
          >
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">
              {dueSoonPercent}% remaining
            </span>
          </SettingsRow>
          <SettingsRow
            icon={Gauge}
            title="Ask for odometer"
            description="A single prompt, weekly"
          >
            <Switch
              checked={askForOdometer}
              onCheckedChange={setAskForOdometer}
              aria-label="Ask for odometer weekly"
            />
          </SettingsRow>
          <SettingsRow
            icon={Moon}
            title="Quiet hours"
            description="No prompts from 22:00 to 07:00"
          >
            <Switch
              checked={quietHours}
              onCheckedChange={setQuietHours}
              aria-label="Use quiet hours"
            />
          </SettingsRow>
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          App
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
          <SettingsRow icon={Ruler} title="Units">
            <Select
              value={units}
              onValueChange={(value) => setUnits(value as "km" | "mi")}
            >
              <SelectTrigger size="sm" aria-label="Units">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">Kilometres</SelectItem>
                <SelectItem value="mi">Miles</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            icon={ShieldCheck}
            title="Sync"
            description="Changes save locally before syncing"
          >
            <SyncStatusBadge />
          </SettingsRow>
        </div>
      </section>
    </div>
  );
}

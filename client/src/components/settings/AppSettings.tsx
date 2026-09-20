import { ChevronRight, Gauge, Moon, Ruler, ShieldCheck, SunMoon, Wrench } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
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
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
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
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t('settings.reminders')}
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
          <Link to="/settings/part-types" className="block transition hover:bg-muted/50">
            <SettingsRow icon={Wrench} title={t('partType.title')} description={t('partType.settingsRowDescription')}>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </SettingsRow>
          </Link>
          <SettingsRow
            icon={Gauge}
            title={t('settings.askOdometer')}
            description={t('settings.askOdometerDescription')}
          >
            <Switch
              checked={askForOdometer}
              onCheckedChange={setAskForOdometer}
              aria-label={t('settings.askOdometerAria')}
            />
          </SettingsRow>
          <SettingsRow
            icon={Moon}
            title={t('settings.quietHours')}
            description={t('settings.quietHoursDescription')}
          >
            <Switch
              checked={quietHours}
              onCheckedChange={setQuietHours}
              aria-label={t('settings.quietHoursAria')}
            />
          </SettingsRow>
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t('settings.app')}
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-card shadow-sm">
          <SettingsRow icon={Ruler} title={t('settings.units')}>
            <Select
              value={units}
              onValueChange={(value) => setUnits(value as "km" | "mi")}
            >
              <SelectTrigger size="sm" aria-label={t('settings.units')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">{t('settings.kilometres')}</SelectItem>
                <SelectItem value="mi">{t('settings.miles')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            icon={SunMoon}
            title={t('settings.appearance')}
            description={t('settings.appearanceDescription')}
          >
            <Select value={theme ?? 'light'} onValueChange={setTheme}>
              <SelectTrigger size="sm" aria-label={t('settings.appearance')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t('settings.light')}</SelectItem>
                <SelectItem value="dark">{t('settings.dark')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            icon={ShieldCheck}
            title={t('settings.sync')}
            description={t('settings.syncDescription')}
          >
            <div className="ml-11 shrink-0 sm:ml-0">
              <SyncStatusBadge />
            </div>
          </SettingsRow>
        </div>
      </section>
    </div>
  );
}

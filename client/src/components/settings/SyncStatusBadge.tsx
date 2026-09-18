import { AlertCircle, CheckCircle2, Cloud, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useOutboxPendingCount } from "@/hooks/useOutboxPendingCount";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSyncStore } from "@/stores/useSyncStore";
import { runSync } from "@/sync/syncOrchestrator";
import { formatTime } from "@/lib/formatters";
import { useSessionStore } from "@/stores/useSessionStore";

export function SyncStatusBadge() {
  const { t } = useTranslation();
  const pendingCount = useOutboxPendingCount();
  const status = useSyncStore((state) => state.status);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const timezone = useSessionStore((state) => state.account?.timezone);
  const online = useOnlineStatus();

  const syncButton = (
    <Button
      size="xs"
      variant="outline"
      disabled={!online || status === "syncing"}
      onClick={() => void runSync().catch(() => undefined)}
    >
      <RefreshCw className={status === "syncing" ? "animate-spin" : ""} />
      {status === "syncing" ? t('sync.syncing') : online ? t('sync.now') : t('sync.offline')}
    </Button>
  );

  if (status === "syncing") {
    return syncButton;
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-destructive">
        <AlertCircle className="size-3.5" /> {t('sync.needsAttention')} {syncButton}
      </span>
    );
  }
  if (pendingCount > 0) {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-warn-fg">
        <Cloud className="size-3.5" /> {t('sync.queued', { count: pendingCount })} {syncButton}
      </span>
    );
  }
  if (lastSyncedAt) {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-primary" /> {t('sync.syncedAt', { time: formatTime(lastSyncedAt, timezone) })} {syncButton}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Cloud className="size-3.5" /> {t('sync.never')} {syncButton}
    </span>
  );
}

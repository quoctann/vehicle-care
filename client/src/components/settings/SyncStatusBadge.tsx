import { AlertCircle, CheckCircle2, Cloud, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOutboxPendingCount } from "@/hooks/useOutboxPendingCount";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSyncStore } from "@/stores/useSyncStore";
import { runSync } from "@/sync/syncOrchestrator";

function formatSyncedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SyncStatusBadge() {
  const pendingCount = useOutboxPendingCount();
  const status = useSyncStore((state) => state.status);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const online = useOnlineStatus();

  const syncButton = (
    <Button
      size="xs"
      variant="outline"
      disabled={!online || status === "syncing"}
      onClick={() => void runSync().catch(() => undefined)}
    >
      <RefreshCw className={status === "syncing" ? "animate-spin" : ""} />
      {status === "syncing" ? "Syncing" : online ? "Sync now" : "Offline"}
    </Button>
  );

  if (status === "syncing") {
    return syncButton;
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-destructive">
        <AlertCircle className="size-3.5" /> Sync needs attention {syncButton}
      </span>
    );
  }
  if (pendingCount > 0) {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-warn-fg">
        <Cloud className="size-3.5" /> {pendingCount} queued {syncButton}
      </span>
    );
  }
  if (lastSyncedAt) {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-primary" /> Synced{" "}
        {formatSyncedAt(lastSyncedAt)} {syncButton}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Cloud className="size-3.5" /> Not synced yet {syncButton}
    </span>
  );
}

import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { SessionAccount } from "@/stores/useSessionStore";

function initials(account: SessionAccount): string {
  const source = account.name?.trim() || account.email.split("@")[0];
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AccountCard({
  account,
  signingOut,
  onSignOut,
}: {
  account: SessionAccount;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-card p-4 shadow-sm">
      <Avatar size="lg" className="size-11">
        <AvatarFallback className="border border-warn-border bg-warn-bg font-bold text-warn-fg">
          {initials(account)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {account.name || account.email.split("@")[0]}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {account.email}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onSignOut}
        disabled={signingOut}
      >
        <LogOut data-icon="inline-start" />
        {signingOut ? t('settings.signingOut') : t('settings.signOut')}
      </Button>
    </section>
  );
}

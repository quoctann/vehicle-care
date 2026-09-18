import { BellRing, History, Home, UserRound } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type SidebarNavProps = {
  vehicleId?: string
}

export function SidebarNav({ vehicleId }: SidebarNavProps) {
  const { t } = useTranslation()
  const items = [
    { label: t('navigation.home'), icon: Home, to: vehicleId ? `/v/${vehicleId}/home` : '/' },
    { label: t('navigation.reminders'), icon: BellRing, to: vehicleId ? `/v/${vehicleId}/reminders` : '/' },
    { label: t('navigation.history'), icon: History, to: vehicleId ? `/v/${vehicleId}/history` : '/' },
    { label: t('navigation.account'), icon: UserRound, to: '/settings' },
  ]

  return (
    <nav aria-label={t('navigation.primary')} className="mt-[18px] flex flex-col gap-0.5">
      {items.map(({ label, icon: Icon, to }) => (
        <NavLink
          key={label}
          to={to}
          end
          className={({ isActive }) =>
            `flex h-[38px] items-center gap-2.5 rounded-[10px] border px-2.5 text-[13.5px] font-medium transition-colors ${
              isActive
                ? 'border-border-subtle bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-background hover:text-foreground'
            }`
          }
        >
          <Icon className="size-[19px]" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

import { BellRing, History, Home, UserRound } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

type BottomTabBarProps = {
  vehicleId?: string
}

export function BottomTabBar({ vehicleId }: BottomTabBarProps) {
  const { t } = useTranslation()
  const items = [
    { label: t('navigation.home'), icon: Home, to: vehicleId ? `/v/${vehicleId}/home` : '/' },
    { label: t('navigation.reminders'), icon: BellRing, to: vehicleId ? `/v/${vehicleId}/reminders` : '/' },
    { label: t('navigation.history'), icon: History, to: vehicleId ? `/v/${vehicleId}/history` : '/' },
    { label: t('navigation.account'), icon: UserRound, to: '/settings' },
  ]

  return (
    <nav
      aria-label={t('navigation.primary')}
      className="grid h-auto shrink-0 grid-cols-4 border-t bg-card px-2 pt-2 lg:hidden"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {items.map(({ label, icon: Icon, to }) => (
        <NavLink
          key={label}
          to={to}
          end
          className={({ isActive }) =>
            `flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10.5px] font-medium transition-colors ${
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className={`rounded-lg px-3 py-0.5 ${isActive ? 'bg-muted' : ''}`}>
                <Icon className="size-5" />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

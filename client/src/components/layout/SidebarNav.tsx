import { ChartNoAxesColumnIncreasing, History, Home, UserRound } from 'lucide-react'
import { NavLink } from 'react-router-dom'

type SidebarNavProps = {
  vehicleId?: string
}

export function SidebarNav({ vehicleId }: SidebarNavProps) {
  const items = [
    { label: 'Home', icon: Home, to: vehicleId ? `/v/${vehicleId}/home` : '/' },
    { label: 'History', icon: History, to: vehicleId ? `/v/${vehicleId}/history` : '/' },
    { label: 'Costs', icon: ChartNoAxesColumnIncreasing, to: vehicleId ? `/v/${vehicleId}/costs` : '/' },
    { label: 'You', icon: UserRound, to: '/settings' },
  ]

  return (
    <nav aria-label="Primary" className="mt-[18px] flex flex-col gap-0.5">
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

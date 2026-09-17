type OdometerCardProps = {
  odometerKm: number | null
  onUpdate: () => void
}

const numberFormatter = new Intl.NumberFormat('en-US')

export function OdometerCard({ odometerKm, onUpdate }: OdometerCardProps) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border-subtle bg-card p-3.5 shadow-[0_1px_1px_rgba(44,54,53,.025),inset_0_0_0_2px_#fff]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Odometer</p>
        <p className="mt-1 text-[30px] font-bold leading-none tracking-[-0.03em]">
          {odometerKm == null ? '--' : numberFormatter.format(odometerKm)}{' '}
          <span className="text-[15px] font-medium text-muted-foreground">km</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {odometerKm == null ? 'No reading logged yet' : 'Current recorded reading'}
        </p>
      </div>
      <button
        type="button"
        onClick={onUpdate}
        className="flex h-9 items-center rounded-[10px] border bg-card px-3.5 font-display text-[13px] font-medium shadow-[0_1px_1px_rgba(44,54,53,.025)] transition hover:border-foreground"
      >
        Update
      </button>
    </section>
  )
}

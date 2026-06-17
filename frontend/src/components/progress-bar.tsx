import { cn } from "@/lib/utils"

interface ProgressBarProps {
  value: number // completed
  total: number
  className?: string
}

export function ProgressBar({ value, total, className }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {value}/{total}
      </span>
    </div>
  )
}

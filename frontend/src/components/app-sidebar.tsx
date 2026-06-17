import { NavLink } from "react-router"
import { CheckCircle2, Circle } from "lucide-react"

import { tracks } from "@/lib/katas"
import { useProgress } from "@/hooks/use-progress"
import { ProgressBar } from "@/components/progress-bar"
import { cn } from "@/lib/utils"

interface AppSidebarProps {
  onNavigate?: () => void
}

export function AppSidebar({ onNavigate }: AppSidebarProps) {
  const { isDone } = useProgress()

  return (
    <nav className="space-y-8 text-sm">
      {tracks.map((track) => {
        const done = track.katas.filter((k) => isDone(k.id)).length
        return (
          <div key={track.track}>
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Track {track.track} · {track.trackName}
            </p>
            <ProgressBar
              value={done}
              total={track.katas.length}
              className="mb-3 px-2"
            />
            <div className="space-y-4">
              {track.modules.map((module) => (
                <div key={module.module}>
                  <p className="mb-1 px-2 text-xs font-medium text-foreground/70">
                    {module.module}
                  </p>
                  <ul className="space-y-0.5">
                    {module.katas.map((kata) => (
                      <li key={kata.id}>
                        <NavLink
                          to={`/kata/${kata.routeId}`}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground",
                              isActive &&
                                "bg-accent font-medium text-accent-foreground",
                            )
                          }
                        >
                          {isDone(kata.id) ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                          ) : (
                            <Circle className="size-4 shrink-0 text-muted-foreground/40" />
                          )}
                          <span className="truncate">
                            <span className="text-muted-foreground">
                              {kata.id}
                            </span>{" "}
                            {kata.title}
                          </span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

import { Link } from "react-router"
import { ArrowRight, Network, ShieldCheck } from "lucide-react"

import { katas, tracks, type TrackGroup } from "@/lib/katas"
import { useProgress } from "@/hooks/use-progress"
import { ProgressBar } from "@/components/progress-bar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function HomePage() {
  const { isDone, count } = useProgress()

  const firstUndone = (track: TrackGroup) =>
    track.katas.find((k) => !isDone(k.id)) ?? track.katas[0]

  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <section className="space-y-4">
        <Badge variant="secondary">Networking + Information Security</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Practice the conversations that ship architectures.
        </h1>
        <p className="text-lg text-muted-foreground">
          A self-paced kata curriculum that takes solution and enterprise
          architects from packet to hybrid cloud, and from the CIA triad to
          cloud security posture — so you can hold credible, efficient
          conversations with IT heads, network teams, and CISOs at banks and
          large FMCGs.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {katas[0] && (
            <Button asChild>
              <Link to={`/kata/${katas[0].routeId}`}>
                Start with {katas[0].id} <ArrowRight />
              </Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            {katas.length} katas · {count} completed
          </span>
        </div>
        <ProgressBar value={count} total={katas.length} className="max-w-md" />
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        {tracks.map((track) => {
          const done = track.katas.filter((k) => isDone(k.id)).length
          const next = firstUndone(track)
          const Icon = track.track === "N" ? Network : ShieldCheck
          return (
            <Card key={track.track}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Icon className="size-5 text-emerald-500" />
                  <CardTitle>
                    Track {track.track} · {track.trackName}
                  </CardTitle>
                </div>
                <CardDescription>
                  {track.modules.length} modules · {track.katas.length} katas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProgressBar value={done} total={track.katas.length} />
                {next && (
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/kata/${next.routeId}`}>
                      {done === 0 ? "Start" : "Continue"}: {next.id} {next.title}
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">All katas</h2>
        <div className="space-y-6">
          {tracks.map((track) => (
            <div key={track.track} className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Track {track.track} · {track.trackName}
              </h3>
              {track.modules.map((module) => (
                <div key={module.module} className="space-y-1">
                  <p className="text-sm font-medium text-foreground/70">
                    {module.module}
                  </p>
                  <ul className="divide-y rounded-lg border">
                    {module.katas.map((kata) => (
                      <li key={kata.id}>
                        <Link
                          to={`/kata/${kata.routeId}`}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
                        >
                          <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">
                            {kata.id}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {kata.title}
                          </span>
                          {isDone(kata.id) && (
                            <Badge variant="secondary">done</Badge>
                          )}
                          {kata.time && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {kata.time}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

import { useEffect } from "react"
import { Link, useParams } from "react-router"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
} from "lucide-react"

import { getAdjacent, getKata } from "@/lib/katas"
import { useProgress } from "@/hooks/use-progress"
import { KataMarkdown } from "@/components/kata-markdown"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NotFoundPage } from "./not-found-page"

export function KataPage() {
  const { id = "" } = useParams()
  const kata = getKata(id)
  const { isDone, toggle } = useProgress()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [id])

  if (!kata) return <NotFoundPage />

  const { prev, next } = getAdjacent(kata.routeId)
  const done = isDone(kata.id)

  return (
    <article className="mx-auto max-w-3xl">
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{kata.id}</Badge>
          <Badge variant="secondary">{kata.trackName}</Badge>
          <Badge variant="outline">{kata.module}</Badge>
        </div>

        <h1 className="text-3xl font-bold tracking-tight">{kata.title}</h1>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {kata.time && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" /> {kata.time}
            </span>
          )}
          <span>Prereqs: {kata.prereqs}</span>
        </div>

        {kata.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {kata.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <Button
          variant={done ? "secondary" : "default"}
          onClick={() => toggle(kata.id)}
        >
          {done ? <CheckCircle2 /> : <Circle />}
          {done ? "Completed" : "Mark complete"}
        </Button>
      </div>

      <KataMarkdown content={kata.body} />

      <nav className="mt-12 flex items-stretch justify-between gap-4 border-t pt-6">
        {prev ? (
          <Button asChild variant="outline" className="h-auto justify-start py-3">
            <Link to={`/kata/${prev.routeId}`}>
              <ArrowLeft />
              <span className="flex flex-col items-start text-left">
                <span className="text-xs text-muted-foreground">Previous</span>
                <span className="text-sm">
                  {prev.id} · {prev.title}
                </span>
              </span>
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button asChild variant="outline" className="h-auto justify-end py-3">
            <Link to={`/kata/${next.routeId}`}>
              <span className="flex flex-col items-end text-right">
                <span className="text-xs text-muted-foreground">Next</span>
                <span className="text-sm">
                  {next.id} · {next.title}
                </span>
              </span>
              <ArrowRight />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>
    </article>
  )
}

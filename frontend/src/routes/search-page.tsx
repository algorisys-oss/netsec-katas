import { useEffect, useMemo, useRef } from "react"
import { Link, useSearchParams } from "react-router"
import { Search as SearchIcon, X } from "lucide-react"

import { katasByTag, queryTerms, searchKatas } from "@/lib/search"
import { allTags } from "@/lib/search"
import { Highlight } from "@/components/highlight"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get("q") ?? ""
  const tag = params.get("tag") ?? ""
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const terms = queryTerms(q)
  const results = useMemo(() => {
    if (tag) {
      return katasByTag(tag).map((k) => ({
        kata: k,
        score: 0,
        snippet: k.body.replace(/\s+/g, " ").slice(0, 160).trim() + "…",
      }))
    }
    return searchKatas(q)
  }, [q, tag])

  function setQ(v: string) {
    const next = new URLSearchParams()
    if (v) next.set("q", v)
    setParams(next, { replace: true })
  }

  const tagList = allTags()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search katas — try “dns”, “tls”, “egress”, “zero trust”, “N08”…"
          className="h-11 pl-9 text-base"
          aria-label="Search katas"
        />
      </div>

      {tag && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtering by tag:</span>
          <Badge variant="secondary">{tag}</Badge>
          <Button variant="ghost" size="sm" asChild className="h-7 gap-1">
            <Link to="/search">
              <X className="size-3" /> clear
            </Link>
          </Button>
        </div>
      )}

      {/* Results */}
      {(q || tag) && (
        <p className="text-sm text-muted-foreground">
          {results.length} {results.length === 1 ? "kata" : "katas"}
          {tag ? ` tagged “${tag}”` : q ? ` matching “${q}”` : ""}
        </p>
      )}

      <ul className="space-y-3">
        {results.map(({ kata, snippet }) => (
          <li key={kata.id}>
            <Link
              to={`/kata/${kata.routeId}`}
              className="block rounded-lg border p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {kata.id}
                </span>
                <span className="font-medium">
                  <Highlight text={kata.title} terms={terms} />
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{kata.module}</p>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                <Highlight text={snippet} terms={terms} />
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {kata.tags.map((t) => (
                  <Badge
                    key={t}
                    variant={t === tag ? "default" : "secondary"}
                    className="font-normal"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {(q || tag) && results.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">
          No katas match. Try a broader term, a protocol name, or a kata id like{" "}
          <code className="rounded bg-muted px-1">N17</code>.
        </p>
      )}

      {/* Empty state: browse by tag */}
      {!q && !tag && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Or browse by tag
          </h2>
          <div className="flex flex-wrap gap-2">
            {tagList.map(({ tag: t, count }) => (
              <Button
                key={t}
                variant="outline"
                size="sm"
                asChild
                className="h-7 gap-1.5 font-normal"
              >
                <Link to={`/search?tag=${encodeURIComponent(t)}`}>
                  {t}
                  <span className="text-xs text-muted-foreground">{count}</span>
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

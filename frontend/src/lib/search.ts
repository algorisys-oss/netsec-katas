import { katas, type Kata } from "./katas"

export interface SearchResult {
  kata: Kata
  score: number
  snippet: string
}

export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function snippetFor(body: string, terms: string[]): string {
  const lower = body.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (idx === -1 || i < idx)) idx = i
  }
  const clean = (s: string) => s.replace(/\s+/g, " ").trim()
  if (idx === -1) {
    return clean(body.slice(0, 160)) + (body.length > 160 ? "…" : "")
  }
  const start = Math.max(0, idx - 70)
  const end = Math.min(body.length, idx + 120)
  return (
    (start > 0 ? "…" : "") +
    clean(body.slice(start, end)) +
    (end < body.length ? "…" : "")
  )
}

// Rank katas against a free-text query. id/title weigh most, then tags, then
// module, then body — so "dns" surfaces N17 before a kata that merely mentions it.
export function searchKatas(query: string): SearchResult[] {
  const terms = queryTerms(query)
  if (!terms.length) return []
  const out: SearchResult[] = []
  for (const k of katas) {
    const id = k.id.toLowerCase()
    const title = k.title.toLowerCase()
    const module = k.module.toLowerCase()
    const body = k.body.toLowerCase()
    let score = 0
    for (const t of terms) {
      if (id === t || id.slice(1) === t) score += 10
      else if (id.includes(t)) score += 4
      if (title.includes(t)) score += 5
      if (k.tags.some((tag) => tag === t)) score += 4
      else if (k.tags.some((tag) => tag.includes(t))) score += 2
      if (module.includes(t)) score += 2
      if (body.includes(t)) score += 1
    }
    if (score > 0) out.push({ kata: k, score, snippet: snippetFor(k.body, terms) })
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.kata.track.localeCompare(b.kata.track) ||
      a.kata.num - b.kata.num,
  )
  return out
}

export function katasByTag(tag: string): Kata[] {
  return katas.filter((k) => k.tags.includes(tag))
}

export function allTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const k of katas) {
    for (const t of k.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

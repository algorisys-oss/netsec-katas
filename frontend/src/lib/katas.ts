// Loads the kata markdown straight from the repo's `modules/` tree at build time.
// The katas remain the single source of truth — this file only parses them.

export type Track = "N" | "S"

export interface Kata {
  id: string // e.g. "N01"
  num: number // e.g. 1
  track: Track
  trackName: string
  slug: string // e.g. "architects-stake"
  routeId: string // e.g. "n01"
  title: string
  module: string // e.g. "N0 Why networking matters"
  prereqs: string // e.g. "none" or "N01"
  time: string // e.g. "~20 min"
  tags: string[] // e.g. ["dns", "ttl", "caching"]
  body: string // markdown with the title + meta/tags blockquote stripped
  path: string
}

export interface ModuleGroup {
  module: string
  katas: Kata[]
}

export interface TrackGroup {
  track: Track
  trackName: string
  modules: ModuleGroup[]
  katas: Kata[]
}

const TRACK_NAMES: Record<Track, string> = {
  N: "Networking",
  S: "Information Security",
}

// Eagerly import every kata file as a raw string.
// Path is relative to this file: frontend/src/lib -> ../../../modules.
const files = import.meta.glob("../../../modules/**/kata*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

function metaField(metaLine: string, key: string): string {
  // Fields are "**Key:** value" separated by "·".
  const match = metaLine.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*([^·]+)`))
  return match ? match[1].trim() : ""
}

function parseKata(path: string, raw: string): Kata {
  const lines = raw.split("\n")

  const titleLine = lines.find((l) => /^#\s+Kata\s+/.test(l)) ?? ""
  const titleMatch = titleLine.match(/^#\s+Kata\s+([NS])(\d+)\s+[—–-]\s+(.+?)\s*$/)
  const track = (titleMatch?.[1] ?? "N") as Track
  const numStr = titleMatch?.[2] ?? "0"
  const num = Number.parseInt(numStr, 10)
  const id = `${track}${numStr}`
  const title = titleMatch?.[3] ?? path

  const metaLine = lines.find((l) => l.startsWith("> **Track:**")) ?? ""
  const module = metaField(metaLine, "Module") || `${track} (unsorted)`
  const prereqs = metaField(metaLine, "Prereqs") || "none"
  const time = metaField(metaLine, "Time") || ""

  // Tags live on a second blockquote line: `> **Tags:** `a` `b` `c``.
  const tagsLine = lines.find((l) => l.startsWith("> **Tags:**")) ?? ""
  const tags = [...tagsLine.matchAll(/`([^`]+)`/g)].map((m) => m[1])

  // Drop everything up to and including the meta/tags blockquote so the page can
  // render its own header without duplicating the title/meta.
  const headerEnd = Math.max(lines.indexOf(metaLine), lines.indexOf(tagsLine))
  const body = (headerEnd >= 0 ? lines.slice(headerEnd + 1) : lines)
    .join("\n")
    .trim()

  const fileName = path.split("/").pop() ?? path
  const slug = fileName.replace(/^kata[NS]\d+-/, "").replace(/\.md$/, "")

  return {
    id,
    num,
    track,
    trackName: TRACK_NAMES[track],
    slug,
    routeId: id.toLowerCase(),
    title,
    module,
    prereqs,
    time,
    tags,
    body,
    path,
  }
}

export const katas: Kata[] = Object.entries(files)
  .map(([path, raw]) => parseKata(path, raw))
  .sort((a, b) => (a.track === b.track ? a.num - b.num : a.track === "N" ? -1 : 1))

export const tracks: TrackGroup[] = (() => {
  const groups: TrackGroup[] = []
  for (const kata of katas) {
    let track = groups.find((g) => g.track === kata.track)
    if (!track) {
      track = {
        track: kata.track,
        trackName: kata.trackName,
        modules: [],
        katas: [],
      }
      groups.push(track)
    }
    track.katas.push(kata)

    let module = track.modules.find((m) => m.module === kata.module)
    if (!module) {
      module = { module: kata.module, katas: [] }
      track.modules.push(module)
    }
    module.katas.push(kata)
  }
  return groups
})()

export function getKata(routeId: string): Kata | undefined {
  return katas.find((k) => k.routeId === routeId.toLowerCase())
}

export function getAdjacent(routeId: string): {
  prev?: Kata
  next?: Kata
} {
  const i = katas.findIndex((k) => k.routeId === routeId.toLowerCase())
  if (i === -1) return {}
  return {
    prev: i > 0 ? katas[i - 1] : undefined,
    next: i < katas.length - 1 ? katas[i + 1] : undefined,
  }
}

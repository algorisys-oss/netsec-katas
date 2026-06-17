function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Wrap occurrences of any term in <mark>. Terms are matched case-insensitively.
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const valid = terms.filter(Boolean)
  if (!valid.length) return <>{text}</>
  const re = new RegExp(`(${valid.map(escapeRegExp).join("|")})`, "gi")
  const set = new Set(valid.map((t) => t.toLowerCase()))
  const parts = text.split(re).filter((p) => p !== "")
  return (
    <>
      {parts.map((p, i) =>
        set.has(p.toLowerCase()) ? (
          <mark
            key={i}
            className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/30"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

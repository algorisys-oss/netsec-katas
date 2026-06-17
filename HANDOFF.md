# HANDOFF — NetSec Katas

A pick-up-where-we-left-off briefing. Read this + `CLAUDE.md` + `plan.md` and you
have full context to continue in a fresh session.

_Last updated: 2026-06-17 (all 99 katas complete; accuracy pass done; web app with search)_

## What this project is

A self-paced **kata curriculum** teaching **networking + information security** to
**solution/enterprise architects and client-facing technical staff**, so they can
hold credible, efficient conversations with **IT heads, network teams, and CISOs**
at **banks, financial institutions, and large FMCGs**. Laptop-first exercises;
cloud priority **GCP → AWS → Azure (later)**.

Authoritative docs:
- `CLAUDE.md` — how to teach here (audience, pedagogy, kata template, conventions).
- `plan.md` — the full curriculum, two tracks, status checkboxes. **Source of truth.**

## Decisions locked (so you don't re-ask)

| Decision | Choice |
|----------|--------|
| Scope | Networking spine **+ full information-security track** |
| Name | `netsec-katas` (renamed from `networking-katas`) |
| Lab depth | **Laptop + paper first**; cloud steps marked `[needs cloud account]` |
| Cloud order | GCP first, AWS comparatively, **Azure stubbed `(Azure: TODO)`** |
| Tracks | `N` = Networking (59 katas), `S` = Security (40 katas), interleaved |
| Numbering | Global **within each track** (N01.., S01..) — never renumber |

Still open (ask the learner when relevant): Azure backfill timing; pacing
(kata/day vs by module); ASCII-only vs Mermaid diagrams.

## Website (`frontend/`)

A React 19 + Vite + React Router 7 + shadcn/ui (Tailwind v4) single-page app.
**No backend.** It loads the kata markdown directly from `modules/` via
`import.meta.glob` and parses the `# Kata NN — Title` heading + meta blockquote —
so **adding a kata markdown file makes it appear in the site automatically**.
Progress is tracked in `localStorage`; full-text + tag **search** at `/search` (press `/`). Code lives in `frontend/src/`; all file
and folder names are lowercase-hyphenated. Run: `cd frontend && npm install &&
npm run dev`. See `frontend/README.md`. When the kata template changes, keep the
parser in `frontend/src/lib/katas.ts` in sync (it expects the current heading +
`> **Track:** … **Module:** … **Prereqs:** … **Time:** …` format).

## Structure

```
netsec-katas/
├── CLAUDE.md                      # teaching contract — read first
├── plan.md                        # curriculum + status (source of truth)
├── HANDOFF.md                     # this file
├── frontend/                [x]   # web app (see below) — reads katas from modules/
├── reference/
│   ├── running-example.md   [x]   # Meridian Bank + Northwind FMCG — reuse everywhere
│   ├── lab-setup.md         [x]   # laptop toolchain (netshoot container, CLI tools)
│   ├── glossary.md          [x]   # 506 terms
│   ├── tags.md             [x]   # controlled tag vocabulary (search)
│   ├── cheatsheet-cidr.md   [x]   # subnetting ready-reckoner
│   ├── cheatsheet-ports.md  [ ]   # TODO
│   ├── cheatsheet-cloud-map.md [ ] # TODO (GCP↔AWS↔Azure↔on-prem)
│   └── cheatsheet-frameworks.md [ ] # TODO (NIST/ISO/PCI)
└── modules/
    ├── networking/   (N01–N59, 11 modules — ALL COMPLETE)
    └── security/     (S01–S40, 11 modules — ALL COMPLETE)
```

## What's done

- ✅ Governing docs: `CLAUDE.md`, `plan.md` (both tracks, 99 katas mapped + ticked).
- ✅ Scaffolding: running example, lab setup, glossary (506 terms), CIDR cheat-sheet,
  tag vocabulary (`reference/tags.md`).
- ✅ **ALL 99 katas written** — Track N (N01–N59) and Track S (S01–S40), every
  module complete. Built via a multi-agent workflow (generate→verify→fix) then put
  through a second independent adversarial accuracy pass; structurally linted
  (template, tags, sections), cross-refs/prereqs validated, glossary terms merged.
- ✅ Each kata tagged with a `> **Tags:**` line from the controlled vocabulary.
- ✅ Web app (`frontend/`) renders all katas; per-module commits pushed to `main`.

**Reference implementations of the template** (match these when editing): `N01`,
`N02`, `N03`, `S01` — the hand-written exemplars.

## What's next (optional / backlog)

1. **Azure backfill:** cloud katas stub Azure as `(Azure: TODO)` in places — fill
   when ready (doesn't block anything).
2. **Reference cheat-sheets still TODO:** `cheatsheet-ports.md`,
   `cheatsheet-cloud-map.md`, `cheatsheet-frameworks.md`.
3. Optional: deeper hands-on labs, diagrams, spaced-repetition review mode.

When writing any kata: open `CLAUDE.md` → copy the template → check `plan.md` for
prereqs/track → use the running example → verify every IP/CIDR/command/CLI flag →
tick the box in `plan.md` → add new terms to `glossary.md`.

## How to resume in one line

> "Read CLAUDE.md, plan.md, HANDOFF.md, and the three exemplar katas (N01, N03,
> S01). Then write the next batch of katas per plan.md, matching the exemplars'
> format and depth."

## Quality bar (don't regress)

- First principles before vendor names; concrete numbers over abstractions.
- Every kata ends with a **Talk to the IT/security head** drill — that's the
  differentiator, never skip it.
- Comparative GCP|AWS|Azure tables for cloud topics; stub Azure, don't block on it.
- Keep the **FSI/FMCG lens** (Meridian / Northwind) throughout.
- Defensive only — no offensive techniques against systems the learner doesn't own.

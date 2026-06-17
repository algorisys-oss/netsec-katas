# NetSec Katas

> A self-paced curriculum of small, repeatable, hands-on **networking** and
> **information-security** exercises — built to make solution/enterprise
> architects fluent enough to hold credible conversations with IT heads, network
> teams, and CISOs at banks, financial institutions, and large FMCGs.

A *kata* here = one focused concept + a worked example with real numbers + a
"say-it-back" self-check + a **"Talk to the IT/security head"** conversation
drill. Katas are meant to be *practiced and repeated*, not read once.

## Who it's for

Architects who design systems but did not come up through network or security
engineering, and who must challenge a design, estimate cost/latency/risk,
understand the IT head's constraints, and translate between business and
technical language — **not** to configure routers or run a SOC for a living.

The lens throughout is **FSI + FMCG**: regulated banks (PCI-DSS / RBI /
data-residency, segmentation, change-control) and sprawling consumer-goods firms
(cost pressure, SD-WAN, M&A network sprawl).

## What's inside

Two interleaved tracks, **99 katas**, all complete:

| Track | Katas | Arc |
|-------|-------|-----|
| **N — Networking** | N01–N59 (11 modules) | packet → subnet → routing → DNS/TLS/proxy → perimeter → data center → VPN/hybrid → cloud (GCP/AWS/Azure) → multi-cloud → observability → conversation capstone |
| **S — Information Security** | S01–S40 (11 modules) | security mindset → IAM → crypto/PKI → appsec/API → data & privacy → secops → resilience/IR → Zero Trust → GRC → cloud posture → conversation capstone |

Cloud topics are taught **comparatively** (on-prem | GCP | AWS | Azure), GCP
first. Azure is filled where certain and marked `(Azure: TODO)` otherwise.

See [`plan.md`](plan.md) for the full module/kata map and status.

## How to use it

**Read the katas** directly as Markdown under [`modules/`](modules/), or **run the
web app** for navigation, progress tracking, and search:

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The app is a React 19 + Vite + React Router 7 + shadcn/ui SPA with **no backend** —
it reads the kata Markdown straight from `modules/` at build time, so adding a
kata file makes it appear automatically. See [`frontend/README.md`](frontend/README.md).

Suggested path: work each track's modules **in order** (prereqs are cited per
kata), or follow the interleave in [`plan.md`](plan.md). Pen-and-paper / laptop
exercises are the default; steps needing a cloud account are marked
`[needs cloud account]`.

## The running example

Every kata reuses two fictional organizations so knowledge compounds — the
regulated bank **Meridian Bank** and the FMCG **Northwind** — defined once in
[`reference/running-example.md`](reference/running-example.md) (real CIDR blocks,
sites, and constraints reused everywhere).

## Repo structure

```
netsec-katas/
├── CLAUDE.md            # teaching contract: audience, pedagogy, kata template, conventions
├── plan.md             # curriculum map + status (source of truth)
├── HANDOFF.md          # pick-up-where-we-left-off briefing
├── reference/          # running example, lab setup, glossary (500+ terms),
│                       #   tag vocabulary, cheat-sheets
├── modules/
│   ├── networking/     # N01–N59, grouped by module
│   └── security/       # S01–S40, grouped by module
└── frontend/           # the web app (SPA, no backend)
```

## Kata format

Each kata follows one template (see [`CLAUDE.md`](CLAUDE.md)): a meta blockquote
(track, module, prereqs, time) plus a `> **Tags:**` line, then sections — *Why it
matters · The mental model · Worked example · Cloud/vendor mapping · Do it ·
Say it back · Talk to the IT/security head · Pitfalls & war stories · Going
deeper.* Tags come from the controlled vocabulary in
[`reference/tags.md`](reference/tags.md) and power search in the app.

## Contributing / extending

Read [`CLAUDE.md`](CLAUDE.md) first — it is the teaching contract (first
principles before vendor names, concrete numbers, the FSI/FMCG lens, defensive
content only). Match the reference katas **N01, N02, N03, S01**. Verify every
CIDR/IP/command/CLI flag before committing — wrong numbers destroy trust faster
than gaps. Update `plan.md` status and `reference/glossary.md` when you add a kata.

## Scope & safety

Educational and **defensive** only: the material builds understanding and
design/conversation skill, not techniques to attack systems you don't own.

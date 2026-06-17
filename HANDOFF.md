# HANDOFF — NetSec Katas

A pick-up-where-we-left-off briefing. Read this + `CLAUDE.md` + `plan.md` and you
have full context to continue in a fresh session.

_Last updated: 2026-06-17 (N0/N1 foundations completed)_

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

## Structure

```
netsec-katas/
├── CLAUDE.md                      # teaching contract — read first
├── plan.md                        # curriculum + status (source of truth)
├── HANDOFF.md                     # this file
├── reference/
│   ├── running-example.md   [x]   # Meridian Bank + Northwind FMCG — reuse everywhere
│   ├── lab-setup.md         [x]   # laptop toolchain (netshoot container, CLI tools)
│   ├── glossary.md          [~]   # starter; grow as katas are written
│   ├── cheatsheet-cidr.md   [x]   # subnetting ready-reckoner
│   ├── cheatsheet-ports.md  [ ]   # TODO
│   ├── cheatsheet-cloud-map.md [ ] # TODO (GCP↔AWS↔Azure↔on-prem)
│   └── cheatsheet-frameworks.md [ ] # TODO (NIST/ISO/PCI)
└── modules/
    ├── networking/
    │   ├── 00-why-networking/
    │   │   ├── kataN01-architects-stake.md                 [x]
    │   │   └── kataN02-whos-who.md                         [x]
    │   └── 01-packets-layers/
    │       ├── kataN03-osi-tcpip.md                        [x]
    │       ├── kataN04-encapsulation.md                    [x]
    │       ├── kataN05-ethernet-mac-arp-switching.md       [x]
    │       └── kataN06-tools-ping-traceroute-tcpdump.md    [x]
    └── security/
        ├── 00-security-foundations/kataS01-security-mindset.md [x]
        └── 01-iam/                                         (empty)
```

## What's done

- ✅ Governing docs: `CLAUDE.md`, `plan.md` (both tracks, 99 katas mapped).
- ✅ Scaffolding: running example, lab setup, glossary (starter), CIDR cheat-sheet.
- ✅ **3 exemplar katas** proving the format across both tracks:
  - `N01` — The architect's stake in the network
  - `N03` — OSI vs TCP/IP
  - `S01` — The security mindset (CIA, risk, defense in depth)

These three are the **reference implementations** of the kata template — match
their depth, structure, and the "Talk to the IT/security head" sections when
writing new ones.

- ✅ **Module N0/N1 foundations complete** (this batch): N02 (who's who), N04
  (encapsulation), N05 (Ethernet/MAC/ARP/switching), N06 (ping/traceroute/mtr/
  tcpdump). Glossary grown with their terms.

## What's next (recommended order)

1. **Module N2 (subnetting):** N07–N11 — highest-value networking skill;
   the CIDR cheat-sheet already backs it. Start here.
2. **In parallel, security S0:** S02 (who's who in security), S03 (threat modeling).
3. **Fill remaining reference cheat-sheets:** ports, cloud-map, frameworks.
4. Continue per `plan.md` **Suggested interleave** section.

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

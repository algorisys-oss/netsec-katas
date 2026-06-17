# CLAUDE.md — NetSec Katas

This file orients any Claude session working in this repository. Read it first.

## What this repo is

A self-paced **curriculum of "katas"** — small, repeatable, hands-on exercises —
covering **networking and information security** from first principles up through
enterprise on-premise and multi-cloud architecture.

A *kata* here = one focused concept + a concrete exercise + a "say-it-back" check
+ a "talk to the IT/security head" conversation drill. Katas are meant to be
*practiced and repeated*, not read once.

## Two tracks

| Track | Prefix | Folder | Covers |
|-------|--------|--------|--------|
| **Networking** | `N` | `modules/networking/` | packets, IP/subnetting, routing, DNS, proxies, load balancing, on-prem, cloud networking |
| **Information Security** | `S` | `modules/security/` | security mindset, IAM, crypto/PKI/KMS, appsec, data security, secops/SIEM, IR, GRC, cloud security posture |

The tracks **interleave and cross-reference** — e.g. networking Kata N21 (TLS)
underpins security Kata S04 (crypto/PKI); networking Kata N27 (segmentation)
pairs with security Kata S07 (Zero Trust). Numbering is **global within each
track** (N01.., S01..) so prereqs stay stable even as content is added.

## Who it is for (the learner)

**Solution / enterprise / software architects and client-facing technical staff**
who design or sell systems but did not come up through network engineering or
security, and who must hold **credible, efficient conversations with IT heads,
network teams, and CISOs/security teams** at:

- **Banks & financial institutions** — regulated, segmented, air-gapped zones,
  RBI/PCI-DSS/data-residency, heavy change-control, the CISO has veto power.
- **Large FMCGs** — sprawling sites, retail/plant connectivity, SD-WAN, M&A
  network sprawl, cost pressure, OT/IT separation.

The learner is **technical but not a specialist**. They need enough depth to ask
the right questions, challenge a design, estimate cost/latency/risk, understand
the other side's constraints, and translate between business and technical
language — *not* to configure routers or run a SOC for a living.

## The goal (what "done" looks like)

After working the katas, the architect / client-facing techie can:

1. Reason from packet → subnet → VPC → hybrid backbone, and from threat → control
   → compliance, without hand-waving.
2. Walk into a design or security review and ask the questions that expose risk.
3. Map a requirement to the right GCP / AWS / Azure construct or security control
   and name the trade-offs (cost, latency, blast radius, compliance).
4. Speak the IT head's *and* the CISO's language: their KPIs, fears, processes.

## Cloud coverage & priority

1. **GCP** — primary, taught first in each cloud kata.
2. **AWS** — taught alongside GCP (the comparison *is* the lesson).
3. **Azure** — added later; leave clearly marked `(Azure: TODO)` stubs. Do not
   block GCP/AWS content waiting on Azure.

Teach cloud concepts **comparatively** — a three-column model (GCP | AWS | Azure)
plus the **on-prem equivalent**, because the IT head thinks in on-prem terms
first. Same discipline for cloud security services.

## Pedagogy — how to teach here

- **First principles before products.** Teach the *problem* before any vendor's
  *named solution*. Vendor names are labels on concepts the learner should
  already understand.
- **Concrete over abstract.** Every concept gets a worked example with real
  numbers (real CIDR blocks, real IPs, real `dig` output, a real cert chain).
- **Comparative tables** for anything that exists in multiple clouds/vendors.
- **"Talk to the IT/security head" drill** in every kata: 3–5 questions to ask +
  what a good answer sounds like + red flags. This converts knowledge into
  *conversation capability* — the whole point of the repo.
- **Spaced repetition.** Katas reference earlier katas (`see N03`) and reuse the
  same running example so knowledge compounds.
- **Laptop-first & safe to practice.** Prefer exercises runnable on a laptop (CLI
  tools, containers, pen-and-paper). Mark cloud-account-only steps
  `[needs cloud account]`. Never include exercises that attack systems the
  learner doesn't own.

## Kata file format (use this template for every kata)

```markdown
# Kata <N|S>NN — <Title>

> **Track:** Networking|Security · **Module:** <name> · **Prereqs:** <ids> · **Time:** ~N min
> **Tags:** `tag-one` `tag-two` `tag-three`

## Why it matters
2–4 sentences. The business/architecture/risk stakes. Why it comes up with the
IT head or CISO.

## The mental model
First-principles explanation. ASCII diagrams. The on-prem/real-world reality first.

## Worked example
Concrete numbers / commands / output. Use the running example where possible.

## Cloud / vendor mapping (when applicable)
| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|

## Do it (the exercise)
Step-by-step, laptop-first. Mark [laptop] / [needs cloud account].

## Say it back (self-check)
3–5 questions the learner answers from memory.

## Talk to the IT/security head
Questions the architect should ask + what a good answer sounds like + red flags.

## Pitfalls & war stories
Common mistakes, especially FSI/FMCG-specific ones.

## Going deeper (optional)
Canonical links (RFCs, NIST, OWASP, official cloud docs).
```

## Repo conventions

- One kata per file: `modules/<track>/<NN-module>/kata<N|S>NN-<slug>.md`.
- Numbering is global **within a track** (N.. and S..) — don't renumber.
- Diagrams: ASCII first (renders everywhere, diffs cleanly). Mermaid only if it
  adds real value.
- The **running example** (Meridian Bank + Northwind FMCG) is defined once in
  `reference/running-example.md` and reused everywhere.
- Glossary in `reference/glossary.md`; link first use of each term.
- **Tags:** every kata carries a `> **Tags:**` line (second blockquote line)
  with 4–8 backtick-wrapped, lowercase-hyphenated tags for search. Draw from the
  controlled vocabulary in `reference/tags.md`; only coin a new tag when none
  fits, and add it to `tags.md` when you do.
- Cheat-sheets (CIDR, ports, cloud-construct map, security frameworks) in
  `reference/`.
- `plan.md` is the source of truth for sequence and status. Update it when a kata
  is added/changed.

## Git / commit conventions

- **No AI attribution in commits.** Do **not** add `Co-Authored-By: Claude ...`
  trailers, "Generated with Claude Code" lines, or any AI/tool hint to commit
  messages, PR bodies, or descriptions. Write commit messages as the human author.
- Keep messages concise and factual: what changed and why (e.g. "Add N07–N09
  subnetting katas; grow glossary"). No marketing, no emoji-noise.
- Commit or push only when the user asks.

## When asked to add or edit content

1. Check `plan.md` for where it fits, its track, and prereqs.
2. Follow the kata template exactly.
3. Teach GCP→AWS comparatively; stub Azure if not ready.
4. Keep the FSI/FMCG lens and the IT-head/CISO conversation framing.
5. Verify any command/CIDR/IP/cert/CLI flag you show is actually correct. Wrong
   numbers destroy trust faster than gaps.
6. Update `plan.md` status checkboxes.

## What NOT to do

- Don't dump vendor marketing. Teach the concept, name the product once.
- Don't assume CCNA/CISSP-level prior knowledge; don't condescend either.
- Don't let Azure-incompleteness block GCP/AWS progress.
- Don't invent IPs/output/certs that wouldn't actually occur — be exact.
- Don't include offensive techniques against systems the learner doesn't own;
  this is defensive, architecture-conversation material.

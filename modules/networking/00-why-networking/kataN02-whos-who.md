# Kata N02 — Who's who: IT head, network team, CISO

> **Track:** Networking · **Module:** N0 Why networking matters · **Prereqs:** N01 · **Time:** ~25 min

## Why it matters

A design doesn't fail because it's wrong on a whiteboard — it fails because the
person who owns the constraint you ignored says no in the review. At a bank or
FMCG, "the IT department" is really three or four organizations with different
KPIs, different fears, and a deliberate wall between them (segregation of duties).
If you walk in treating them as one, you'll pitch the firewall change to the
person who can't approve it and skip the person who can veto it. Knowing who owns,
fears, and measures what is the difference between a design that ships and one that
dies in change-control.

## The mental model

The people in the room map to layers of accountability, not layers of the stack:

```
   BUSINESS / CIO
        │  "deliver the digital channel, on time, on budget, no incidents"
        ▼
 ┌──────────────┬─────────────────┬───────────────────┐
 │   IT HEAD /  │   NETWORK TEAM  │   CISO / SECURITY │
 │  INFRA LEAD  │   (NetOps)      │   (GRC + SecOps)  │
 ├──────────────┼─────────────────┼───────────────────┤
 │ owns: uptime │ owns: circuits, │ owns: risk,       │
 │  budget, DR, │  routing, FW    │  controls, audit, │
 │  vendors     │  rules, DNS     │  incident response│
 └──────────────┴─────────────────┴───────────────────┘
        │  segregation of duties: net ≠ security ≠ app  │
        └──────── change-control board (CAB) gates it ──┘
```

**The key insight:** in a regulated shop these roles are *deliberately separated*.
The network team can build a path; the security team decides if it's allowed; an
app team consumes it; and a **change advisory board (CAB)** approves the actual
change window. No single person can both open a firewall and approve opening it —
that separation *is* a PCI/RBI control, not bureaucracy for its own sake.

### Who owns / fears / measures what

| Role | Owns | Fears | Measures (KPIs) |
|------|------|-------|-----------------|
| **IT head / Infra lead** | Budget, uptime, DR, vendor contracts, the org chart | An outage with their name on it; cost overrun; a failed audit | Availability (the "nines"), MTTR, cost vs budget, audit findings |
| **Network team (NetOps)** | Circuits (MPLS/internet), routers/switches, firewall rules, DNS, IP plan, load balancers | A change that breaks routing at 2 a.m.; a flat network they can't defend; address overlap | Link utilization, packet loss/latency, change success rate, ticket SLA |
| **CISO / Security** | Risk posture, security controls, policy, incident response, compliance evidence | A breach; an unsegmented CDE; an audit finding; shadow IT | # of incidents, mean time to detect/respond, % systems patched, open risks |
| **App / platform team** | The service, its SLAs, its deploys | Being blocked by infra; latency they can't fix | Deploy frequency, error rate, latency |
| **Cloud / platform eng** | Landing zone, VPCs, IAM, the cloud bill | Egress surprises; misconfig blast radius | Cloud cost, posture score, provisioning lead time |

### The fault lines you'll feel

- **NetOps vs Security:** NetOps wants the change to *work*; Security wants it
  *justified and logged*. Both must sign off; they don't always agree.
- **Speed vs control:** App/cloud teams measure deploy velocity; infra/security
  measure incidents and audit-cleanliness. Your design sits on that seam.
- **CapEx vs OpEx:** the IT head defends the MPLS circuit (sunk CapEx-style
  commitment); finance eyes the variable cloud bill. "Move it to cloud" can read
  as "strand my circuit investment."

## Worked example

Meridian Bank wants the new mobile-banking backend (GCP) to read balances from
the core in HQ-DC1 (see `reference/running-example.md`). One "simple" requirement
— *open a path from cloud to core* — touches every role:

| Step | Who must act | What they're really asking |
|------|--------------|----------------------------|
| New firewall rule cloud→core | **Network team** builds it | "Source, dest, port, and who approved this?" |
| Is the path allowed at all? | **CISO/Security** | "Does this widen the CDE? Is it least-privilege? Logged?" |
| Change window | **CAB / IT head** | "What's the rollback? Blast radius? Who's on the bridge?" |
| Region & data residency | **CISO + IT head** | "Does customer data stay in-country?" (see N29) |
| The API contract | **App team** | "Can we batch/cache so we're not chatty?" (see N01) |

If you pitch only the app team, the rule never gets built. If you pitch only
NetOps, Security vetoes it in review. The architect's value is *sequencing the
conversation* so each owner gets the question they can actually answer.

## Do it (the exercise) [laptop]

1. Take a real (or plausible) requirement: "expose service X to partner Y." List
   every role above and write the **one question each** would ask you. If you
   can't fill a row, that's a relationship you're missing at the client.
2. Draw the **approval path** for one firewall change at a regulated client:
   who requests → who builds → who approves → who audits. Mark where
   segregation-of-duties forces a hand-off.
3. For a system you know, identify **which KPI** each role is judged on, then ask:
   does your design make that number better or worse? (A design that raises the
   CISO's "open risks" count will be resisted, even if it's faster.)

## Say it back (self-check)

1. Name the three core roles and one KPI each is measured on.
2. What is *segregation of duties* and why can't one person both open and approve
   a firewall rule in a bank?
3. What does a CAB (change advisory board) gate, and why does it exist?
4. Where is the natural friction between NetOps and Security?
5. Why might an IT head resist "just move it to the cloud" for non-technical reasons?

## Talk to the IT/security head

**Ask:**
- "Who owns the firewall rule base, and who approves changes to it?" *(reveals the
  net/security split and the change process)*
- "What's your change process and typical lead time for a new network path?"
- "Which of your KPIs would this design move — and in which direction?"
- "Where does the network team's responsibility end and security's begin?"

**A good answer sounds like:** clear ownership and a named process ("NetOps
implements, Security approves via the CAB, changes go in the Thursday window,
rollback is documented"). They can state their own KPIs without hesitation.

**Red flags:** "we all just kind of do it" (no segregation — an audit finding
waiting to happen); nobody owns the rule base; no change process; or NetOps and
Security openly can't agree on who decides. These predict slow, contested delivery.

## Pitfalls & war stories

- Pitching a network change to the app team and discovering three weeks later it
  never reached the people who build or approve it.
- Designing something that quietly raises the CISO's open-risk count, then being
  surprised it's blocked — the resistance was rational, you just didn't see their
  scoreboard.
- Treating the CAB as red tape to route around. In FSI, bypassing change-control
  is itself a reportable control failure.
- Assuming the cloud team and the network team talk. At many clients they're
  separate orgs with separate tools and a thin, tense interface — your hybrid
  design lives exactly on that seam.

## Going deeper (optional)

- ITIL change-management basics (request → assess → authorize → implement →
  review) — the vocabulary CABs use.
- Revisit after N29 (compliance) and S02 (who's who in security) — the security
  side gets its own org chart.

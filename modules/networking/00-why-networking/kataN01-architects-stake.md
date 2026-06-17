# Kata N01 — The architect's stake in the network

> **Track:** Networking · **Module:** N0 Why networking matters · **Prereqs:** none · **Time:** ~20 min
> **Tags:** `networking` `first-principles` `cost` `latency` `blast-radius` `compliance` `conversation`

## Why it matters

Architects get judged on systems that work end-to-end, but the network is where
"works on my machine" goes to die. Latency, cost, blast radius, and compliance
are all decided by network choices — usually by *someone else* (the IT head, the
network team). If you can't reason about those choices, you either get overruled
or you ship a design that the network team quietly blocks for six weeks. This
kata frames the four levers you must be able to discuss.

## The mental model

Every architecture decision touches the network through four levers:

```
                 ┌─────────────────────────────────────────┐
   REQUIREMENT → │  LATENCY   COST   BLAST RADIUS   COMPLIANCE │ → DESIGN
                 └─────────────────────────────────────────┘
                         the network sets all four
```

1. **Latency** — distance and hops cost milliseconds. A "simple" call from a
   cloud region to an on-prem core banking system might cross a VPN, a firewall,
   two proxies, and 1,200 km of fiber. Users feel every hop.
2. **Cost** — in cloud, *moving data* is often pricier than storing or computing
   it. Cross-region and internet **egress** charges sink budgets silently. On-prem,
   the WAN circuit (MPLS) is a fixed monthly line item the IT head defends fiercely.
3. **Blast radius** — a flat network means one compromised host can reach
   everything. Segmentation limits the damage. "How far can this spread?" is a
   network question first.
4. **Compliance** — where data flows and where it rests is a *legal* constraint
   in FSI. Data residency, PCI segmentation, and audit trails are network design
   inputs, not afterthoughts.

The architect's job isn't to *own* these — it's to **reason about them out loud**
so the network team trusts you and the design survives review.

## Worked example

Meridian Bank (see `reference/running-example.md`) wants a new mobile-banking
backend in GCP that reads account balances from the core banking system in HQ-DC1.

| Lever | Naive design | What the network reality forces |
|-------|-------------|-------------------------------|
| Latency | "Just call the core API" | Each call crosses GCP→VPN→firewall→core: ~30–60 ms each way. Chatty calls = slow app. → cache / API aggregation. |
| Cost | "Stream all transactions to cloud for analytics" | Egress from on-prem + cross-cloud adds up fast. → aggregate on-prem, send summaries. |
| Blast radius | "Put the backend in the main VPC" | A breach there could reach the core. → isolated VPC, tight firewall, no flat path to CDE. |
| Compliance | "Use whatever region is cheapest" | Customer data must stay in-country. → region choice is fixed by law, not price. |

Notice: none of these are coding problems. All four are settled before a line of
application code is written.

## Do it (the exercise) [laptop]

1. Pick a system you've worked on. Write one sentence each on its **latency**,
   **cost**, **blast radius**, and **compliance** posture from a *network* angle.
2. For each, name **who** at the client would actually own that decision (IT head?
   network team? CISO? finance?). If you don't know, that's the gap this
   curriculum closes.
3. Measure real latency to feel it:
   ```bash
   ping -c 5 8.8.8.8                 # nearby
   ping -c 5 a-host-on-another-continent.example
   traceroute 8.8.8.8               # see the hops between you and "the cloud"
   ```
   Note how each hop and each 1,000 km adds milliseconds. That's your latency budget.

## Say it back (self-check)

1. Name the four network levers every architecture decision touches.
2. Why is *egress* cost often the surprise line item in cloud designs?
3. What does "blast radius" mean and which network technique limits it?
4. Give one example where compliance, not performance or cost, dictates a network
   choice.
5. Who typically owns each of the four levers at a bank?

## Talk to the IT/security head

**Ask:**
- "What's our current latency budget between cloud and the core systems?"
- "How is egress billed today, and has it ever surprised us?"
- "If this new service were compromised, what could it reach?" *(blast radius)*
- "What data-residency or PCI constraints apply to this data flow?"

**A good answer sounds like:** specific numbers and a clear segmentation story
("the CDE is isolated; cloud workloads land in a separate VPC with explicit
firewall rules and no route to the core except a brokered API").

**Red flags:** "the network is flat, it's easier"; "we don't track egress";
"latency hasn't been a problem" (said without data). These signal risk you'll
inherit.

## Pitfalls & war stories

- Designing chatty cloud↔on-prem call patterns and discovering the latency only
  in UAT. Batch and cache *by design*.
- Treating egress as free because compute felt cheap — then a monthly cloud bill
  dominated by data transfer.
- Assuming "the cloud region nearest me" is allowed. In FSI it frequently isn't.

## Going deeper (optional)

- AWS / GCP pricing docs — find the *data transfer / egress* pages and skim the
  per-GB cross-region and internet rates.
- Revisit this kata after N51 (the egress-cost trap) and N29 (compliance).

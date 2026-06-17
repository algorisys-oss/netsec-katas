# Kata N11 — IP planning at enterprise scale: overlap, RFC 6598, M&A

> **Track:** Networking · **Module:** N2 IP addressing & subnetting · **Prereqs:** N07, N08, N09 · **Time:** ~35 min
> **Tags:** `networking` `ipv4` `cidr` `rfc1918` `hybrid` `ipam` `fsi` `fmcg`

## Why it matters

The day an M&A closes, two address plans become one network — and if both sides
used `10.0.0.0/8` defaults, every VPN you try to build will route traffic to the
wrong side. At Meridian Bank, adding a cloud VPC whose range collides with
HQ-DC1 means routing black-holes and change freezes while the network team
untangles it. At Northwind, three acquired companies brought `10.50.0.0/16` with
them. These aren't exotic problems: overlapping RFC 1918 space is the #1 cause
of hybrid and M&A networking pain, and preventing it is an architectural
decision you must make *before* the first subnet is allocated, not after.

## The mental model

### Why overlap happens

RFC 1918 gives everyone three ranges to share from the same pool:

```
10.0.0.0/8         ~16.7M addresses   "the big one"
172.16.0.0/12      ~1M addresses      often skipped or confused
192.168.0.0/16     ~65K addresses     SOHO equipment default
```

Every router, cloud environment, and default config reaches for the same
addresses. Independently, two orgs both pick `10.0.0.0/8` — rational locally,
catastrophic when they need to talk to each other.

### What overlap actually breaks

When two hosts in different sites share the same IP prefix, every router that
must bridge them faces an irresolvable question: "which `10.50.x.x` do I mean?"

```
Site A: 10.50.0.0/16  ──────┐
                             ├── router: two routes to same prefix → RPF/longest-match ambiguity
Site B: 10.50.0.0/16  ──────┘
```

Options when you discover overlap mid-project:

1. **NAT on both sides** — hide each site behind a unique "translation" IP before
   routing. Works, but adds latency, breaks IP-logged audit trails, and is a
   compliance headache (the auditor sees NATed IPs in logs, not real hosts).
2. **Renumber one side** — painful but clean. The right long-term answer; often
   blocked by change-control and baked-in apps.
3. **Abandon connectivity** — sometimes the honest answer at M&A Day 1 while
   renumbering is planned.

### RFC 6598: the Carrier-Grade NAT range

`100.64.0.0/10` (100.64.0.0 – 100.127.255.255, ~4M addresses) was defined by
RFC 6598 for use by ISPs performing Carrier-Grade NAT (CGNAT). It is **not
RFC 1918** — it isn't "public," but it also isn't generally routable. Cloud
providers and SD-WAN vendors have adopted it for:

- **GCP:** proxy-only subnets and some Google-managed service ranges.
- **AWS:** pod CIDRs in EKS clusters that would otherwise exhaust a VPC.
- **SD-WAN overlays:** underlay management interfaces.

The architect's takeaway: `100.64.0.0/10` is available for use *inside* your
environment if RFC 1918 space is exhausted, but you must ensure your firewalls
and routers don't mistake it for a public Internet destination. It will not be
routed on the public Internet, so it must stay within your administrative domain.

### The right answer: a company-wide supernet allocation plan

Draw the allocation *once* from a master supernet, assign unique non-overlapping
blocks to every site and cloud environment *before* they are built, and store it
in an **IPAM** (IP Address Management) system. The pattern:

```
Company supernet: 10.0.0.0/8
│
├─ On-prem (10.0.0.0/10)       ← 10.0.0.0 – 10.63.255.255
│   ├─ DC / data center sites  10.10.0.0/16, 10.20.0.0/16, …
│   ├─ Branches                10.30.0.0/16
│   └─ Corp offices            10.40.0.0/16
│
├─ Cloud (10.64.0.0/10)        ← 10.64.0.0 – 10.127.255.255
│   ├─ GCP primary VPCs        10.100.0.0/14 (10.100–10.103.x)
│   ├─ AWS secondary VPCs      10.104.0.0/14 (10.104–10.107.x)
│   └─ Azure (reserved)        10.108.0.0/14
│
├─ M&A / quarantine (10.128.0.0/10)  ← for acquired orgs before renumbering
│
└─ Lab / dev / test (10.192.0.0/10)  ← never bleeds into prod
```

Reserving space *you don't use yet* is not waste — it is future-proofing.

## Worked example

### Meridian Bank: clean from day one

Meridian planned ahead (see `reference/running-example.md`):

```
HQ-DC1      10.10.0.0/16
DC2 (DR)    10.20.0.0/16
Branches    10.30.0.0/16   (further split to /24 per branch, see N09)
Corp        10.40.0.0/16
GCP         10.100.0.0/14  = 10.100.0.0 – 10.103.255.255
AWS         10.104.0.0/14  = 10.104.0.0 – 10.107.255.255
Azure (rsv) 10.108.0.0/14
```

Verify GCP range with Python [laptop]:

```bash
python3 -c "
import ipaddress as i
n = i.ip_network('10.100.0.0/14')
print('GCP supernet:', n)
print('First addr: ', n.network_address)
print('Last addr:  ', n.broadcast_address)
print('Total addrs:', n.num_addresses)
"
# GCP supernet: 10.100.0.0/14
# First addr:  10.100.0.0
# Last addr:   10.103.255.255
# Total addrs: 262144
```

No range in Meridian's plan overlaps any other — you can confirm by checking
that no two prefixes share a common sub-range:

```bash
python3 -c "
import ipaddress as i
nets = [
    '10.10.0.0/16', '10.20.0.0/16', '10.30.0.0/16', '10.40.0.0/16',
    '10.100.0.0/14', '10.104.0.0/14', '10.108.0.0/14',
]
nets = [i.ip_network(n) for n in nets]
for a in nets:
    for b in nets:
        if a != b and a.overlaps(b):
            print('OVERLAP:', a, b)
print('No overlaps found' if True else '')
"
# No overlaps found
```

### Northwind FMCG: the M&A overlap problem

Northwind acquired **Eastfield Foods**, which happened to also use `10.50.0.0/16`
— the same block Northwind's original distribution centers run on.

```
Northwind DC (Leeds):    10.50.1.0/24   warehouse management
Eastfield Foods (Derby): 10.50.1.0/24   also warehouse management  ← same!
```

Both are `/24`s within `10.50.0.0/16`. The VPN between the two sites sees
identical destination prefixes — packets meant for Northwind's WMS server at
`10.50.1.45` might reach Eastfield's server at `10.50.1.45`. Silent misdirection,
not a loud failure — the worst kind.

**Immediate mitigation:** NAT at the Eastfield edge, mapping Eastfield's
`10.50.0.0/16` to a temporary translation range (`10.180.0.0/16`) until a
renumbering project completes:

```
Eastfield host 10.50.1.45  →  appears as 10.180.1.45 to Northwind's routers
```

**Long-term fix:** allocate Eastfield a unique supernet block. Northwind should
have reserved a quarantine range (`10.128.0.0/10`) for exactly this scenario.

**RFC 6598 at Northwind:** The SD-WAN vendor uses `100.64.0.0/10` for underlay
management links between ~3,000 retail endpoints. Because this space is not
RFC 1918, it doesn't collide with any of Northwind's data ranges — one of the
reasons SD-WAN vendors chose this range deliberately.

### Detecting overlap before you build [laptop]

```bash
# Check if two networks overlap (Python stdlib — no install needed)
python3 -c "
import ipaddress as i
a = i.ip_network('10.50.0.0/16')
b = i.ip_network('10.50.0.0/16')
print('Overlap:', a.overlaps(b))   # True
"

# List subnets available in a supernet (e.g. unused /16s in 10.128.0.0/10)
python3 -c "
import ipaddress as i
quarantine = i.ip_network('10.128.0.0/10')
print('Quarantine range:', quarantine)
print('Num /16 blocks:', 2**(16-10))   # 64
"
# Quarantine range: 10.128.0.0/10
# Num /16 blocks:  64
```

## Cloud mapping

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Private address plan | RFC 1918 IPAM (Infoblox, phpIPAM, etc.) | VPC subnets draw from user-assigned CIDR; GCP VPCs are global, subnets are regional | VPC CIDR assigned at creation per region; cannot be changed easily | VNet address space assigned at creation; can add secondary spaces (Azure: TODO) |
| Non-overlapping enforcement | Manual policy + IPAM; no technical block | No built-in guardrail; peering will fail if ranges overlap | VPC peering rejects overlapping CIDRs at creation | VNet peering rejects overlapping spaces (Azure: TODO) |
| CGNAT / RFC 6598 use | SD-WAN underlay management interfaces | Alias IP ranges; Proxy-only subnets use `10.x` or RFC 6598 ranges | EKS pod CIDRs can use `100.64.0.0/10` to avoid VPC exhaustion | (Azure: TODO) |
| M&A quarantine pattern | NAT at site edge; renumber long-term | Create isolated VPC for acquired workloads; peer when renumbered | Create isolated VPC; use Transit Gateway with strict route tables | (Azure: TODO) |
| IPAM tooling | Infoblox, SolarWinds IPAM, phpIPAM | No native IPAM; use GCP IP Address Management (preview) or external | No native IPAM; AWS Network Manager + external; VPC IPAM (VPC IP Address Manager, GA since 2021) | (Azure: TODO) |

**AWS VPC IPAM** (released 2021) is the first native cloud IPAM — it lets you
allocate pools hierarchically so child VPCs draw from a pre-approved range.
GCP's equivalent is still maturing; most enterprise GCP users run external IPAM
against Shared VPCs (see N52).

## Do it (the exercise)

**Part A — Verify Meridian Bank's plan is collision-free [laptop]**

1. Open a terminal. Run the overlap-check script from the Worked example above
   with Meridian's seven ranges. Confirm no overlaps.
2. Add a hypothetical "Acquired FinTech" at `10.104.0.0/16` to the list. Re-run.
   Which production range does it overlap? (Answer: `10.104.0.0/14` — AWS VPCs.)
3. Assign the FinTech a safe quarantine address instead. Choose a `/16` from the
   `10.128.0.0/10` quarantine block. Verify it doesn't overlap anything.

**Part B — Northwind M&A triage [laptop / paper]**

1. Draw the collision: Northwind `10.50.0.0/16` vs Eastfield `10.50.0.0/16`.
   Mark the specific `/24`s that conflict.
2. Write the NAT mapping table for the interim: which Eastfield addresses map to
   which translated addresses using `10.180.0.0/16`.
3. Propose a permanent Eastfield allocation. Which supernet block would you use,
   and how many `/24` branches could it serve?

**Part C — RFC 6598 hands-on [laptop]**

```bash
# Is 100.64.0.0/10 really distinct from RFC 1918 ranges?
python3 -c "
import ipaddress as i
rfc1918 = [i.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']]
cgnat   = i.ip_network('100.64.0.0/10')
for r in rfc1918:
    print(f'{cgnat} overlaps {r}:', cgnat.overlaps(r))
"
# All three should print False — 100.64.x.x is a separate range.
```

## Say it back (self-check)

1. Why does an M&A integration fail even if both companies' networks are
   technically healthy in isolation? What is the root cause?
2. What is `100.64.0.0/10`, which RFC defines it, and why do cloud and SD-WAN
   vendors use it rather than RFC 1918 space?
3. Name two immediate mitigations when you discover an overlap after an
   acquisition closes — and the trade-off each one carries.
4. In Meridian Bank's plan, why are GCP (`10.100.0.0/14`) and AWS (`10.104.0.0/14`)
   on adjacent /14 blocks rather than a single /13? (Hint: think blast radius and
   independent routing.)
5. What is an IPAM system's job, and what breaks if you manage address allocation
   in a spreadsheet across 3,000 sites?

## Talk to the IT/security head

**Ask:**

- "Do you have a single source of truth for your IP allocations — an IPAM system
  — and who is the gatekeeper for new ranges?"
  *Good answer:* a named system (Infoblox, AWS VPC IPAM, phpIPAM), an owner, and
  a process for requesting a new block. *Red flag:* "we have a spreadsheet
  somewhere" — this predicts overlap on the next M&A or cloud VPC.

- "When the last acquisition closed, how did you handle the IP overlap? What
  is the current state — is renumbering complete or still NATed?"
  *Good answer:* a dated renumbering project, tracked in change-control, with a
  target completion date. *Red flag:* "we NAT'd it and forgot about it" — those
  NAT boxes become single points of failure and audit headaches years later.

- "What range do you have reserved for the next cloud environment or M&A entity
  you haven't built yet?"
  *Good answer:* a named, documented reserved range that isn't used for anything
  today. *Red flag:* "we'll deal with it when we get there" — this is how
  Northwind ended up with three overlapping `10.50.x.x` sites.

- "Do any firewall rules or ACLs reference the `100.64.0.0/10` range? What does
  your perimeter treat it as — internal, external, or blocked?"
  *Good answer:* a deliberate, documented policy. *Red flag:* blank stares —
  RFC 6598 space is often unclassified and falls through firewall rule gaps.

**Red flags to listen for overall:**
- Multiple teams maintain separate spreadsheets for IP allocation.
- No reserved block for cloud, future M&A, or DR.
- The network team and the cloud team are assigning ranges independently.
- "We have plenty of `10.x` space" — true until two acquisitions happen at once.

## Pitfalls & war stories

- **The silent misdirection.** When two sites share a /24, traffic sometimes
  *reaches a host* — just the wrong one. No connection refused, no ICMP error,
  just wrong data. This surfaces as an application bug that takes days to trace
  back to a routing table.

- **NAT is not a renumbering strategy.** NAT-as-mitigation accretes over years:
  three acquisitions, three NAT tiers, firewall rules that reference the
  translated IPs, audit logs that show only NATed addresses. By year five, nobody
  knows which real host generated which log line — a PCI-DSS audit finding.

- **The cloud team uses `10.0.0.0/8` without telling anyone.** Architects
  building cloud VPCs often pick arbitrary `10.x.x.x` ranges without checking
  the corporate IPAM. The collision surfaces when the hybrid interconnect is
  built — six months into the project.

- **RFC 6598 surprise at the firewall.** Many enterprise firewalls have default
  ACLs that block all non-RFC 1918 and non-public traffic. If an SD-WAN or cloud
  vendor sends traffic sourced from `100.64.x.x`, those packets are silently
  dropped. The symptom: intermittent connectivity to management interfaces.

- **Northwind's `192.168.0.0/16` sprawl.** When 3,000 retail sites run SOHO
  routers that default to `192.168.1.0/24`, every site is identical at L3. SD-WAN
  vendors solve this by treating all branch addresses as "behind NAT" at the edge
  — but it means no direct branch-to-branch routing, only hub-and-spoke, which
  limits what you can build.

## Going deeper (optional)

- **RFC 1918** (1996) — the original private-address specification.
- **RFC 6598** (2012) — defines `100.64.0.0/10` for CGNAT; §4 explains why it
  must not be used on the public Internet.
- **RFC 5737** — `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`:
  documentation-only ranges (safe to use in examples; never route them).
- AWS VPC IP Address Manager (IPAM) docs — the native AWS tool for hierarchical
  pool management; useful contrast with the external-IPAM model GCP assumes.
- Pairs with N09 (VLSM carving), N16 (NAT/PAT mechanics), N40 (cloud IP
  planning), and N41 (route tables and egress). Revisit N11 when you reach N43
  (VPC peering) — overlap rejection is enforced there.

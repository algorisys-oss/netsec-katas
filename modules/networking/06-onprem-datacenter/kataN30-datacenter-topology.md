# Kata N30 — Data center topology: 3-tier vs spine-leaf; oversubscription

> **Track:** Networking · **Module:** N6 On-prem & data center · **Prereqs:** N15, N26 · **Time:** ~35 min
> **Tags:** `networking` `data-center` `spine-leaf` `three-tier` `oversubscription` `on-prem` `high-availability` `east-west`

## Why it matters

When you propose moving a workload into a bank's data center — or challenge why
their new private-cloud build looks the way it does — the IT head will talk about
**spine-leaf vs 3-tier** and **oversubscription ratios**. These are not jargon to
deflect architects; they are real design choices that determine whether the
network can carry east-west traffic between application tiers, and whether latency
or a cabling budget limits what you can build. If you can name the model, ask the
right follow-on question, and spot the oversubscription ratio that makes a
proposed design unworkable, you will be the architect who actually helps rather
than the one being quietly patronized.

This kata also anchors the cloud networking katas ahead (N39–N42): cloud VPCs
mimic spine-leaf at hyperscale, and "region" vs "zone" maps directly to concepts
you will recognize once you have the on-prem mental model.

## The mental model

### Why topology matters: east-west vs north-south traffic

Traditional data center traffic was mostly **north-south** — from the internet
(or corporate WAN) down into the data center and back. Modern application
architectures (microservices, distributed databases, real-time analytics) are
dominated by **east-west** traffic — server talking to server within the data
center. The topology you choose has to match the dominant traffic pattern.

### 3-tier (access → distribution → core)

The classic model, designed for north-south traffic:

```
                        ┌──────────────────────┐
                        │    CORE SWITCHES      │  Layer 3 routing, inter-VLAN
                        │  (Catalyst 6500-era)  │  high-speed backplane
                        └──────────┬───────────┘
                                   │ uplinks (10G)
              ┌────────────────────┼────────────────────┐
              │                    │                    │
   ┌──────────┴───────┐  ┌────────┴─────────┐  ┌──────┴──────────┐
   │ DISTRIBUTION SW  │  │ DISTRIBUTION SW  │  │ DISTRIBUTION SW │  VLAN, ACL,
   │  (pair, per pod) │  │  (pair, per pod) │  │  (pair, per pod)│  inter-rack
   └──────────┬───────┘  └────────┬─────────┘  └──────┬──────────┘  routing
              │                   │                    │
        ┌─────┴────┐        ┌─────┴────┐        ┌─────┴────┐
        │ ACCESS   │        │ ACCESS   │        │ ACCESS   │  L2 to servers,
        │ switches │        │ switches │        │ switches │  one per rack
        │ (ToR)    │        │ (ToR)    │        │ (ToR)    │
        └──┬──┬────┘        └──┬──┬───┘        └──┬──┬────┘
           │  │                │  │                │  │
         servers             servers             servers
```

**The problem:** east-west traffic (server A in rack 1 → server B in rack 3)
travels *up* to distribution, possibly across the core, and back *down* — and the
hop count is path-dependent: racks under the same distribution pair are 2 switch
hops apart, but racks in different pods traverse access→distribution→core→
distribution→access, **up to four hops cross-pod**. Worse, paths are often
blocked by spanning-tree restrictions or mis-matched VLANs at the distribution
layer. The "two switches in a pod" pattern was the band-aid.

**Oversubscription** is built into 3-tier at every uplink. A typical access
switch has 48 × 1 Gbps downlinks to servers and 2 × 10 Gbps uplinks to
distribution. That is 48 Gbps of potential server traffic trying to share 20
Gbps of uplink: **oversubscription ratio of 48:20 = ~2.4:1**. If all 48 servers
blast traffic simultaneously, something waits. In practice most traffic is light;
the problem appears when one application bursts (a database backup, a batch job)
and surprises everyone.

### Spine-leaf (Clos fabric)

Designed for east-west traffic; every server is the same number of hops from
every other server:

```
  SPINE layer  (usually 2–4 switches, fully meshed)
  ┌──────────┐   ┌──────────┐
  │ SPINE-1  │   │ SPINE-2  │    Layer 3 everywhere; ECMP for
  └────┬─┬───┘   └───┬─┬────┘    all paths used simultaneously
       │ │           │ │
  ─────┼─┼───────────┼─┼──────────────
       │ │           │ │
  ┌────┴─┴────┐  ┌───┴─┴────┐  ┌─────┴──────┐
  │  LEAF-1   │  │  LEAF-2  │  │  LEAF-3    │  One leaf per rack
  └─────┬─────┘  └────┬─────┘  └────┬───────┘  (or logical group)
        │              │              │
      servers        servers        servers
```

Every leaf is connected to **every** spine. Traffic from Leaf-1 to Leaf-3 takes
exactly **two hops** via any spine — the same latency as Leaf-1 to Leaf-2. This
predictable, flat latency is why spine-leaf is mandatory for latency-sensitive
workloads (trading systems, real-time payments, distributed databases).

**ECMP (Equal-Cost Multi-Path)** — the routing trick that makes it work.
A packet from Leaf-1 can go to Spine-1 or Spine-2 with equal cost; the switch
hashes on src+dst IP (or L4 ports) to spread traffic across all spines. Bandwidth
scales by adding spine switches; you never need to re-cable leaves.

**Oversubscription in spine-leaf** is explicit and controlled. If each leaf has
48 × 25 Gbps server ports and 4 × 100 Gbps uplinks to spine, the ratio is:

```
  48 × 25 Gbps downlinks  =  1,200 Gbps
  4  × 100 Gbps uplinks   =    400 Gbps
  Oversubscription ratio  =  1,200 / 400  =  3:1
```

A 3:1 ratio is considered acceptable for mixed workloads. Storage and high-
performance computing environments target 2:1 or even 1:1 (non-blocking).
A 10:1 or higher is a red flag in regulated environments with compliance audit
trails depending on network capture.

### Choosing between them

| Factor | 3-tier | Spine-leaf |
|--------|--------|------------|
| Age of design | Pre-2012, common in legacy bank DCs | Post-2012, all modern builds |
| Traffic pattern fit | North-south dominant | East-west dominant |
| Latency predictability | Variable (path depends on VLAN/STP state) | Consistent (always 2 hops leaf-to-leaf) |
| Scalability | Add pods, complex; STP limits growth | Add a leaf, re-cable to all spines; linear |
| Protocol | Spanning tree (L2) + OSPF/EIGRP (L3) | L3 everywhere; ECMP; often BGP unnumbered |
| Failure blast radius | Distribution switch failure takes a pod | Single leaf failure takes one rack |
| Cost | Legacy hardware, often already sunk | Newer whitebox/merchant-silicon switches |

### Oversubscription — the number that matters

Oversubscription is the ratio of *potential* bandwidth at the server ports to
*actual* bandwidth available on uplinks. It is **not bad by default** — it
reflects the statistical reality that not all servers transmit simultaneously.
What makes it dangerous is when:

1. The ratio is hidden or unknown (nobody measured it).
2. Applications have changed (microservices talk much more east-west than
   the old three-tier app did).
3. The ratio is 10:1 or higher and someone then runs a distributed database or
   a compliance packet-capture tool that must see 100% of traffic.

## Worked example

### Meridian Bank — HQ-DC1 upgrade decision

Meridian Bank's HQ-DC1 (`10.10.0.0/16`, see `reference/running-example.md`)
runs a legacy 3-tier fabric installed in 2009. The network team has quoted an
upgrade. Here is how to read the numbers they bring:

**Current (3-tier, legacy):**

```
  Core:         2 × Catalyst 6509   (VSS pair, 720 Gbps backplane each)
  Distribution: 6 × Catalyst 4507R  (one pair per pod — 3 pods)
  Access:       48 × Catalyst 3750  (48 × 1G downlinks, 2 × 10G uplinks)
  Servers:      384 total (8 racks per pod × 3 pods × 16 servers per rack)
```

Oversubscription at access layer:
```
  48 × 1 Gbps = 48 Gbps server bandwidth
  2  × 10 Gbps = 20 Gbps uplink bandwidth
  Ratio: 48/20 = 2.4:1   ← still reasonable for north-south
```

But PCI-DSS compliance requires full packet capture (from the IDS sensors) for
all traffic through the CDE segment (`10.10.20.0/24`). When the security team
ran a compliance audit and enabled port mirroring on the access switches for the
CDE rack, the distribution uplinks saturated at 80% — the 2.4:1 ratio had not
left headroom for mirror traffic.

**Proposed (spine-leaf, merchant silicon):**

```
  Spine:  4 × 100G Arista 7280CR2 (each terminates 32 leaves × 2 links = 64 × 100G leaf-facing ports)
  Leaf:   32 × 48-port Arista 7050X3 (48 × 25G server, 8 × 100G uplinks)
  Servers: 32 racks × 48 servers = 1,536 servers at full build
```

Oversubscription at leaf:
```
  48 × 25 Gbps = 1,200 Gbps server bandwidth
  8  × 100 Gbps = 800 Gbps uplink bandwidth
  Ratio: 1,200/800 = 1.5:1   ← comfortable for compliance capture headroom
```

East-west latency (e.g., payment service calling fraud engine):
- Old 3-tier: variable, 2–6 hops, sometimes 500 µs–2 ms depending on STP state.
- Spine-leaf: exactly 2 hops (leaf → spine → leaf); consistently ~5–10 µs
  switching latency end-to-end within the fabric.

For Meridian's real-time payment processing — where the fraud engine must respond
within 50 ms before the customer's payment times out — cutting intra-DC latency
from "up to 2 ms variable" to "10 µs consistent" is an architecture-level
improvement, not a nice-to-have.

### Northwind — plant network (OT/IT boundary)

Northwind's manufacturing plants (`10.50.0.0/16`, see `reference/running-example.md`)
run 3-tier switching from multiple M&A acquisitions. The plant floor (OT) and
corporate (IT) segments are separated — but on the same physical distribution
layer. This is a red flag: a misconfigured VLAN trunk or spanning-tree failure
at the distribution switch can accidentally bridge IT and OT traffic. The
upgrade to spine-leaf would physically separate the OT leaf from IT leaves, with
the firewall as the only path between them (pairs with N27 segmentation).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Physical fabric topology | Spine-leaf Clos within each data center | Jupiter fabric (proprietary spine-leaf) — invisible to you; surfaces as zone-level bandwidth | Same physical principle; exposed as Availability Zone bandwidth guarantees | (Azure: TODO) |
| East-west latency guarantee | ~5–10 µs intra-fabric (spine-leaf); no SLA on 3-tier | Sub-ms within a zone; ~1–2 ms cross-zone same region | ~0.5–1 ms within an AZ; cross-AZ ~1–2 ms | (Azure: TODO) |
| Oversubscription visible to you | Yes — ask the network team for the ratio | No — Google absorbs it; you pick bandwidth tiers per VM | Partially — "enhanced networking" / "placement groups" give you denser bandwidth | (Azure: TODO) |
| Non-blocking / dedicated bandwidth | 1:1 ratio switches for HPC/storage clusters | Compact placement policy collocates VMs in a zone for low-latency/HPC; C3/bare-metal with up to 200 Gbps Tier_1 networking | Cluster placement groups within an AZ; gives lowest latency; no cross-AZ | (Azure: TODO) |
| Pod / availability zone | Pod = a physical failure domain in a DC | Zone = independent power/cooling/network; a DC building | Availability Zone = one or more distinct DCs per region | (Azure: TODO) |
| Spanning-tree | STP/RSTP/MST — on 3-tier legacy; absent on spine-leaf | Not used; L3 everywhere in the fabric | Not used in the underlying fabric | (Azure: TODO) |

The key take-away for cloud comparisons: when you pick a GCP zone or AWS AZ, you
are picking a *physical failure domain* — which is the cloud expression of the
on-prem concept of a DC pod with its own spine-leaf fabric.

## Do it (the exercise)

**Part 1: Topology on paper [laptop / paper]**

1. Draw a 3-tier topology for a small DC: 1 core pair, 2 distribution pairs,
   4 access switches (2 per distribution pair), 8 servers per access switch.
   Label uplink speeds: 1G server NIC, 10G access→distribution, 40G
   distribution→core. Calculate the oversubscription ratio at the access layer
   and at the distribution layer.

2. Redraw as spine-leaf: 2 spines, 4 leaves, 8 servers per leaf. Use 10G
   server NICs, 4 × 40G leaf uplinks. Calculate the leaf oversubscription ratio.
   Confirm all four leaves are exactly 2 hops from each other.

3. Identify which topology you would recommend for:
   - A batch-processing cluster (nightly ETL, not latency-sensitive).
   - A real-time payments hub that calls five downstream services per transaction.
   - A CCTV/physical-security recording server (one-way, high-bandwidth north-south).

**Part 2: Read a real fabric config [laptop]**

On Linux, inspect your own machine's NIC bonding or multi-path:

```bash
# See all network interfaces and their speeds
ip link show

# If on a multi-NIC Linux server, check bonding
cat /proc/net/bonding/bond0 2>/dev/null || echo "no bond configured"

# On a Mac
networksetup -listallhardwareports
```

This shows you L1/L2 — the physical layer under the topology. Note the MTU
(usually 1500, sometimes 9000 for jumbo frames on storage networks).

**Part 3: Calculate oversubscription for Meridian Bank's proposed upgrade
[laptop / paper]**

The network team proposes 32 leaf switches, each with 48 × 25G server ports and
8 × 100G spine uplinks, connected to 4 spine switches.

1. What is the leaf-level oversubscription ratio?
2. If only 50% of server ports are populated today (24 servers per leaf), what
   is the *effective* oversubscription?
3. The compliance team needs to mirror 10% of CDE traffic (`10.10.20.0/24`)
   to a capture probe. If CDE servers average 5 Gbps each and there are 48 in
   the CDE leaf, does the headroom on the 8 × 100G uplinks support the mirror
   traffic? Show the math.

*(Answers: 1. 1,200/800 = 1.5:1 · 2. 600/800 < 1:1 — non-blocking with
24 servers · 3. Mirror = 48 × 5 Gbps × 10% = 24 Gbps; uplink headroom =
800 Gbps − (48 × 5 Gbps) = 800 − 240 = 560 Gbps available; 24 Gbps mirror
fits easily. Yes.)*

## Say it back (self-check)

1. Draw the 3-tier topology from memory and name the three layers. What protocol
   prevents loops at the access/distribution boundary in a 3-tier design?

2. What is oversubscription? If an access switch has 48 × 10G server ports and
   4 × 25G uplinks, what is the oversubscription ratio?
   *(48 × 10 = 480 Gbps; 4 × 25 = 100 Gbps; ratio = 4.8:1)*

3. Why does spine-leaf guarantee every server pair is exactly two hops apart?
   What routing mechanism uses all spine paths simultaneously?

4. In what workload scenario would you accept a 10:1 oversubscription ratio?
   In what scenario is 3:1 already dangerous?

5. What is the cloud equivalent of an on-prem DC pod with its own spine-leaf
   fabric?

## Talk to the IT/security head

**Ask — and what a good answer sounds like:**

- **"Is your data center fabric 3-tier or spine-leaf, and how old is the design?"**
  Good answer: "We're on spine-leaf, migrated in [year]; our access-layer ratio
  is X:1." Red flag: "I'm not sure" or "we have a mix" with no plan — a mix
  often means unknown oversubscription and inconsistent east-west latency.

- **"What is the oversubscription ratio at the access layer, and has it been
  re-evaluated since you went to microservices?"**
  Good answer: a specific number, awareness of east-west growth, and a recent
  measurement. Red flag: "We haven't changed it since 2015" — application
  traffic patterns have almost certainly changed since then.

- **"Does your compliance packet-capture / IDS feed see 100% of CDE traffic,
  and does the network headroom support it without dropping frames?"**
  Good answer: "Yes — we sized the oversubscription to include mirror traffic
  in the budget; here is the utilization graph." Red flag: "The IDS is on a
  span port on the core, so it sees most things" — 'most' is not
  PCI-DSS-compliant when complete capture is required.

- **"On the spine-leaf, how many spines do you have, and what happens if one
  fails?"**
  Good answer: "Four spines; losing one reduces bandwidth by 25% but no
  connectivity is lost because ECMP re-balances." Red flag: "Two spines, and
  we haven't load-tested the failover" — a two-spine design with no headroom
  means a spine failure may cause congestion even if it does not cause a black
  hole.

- **"How is the OT network separated from IT at the switching layer?"**
  (For Northwind / any FMCG or utility) Good answer: "OT is on a separate leaf,
  the only path to IT is through a firewall." Red flag: "They are on separate
  VLANs on the same distribution switch" — a misconfigured trunk can collapse
  that boundary.

**Red flags to listen for (any client):**
- "Our oversubscription ratio is fine — it's always been fine." (Not measured.)
- "East-west latency? We've never had complaints." (Has never been instrumented.)
- Inability to say how many uplinks a leaf/access switch has. (Design not owned.)

## Pitfalls & war stories

- **The compliance mirror that killed the network.** A large FSI enabled port
  mirroring on all CDE access switches simultaneously during an audit — doubling
  their effective traffic — and drove the distribution uplinks to 100%. Batch
  jobs failed; the team blamed the app. The root cause was a 4:1 oversubscription
  that looked fine until compliance tooling was counted as traffic. Lesson:
  always include monitoring and capture in your oversubscription budget.

- **3-tier STP instability.** Classic spanning-tree (802.1D) convergence on a
  large 3-tier fabric can take 30–50 seconds (Max Age 20s + 2 × Forward Delay
  15s = 50s). Rapid PVST+ / RSTP (802.1w) normally converges in ~1–2 seconds —
  but you only get that if every switch stays in RSTP; a switch that falls back
  to classic STP, or a topology-change-notification storm from a misconfigured
  switch, drags you back to the slow regime. In a bank, "30 seconds dark" is an
  incident. Spine-leaf eliminates this failure mode by running L3 everywhere.

- **The M&A spine-leaf that was really just re-labeled 3-tier.** Northwind
  acquired a company that claimed "spine-leaf" — and the diagram looked right —
  but the spines were not fully meshed to all leaves (cost saving during build).
  Two leaves were connected to only one spine. When that spine failed, those
  servers were isolated. Always ask: "Are all leaves connected to all spines?"

- **Oversubscription ratio that assumed 1G servers — now running 10G.** A DC
  designed in 2012 for 1G server NICs was upgraded to 10G server NICs in 2020,
  but the uplinks stayed the same. The oversubscription went from 2.4:1 to
  24:1 overnight. Nobody recalculated. This is the single most common legacy
  DC time-bomb.

- **Jumbo frames misconfiguration.** Spine-leaf storage networks often run
  9,000-byte MTU (jumbo frames) for iSCSI or NFS. If even one switch in the
  path is misconfigured at 1,500 MTU, storage traffic fragments or drops silently
  — latency appears to spike intermittently and is very hard to diagnose without
  packet capture. (See N04 for MTU/MSS background.)

## Going deeper (optional)

- **Clos networks** (original paper): Charles Clos, "A Study of Non-Blocking
  Switching Networks," *Bell System Technical Journal*, 1953. Spine-leaf is a
  two-stage Clos topology.
- **RFC 7938** — "Use of BGP for Routing in Large-Scale Data Centers" — the
  standard for BGP unnumbered in a spine-leaf fabric.
- **ECMP hashing and flow pinning:** Juniper and Arista have good public docs on
  how ECMP hashes TCP flows to avoid reordering (relevant when your database
  sees asymmetric latency on multi-path fabrics).
- **GCP Jupiter fabric** — Google's public paper "Jupiter Rising: A Decade of
  Clos Topologies and Centralized Control in Google's Datacenter Network" (2015,
  SIGCOMM) explains how hyperscale spine-leaf works. Reading it grounds the cloud
  networking katas (N39 onward).
- Pairs with: **N31** (HA and redundancy — what happens when a spine/leaf fails),
  **N27** (segmentation — how VLANs and zones map onto leaf boundaries),
  **N15** (VLANs — how L2 domains map onto access vs leaf switches).

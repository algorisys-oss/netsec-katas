# Kata N13 — Static vs dynamic routing; intro to OSPF

> **Track:** Networking · **Module:** N3 Routing & switching · **Prereqs:** N12, N08, N09 · **Time:** ~35 min
> **Tags:** `networking` `routing` `static-routing` `ospf` `l3-network` `on-prem` `fsi` `meridian-bank`

## Why it matters

A routing table tells a packet where to go next, but someone — or something —
has to fill that table in. At a bank with dozens of VLANs and a hybrid cloud
edge, the question "who manages your routes and how?" reveals whether the
network can adapt to change without a maintenance window. Static routes are
simple and auditable (a CISO loves them), but they don't heal when a link
fails. Dynamic routing protocols like OSPF fill tables automatically and
re-converge in seconds after a failure — but that automation must be
understood and trusted before a regulated shop will deploy it. Knowing the
difference lets you challenge the design, ask the right question in the DR
review, and avoid the classic mistake of mixing the two carelessly.

## The mental model

### The problem: how does a router know where to send a packet?

A router is nothing more than a device that looks up a destination IP in a
table and forwards the packet out the matching interface. The table has three
possible sources:

```
1. DIRECTLY CONNECTED  — the router owns that subnet on one of its interfaces.
                         No configuration needed; the OS adds it automatically.

2. STATIC ROUTE        — an admin typed "to reach X, use next-hop Y."
                         Simple. Predictable. Breaks silently if Y goes down.

3. DYNAMIC ROUTE       — a routing protocol heard it from a neighbor router.
                         Self-healing. Scales. Requires understanding & trust.
```

The routing table is a ranked list. When a packet arrives, the router picks
the **longest prefix match** — the most specific entry that covers the
destination — regardless of how the route was learned.

```
Destination        Next-hop    Source      Metric
─────────────────────────────────────────────────
10.10.0.0/16       via eth0    connected   0
10.20.0.0/16       10.10.1.1   OSPF        110 / cost 2
10.30.0.0/16       10.10.1.1   static      —
0.0.0.0/0          10.10.0.1   static      —   ← default route (catch-all)
```

Longest-prefix match example: a packet to `10.10.5.7` matches both
`10.10.0.0/16` and `0.0.0.0/0`; the `/16` is more specific, so it wins.

### Static routing — the accountant's choice

An admin manually adds each route:

```bash
# Linux (iproute2) — add a static route to the DC2 subnet via the WAN router
ip route add 10.20.0.0/16 via 10.10.1.1 dev eth1
```

**Strengths:**
- Zero protocol overhead; no routing traffic on the wire.
- Fully deterministic — auditors can read the config and know exactly what
  traffic goes where. PCI/RBI auditors appreciate this.
- No risk of a misconfigured neighbor injecting a bad route.

**Weaknesses:**
- Each route is manually maintained. 50 subnets = 50 lines to keep in sync.
- No automatic failover. If the next-hop goes down, the route stays in the
  table pointing at a dead end. Traffic blackholes silently.
- Doesn't scale past a handful of routers without becoming error-prone.

**When to use it:**
- Default routes on stub sites (branches, cloud subnets with one exit).
- Point-to-point links where there's only one path anyway.
- Anywhere you want explicit, auditable control and don't need failover.

### Dynamic routing — the self-healing network

Routers running a dynamic protocol advertise their connected subnets to
neighbors. Each router builds a complete picture of the network and picks the
best path. When a link fails, neighbors notice, re-run the algorithm, and
update their tables — typically in seconds.

The main protocols you'll encounter:

| Protocol | Full name | Scope | Who runs it |
|----------|-----------|-------|-------------|
| **OSPF** | Open Shortest Path First | within one org (intra-AS) | enterprise, DC, campus |
| **EIGRP** | Enhanced Interior Gateway Routing Protocol | within one org | Cisco-only legacy |
| **BGP** | Border Gateway Protocol | between orgs / internet / cloud edge | ISPs, cloud, multi-homed sites |
| **IS-IS** | Intermediate System to IS | within one org | service providers, some DCs |

OSPF is the industry default for enterprise routing within a single
organization. BGP is covered in N14; it's what runs the internet and what your
cloud interconnect speaks.

### OSPF — first principles

OSPF (RFC 2328 for IPv4 / OSPFv2; RFC 5340 for IPv6 / OSPFv3) is a
**link-state** protocol. Every router learns the entire topology and runs
**Dijkstra's shortest-path algorithm** locally to compute the best route to
every destination.

The three steps:

```
1. DISCOVER NEIGHBORS
   Routers send "Hello" multicast packets (224.0.0.5) on each OSPF-enabled
   interface every 10 s (default). Neighbors form an adjacency if:
   - same Area ID
   - same Hello/Dead timer intervals
   - same subnet mask on that link

2. FLOOD LINK-STATE ADVERTISEMENTS (LSAs)
   Each router originates an LSA describing its links and costs.
   LSAs flood to all routers in the same OSPF area.
   Every router ends up with an identical Link-State Database (LSDB).

3. RUN DIJKSTRA (SPF)
   Each router independently computes the shortest path tree from itself
   to every destination. Cost = sum of interface costs along the path.
   Default cost = 10^8 / interface_bandwidth_bps
     (a 100 Mbps link → cost 1; a 1 Gbps link → cost 1; 10 Mbps → cost 10)
   Modern networks often override this manually since 100M and 1G both map
   to cost 1 by default — check your reference-bandwidth setting.
```

**Convergence:** when a link fails, the router on each side sends an updated
LSA. Neighbors re-flood it, re-run SPF, and install new routes. The process
typically completes in 1–3 seconds with default timers; tunable to sub-second
with BFD (Bidirectional Forwarding Detection).

**Areas:** OSPF scales via **areas**. Area 0 (the backbone) is mandatory.
Other areas (1, 2, …) attach to Area 0 via **ABRs** (Area Border Routers).
LSA flooding is contained within an area, so a large network doesn't drown
every router in topology updates.

```
      Area 1         Area 0 (backbone)      Area 2
   (branches)           (DC core)          (cloud edge)
 ┌──────────┐       ┌──────────────┐       ┌──────────┐
 │  R-BR1   ├──ABR──┤  R-DC1-CORE ├──ABR──┤ R-GCP-GW │
 │  R-BR2   │       │  R-DC2-CORE │       └──────────┘
 └──────────┘       └──────────────┘
```

For a single site or small network, putting everything in Area 0 is fine and
simplest. Multi-area is an optimization for scale (hundreds of routers).

## Worked example

Meridian Bank's network has three routing domains to connect (see
`reference/running-example.md` for IP ranges):

```
HQ-DC1:   10.10.0.0/16    (primary DC — core banking)
DC2:      10.20.0.0/16    (DR site)
Branches: 10.30.0.0/16    (220 branches, /24 each)
Corp:     10.40.0.0/16    (corp offices)
GCP:      10.100.0.0/14   (cloud — non-overlapping, per the IP plan)
```

### Routing strategy by zone

| Zone | Routing method | Reason |
|------|---------------|--------|
| HQ-DC1 ↔ DC2 (core) | **OSPF Area 0** | Two equal MPLS paths; OSPF load-balances and auto-fails over |
| DC core → branches | **OSPF Area 1** (branches as stubs) | 220 branches summarised into one aggregate; not all branches need full topology |
| Branch sites | **Static default route** → nearest MPLS PE | Each branch has one exit; no dynamic protocol needed on CPE |
| DC core → GCP | **Static route** (or BGP via Cloud Router) | Cloud Router speaks BGP (see N14); from the DC side, a static pointing at the interconnect is the simplest safe choice |

### What the routing table looks like on DC1's core router

```
Destination       Next-hop          Proto   Cost / AD
────────────────────────────────────────────────────────
10.10.0.0/16      directly connected  C       0
10.10.1.0/24      directly connected  C       0         ← server VLAN
10.10.10.0/24     directly connected  C       0         ← DB VLAN
10.20.0.0/16      10.10.255.2        OSPF    110 / 2   ← learned from DC2 router
10.30.0.0/16      10.10.255.2        OSPF    110 / 3   ← aggregate from Area 1 ABR
10.40.0.0/16      10.10.255.6        OSPF    110 / 2   ← corp
10.100.0.0/14     10.10.254.1        static  1         ← GCP via interconnect
0.0.0.0/0         10.10.0.1          static  1         ← internet / fallback
```

`10.10.255.2` is the OSPF neighbor (DC2) on the DC1↔DC2 MPLS handoff link
(`/30` point-to-point — 4 addresses, 2 usable). 10.10.255.0/30: .0 = network,
.1 = DC1 side, .2 = DC2 side, .3 = broadcast. The corp link is a separate
point-to-point `/30`, 10.10.255.4/30: .4 = network, .5 = DC1 side, .6 = corp
side, .7 = broadcast — so `10.10.255.6` is the corp router next-hop.

### Administrative distance (AD) — what wins when two protocols know the same route?

When a router learns the same prefix from two sources, the **administrative
distance** breaks the tie (lower = more trusted):

| Source | AD (Cisco default; Linux metric varies) |
|--------|----------------------------------------|
| Directly connected | 0 |
| Static route | 1 |
| OSPF | 110 |
| BGP (eBGP) | 20 |
| BGP (iBGP) | 200 |

A static route (AD 1) beats an OSPF route (AD 110) for the same prefix.
This is why a misconfigured static can silently override a dynamic route —
dangerous in a failover scenario.

### OSPF neighbor output (what the network engineer will show you)

```
# show ip ospf neighbor   (Cisco IOS syntax)

Neighbor ID     Pri   State           Dead Time   Interface
10.20.1.1        0    FULL/  -        00:00:31    GigabitEthernet0/0
10.40.1.1        0    FULL/  -        00:00:38    GigabitEthernet0/1

# State "FULL" = adjacency complete, LSDB synchronized — healthy.
# "FULL/  -" with no DR/BDR role = a point-to-point link (the /30s above):
#   no DR election happens, so the role column is blank.
# State "EXSTART" or "LOADING" = negotiating — still converging.
# Empty neighbor list = no adjacency — check: same area? same timers? same subnet?
```

On a **broadcast segment** (Ethernet), OSPF elects a **Designated Router
(DR)** and **Backup DR (BDR)** to reduce LSA flooding. All other routers only
form full adjacencies with the DR/BDR, not with each other. On point-to-point
links (/30, /31), there is no DR/BDR election — both sides go directly to
FULL state.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Static routes | `ip route add` (Linux) / `ip route` (IOS) | VPC route table — add custom route | VPC route table — add static route | (Azure: TODO) |
| Dynamic routing (BGP) | OSPF internal; BGP at edge | **Cloud Router** — managed BGP peer for Interconnect / VPN | **Virtual Private Gateway** or **Transit Gateway** with BGP | (Azure: TODO) |
| OSPF inside cloud | Not a cloud construct | Not used in GCP VPC (cloud is a flat L3 fabric) | Not used in AWS VPC | (Azure: TODO) |
| Route advertisement to on-prem | OSPF redistribution + BGP | Cloud Router advertises VPC subnets via BGP over Interconnect | VGW/TGW advertises VPC CIDRs via BGP over Direct Connect | (Azure: TODO) |
| Route priority / preference | Administrative distance | Priority field on route; longest-prefix wins | Longest-prefix wins; route priority via multiple route tables | (Azure: TODO) |

**Key insight for cloud:** cloud VPCs do not run OSPF internally. The fabric is
a fully-distributed software router — every VM already has reachability to
every other VM in the VPC without a routing protocol. OSPF only appears at the
**edge** (on-prem side of the interconnect) where a real router (or virtual
appliance) hands off routes via BGP to the Cloud Router. This is why N14 (BGP)
is the cloud-relevant protocol, while N13 (OSPF) is the enterprise-LAN
protocol.

## Do it (the exercise)

### Part 1 — read a routing table [laptop]

On any Linux machine (your laptop, a container, a VM):

```bash
ip route show
```

Identify each route:
- Which are **directly connected** (no via)?
- Which have a **via** (next-hop) — static or dynamic?
- Which is the **default route** (`0.0.0.0/0` or `default`)?
- What is the longest-prefix match for `10.10.5.7` if your table includes
  both `10.0.0.0/8` and `10.10.0.0/16`?

### Part 2 — add and remove a static route [laptop]

```bash
# Add a static route (use a non-routable range so it doesn't affect real traffic).
# Point it out the loopback device — the kernel rejects 127.0.0.1 as a *gateway*,
# but "dev lo" installs cleanly and is enough to see the route appear.
sudo ip route add 192.0.2.0/24 dev lo

# Verify it appeared
ip route show | grep 192.0.2

# Try to reach it (it will time out — nothing answers on lo for this range —
# but the route exists and is selected for 192.0.2.0/24 traffic).
ping -c 1 -W 1 192.0.2.1

# Remove it
sudo ip route del 192.0.2.0/24 dev lo

# Alternative: a blackhole route that silently drops matching traffic
#   sudo ip route add blackhole 192.0.2.0/24
#   sudo ip route del   blackhole 192.0.2.0/24
```

Note: `192.0.2.0/24` is **TEST-NET-1** (RFC 5737) — documentation range,
safe to use in exercises; never routed on the public internet.

### Part 3 — observe OSPF in a two-router namespace lab [laptop]

This uses Linux network namespaces to simulate two routers without any
additional hardware or VMs.

```bash
# Create two "routers" as network namespaces
sudo ip netns add router1
sudo ip netns add router2

# Create a virtual Ethernet pair connecting them (simulates a /30 link)
sudo ip link add veth-r1 type veth peer name veth-r2
sudo ip link set veth-r1 netns router1
sudo ip link set veth-r2 netns router2

# Assign the /30 link addresses: .1 = router1, .2 = router2
sudo ip netns exec router1 ip addr add 10.10.255.1/30 dev veth-r1
sudo ip netns exec router2 ip addr add 10.10.255.2/30 dev veth-r2
sudo ip netns exec router1 ip link set veth-r1 up
sudo ip netns exec router2 ip link set veth-r2 up

# Verify the link is up and they can reach each other
sudo ip netns exec router1 ping -c 2 10.10.255.2
```

To run actual OSPF you need a routing daemon (e.g. **FRRouting** — `frr`
package on Debian/Ubuntu). If you have it installed:

```bash
# Install FRR on Debian/Ubuntu
sudo apt-get install -y frr

# Enable OSPF in /etc/frr/daemons: set ospfd=yes, then restart
sudo systemctl restart frr

# The vtysh CLI (Cisco-like):
sudo vtysh -c "show ip ospf neighbor"
sudo vtysh -c "show ip route ospf"
```

If FRR is not available, this step is a paper exercise: draw a two-router
topology, assign /30 addresses, write out what each router's LSDB would look
like after convergence, and compute the SPF tree by hand.

### Part 4 — paper exercise: Meridian Bank route design

Draw the topology (HQ-DC1 ↔ DC2 ↔ branches) and answer:

1. If the primary MPLS link DC1↔DC2 fails, which route in the table changes
   and how quickly (assuming OSPF dead-interval default of 40 s)?
2. What is the longest-prefix match for a packet from DC1 destined for
   `10.30.5.100` (a branch host)?
3. If someone adds a static route `10.20.0.0/16 via 10.10.99.1` on DC1's
   core router, what happens to traffic destined for DC2? (Hint: check AD.)

## Say it back (self-check)

1. Name three sources of routes in a routing table. Which wins when all three
   know the same prefix, and why?
2. What does "longest-prefix match" mean? Give an example using two entries
   from the Meridian table above.
3. Explain the three steps of OSPF convergence in plain language. What is an
   LSDB?
4. Why is a static default route sufficient on a branch site but not on a core
   DC router serving 220 branches?
5. Why does OSPF not appear inside a GCP or AWS VPC, even though routing
   still happens?

## Talk to the IT/security head

**Ask:**
- "Is your core network running OSPF or static routes, and what's the
  expected convergence time if a link fails?"

  *A good answer:* "OSPF Area 0 between DCs, OSPF with fast-hello timers and
  BFD for sub-second convergence on the core links; branch CPE uses static
  default via MPLS PE." If they say "a few minutes" for DC-to-DC convergence,
  that's a DR problem.

- "Are there any static routes in the table that could override OSPF during a
  failover?" *(Administrative distance gotcha.)*

  *A good answer:* "Yes, we have audited static routes for cloud interconnects
  and the internet default; they're documented and don't overlap with dynamic
  prefixes." A blank stare here is a red flag.

- "Who can inject a new route into OSPF, and is there authentication on OSPF
  adjacencies?"

  *A good answer:* OSPF MD5 or SHA authentication is configured on all
  adjacencies so rogue devices can't peer and advertise bogus routes. In a
  PCI-scoped network, unauthenticated OSPF is a finding.

- "How are GCP / AWS routes advertised back to on-prem — BGP via Cloud Router
  or static?" *(Relevant once cloud interconnects exist.)*

  *A good answer:* Cloud Router BGP, with route filters to ensure only
  expected prefixes are accepted. "We accept all routes the cloud sends" is
  a red flag — a misconfigured cloud subnet could inject a default route and
  black-hole internet traffic.

**Red flags to listen for:**
- "We use static routes everywhere" on a network with many VLANs and two
  DCs — that's a manual, brittle operation that will hurt during incidents.
- "OSPF has no authentication" — a rogue device peering can redirect traffic.
- Confusion between OSPF and BGP — knowing which protocol runs where is
  basic network hygiene.
- "Convergence takes a few minutes" for a core DC link — default dead-interval
  is 40 s; anything beyond 60–90 s indicates either no tuning or a serious
  architectural gap.

## Pitfalls & war stories

- **The silent blackhole:** a stale static route (`ip route add` during
  maintenance, never removed) persists after the next-hop goes away. The
  routing table shows a valid entry; traffic drops. Dynamic routes would have
  removed it. Audit your statics regularly.

- **Administrative distance ambush:** an engineer adds a static route to
  "fix" a routing issue during an incident. It has AD 1 and overrides the
  OSPF path (AD 110). The incident is resolved, but the static stays. Six
  months later, OSPF re-routes around a failure — but the static still wins,
  and traffic goes the wrong way. This is a documented pattern in FSI incident
  post-mortems.

- **OSPF over the wrong interface:** an admin enables OSPF on the internet-
  facing interface by accident (missed the `network` statement scope). The
  bank's internal topology is now advertised to the ISP router — or worse, a
  BGP peer on the internet. **Always use OSPF area filtering and passive
  interfaces** on any interface that shouldn't form adjacencies.

- **Northwind M&A OSPF overlap:** when Northwind acquired Eastfield Foods
  (overlapping `10.50.0.0/16`), merging OSPF domains was impossible without
  address renumbering or NAT at the boundary. Static routes between the two
  domains were the only option until the IP conflict was resolved. Dynamic
  routing and address overlap don't mix (see N11).

- **Forgetting reference-bandwidth:** OSPF defaults to `10^8 bps` for cost
  calculation. On a modern network where uplinks are 10 Gbps, a 1 Gbps and
  a 10 Gbps link both get cost 1 — OSPF can't prefer the faster one. Raise
  `auto-cost reference-bandwidth` to 10000 (10 Gbps) or 100000 (100 Gbps) so
  costs differentiate link speeds.

## Going deeper (optional)

- RFC 2328 — OSPFv2 specification (IPv4). The authoritative reference;
  Section 10 (adjacency formation) and Appendix B (interface states) are
  the parts most relevant to troubleshooting.
- RFC 5340 — OSPFv3 (IPv6 support).
- RFC 5737 — IPv4 address blocks reserved for documentation (192.0.2.0/24,
  198.51.100.0/24, 203.0.113.0/24) — use these in exercises.
- FRRouting project (frrouting.org) — open-source routing suite; runs OSPF,
  BGP, IS-IS; the easiest way to experiment with dynamic routing on Linux.
- Pairs with N12 (routing tables & default gateway) and N14 (BGP — the
  protocol at the cloud edge). Security angle: unauthenticated OSPF is a
  lateral-movement enabler; revisit in N27 (segmentation).

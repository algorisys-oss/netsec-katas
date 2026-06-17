# Kata N43 — VPC peering & topology at scale

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N39, N40, N41, N42 · **Time:** ~35 min
> **Tags:** `vpc-peering` `vpc` `hub-and-spoke` `transit-gateway` `cloud` `networking` `segmentation` `multi-cloud`

## Why it matters

A cloud deployment rarely stays in one VPC. The moment Meridian Bank runs a
PCI-scoped payment service *and* a lower-trust analytics platform, the CISO will
demand separate VPCs — and immediately someone asks "how do they talk?" VPC
peering is the first answer engineers reach for. But peering has a geometric limit
that breaks at scale, and the fix (hub-and-spoke transit) changes the governance
conversation entirely: who owns the hub, how are routes approved, and does prod
data cross a shared path? Getting topology right before the fifth VPC exists saves
months of painful re-architecture.

## The mental model

### The problem: two isolated private networks

On-premises, two segments share a router. In the cloud, two VPCs are completely
isolated by default — no route exists between them. You must create one explicitly.

**Option 1 — VPC peering (direct, bilateral):**

```
  VPC-A  10.100.0.0/16          VPC-B  10.101.0.0/16
          │                               │
          └──────── peering connection ───┘
            (private backbone; no internet; no NAT)
```

Each side adds a route: "to reach 10.101.0.0/16, use the peering." Traffic stays
on the provider backbone — never touches the internet.

**The non-transitivity rule:** peering connections are bilateral only.

```
  VPC-A ─── peer ─── VPC-B ─── peer ─── VPC-C

  VPC-A CANNOT reach VPC-C via VPC-B.
  Each pair that must communicate needs its own peering connection.
```

With N VPCs, full-mesh peering needs **N×(N−1)/2** connections:

```
  3 VPCs  →   3 connections     5 VPCs  →  10 connections
  8 VPCs  →  28 connections    12 VPCs  →  66 connections
```

At 5–6 VPCs the diagram becomes unreadable and the CAB change queue backs up.

**Option 2 — Hub-and-spoke (transit model):**

```
   spoke-A    spoke-B    spoke-C    spoke-D
  10.100.0/17 10.100.128/17 10.101.0/17 10.101.128/17
      │          │          │          │
      └────┬─────┴────┬─────┘          │
           │   HUB    │◄───────────────┘
           │ transit  │
           │service   │  (TGW / NCC / NGFW appliance)
           │10.103.0/17│
```

Every spoke attaches once — to the hub. Adding a new spoke means one new
attachment and one new hub route, not N new connections. The hub also becomes the
natural place for a central firewall policy.

**Critical:** for spokes to reach *each other* through the hub, the hub must be a
true **transit service** (AWS Transit Gateway, GCP Network Connectivity Center) or
a routing/NAT/NGFW **appliance** — *not* plain VPC peering. Raw VPC peering is
non-transitive (see the rule above): if spoke-A peers a hub VPC and spoke-B peers
the same hub VPC, spoke-A still cannot reach spoke-B. A peered hub VPC only lets
each spoke reach the hub itself. Spoke-to-spoke transit needs a service that
forwards between attachments.

**Key trade-off table:**

| | Full-mesh peering | Hub-and-spoke |
|---|---|---|
| Latency | Lowest (direct path) | One extra hop through hub |
| Route governance | Distributed — each team adds own routes | Centralized — hub team controls route tables |
| Scale | ~5 VPCs before pain | Hundreds of spokes |
| Blast radius of a rule error | Contained to the bilateral pair | Hub misconfiguration affects all spokes |
| FSI/audit friendliness | Harder: rules spread across many VPCs | Easier: one place to audit and control |

## Worked example

Meridian Bank's GCP environment has grown to four VPCs, all carved from the GCP
supernet `10.100.0.0/14` (= 10.100.0.0 – 10.103.255.255; see
`reference/running-example.md`). The four spokes are placed contiguously as /17s so
they summarize cleanly, and the transit hub is carved from *within* the same
supernet (respecting Meridian's IP plan — never grab ad-hoc space outside it):

```
  VPC               CIDR             Purpose
  ─────────────────────────────────────────────────────
  prod-banking      10.100.0.0/17    Core banking APIs (PCI scope)
  analytics         10.100.128.0/17  Data warehouse, BI tools
  shared-services   10.101.0.0/17    AD, monitoring, logging
  dev-sandbox       10.101.128.0/17  Developer workloads (lower trust)
  transit-hub       10.103.0.0/17    Hub for transit + central firewall
```

The four spokes together span `10.100.0.0/15` (10.100.0.0 – 10.101.255.255), so a
single summary route covers all of them. `10.102.0.0/16` and `10.103.128.0/17`
stay free inside the supernet for future spokes.

**Peering connection count check:** 4×3/2 = 6 connections. Manageable today, but
VPC 5 (a new partner-integration environment) would need 4 new peerings. The
network team raises this to the CAB and recommends a transit hub.

**Hub-and-spoke build:** stand up the transit hub at `10.103.0.0/17` and attach
each spoke once. The hub must be a **transit service** — GCP Network Connectivity
Center, AWS Transit Gateway, or an NGFW/routing appliance — *not* a plain peered
VPC, because peering is non-transitive and would black-hole spoke-to-spoke traffic.
Hub (transit-service) route table — one entry per spoke attachment:

```
  Destination       Next-hop
  10.100.0.0/17     attachment → prod-banking
  10.100.128.0/17   attachment → analytics
  10.101.0.0/17     attachment → shared-services
  10.101.128.0/17   attachment → dev-sandbox
```

Each spoke's route table needs entries for the *destination* CIDRs it must reach —
a route to the hub's own range alone does **not** reach sibling spokes. Using the
spoke summary `10.100.0.0/15` (all spokes) plus a default route:

```
  Destination       Next-hop
  10.100.0.0/15     hub attachment   ← reaches all other spokes via the hub
  10.103.0.0/17     hub attachment   ← reaches the hub's own range (services in hub)
  0.0.0.0/0         NAT gateway      ← internet egress (if allowed)
```

(A spoke's own /17 is connected/local, so traffic to itself stays inside the spoke
even though it falls within the `10.100.0.0/15` summary.)

**PCI isolation:** the CISO requires `dev-sandbox` cannot reach `prod-banking`.
With hub-and-spoke, one firewall policy rule in the hub drops
`10.101.128.0/17 → 10.100.0.0/17`. One rule, one place, one auditable change.
With full-mesh peering, the same control needs enforcement in both VPCs — two
places that can drift apart without anyone noticing.

**CIDR overlap check — always do this first:**

```
  10.100.0.0/17   →  10.100.0.0   – 10.100.127.255
  10.100.128.0/17 →  10.100.128.0 – 10.100.255.255
  10.101.0.0/17   →  10.101.0.0   – 10.101.127.255
  10.101.128.0/17 →  10.101.128.0 – 10.101.255.255
  10.103.0.0/17   →  10.103.0.0   – 10.103.127.255
```

No overlaps, and every range sits inside the GCP supernet `10.100.0.0/14` —
peering/attachments will work. Contrast with Northwind's M&A pain (N11):
Eastfield Foods ran `10.50.0.0/16`, identical to Northwind's own range. Peering
is **rejected outright** when CIDRs overlap; the only workarounds are NAT (messy)
or re-IP (expensive). Reserve a unique supernet *before* M&A closes.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| VPC-to-VPC private routing | Routed link between two L3 segments | **VPC Network Peering** (VPCs are global; one peering spans regions) | **VPC Peering** (VPCs are regional, so cross-region needs a peering/TGW; peering itself supports inter-region since 2017) | **VNet Peering** (VNets are regional; Global VNet Peering connects across regions) |
| Non-transitive limitation | N/A — routers are transitive | Applies | Applies | Applies |
| Hub-and-spoke transit | Core router/L3 switch | **Network Connectivity Center (NCC)** hub; or custom transit VPC with static routes | **Transit Gateway (TGW)** | **Azure Virtual WAN (vWAN)** (Azure: TODO) |
| Central firewall in hub | Perimeter firewall between zones | **Network Firewall Policies** (global/regional) or NGFW appliance in the hub (Hierarchical Firewall Policies attach at org/folder level, not a single hub VPC) | **AWS Network Firewall** in inspection VPC | **Azure Firewall** in hub VNet (Azure: TODO) |
| Route advertisement control | Route filters (prefix-lists) on a router | Custom static routes; NCC route policies | TGW route tables with per-attachment propagation on/off | vWAN route tables (Azure: TODO) |
| Overlap detection | Manual or IPAM tool | API rejects peering if CIDRs overlap | Same — peering rejected on overlap | Same |

**GCP vs AWS scope difference:** GCP VPCs are *global* — one VPC spans all regions,
with regional subnets inside it. AWS VPCs are *regional* — a workload in
`us-east-1` and `eu-west-1` needs two VPCs and a peering or TGW to connect them.
AWS engineers often need more VPCs, and thus hit the peering-mesh problem sooner.

**Route automation difference:** GCP peering has an "export/import custom routes"
checkbox that propagates routes automatically. AWS requires manual route table
entries on both sides after the peering is accepted — the most common "why isn't
ping working" cause for engineers new to AWS peering.

## Do it (the exercise)

### Part A — Overlap check [laptop]

```bash
python3 - <<'EOF'
import ipaddress
nets = ["10.100.0.0/17","10.100.128.0/17","10.101.0.0/17",
        "10.101.128.0/17","10.103.0.0/17"]
nets = [ipaddress.ip_network(n) for n in nets]
for i, a in enumerate(nets):
    for b in nets[i+1:]:
        if a.overlaps(b):
            print(f"OVERLAP: {a} and {b}")
print("Done — no output above means clean.")
EOF
```

Then repeat with `"10.50.0.0/16"` twice (Northwind's M&A scenario) and confirm
the overlap is detected.

### Part B — Connection-count math [paper]

Calculate N×(N−1)/2 for N = 3, 5, 8, 12. Note the N where you would personally
push back and recommend a transit model.

### Part C — Route table design [paper]

Draw Meridian's hub-and-spoke. Write the route table for `prod-banking` (the spoke
summary route to sibling spokes, the hub-range route, and a default route) and the
hub transit service (one route per spoke attachment — four entries). Confirm the
hub is a transit service (NCC/TGW/appliance), not a plain peered VPC, or the spokes
cannot transit it. Mark where the dev-sandbox→prod-banking block rule lives and why
putting it there is better than putting it in two spoke firewalls.

### Part D — Cloud exploration [needs cloud account]

In GCP Console → VPC Network → VPC Network Peering: create a peering between
two test VPCs. Observe that the status stays "Inactive" until the *other* side
also accepts — peering is always bilateral. Note the auto-created routes.

In AWS Console → VPC → Peering Connections: accept a peering and then check
the route tables. Confirm the routes were *not* added automatically — add them
manually and verify connectivity.

## Say it back (self-check)

1. Why is VPC peering not transitive? If A peers B and B peers C, how does A
   reach C?
2. How many peering connections does a 6-VPC full mesh need?
3. What is the single prerequisite before any peering can succeed — and what does
   the API do if it is violated?
4. Name the hub-and-spoke transit service in GCP and in AWS.
5. What is the key scope difference between a GCP VPC and an AWS VPC, and why
   does it mean AWS users often need more VPCs for the same workload?

## Talk to the IT/security head

**Ask:**

- "How many VPCs do you have today, and how are they connected — full-mesh peering,
  a transit hub, or both?"
  *Good answer:* a clear topology with a named mechanism ("TGW in AWS, NCC in
  GCP, network team owns the hub, adding a spoke requires a change ticket").
  *Red flag:* "we have 15 VPCs and they're all peered" — ask to see the
  peering count; it is likely unmanageable and the route tables will be a mess.

- "Who owns the transit hub and its route tables? What is the process for a team
  that needs to add a new VPC?"
  *Good answer:* central network team; new spoke requires CIDR reservation, security
  review, and a CAB ticket stating which cross-VPC flows are approved.
  *Red flag:* "any team can peer their own VPC" — unauthorized traffic paths can
  appear without the CISO or network team knowing, a PCI control gap.

- "Do you have an IPAM? Have you confirmed no CIDR overlaps across all VPCs?"
  *Good answer:* IPAM enforces uniqueness at provisioning time. An emergency
  re-IP is not on anyone's roadmap.
  *Red flag:* "we track it in a spreadsheet" — two teams will eventually collide,
  and the resulting re-IP or NAT remediation blocks the peering they urgently need.

- "Does production or PCI-scoped data pass through the shared transit hub? Is the
  hub inside your compliance boundary?"
  *Good answer:* explicit policy — either the hub is in-scope and fully audited, or
  CDE/prod traffic uses dedicated peering or Private Service Connect (see N44) and
  never transits the shared hub.
  *Red flag:* vague or surprised expression — this is a PCI scoping gap.

## Pitfalls & war stories

- **The transitivity trap.** Engineers build A→B and B→C peerings and assume A
  reaches C. Traffic black-holes silently — no ICMP error, just loss. Draw the
  topology before you build it.

- **AWS route tables are not automatic.** You create the peering and it shows
  "Active" in the console. Engineers celebrate, then spend an hour debugging why
  `ping` fails. The routes were never added to either route table — both sides must
  be updated manually.

- **CIDR overlap found during migration.** Northwind's Eastfield acquisition arrived
  with `10.50.0.0/16`. Peering was impossible. NAT remediation took months and
  was never fully clean. The fix: negotiate a unique supernet re-IP as a deal
  condition *before* close, or at minimum reserve the range in your IPAM on day one.

- **Dev peered to prod "temporarily."** An engineer peers two VPCs for a test,
  forgets to remove it. The route exists; the CISO's segmentation control is
  bypassed; at Meridian that is a PCI finding. In FSI, every peering connection
  should be change-controlled and have a named business justification.

- **GCP's global VPC misread as regional.** AWS engineers joining a GCP project
  split workloads into one VPC per region (AWS habit), then create peerings between
  them. In GCP one VPC with regional subnets is the correct model; the extra VPCs
  introduce the peering complexity they were trying to avoid.

- **Hub as a single point of governance failure.** A bad firewall policy pushed to
  the transit hub silently drops all inter-VPC traffic at once. Counter-measure:
  treat the hub's route tables and firewall policies as infrastructure-as-code
  (Terraform), version-controlled, with mandatory peer review — the same discipline
  as a change to an on-prem core router.

## Going deeper (optional)

- GCP VPC Network Peering docs — auto-route import/export, MTU considerations,
  transitive-peering limitation: `cloud.google.com/vpc/docs/vpc-peering`
- AWS VPC Peering Guide — cross-account, cross-region, route table requirements,
  security group referencing: `docs.aws.amazon.com/vpc/latest/peering/`
- AWS Transit Gateway Guide — attachments, route tables, propagation policies:
  `docs.aws.amazon.com/vpc/latest/tgw/`
- GCP Network Connectivity Center — hub/spoke types, VPN and Interconnect spokes:
  `cloud.google.com/network-connectivity/docs/network-connectivity-center`
- Pairs with N44 (Private Service Connect / PrivateLink) for service-level
  connectivity without full network-layer peering; and N48 (hub-and-spoke at
  multi-cloud/hybrid scale); N52 (Shared VPC as an alternative to spoke VPCs in GCP).
- For the compliance context driving Meridian's topology choices: N29 (PCI-DSS /
  RBI network requirements) and S01 (blast radius, defense in depth).

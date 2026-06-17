# Kata N48 — Hub-and-spoke / Transit Gateway / NCC / Azure Virtual WAN

> **Track:** Networking · **Module:** N9 Hybrid & multi-cloud · **Prereqs:** N14, N39, N40, N41, N43, N36 · **Time:** ~40 min
> **Tags:** `hub-and-spoke` `transit-gateway` `vpc` `hybrid` `multi-cloud` `routing` `gcp` `aws`

## Why it matters

Once you have more than two or three VPCs — different environments, different
business units, different cloud regions — connecting them pairwise with VPC
peering quickly breaks down. The pairing math is quadratic (n VPCs need n×(n−1)/2
peerings), and more importantly, peered VPCs don't transit traffic for each other:
a spoke cannot reach another spoke through a peer. The hub-and-spoke pattern
solves both problems. It also becomes the mandatory blueprint for any hybrid
design (on-prem + cloud) that must centralize inspection, shared services, or
compliance controls.

For Meridian Bank this matters doubly: the CISO needs all traffic to pass through
a single choke-point for inspection, and the RBI auditor needs to see that
cardholder data can only flow through explicitly approved paths — not through any
accidental peering shortcut.

## The mental model

**First principles: the peering scalability wall**

Imagine four VPCs — prod, staging, shared-services, and connectivity. Connecting
them fully-meshed with peering requires 4×3/2 = 6 peerings. With eight VPCs that
is 28 peerings. Each peering is its own object with its own route table entries,
and cloud providers impose limits (GCP: 25 peerings per VPC; AWS: 125 peerings
per VPC but route table limits bite first). More critically, VPC peering is
**non-transitive**: traffic from prod cannot reach shared-services *through* the
connectivity VPC — it needs a direct peering, or a router in the middle.

**The hub-and-spoke answer**

Place one VPC in the center (the hub). Every other VPC (the spokes) connects only
to the hub. Traffic between any two spokes travels hub → spoke, never spoke ↔ spoke
directly. The hub hosts — or connects to — shared services: a firewall, a NAT
gateway, a DNS resolver, and the on-prem interconnect/VPN.

```
         On-prem HQ-DC1
         10.10.0.0/16
               │
               │ Cloud Interconnect / VPN
               │
  ┌────────────▼──────────────────────┐
  │           HUB VPC                  │
  │     (transit / connectivity)       │
  │   Firewall  NAT  DNS  VPN GW       │
  │       10.100.0.0/16                │
  └──┬──────────┬──────────┬───────────┘
     │          │          │
     │          │          │
  ┌──▼──┐    ┌──▼──┐    ┌──▼──┐
  │Prod  │    │Stage│    │Shared│
  │Spoke │    │Spoke│    │Svc   │
  │10.101│    │10.102│   │10.103│
  │.0/20 │    │.0/20 │   │.0/20 │
  └──────┘    └──────┘   └──────┘
```

Key properties:
- Spokes cannot talk to each other directly — traffic must traverse the hub.
- The hub can apply firewall inspection to east-west traffic (spoke-to-spoke).
- On-prem reachability is published once, from the hub; spokes inherit it.
- Adding a new spoke = one connection + one set of route table entries, not N new
  ones.

**The non-transitive peering problem, illustrated**

In pure VPC peering (no hub), if Prod peers with Hub and Staging peers with Hub,
Prod cannot reach Staging via Hub. The cloud routing engine does not forward
between two peers. You need a router — a VM, a managed gateway, or a transit
construct — that actually receives the packet and re-forwards it. That router is
the hub.

**Dedicated transit services**

All three major clouds now offer managed transit constructs that eliminate the need
to run a hub VM yourself:

```
On-prem                                GCP Network Connectivity Center
                                       AWS Transit Gateway
                                       Azure Virtual WAN Hub
```

These act as regional routing planes. Each VPC (or VNet) attaches to the transit
construct, which maintains the route table and forwards packets without a VM in the
path. BGP (see N14) carries routes between on-prem, the transit construct, and
each spoke.

## Worked example

Meridian Bank is deploying three GCP VPCs in `asia-south1` (Mumbai, for
data-residency compliance):

| VPC | Purpose | CIDR |
|-----|---------|------|
| `meridian-hub` | Transit, shared firewall, Cloud Interconnect endpoint | `10.100.0.0/20` |
| `meridian-prod` | Production mobile banking backend | `10.101.0.0/20` |
| `meridian-staging` | Pre-prod environment | `10.102.0.0/20` |
| `meridian-shared` | Shared services: DNS, monitoring, build | `10.103.0.0/20` |

On-prem: HQ-DC1 = `10.10.0.0/16`, DC2 = `10.20.0.0/16` (see `reference/running-example.md`).
Cloud Interconnect lands in `meridian-hub`.

**Routing the packet: Prod → on-prem core**

A pod in `meridian-prod` (`10.101.0.5`) calls the core banking API at
`10.10.4.22` (HQ-DC1 subnet).

```
10.101.0.5  →  (VPC peering route)  →  meridian-hub router
           →  (Cloud Router BGP)   →  Cloud Interconnect
           →  (MPLS/leased line)   →  HQ-DC1 core router
           →  10.10.4.22
```

The packet never leaves GCP `asia-south1` to the internet. The return path is
symmetric. The hub's Cloud Router advertises the on-prem prefixes (`10.10.0.0/16`,
`10.20.0.0/16`) into the spoke peerings so prod and staging learn the route.

**GCP Network Connectivity Center (NCC) variant**

Instead of manually peering hub-to-each-spoke and managing route export flags,
Meridian can attach all VPCs as NCC "spokes" to an NCC hub. NCC manages the
transit routing table. The spoke VPCs attach as VPC network spokes; the
Interconnect attaches as a VLAN attachment spoke. Routes propagate automatically.

```
NCC Hub (region: asia-south1)
  ├── Spoke: meridian-prod   (VPC network spoke)
  ├── Spoke: meridian-staging (VPC network spoke)
  ├── Spoke: meridian-shared (VPC network spoke)
  └── Spoke: Cloud Interconnect VLAN attachment (hybrid spoke)
```

Firewall policies are applied on the hub VPC (`meridian-hub`) or via Hierarchical
Firewall Policies — all east-west traffic through the hub means one chokepoint.

**CIDR non-overlap check (critical)**

GCP peering and NCC require non-overlapping CIDR ranges. Verify:
- `10.100.0.0/20` — hub (4096 addresses, .0.0–.15.255)
- `10.101.0.0/20` — prod (4096 addresses, .0.0–.15.255 of 10.101)
- `10.102.0.0/20` — staging
- `10.103.0.0/20` — shared-services
- `10.10.0.0/16` — on-prem HQ-DC1 (65536 addresses)
- `10.20.0.0/16` — on-prem DC2

None overlap — the `/20` spokes sit in different /16 blocks, and the on-prem /16s
are separate from the cloud `10.100–103` space. This is exactly why
`reference/running-example.md` reserves `10.100.0.0/14` for GCP.

**AWS equivalent: Transit Gateway**

If Meridian's secondary AWS footprint (`10.104.0.0/14` reserved) follows the same
pattern, an AWS Transit Gateway replaces NCC:

```
Transit Gateway (TGW) — ap-south-1 (Mumbai)
  ├── VPC attachment: meridian-aws-prod   (10.104.0.0/20)
  ├── VPC attachment: meridian-aws-shared (10.104.16.0/20)
  └── VPN/DX attachment: on-prem (Direct Connect)
```

TGW has its own route tables — one per "domain" (e.g., one for prod VPCs, one for
shared). Route table associations and propagations control which spokes can
reach which.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Transit construct | Core/aggregation router or L3 switch | Network Connectivity Center (NCC) Hub | Transit Gateway (TGW) | Virtual WAN Hub (vWAN) |
| Spoke attachment | Distribution router | VPC network spoke / VLAN attachment spoke | VPC attachment / VPN attachment | VNet connection |
| Route propagation | BGP / OSPF redistribution | Cloud Router (BGP) on each attachment | TGW route table propagation | BGP via VPN/ExpressRoute gateway |
| East-west inspection | Firewall in traffic path | VM-based NGFW or Cloud Next-Gen Firewall in hub | Network Firewall in inspection VPC or Centralized Firewall on TGW | Azure Firewall in the vWAN Secured Hub |
| On-prem attachment | N/A | Cloud Interconnect VLAN attachment or HA VPN | Direct Connect or Site-to-Site VPN | ExpressRoute or VPN Gateway |
| VPC peering (non-transitive) | N/A | VPC Network Peering | VPC Peering | VNet Peering |
| Managed routing SLA | Router FHRP (HSRP/VRRP) | NCC managed; Cloud Router HA | TGW: 99.99% SLA | vWAN Hub: 99.95% SLA |

**GCP NCC vs bare hub-VPC peering**

The original GCP pattern was to create a hub VPC, peer it to each spoke, and use
`export_custom_routes` and `import_custom_routes` flags on each peering to share
on-prem routes. NCC has been GA since 2021; VPC network spokes (attaching whole
VPCs as spokes, used here) reached GA in 2023. NCC replaces the manual peering
plumbing with a managed plane, but the mental model is the same — NCC just
automates the route plumbing and supports cross-region transit (with data
transfer charges).

**AWS TGW nuances**

TGW supports **inter-region peering** (two TGWs in different regions peer over the
AWS backbone), making it the natural spine for a multi-region or multi-account
architecture (AWS Organizations + Transit Gateway is the standard AWS landing zone
pattern). Route tables on TGW are per-attachment-group — you can isolate prod from
staging at the routing layer without a firewall rule.

**(Azure: TODO)** Azure Virtual WAN details — Hub resource, branch connections,
secured hub (Azure Firewall integration), routing intent. The pattern is equivalent
but the configuration surface differs significantly from GCP/AWS.

## Do it (the exercise)

**Part 1 — Pen-and-paper topology [laptop]**

1. Draw Meridian Bank's four GCP VPCs (hub + 3 spokes) on paper. Label each with
   its CIDR. Draw the connections to NCC. Mark where the Cloud Interconnect lands.
2. Trace two packets:
   a. `meridian-prod` → `meridian-shared` (spoke-to-spoke via hub)
   b. `meridian-prod` → `10.10.4.22` (spoke to on-prem HQ-DC1)
   For each: list every hop, the routing table entry that forwards it, and who
   advertised that entry.
3. Answer: if you accidentally assigned `10.100.0.0/20` to both the hub and prod,
   what would break and at which step would GCP surface the error?

**Part 2 — Route table reasoning [laptop]**

Given this simplified route table in `meridian-hub`:

```
Destination       Next hop                    Learned from
10.101.0.0/20     VPC peering → prod-hub      peering
10.102.0.0/20     VPC peering → staging-hub   peering
10.103.0.0/20     VPC peering → shared-hub    peering
10.10.0.0/16      Cloud Router (BGP)          Cloud Interconnect
10.20.0.0/16      Cloud Router (BGP)          Cloud Interconnect
0.0.0.0/0         default-internet-gateway   static (default route)
```

(Note: in GCP the default route's next hop is the `default-internet-gateway`.
Cloud NAT is *not* a next hop — it is a NAT service attached to a Cloud Router
that performs source NAT (SNAT) for VMs without external IPs, letting their
egress reach the internet via that default route. Contrast with AWS, where a
route table *can* point `0.0.0.0/0` at a `nat-gateway-id`; importing that AWS
model into a GCP routes table is a classic cross-cloud conflation error.)

Answer:
- Can `meridian-prod` reach `10.20.0.0/16` (DC2)? Trace the path.
- What route does `meridian-prod` need in *its own* route table to reach DC2?
  (Hint: GCP's peering `import_custom_routes` flag is involved.)
- What happens to a packet from `10.101.0.5` destined for `10.102.8.8`
  (in staging) if there is no spoke-to-spoke route exported from the hub? Where
  does it get dropped?

**Part 3 — Cloud console exploration [needs cloud account]**

In a GCP project:
```
# Create hub VPC (custom mode)
gcloud compute networks create meridian-hub \
  --subnet-mode=custom \
  --bgp-routing-mode=regional

# Create hub subnet in asia-south1
gcloud compute networks subnets create hub-subnet \
  --network=meridian-hub \
  --region=asia-south1 \
  --range=10.100.0.0/24

# Create a spoke VPC
gcloud compute networks create meridian-prod \
  --subnet-mode=custom \
  --bgp-routing-mode=regional

gcloud compute networks subnets create prod-subnet \
  --network=meridian-prod \
  --region=asia-south1 \
  --range=10.101.0.0/24

# Peer hub → prod (must be done in both directions)
gcloud compute networks peerings create hub-to-prod \
  --network=meridian-hub \
  --peer-network=meridian-prod \
  --export-custom-routes \
  --import-custom-routes

gcloud compute networks peerings create prod-to-hub \
  --network=meridian-prod \
  --peer-network=meridian-hub \
  --export-custom-routes \
  --import-custom-routes
```

Inspect the resulting route tables:
```
gcloud compute routes list --filter="network=meridian-prod"
```

Verify that the hub's routes (on-prem prefixes, if you add a Cloud Router) appear
in the prod VPC's routing table — or don't appear if `import-custom-routes` is
missing. This is where many hub-and-spoke breaks in practice.

## Say it back (self-check)

1. Why does VPC peering not scale beyond a handful of VPCs, and what two distinct
   problems does hub-and-spoke solve?
2. Explain non-transitive routing: if A peers with B and B peers with C, can A
   reach C via B? Why or why not?
3. What is the role of the Cloud Router / BGP in a hub-and-spoke design? What
   prefix does it advertise into the spokes?
4. Name the managed transit construct in GCP, in AWS, and in Azure. What is the
   main operational advantage each provides over a manual hub-VM topology?
5. Meridian wants to prevent `meridian-staging` from talking to `meridian-prod`
   through the hub. Name two mechanisms (routing and firewall) to enforce this.

## Talk to the IT/security head

**Ask:**

- "Do your spoke VPCs allow direct peering between each other, or does all traffic
  go through the hub? Who enforces that?"
  *Why it matters:* direct spoke-to-spoke peering is often created as a shortcut
  and bypasses hub-based inspection — a compliance blind spot in a PCI environment.

- "Are east-west flows (spoke-to-spoke) inspected by a firewall, or just routed?"
  *A good answer:* "All east-west traffic hairpins through the hub; the firewall
  there enforces allow-list rules by zone. Our NGFW logs every flow for the
  auditors."
  *Red flag:* "It goes through the transit gateway so it's fine" — TGW/NCC routes
  traffic; they do not inspect it. A managed transit construct is a router, not a
  firewall.

- "How many VPCs are attached to your transit hub, and what is the route table
  isolation policy?"
  *Why it matters:* TGW and NCC support routing domains / route tables; not using
  them means prod and staging share the same routing domain — a blast-radius problem.

- "If on-prem becomes unreachable, which cloud workloads lose connectivity and
  which can operate in island mode?"
  *A good answer:* names the workloads with hard on-prem dependencies (core banking
  APIs, LDAP auth) vs those that can degrade gracefully (mobile caching layers).
  *Red flag:* "we haven't mapped that" — this is the first question in any DR
  conversation.

- "What is the BGP AS number used for your Cloud Router / Direct Connect, and who
  owns change control for BGP policy?"
  *Why it matters:* BGP misconfig at the hub propagates a bad route to every spoke
  simultaneously — highest blast-radius failure mode in a hub-and-spoke design.

**Red flags to listen for:**

- "We just peer everything to everything" — you've lost the transitive routing
  argument and there's no inspection chokepoint.
- No separation between prod and non-prod in the transit routing table.
- The hub VPC has internet egress not flowing through a firewall or NAT audit log.
- "Azure is managed by a different team" — in a multi-cloud design, a fragmented
  hub model usually means no single inspection point and data-residency blind spots.

## Pitfalls & war stories

**The missing `export-custom-routes` flag**

The most common GCP hub-and-spoke misconfiguration: the hub peers to each spoke,
Cloud Router learns the on-prem prefix `10.10.0.0/16` via Cloud Interconnect, but
the peering was created without `--export-custom-routes`. Spokes never learn the
on-prem route. Packets from prod destined for the core banking API are dropped
silently. The fix is a peering update — but that itself may require a CAB change
at a regulated client.

**AWS TGW route table isolation forgotten**

AWS TGW creates a single default route table and puts every attachment in it,
allowing prod → staging routing from day one. Teams later discover staging has full
connectivity to prod data stores and scramble to add route table isolation. The
right time to design route tables is at landing-zone creation (see N49), not after
the first prod incident.

**The hub becomes a choke-point performance problem**

For very high-bandwidth workloads (Northwind FMCG moving warehouse scanner data at
scale), routing all spoke-to-spoke traffic through a hub-resident NGFW can saturate
the firewall's throughput. The fix is either a higher-capacity appliance, or
introducing service-level peering for trusted high-volume paths — which re-adds
complexity. This trade-off must be sized at design time.

**Northwind's M&A overlap at the hub**

When Northwind acquired Eastfield Foods (`10.50.0.0/16` — same as Northwind
original, see `reference/running-example.md`), both networks couldn't be attached
to the same TGW/NCC hub with overlapping prefixes. BGP refuses duplicate prefixes
on the same route table. Resolution required NAT at the boundary or an IP
renumbering project — the latter took 14 months. The lesson: M&A due diligence
must include an IP plan comparison before Day 1.

**Azure Virtual WAN "secured hub" vs plain hub**

Azure offers two hub variants: a plain routing hub, and a "Secured Virtual WAN
Hub" with Azure Firewall embedded. Choosing the plain hub and expecting firewall
enforcement that isn't there is the Azure equivalent of the missing GCP
`export-custom-routes` flag — a gap that's invisible until an auditor or a
penetration test finds it.

## Going deeper (optional)

- GCP Network Connectivity Center documentation: `cloud.google.com/network-connectivity/docs/network-connectivity-center`
- AWS Transit Gateway documentation and route table design guide: `docs.aws.amazon.com/vpc/latest/tgw/`
- RFC 4364 (BGP/MPLS IP VPNs) — the on-prem MPLS VRF model that cloud transit
  constructs conceptually inherit from.
- AWS whitepaper "Building a Scalable and Secure Multi-VPC AWS Network
  Infrastructure" — reference architecture for TGW + AWS Organizations.
- Pairs with N43 (VPC peering basics), N36 (site-to-site VPN into the hub), N38
  (Cloud Interconnect / Direct Connect as hub attachments), and N49 (landing zones
  that enforce hub-and-spoke from day zero).

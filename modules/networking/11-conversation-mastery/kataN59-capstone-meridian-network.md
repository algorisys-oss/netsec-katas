# Kata N59 — Capstone: design Meridian Bank's hybrid GCP+AWS network

> **Track:** Networking · **Module:** N11 Conversation mastery · **Prereqs:** N36, N38, N39, N40, N41, N42, N43, N44, N48, N49, N56, N57, N58 · **Time:** ~45 min
> **Tags:** `hybrid` `multi-cloud` `vpc` `interconnect` `hub-and-spoke` `capstone` `meridian-bank` `fsi`

## Why it matters

A bank's hybrid cloud network is the riskiest surface you will ever design — it
carries regulated customer data between on-premise core banking systems and new
cloud channels, across multiple cloud providers, while meeting PCI-DSS
segmentation, RBI data-residency, and an IT head's change-control discipline.
If the design is wrong, the auditor finds it. If it is right but you cannot
explain *why* each choice was made, the IT head and CISO will fill the gaps with
their own (often more restrictive) assumptions and the project stalls.

This capstone assembles every major networking concept from the track into a
single coherent design for Meridian Bank. Work through it until you can defend
every number, every route, and every segmentation boundary out loud — that is
the bar.

## The mental model

A regulated hybrid cloud network has four structural layers. Each layer is a
design decision, not just an implementation detail:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4 — EDGE & SERVICES                                  │
│  Cloud LB · WAF · CDN · API gateway · DNS (split-horizon)   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3 — CLOUD WORKLOAD SEGMENTS (VPCs)                   │
│  GCP prod/non-prod · AWS prod/DR · security VPC             │
│  Private Service Connect · PrivateLink                       │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2 — HYBRID BACKBONE                                   │
│  Cloud Interconnect (GCP) · Direct Connect (AWS)            │
│  Transit hub VPC / Transit Gateway                           │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1 — ON-PREM                                           │
│  HQ-DC1 · DC2 (DR) · 220 branches · Corp offices            │
│  10.10.0.0/16 · 10.20.0.0/16 · 10.30.0.0/16               │
└─────────────────────────────────────────────────────────────┘
```

The design principle underlying all four layers: **traffic must not be able to
reach a zone it has no business being in**. Every subnet boundary is a
segmentation decision. Every route is an authorization decision. The blast radius
(see N01) of any compromise is bounded by the segmentation design, not by the
firewall policy alone.

**The non-overlap constraint** (see running-example.md and N11): all private
ranges must be unique across on-prem and both clouds. Overlap forces NAT, which
breaks the clean route model and introduces state that auditors ask about.
Meridian's plan already reserves:

```
On-prem supernet:  10.0.0.0/8  (carved by site)
  HQ-DC1:          10.10.0.0/16
  DC2 (DR):        10.20.0.0/16
  Branches:        10.30.0.0/16
  Corp offices:    10.40.0.0/16
GCP:               10.100.0.0/14  (10.100.0.0 – 10.103.255.255)
AWS:               10.104.0.0/14  (10.104.0.0 – 10.107.255.255)
Azure (reserved):  10.108.0.0/14
```

## Worked example

### Step 1 — Carve the cloud address space

Within `10.100.0.0/14` (GCP), assign one `/16` per environment:

```
10.100.0.0/16  GCP prod VPC         (65,534 usable host addresses)
10.101.0.0/16  GCP non-prod VPC     (dev/staging)
10.102.0.0/16  GCP shared/hub VPC   (transit, DNS, security services)
10.103.0.0/16  GCP reserved
```

Within `10.104.0.0/14` (AWS), same pattern:

```
10.104.0.0/16  AWS prod VPC
10.105.0.0/16  AWS DR VPC
10.106.0.0/16  AWS shared/hub VPC
10.107.0.0/16  AWS reserved
```

Verify `10.100.0.0/14` covers `10.100.0.0` through `10.103.255.255`:
`/14` = 14 network bits; host bits = 18; 2^18 = 262,144 addresses.
`10.100.0.0 + 262143` = `10.103.255.255`. ✓

### Step 2 — Subnet the GCP prod VPC

Meridian's GCP prod workloads need four segments:

```
Subnet                  CIDR             Purpose
──────────────────────────────────────────────────────────────
gcp-prod-frontend       10.100.0.0/22    L7 LB backends, API layer  (1020 hosts*)
gcp-prod-app            10.100.4.0/22    Application servers         (1020 hosts*)
gcp-prod-data           10.100.8.0/24    Cloud SQL, Memorystore       (252 hosts*)
gcp-prod-mgmt           10.100.9.0/24    Bastion, monitoring agents   (252 hosts*)
```

(*GCP reserves **4 addresses** per subnet: the network address, the default
gateway (`.1`), the second-to-last address, and the broadcast (last) address.
So usable = total − 4: a /24 gives 256 − 4 = **252**, and a /22 gives
1024 − 4 = **1020**. Note this differs from AWS, which reserves 5.)

The `gcp-prod-data` subnet has **no default route to the internet**. Cloud NAT
is provisioned only for outbound package-update traffic if needed — no inbound.
The firewall rule base defaults to deny-all; allow rules are additive (see N42).

### Step 3 — Draw the hybrid backbone

Meridian uses **Dedicated Cloud Interconnect** from HQ-DC1 to the GCP hub VPC,
and **AWS Direct Connect** from HQ-DC1 to the AWS hub VPC. Both terminate in
HQ-DC1's edge router.

```
HQ-DC1 (10.10.0.0/16)
     │
     ├──[Dedicated Interconnect, 10 Gbps]──► GCP hub VPC (10.102.0.0/16)
     │                                          │
     │                                          ├── VPC Peering ──► GCP prod (10.100.0.0/16)
     │                                          └── VPC Peering ──► GCP non-prod (10.101.0.0/16)
     │
     └──[Direct Connect, 10 Gbps]─────────► AWS hub VPC (10.106.0.0/16)
                                               │
                                               ├── TGW ──► AWS prod (10.104.0.0/16)
                                               └── TGW ──► AWS DR   (10.105.0.0/16)
```

BGP sessions run over each interconnect. HQ-DC1 advertises:
- `10.10.0.0/16` (HQ) and `10.20.0.0/16` (DC2) to both cloud hubs.

GCP hub VPC advertises the GCP supernet (`10.100.0.0/14`) back to HQ-DC1 via BGP.
AWS hub VPC advertises the AWS supernet (`10.104.0.0/14`) back to HQ-DC1 via BGP.

Result: on-prem can reach any cloud subnet by IP, without NAT. Cloud subnets
can reach on-prem. GCP and AWS do **not** have a direct link to each other —
inter-cloud traffic, if needed, routes via HQ-DC1 (hub-and-spoke, see N48).
This avoids cross-cloud BGP complexity and keeps the on-prem team in control of
what crosses the boundary.

### Step 4 — Segmentation and the CDE

PCI-DSS requires the Cardholder Data Environment (CDE) to be isolated. In
Meridian's design the CDE lives in HQ-DC1 on `10.10.16.0/20` (a /20 carved from
the HQ /16). Cloud workloads that touch card data are placed in a dedicated
subnet (`10.100.8.0/24`, the `gcp-prod-data` subnet above) and communicate
with the on-prem CDE only through a named, logged firewall policy — not by
default routing.

The path from a GCP app server to the CDE:

```
gcp-prod-app (10.100.4.x)
  → GCP firewall: allow tcp/8443 to 10.10.16.0/20, log-all
  → GCP hub VPC
  → Cloud Interconnect
  → HQ-DC1 edge router
  → on-prem firewall: allow tcp/8443 from 10.100.4.0/22 to 10.10.16.0/20, log-all
  → CDE segment (10.10.16.0/20)
```

Every hop has a named rule, and every rule is logged. The auditor can trace a
packet from source to destination and show which rule allowed it. No implicit
routes cross the CDE boundary.

### Step 5 — DNS architecture (split-horizon)

Internal services resolve via private zones:

```
mobile.meridian.internal  →  GCP Cloud DNS private zone  →  10.100.0.x  (internal LB)
core.meridian.internal    →  on-prem DNS (forwarded via DNS peering)  →  10.10.10.x
```

Cloud DNS peering: the GCP hub VPC hosts an inbound forwarding policy. On-prem
resolvers forward `*.meridian.internal` queries to the Cloud DNS inbound
endpoints (which get IPs in `10.102.x.x`). Cloud workloads forward
`core.meridian.internal` queries via the GCP-to-on-prem conditional forwarder.
This gives both sides name resolution without leaking internal zones to the
public internet. (See N18, N45, N50.)

### Step 6 — Egress and data-residency

All GCP prod workloads are pinned to `asia-south1` (Mumbai) to satisfy
RBI data-residency for Indian customer data. AWS prod VPC is in `ap-south-1`
(also Mumbai). Cloud NAT is used for outbound software downloads; no VM has a
public IP. Internet-facing traffic flows exclusively through the Global External
Application Load Balancer (GCP) fronted by Cloud Armor (WAF) — the only
internet-reachable surface. (See N41, N46.)

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Private network | VLAN / routed L3 segment | VPC (global, subnet-per-region) | VPC (regional, AZ-aware) | VNet (regional) |
| Subnet | IP subnet on a router | Regional subnet (one region) | AZ subnet (one AZ) | Subnet (spans AZ) |
| Transit hub | Core router / MPLS PE | Network Connectivity Center (NCC) hub VPC + VPC Peering | Transit Gateway (TGW) | Azure Virtual WAN hub |
| Dedicated private link | MPLS leased line | Dedicated Cloud Interconnect (10/100 Gbps) | Direct Connect (1–100 Gbps) | ExpressRoute |
| Cloud firewall | Hardware NGFW | VPC firewall rules (allow/deny, tag-based) | Security Group (stateful) + NACL (stateless) | NSG (Network Security Group) |
| Private service access | Internal VLAN/segment | Private Service Connect (PSC) | AWS PrivateLink | Azure Private Link |
| Cloud DNS (private) | Internal DNS server | Cloud DNS private zone | Route 53 private hosted zone | Azure Private DNS zone |
| WAF / front door | On-prem WAF / reverse proxy | Cloud Armor + Global Ext. LB | AWS WAF + ALB / CloudFront | Azure Front Door + WAF |
| Egress NAT | NAT44 on perimeter firewall | Cloud NAT | NAT Gateway | Azure NAT Gateway |
| Flow logging | NetFlow / sFlow on switches | VPC Flow Logs | VPC Flow Logs | NSG flow logs |
| BGP interconnect | BGP on PE router | Cloud Router (BGP over Interconnect) | Direct Connect Gateway + BGP | ExpressRoute circuit + BGP |

## Do it (the exercise)

**This exercise is paper + laptop; two steps need a cloud account.**

### Part A — IP plan on paper [laptop / paper]

1. Verify that `10.100.0.0/14` does not overlap with `10.10.0.0/16`.
   Use Python:
   ```bash
   python3 -c "
   import ipaddress as i
   gcp = i.ip_network('10.100.0.0/14')
   hq  = i.ip_network('10.10.0.0/16')
   print('overlap:', gcp.overlaps(hq))
   print('GCP range:', gcp.network_address, '-', gcp.broadcast_address)
   "
   ```
   Expected: `overlap: False`, range `10.100.0.0 - 10.103.255.255`.

2. Carve `10.100.0.0/16` into the four prod subnets from Step 2 above.
   Verify with `ipcalc` or Python that each subnet fits and none overlap:
   ```bash
   python3 -c "
   import ipaddress as i
   subnets = ['10.100.0.0/22','10.100.4.0/22','10.100.8.0/24','10.100.9.0/24']
   nets = [i.ip_network(s) for s in subnets]
   for a in nets:
       for b in nets:
           if a != b and a.overlaps(b):
               print('OVERLAP:', a, b)
   print('usable per subnet:', [n.num_addresses - 4 for n in nets])
   "
   ```
   Expected: no overlaps; usable counts `1020, 1020, 252, 252`.

3. On paper, draw the BGP route advertisement table: which prefixes does HQ-DC1
   learn from GCP, and which does it advertise to GCP? Who summarises — do you
   advertise the /16s individually or the /14 supernet? (Hint: the IT head will
   ask. A supernet summary reduces the route table; individual /16s give more
   control over which routes exist.)

### Part B — Trace a packet end-to-end [laptop]

Simulate (with `traceroute` or `mtr`) the hop count from your laptop to a known
endpoint to get a feel for latency across regions:

```bash
# [laptop] — public traceroute to a Mumbai-region address
mtr --report --report-cycles 5 --no-dns 8.8.8.8
```

Then calculate the expected RTT for Meridian: an application in `asia-south1`
(Mumbai) calling HQ-DC1 over a 10 Gbps Cloud Interconnect. Typical on-net RTT
Mumbai↔Mumbai data center: 1–3 ms. Compare to an internet path via a public IP.

### Part C — Design review walkthrough [laptop / paper]

Using the ASCII diagram from the Worked Example, answer these four questions
that the IT head will ask in the design review:

1. "If the Cloud Interconnect goes down, how does GCP prod talk to the core?"
   (Is there a failover path? What happens to transactions in flight?)
2. "What prevents a developer in GCP non-prod from accidentally reaching the CDE?"
   (Hint: check whether the VPC Peering or route table allows it.)
3. "Where exactly does TLS terminate for a mobile-banking API call, and who can
   see the plaintext?" (See N21 and N44.)
4. "How do I prove to the auditor which firewall rule allowed a packet through
   on a given date?" (Hint: flow logs — see N54.)

### Part D — Cloud Interconnect exploration [needs cloud account]

In GCP (free-tier project is sufficient to explore the UI; provisioning
Interconnect requires an account):

```bash
# List available Interconnect locations near Mumbai
gcloud compute interconnects locations list --filter="region:asia-south1"

# Show what a Cloud Router looks like (the BGP peer endpoint)
gcloud compute routers list --regions=asia-south1
```

In AWS Console: navigate to Direct Connect > Locations, filter for Mumbai
(`ap-south-1`). Note the provider names and connection speeds available.
Compare the provider list between GCP and AWS — they often differ, which affects
the physical diversity of your dual-cloud hybrid design.

## Say it back (self-check)

1. State Meridian's full IP plan — on-prem supernet, GCP block, AWS block — and
   explain why they must not overlap even though all three are RFC 1918 ranges.

2. A packet from `10.100.4.5` (GCP prod app) arrives at the on-prem CDE segment.
   Name every hop and every policy decision point it crossed (GCP firewall →
   Cloud Interconnect → on-prem edge → on-prem firewall).

3. What is the difference between a Transit Gateway (AWS) and a hub VPC + VPC
   Peering (GCP)? When does each approach run into scale limits?

4. A developer asks: "Can I just VPC-peer GCP prod directly to AWS prod for
   lower latency?" Give the correct answer and the one-line reason.

5. Why does placing all GCP prod workloads in `asia-south1` satisfy RBI
   data-residency, and what additional controls must also be in place?

## Talk to the IT/security head

**Ask:**

- "Is the Cloud Interconnect physically diverse — do the two 10 Gbps links
  enter the data center on separate fibres, separate carriers, separate PoPs?"
  *Good answer: yes, diverse entry points, different carrier for each bundle.
  Red flag: single carrier, single entry — a contractor's backhoe kills both.*

- "Who owns the BGP route policy on the on-prem CE router — the network team
  or the cloud team? And who approves a change to it?"
  *Good answer: network team owns, cloud team requests, CAB approves. Red flag:
  'the cloud team just adds what they need' — that is an audit finding waiting
  to happen; BGP misconfiguration can blackhole all cloud traffic.*

- "The GCP prod VPC is peered to the hub. Can workloads in GCP non-prod reach
  the hub — and transitively, the CDE?"
  *Good answer: VPC peering is not transitive by default; non-prod is a separate
  peering and the hub's firewall drops non-prod source ranges to CDE destinations.
  Red flag: 'I think the firewall handles it' with no named rule — not a controlled
  boundary.*

- "If a new application team wants a new subnet in GCP prod, what is the
  provisioning lead time and approval path?"
  *Good answer: IaC (Terraform) PR, peer-reviewed, approved by network lead and
  security, applied in the next change window — typically days not weeks.
  Red flag: weeks or months — that velocity will kill digital channels.*

- "How are flow logs retained, and who can query them in an incident?"
  *Good answer: VPC Flow Logs exported to Cloud Logging / S3, retained 90 days
  minimum (or longer per RBI), accessible to SOC under documented access policy.
  Red flag: 'we have logs somewhere' — not a controlled evidence chain.*

**Red flags to listen for overall:**
- No named firewall rule for the CDE path — "it's just blocked by default" is
  not auditable.
- BGP summarisation not decided — individual /16 advertisements cause route-table
  sprawl at scale; but summarising too aggressively hides which VPCs are active.
- VPC peering assumed to be transitive — it is not (GCP or AWS); this is a
  frequent design error that creates unexpected isolation or unexpected access.
- Relying on a single Interconnect/Direct Connect circuit with no failover to
  IPsec VPN — violates the bank's DR requirements and any HA SLA.

## Pitfalls & war stories

**The overlap mistake in production.** A bank's cloud team chose `10.10.0.0/16`
for their GCP VPC because "that's what the Terraform template defaulted to." The
on-prem team had been using `10.10.0.0/16` for HQ for years. The Cloud
Interconnect came up, BGP routes were exchanged, and for 48 hours no one could
explain why some on-prem servers were intermittently unreachable from cloud — the
router was learning two conflicting /16 routes and alternating. Fix: re-number
the cloud VPC. Cost: three weekends. Prevention: running-example.md IP plan,
enforced at the Terraform variable layer from day one.

**VPC peering transitivity assumed.** A development team in GCP non-prod noticed
they could resolve `core.meridian.internal` via DNS (the DNS peering was applied
hub-wide). They assumed routing would follow and filed a ticket saying "we can
see the hostname but can't connect." The firewall blocked them — but the fact
that DNS worked gave them the address of the CDE endpoint. Lesson: DNS peering
scope and routing scope are independent. Control both or you leak information
even when traffic is blocked.

**BGP route leak from the wrong team.** A cloud engineer added a static route
in the GCP hub VPC to `0.0.0.0/0` pointing at a NAT gateway for testing. That
route was redistributed into BGP and advertised to HQ-DC1, which began using
GCP as its default route to the internet — for all branch traffic. Internet
performance degraded; the network team spent four hours finding it. Lesson:
every BGP redistribution policy must be explicit and reviewed. No default route
into or out of a hybrid backbone without explicit CAB approval.

**The DR circuit that was never tested.** Meridian had a secondary IPsec VPN
configured as failover for the Cloud Interconnect. In the DR test, the VPN
came up but the BGP session did not — the pre-shared key had been rotated on the
on-prem side and not updated in GCP's Cloud Router. Lesson: DR paths must be
tested under load at least quarterly. A configured path is not a working path.

## Going deeper (optional)

- GCP: [Cloud Interconnect overview](https://cloud.google.com/network-connectivity/docs/interconnect/concepts/overview) — BGP setup, VLAN attachments, redundancy requirements.
- AWS: [Direct Connect user guide](https://docs.aws.amazon.com/directconnect/latest/UserGuide/Welcome.html) — virtual interfaces, BGP communities, failover to VPN.
- RFC 4364 — MPLS/BGP VPNs: the on-prem model that Cloud Interconnect is designed to connect to.
- RFC 7938 — Use of BGP for routing in large-scale data centers: explains why the hub VPC uses BGP even inside a cloud provider.
- PCI-DSS v4.0 requirement 1.3: network access controls to/from the CDE — the specific language the auditor will cite.
- Pairs with N48 (hub-and-spoke topology), N49 (landing zones), N50 (hybrid DNS), N54 (flow logs), N56 (design-review playbook), and S40 (security capstone for the same architecture).

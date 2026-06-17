# Kata N39 — The VPC mental model: GCP vs AWS vs Azure

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N08, N09, N15, N36, N38 · **Time:** ~35 min
> **Tags:** `vpc` `cloud` `networking` `subnets` `regions` `mental-model` `gcp` `aws`

## Why it matters

When an architect says "we'll put the app in a VPC," they usually mean something
different depending on which cloud they're working in — and that difference matters
the moment you add a second region, peer two teams' networks, or try to route
traffic between GCP and AWS. The network team and the IT head are already thinking
in on-prem concepts (routers, subnets, VLANs, firewall zones). Your job is to
translate precisely: *what is the cloud equivalent, where does it break down, and
where do the teams need to agree before the first VM is deployed?*

Getting this wrong in design causes IP overlap (see N11), peering dead-ends (N43),
and the hybrid routing nightmares the IT head has already lived through on-prem.

## The mental model

### The problem a VPC solves

On-prem, you define a private network by physically or logically separating it
from the internet — a router/firewall sits at the edge, and nothing enters unless
you explicitly allow it. In the cloud, the hypervisor is shared infrastructure
accessible from the internet. A **Virtual Private Cloud (VPC)** is the cloud
provider's answer to the same question: carve out an isolated L3 domain in shared
infrastructure that behaves like your own private network.

```
  On-prem data center                  Cloud VPC (abstract model)
  ┌───────────────────────────┐         ┌───────────────────────────────┐
  │  Firewall / edge router   │         │  VPC (your private namespace) │
  │  ┌──────────────────────┐ │         │  ┌──────────┐ ┌────────────┐ │
  │  │  10.10.0.0/16        │ │         │  │ subnet-A │ │  subnet-B  │ │
  │  │  (routed block)      │ │         │  │ 10.x/24  │ │  10.y/24   │ │
  │  │  VLANs segment zones │ │         │  └──────────┘ └────────────┘ │
  │  └──────────────────────┘ │         │  implicit router + FW rules   │
  └───────────────────────────┘         └───────────────────────────────┘
```

The on-prem mental model is: "I have a flat IP block, I carve VLANs, and a
firewall enforces zones." The cloud model is: "I declare a VPC (the IP block), I
carve subnets, and cloud-native rules (not a separate appliance) control traffic
within and across it."

### The critical difference: GCP's VPC is global; AWS's VPC is regional

This is the single most important fact in this kata.

```
  GCP VPC — GLOBAL                       AWS VPC — REGIONAL
  ┌──────────────────────────────────┐   ┌──────────────────────────────────┐
  │ VPC: meridian-prod-vpc           │   │ VPC: meridian-prod (ap-south-1)  │
  │ (one logical network, worldwide) │   │ (exists in ONE region)           │
  │                                  │   │                                  │
  │  Region: asia-south1             │   │  AZ: ap-south-1a                 │
  │  Subnet: 10.100.32.0/24 ─────┐   │   │  Subnet: 10.104.0.0/24 (pub) ─┐ │
  │                              │   │   │  Subnet: 10.104.1.0/24 (prv) ─┤ │
  │  Region: us-central1         │   │   │                                │ │
  │  Subnet: 10.100.0.0/24 ──────┤   │   │  AZ: ap-south-1b               │ │
  │  Subnet: 10.100.1.0/24 ──────┤   │   │  Subnet: 10.104.2.0/24 (prv) ─┘ │
  │                              │   │   └──────────────────────────────────┘
  │  Same VPC; same firewall     │   │   To add another region in AWS:
  │  rules apply across regions  │   │   → create a SECOND VPC in that region
  └──────────────────────────────┘   │     + peer it, or use Transit Gateway
```

**GCP:** One VPC spans all regions. You create subnets *per region*, but they all
belong to the same VPC. A firewall rule that says "allow port 443 to the app
servers" applies identically in Mumbai and Iowa without duplication.

**AWS:** A VPC lives in exactly one region. If you need workloads in two regions,
you create two VPCs (one per region) and then connect them via VPC Peering or
Transit Gateway (see N43). Every policy lives in its own VPC and must be
replicated or referenced explicitly.

**Azure VNet** follows the AWS regional model: one VNet per region. Multiple
VNets connect via VNet Peering or Virtual WAN.

### Subnets and Availability Zones

```
  GCP subnet = regional, spans all zones in that region
  ┌────────────────────────────────────────────────┐
  │ Subnet: 10.100.0.0/24  Region: asia-south1     │
  │   VM in asia-south1-a gets 10.100.0.5          │
  │   VM in asia-south1-b gets 10.100.0.6  ← same  │
  │   VM in asia-south1-c gets 10.100.0.7    subnet │
  └────────────────────────────────────────────────┘

  AWS subnet = per-AZ (you choose the zone at subnet creation)
  ┌────────────────────────────────────────────────┐
  │ ap-south-1                                     │
  │  ┌─────────────────────┐ ┌───────────────────┐ │
  │  │ subnet-prv-1a       │ │ subnet-prv-1b     │ │
  │  │ 10.104.1.0/24  AZ-a │ │ 10.104.2.0/24    │ │
  │  │                     │ │ AZ-b              │ │
  │  └─────────────────────┘ └───────────────────┘ │
  │  In AWS you must create one subnet per AZ if   │
  │  you want multi-AZ high availability.           │
  └────────────────────────────────────────────────┘
```

**Implication for IP planning:** in AWS you need to pre-allocate separate CIDR
blocks for each AZ-specific subnet. In GCP, one subnet CIDR covers all zones in
the region — simpler IP planning, but you lose per-zone isolation at the subnet
boundary (you use firewall rules for zone-level control instead).

### The implicit router

In both clouds, there is **no router appliance you configure**. Every VPC has a
built-in, automatically maintained router (GCP calls it the "VPC router"; AWS
calls it the "implicit router" / "local route"). It knows every subnet CIDR in the
VPC and routes between them automatically. You influence routing via route tables,
but you don't manage the routing daemon.

On-prem analogy: imagine your L3 core switch's routing table was managed entirely
by the cloud, and you could only add static routes on top of it. That's the model.

### Public vs private subnets (AWS term; GCP models it differently)

In AWS, the concept of a "public subnet" is explicit: a subnet whose route table
has a default route (`0.0.0.0/0`) pointing to an **Internet Gateway (IGW)**. Any
EC2 instance in that subnet with a public IP can reach the internet and be reached
from it. A "private subnet" routes `0.0.0.0/0` to a NAT Gateway instead —
instances can initiate outbound internet traffic but are not directly reachable.

GCP does not use the "public vs private subnet" terminology. Instead, GCP VMs
have an "external IP" attribute (optional). Whether traffic can reach them from
the internet is governed by firewall rules, not subnet routing. The routing is
still there (`0.0.0.0/0` → default internet gateway when an external IP exists),
but the *mental model* is firewall-first, not subnet-boundary-first.

```
  AWS model                       GCP model
  subnet type determines          firewall rule + external IP
  internet reachability           determines internet reachability
  (route table with/without IGW)  (subnet routing is mostly uniform)
```

## Worked example

Meridian Bank is deploying its new mobile-banking backend on GCP (primary) with a
secondary on AWS for DR (see `reference/running-example.md`). The cloud IP plan
reserves non-overlapping ranges to support hybrid routing without NAT:

```
  HQ-DC1 (on-prem):    10.10.0.0/16
  GCP allocation:      10.100.0.0/14  (10.100.0.0 – 10.103.255.255)
  AWS allocation:      10.104.0.0/14  (10.104.0.0 – 10.107.255.255)
```

These /14s are *IPAM reservation envelopes* — non-overlapping ranges set aside
for each cloud, not the CIDR of any single VPC. On GCP a VPC has no fixed block,
so its subnets simply draw from the allocation. On AWS a single VPC's primary
IPv4 CIDR is capped at /16 (min /28), so the AWS VPC uses one /16 (e.g.
`10.104.0.0/16`) as its primary CIDR, adding secondary CIDRs from the rest of the
/14 only if it needs more space.

**GCP side — global VPC "meridian-prod":**

```
  Subnet                  CIDR             Region         Purpose
  ────────────────────────────────────────────────────────────────────
  prod-app-india          10.100.32.0/24   asia-south1    App tier (Mumbai)
  prod-data-india         10.100.33.0/24   asia-south1    Data tier (Mumbai)
  prod-app-us             10.100.0.0/24    us-central1    Non-prod / analytics
  prod-mgmt               10.100.128.0/24  asia-south1    Bastion / ops

  All four subnets belong to ONE VPC. A firewall rule "allow port 8080 from
  prod-app-india to prod-data-india" is applied globally (tag-based), not
  per-subnet. The GCP VPC router handles inter-subnet routing automatically.
```

Data residency requirement: Meridian's PCI-scoped cardholder data must remain in
India. The architect places `prod-data-india` in `asia-south1` (Mumbai) and uses
GCP's **VPC Service Controls** (see N44) to prevent data exfiltration. The global
VPC makes firewall policy uniform, but the architect must verify that subnets
containing regulated data are never routed to out-of-country regions — that is a
policy choice, not automatic.

**AWS side — regional VPC in ap-south-1 (Mumbai), primary CIDR `10.104.0.0/16`
(drawn from the `10.104.0.0/14` allocation):**

```
  Subnet                  CIDR             AZ              Purpose
  ────────────────────────────────────────────────────────────────────
  pub-1a                  10.104.0.0/25    ap-south-1a     NAT GW, bastion (126 hosts)
  prv-app-1a              10.104.1.0/24    ap-south-1a     App tier AZ-a  (254 hosts)
  prv-app-1b              10.104.2.0/24    ap-south-1b     App tier AZ-b  (254 hosts)
  prv-data-1a             10.104.3.0/24    ap-south-1a     Data tier AZ-a (254 hosts)
  prv-data-1b             10.104.4.0/24    ap-south-1b     Data tier AZ-b (254 hosts)

  /25 check: 10.104.0.0/25 → hosts 10.104.0.1–10.104.0.126, broadcast .127  ✓
  /24 check: 10.104.1.0/24 → hosts 10.104.1.1–10.104.1.254, broadcast .255  ✓
  All within VPC primary CIDR 10.104.0.0/16 (10.104.0.0–10.104.255.255)      ✓
  No overlap with GCP (10.100–10.103) or on-prem (10.10)                      ✓
```

The AWS architect must create per-AZ subnets to get multi-AZ high availability.
That doubles the number of subnet CIDRs versus the GCP design. This is normal for
AWS and must be factored into IP planning (see N40).

> **Note on host counts.** The figures above (254 for a /24, 126 for a /25, 62
> for a /26) are *raw* CIDR usable counts (`2^(32-prefix) - 2`, subtracting only
> the network and broadcast addresses). Real cloud subnets reserve more per
> subnet: GCP reserves 4 IPs (≈252 usable in a /24) and AWS/Azure reserve 5
> (≈251 usable in a /24, 11 in a /28 — see Part 3 and `reference/cheatsheet-cidr.md`).
> When sizing a *tight* subnet, plan against the cloud's post-reservation count,
> not the raw figure (covered in depth in N40).

**Why non-overlapping matters:** When Meridian connects HQ-DC1 to GCP via Cloud
Interconnect (N38) and to AWS via Direct Connect (N38), the on-prem routers learn
routes for `10.100.0.0/14` (GCP) and `10.104.0.0/14` (AWS) as distinct prefixes.
If those blocks overlapped each other or with `10.10.0.0/16`, the routing table
would be ambiguous and traffic would be misrouted or dropped with no obvious error
message. This is the number-one IP planning mistake on cloud migration projects.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Private network container | Routed VLAN set / VRF | VPC (global scope) | VPC (regional scope) | VNet (regional scope) |
| Subnet | IP subnet on a VLAN | Regional subnet (spans all AZs in region) | AZ-scoped subnet (one per AZ) | Subnet (spans all AZs in region) |
| Subnet-to-subnet routing | L3 core switch / inter-VLAN routing | Automatic (VPC router, no config) | Automatic (implicit router, no config) | Automatic (system routes) |
| Custom routing | Static routes on router | Cloud Router + static routes | Route Table (one per subnet) | Route Table (User Defined Routes) |
| Internet edge | Perimeter firewall / ISP handoff | Cloud NAT + external IP on instance | Internet Gateway (IGW) + public subnet | (Azure: TODO) |
| Outbound internet (private) | Proxy / NAT appliance | Cloud NAT (managed, regional) | NAT Gateway (per-AZ, attached to subnet) | (Azure: TODO) |
| Packet filtering | Firewall / ACL appliance | VPC Firewall Rules (tag/SA-based, stateful) | Security Groups (stateful) + NACLs (stateless) | NSG (stateful, per-subnet or per-NIC) |
| Multi-region networking | MPLS / WAN backbone | Native (one VPC spans regions) | VPC Peering or Transit Gateway | VNet Peering or Virtual WAN |
| Private cloud-to-cloud link | Leased line / MPLS | Cloud VPN / Cloud Interconnect | Site-to-Site VPN / Direct Connect | (Azure: TODO) |
| IP address scope | RFC 1918 private ranges | RFC 1918 private ranges | RFC 1918 private ranges | RFC 1918 private ranges |
| VPC/subnet CIDR sizing | Site-dependent | Subnet /29–/8 (no fixed VPC block) | VPC CIDR /16–/28 per block (secondary CIDRs allowed to exceed 65k); subnet /16–/28 | VNet/subnet by address space (secondary ranges allowed) |

**The key row:** the VPC scope (global vs regional) and the subnet AZ scope are
where GCP and AWS diverge most visibly. Everything downstream — peering, firewall
policy, HA design, IP planning — flows from that difference.

## Do it (the exercise)

**Part 1 — Paper: IP plan for Meridian's GCP VPC** [laptop]

Using Meridian's GCP allocation `10.100.0.0/14`, carve the following subnets and
verify the math:

1. `prod-app-india` — needs up to 200 hosts in `asia-south1`. Choose the smallest
   /prefix that fits. (Answer: in GCP a /24 gives **252** usable addresses — GCP
   reserves 4 per subnet: the network address, the `.1` gateway, and the
   second-to-last and last addresses. 200 fits a /24; a /25 gives only **124**
   usable — too few.)
2. `prod-data-india` — 50 hosts. What's the smallest prefix? (Answer: a /26 gives
   **60** usable in GCP — `10.100.33.0/26` spans `.0`–`.63` with `.0`, `.1`, `.62`,
   and `.63` reserved, leaving `.2`–`.61`. 50 fits.)
3. Confirm all chosen CIDRs are within `10.100.0.0/14`. (Range: `10.100.0.0` to
   `10.103.255.255`. Any `10.100.x.x` or `10.101–103.x.x` fits.)

**Part 2 — Paper: AWS subnet plan for ap-south-1** [laptop]

From the AWS allocation `10.104.0.0/14`, use `10.104.0.0/16` as the VPC's primary
CIDR (remember a single AWS VPC primary CIDR is capped at /16), then carve a
multi-AZ design for two AZs with app and data tiers. No subnet should have fewer
than 50 hosts.

1. List your CIDRs with AZ assignments.
2. Verify no overlap between any two subnets.
3. Confirm all are within the VPC's `10.104.0.0/16`.

**Part 3 — Observation: compare the VPC models** [laptop]

Using the GCP and AWS free tiers or the cloud console documentation (no billable
resources needed), answer:

- In GCP, how many subnets can a single VPC contain, and do they have to be in the
  same region? (Hint: VPC quotas page in GCP docs.)
- In AWS, if you have a VPC with primary CIDR `10.104.0.0/16`, what is the minimum subnet size the
  console allows? (Answer: /28 = 16 addresses, 11 usable after AWS reserves 5.)
- AWS reserves 5 IP addresses per subnet. Which are they? (First four + last:
  `.0` network, `.1` VPC router, `.2` DNS, `.3` reserved for future, `.255`
  broadcast.) [needs cloud account to observe, but verifiable in AWS docs]

**Part 4 — Conceptual** [laptop]

Draw (on paper or a text file) Meridian's final dual-cloud network showing:
- HQ-DC1 `10.10.0.0/16`
- GCP VPC (from the `10.100.0.0/14` allocation) with two regional subnets in `asia-south1`
- AWS VPC primary CIDR `10.104.0.0/16` (from the `10.104.0.0/14` allocation) with four AZ subnets in `ap-south-1`
- Arrows showing: Interconnect (HQ → GCP), Direct Connect (HQ → AWS), and
  the hybrid routing requirement that no CIDR overlaps.

## Say it back (self-check)

1. State the single biggest structural difference between a GCP VPC and an AWS VPC.
   Why does it matter when you add a second region?
2. In AWS, why must you create a separate subnet for each Availability Zone if you
   want multi-AZ high availability? What would happen if you put everything in one
   subnet?
3. What is an "implicit router" in a cloud VPC, and what does it replace from the
   on-prem world?
4. In AWS, what is the difference between a "public subnet" and a "private subnet"?
   What makes the difference — the route table or the subnet setting?
5. Meridian has `10.100.0.0/14` for GCP and `10.10.0.0/16` for HQ-DC1. Why is it
   essential that these do not overlap, and what breaks at the network layer if they do?

## Talk to the IT/security head

**Ask:**

- "How is your cloud VPC design scoped — one VPC per region, one per environment
  (prod/dev/staging), or one per team/business-unit?"

  *A good answer:* a deliberate decision with a rationale tied to blast radius,
  peering limits, and IP space. For example: "One VPC per environment; prod is
  isolated; we peer to a shared-services VPC for DNS and logging." Red flag:
  "we just used the default VPC that came with the account" — the default VPC in
  AWS has open security groups and no deliberate IP plan; it is never acceptable
  in FSI or PCI scope.

- "Is your cloud IP plan documented, non-overlapping with on-prem, and reserved in
  your IPAM?"

  *A good answer:* yes, with a named owner, a CIDR allocation register, and a
  process for requesting new subnets. Red flag: "we just pick /24s when we need
  them" — overlaps will appear the moment you add a new cloud region or try to
  peer a newly acquired company.

- "How do firewall rules (or security groups) differ between your GCP and AWS
  deployments? Who owns those rules and how are changes approved?"

  *A good answer:* rules are declared as code (Terraform/CDK), reviewed in PRs, and
  applied through a pipeline — not hand-edited in the console. The network/security
  team owns the policy; individual app teams request rules through a change process
  (see N02). Red flag: "each team manages their own security groups in the console"
  — this leads to sprawl, inconsistency, and missed audit findings.

- "For data-residency compliance, how do you ensure that data in your India VPC
  subnets cannot be routed to or stored in non-India regions?"

  *A good answer in FSI context:* VPC Service Controls (GCP) or SCPs + resource
  policies (AWS) explicitly deny cross-region data access for the regulated
  data tier; this is tested quarterly and part of the compliance evidence package.
  Red flag: "the data is in India, so it's fine" — without an explicit control,
  a misconfigured route or a developer mistake can exfiltrate data silently.

**Red flags to listen for (summary):**

- Default VPC still in use for anything regulated.
- No IPAM or documented IP plan.
- "We'll deal with peering when we need it" — peering requires non-overlapping
  address space; retrofitting is painful.
- App teams self-managing firewall rules without a review process.
- No per-region subnet strategy in AWS (everything in one AZ).

## Pitfalls & war stories

**The GCP "everything in one VPC" trap.** GCP's global VPC is powerful, but it
tempts teams to put every environment (prod, staging, dev) in one VPC and use
firewall rules to separate them. When a firewall rule has a typo, production
and staging share a flat network. FSI clients need environment isolation enforced
at the VPC boundary, not just the rule level — a separate prod VPC whose firewall
cannot be edited by the dev team.

**The AWS AZ subnet miscounting.** An AWS architect plans "we need two AZs for
HA" and allocates two /24s. Then they add a data tier, a management tier, and
a DMZ — suddenly they need 10 subnets × 2 AZs = 20 CIDRs, and the /16 is already
half consumed. IP planning in AWS must account for the AZ multiplier upfront. See
Northwind's M&A IP sprawl (N11) for the FMCG version of this exact problem.

**The "we'll fix the overlap in NAT" assumption.** Northwind's acquired Eastfield
Foods brought `10.50.0.0/16` — same as Northwind's core block. The first instinct
is "just NAT one side." NAT solves reachability but breaks application-layer
protocols that embed IPs (FTP, SIP, some database clustering), complicates logging
(source IPs are translated, so you lose visibility), and is forbidden in PCI scope
where the CDE must be reachable via a routable path for audit. Non-overlapping
design is always cheaper than NAT workarounds.

**Confusing GCP subnet scope with AWS subnet scope.** A developer who learned AWS
first will try to make GCP subnets AZ-specific. They don't need to — a GCP subnet
covers all zones in the region. Creating four GCP subnets for four zones wastes
address space for no benefit.

**The "default VPC in prod" incident.** A well-known pattern: a bank's cloud team
spins up a proof-of-concept in the AWS default VPC (172.31.0.0/16, with a
default-open security group). The PoC becomes production before the VPC is ever
redesigned. The default security group allows all inbound from the same SG —
fine for isolated resources, catastrophic when ECS tasks, RDS, and a bastion
all share it.

## Going deeper (optional)

- GCP VPC documentation: "VPC network overview" — covers the global scope, subnet
  design, and implied rules.
  <https://cloud.google.com/vpc/docs/vpc>
- AWS VPC documentation: "How Amazon VPC works" — covers subnets, route tables,
  IGW, and the 5-reserved-IP rule.
  <https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html>
- RFC 1918 (private address ranges) — the foundation of all on-prem and cloud IP
  planning. Revisit N07 and N08 if the CIDR math above felt unfamiliar.
- Pairs with N40 (subnets, regions, zones, cloud IP planning in depth) and N42
  (cloud firewalls: GCP rules vs AWS Security Groups + NACLs vs Azure NSG).
- The peering and topology consequences of this design are in N43.
- Data-residency controls built on top of VPC isolation: N44 (Private Service
  Connect / PrivateLink) and S35 (cloud network security).

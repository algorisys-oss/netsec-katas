# Kata N52 — Shared VPC / centralized vs decentralized network ownership

> **Track:** Networking · **Module:** N9 Hybrid & multi-cloud · **Prereqs:** N39, N40, N41, N43, N48, N49 · **Time:** ~35 min
> **Tags:** `shared-vpc` `vpc` `cloud` `networking` `landing-zone` `segmentation` `gcp` `aws`

## Why it matters

When a bank or large FMCG moves to cloud, the first real fight is not about
which region to use — it is about **who owns the network**. Left unchecked, every
product team creates its own VPC, its own subnets, its own firewall rules, and its
own egress path. Within a year you have 40 isolated islands, none of which can talk
to each other without NAT, none of which an auditor can trace, and an egress bill
nobody predicted. The alternative — Shared VPC on GCP, centralized network accounts
on AWS — concentrates network ownership in a platform team while letting app teams
deploy freely inside pre-built boundaries. Understanding this split is what lets
you walk into a cloud design review and ask the question that exposes structural
risk before it is baked in.

## The mental model

### The problem: autonomous VPCs drift apart

In on-prem, the network team owns every switch, router and firewall rule. IP
addresses are allocated by one IPAM system. Nobody creates a new subnet without a
ticket. That control is sometimes frustrating — but it is also why audits can
produce a network diagram in three days.

Cloud self-service breaks this discipline. If any project can create a VPC and
pick whatever CIDR it likes, you get:

```
  Product team A       Product team B       Product team C
  ┌────────────┐       ┌────────────┐       ┌────────────┐
  │ VPC        │       │ VPC        │       │ VPC        │
  │ 10.0.0.0/16│       │ 10.0.0.0/16│       │ 10.0.0.0/16│  ← overlap!
  │ own rules  │       │ own rules  │       │ own rules  │
  └────────────┘       └────────────┘       └────────────┘
       ↑                    ↑                    ↑
  can't peer          can't peer           can't peer
  (overlap)           (overlap)            (overlap)
```

When team A's API eventually needs to call team B's service, you discover peering
is impossible. You reach for NAT. NAT breaks mutual TLS. The auditor asks for a
traffic map and you cannot produce one. (The on-prem analogue: the acquired
Eastfield Foods `10.50.0.0/16` overlap that Northwind inherited — see
`reference/running-example.md`.)

### The solution: separate ownership of the network from ownership of the workload

The core insight, as first principles:

```
  WHO OWNS THE SUBNET ≠ WHO OWNS THE WORKLOAD RUNNING IN IT.
```

On-prem this was always true (NetOps owns the VLAN; the app team owns the server).
Cloud makes it optional — and some teams abuse that freedom by owning both, which
removes the separation of duties that regulators expect.

Shared VPC (GCP) and centralized network accounts (AWS) restore that separation:

```
  ┌──────────────────────────────────────────────────────┐
  │  HOST PROJECT / NETWORK ACCOUNT (platform team owns) │
  │                                                      │
  │  Shared VPC / Transit Account                        │
  │  ┌──────────────────────────────────────────────┐   │
  │  │  Subnets (pre-carved, non-overlapping CIDR)  │   │
  │  │  Firewall rules (centrally managed)          │   │
  │  │  Cloud NAT, Cloud Router, BGP to on-prem     │   │
  │  └──────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ SERVICE      │  │ SERVICE      │  │ SERVICE      │
  │ PROJECT A    │  │ PROJECT B    │  │ PROJECT C    │
  │ (app team A) │  │ (app team B) │  │ (app team C) │
  │ VMs, GKE,    │  │ VMs, GKE,    │  │ VMs, GKE,    │
  │ Cloud Run    │  │ Cloud Run    │  │ Cloud Run    │
  └──────────────┘  └──────────────┘  └──────────────┘
```

App teams deploy workloads; they consume subnets that the platform team created.
They cannot change firewall rules or create new subnets without going through
the platform team — preserving the same segregation of duties that the auditor
expects from on-prem (see N02 on who owns what in the IT org).

### Centralized vs decentralized: a spectrum

Not every organisation wants full centralisation. The practical options, from tight
to loose:

```
  TIGHT ←──────────────────────────────────────────→ LOOSE

  Shared VPC          VPC peering          Independent VPCs
  (one network,        (separate VPCs       (full isolation;
   shared subnets)      with explicit        teams own
                        connections)         everything)

  Best for: FSI,       Best for: smaller    Best for: fully
  regulated,           orgs, simple         isolated products,
  audit-heavy          topologies           not needing to talk
```

The right answer is almost always context-dependent, but Meridian Bank's
regulatory constraints push them firmly toward the tight end.

## Worked example

Meridian Bank is building three cloud workloads in GCP:

1. **Mobile API** — internet-facing, calls core banking
2. **Analytics** — reads from a data warehouse, no internet exposure
3. **PCI CDE** — card data environment, tightly regulated, must be isolated

Without Shared VPC, three teams would each create their own VPC and the
following problems emerge immediately:

- Overlapping CIDRs block VPC peering.
- The PCI team's isolation is self-declared and hard to audit.
- No single egress point means no consistent DPI/inspection.

**With Shared VPC**, the platform team creates one host project with three
subnets carved from Meridian's GCP range `10.100.0.0/14`:

```
  GCP Host Project: meridian-network-host
  ┌───────────────────────────────────────────────────────────┐
  │  Shared VPC: meridian-vpc (region: asia-south1)           │
  │                                                           │
  │  subnet: mobile-api-subnet    10.100.0.0/24   (256 hosts) │
  │  subnet: analytics-subnet     10.100.1.0/24   (256 hosts) │
  │  subnet: pci-cde-subnet       10.100.2.0/24   (256 hosts) │
  │                                                           │
  │  VPC firewall rules (centrally owned):                    │
  │    allow: mobile-api → core-banking port 8443             │
  │    allow: analytics → data-warehouse port 5432            │
  │    deny:  pci-cde → internet (default)                    │
  │    deny:  analytics → pci-cde (explicit)                  │
  └───────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │ Service    │  │ Service    │  │ Service    │
  │ Project:   │  │ Project:   │  │ Project:   │
  │ mobile-api │  │ analytics  │  │ pci-cde    │
  │            │  │            │  │            │
  │ GKE pods   │  │ Dataflow   │  │ Payment    │
  │ Cloud Run  │  │ BigQuery   │  │ processor  │
  └────────────┘  └────────────┘  └────────────┘
```

Subnet math verification:
- `10.100.0.0/14` = 10.100.0.0 – 10.103.255.255 (2^18 = 262,144 addresses, 262,142 usable)
- `/24` subnets each have 256 addresses. Classic on-prem math leaves 254 usable
  (first = network, last = broadcast). **GCP reserves 4 addresses per subnet** —
  network address, default gateway, and the second-to-last and last addresses — so
  a GCP `/24` yields **252 usable IPs**. (GCP VPCs carry no broadcast traffic, so
  the "broadcast" framing is on-prem only.)
- `10.100.0.0/24`, `10.100.1.0/24`, `10.100.2.0/24` are all within the `/14` supernet
- No overlap, no NAT between subnets within the same VPC ✓

The PCI auditor can now ask: "show me every rule that could allow traffic to the
CDE subnet" — and the answer is a single VPC firewall rule list managed by one
team, not a patchwork of per-project firewalls.

**On AWS**, Meridian's secondary cloud uses a dedicated **Network Account** in
AWS Organizations, which holds the Transit Gateway and all shared subnets from
`10.104.0.0/14`. Application accounts are separate; they attach their VPCs to the
Transit Gateway and receive routes from the central account only. This mirrors the
GCP Shared VPC concept but uses a different mechanical model.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Network owner's domain | Network team (switches, routers, firewall) | Host project (holds Shared VPC) | Network Account (holds Transit Gateway, VPCs) | (Azure: TODO) |
| Shared subnet mechanism | VLAN + trunk, IP allocated by IPAM | Shared VPC: subnets in host project shared to service projects | AWS RAM (Resource Access Manager) sharing subnets from network account | (Azure: TODO) |
| Centralised routing hub | Core switch / MPLS core router | Cloud Router + VPC (GCP VPC is global) | Transit Gateway (regional; TGW peering for multi-region) | (Azure: TODO) |
| Firewall rule ownership | Network security team, changes via CAB | VPC firewall rules on host project; app teams cannot modify | Security Groups (per-ENI, app team owns) + NACLs (subnet, usually central) | (Azure: TODO) |
| IP allocation governance | IPAM (Infoblox, Bluecat) | Subnet creation in host project; app teams request, platform team allocates | IPAM in Network Account; subnets pre-created and shared | (Azure: TODO) |
| Isolation boundary for compliance | Separate VLAN + firewall zone (e.g. CDE VLAN) | Separate service project + subnet + targeted firewall rules | Separate VPC in network account or separate account with TGW attachment | (Azure: TODO) |
| Egress control | DMZ firewall, internet proxy | Cloud NAT + Cloud Router in host project; centrally managed | Internet Gateway or NAT Gateway in network account; route table controls | (Azure: TODO) |

### Key GCP vs AWS distinction

GCP's Shared VPC is **intra-project**: one VPC, many projects consuming it.
The VPC itself is global (spans all regions), so a single Shared VPC can serve
workloads in `asia-south1` and `us-central1` without peering.

AWS has no equivalent single-VPC-shared-across-accounts construct. Instead, the
pattern is: the Network Account pre-creates VPCs (one per region, sometimes per
environment), shares subnets via **AWS Resource Access Manager (RAM)**, and
routes everything through a **Transit Gateway**. App accounts launch resources
into those shared subnets. The result is similar in intent but requires more
moving parts and regional duplication.

## Do it (the exercise)

### Part 1 — Model the ownership split [laptop / paper]

1. Take Meridian Bank's three GCP workloads above. Draw two columns:
   - **Platform team owns** (network layer)
   - **App team owns** (workload layer)
   Fill in at least five items per column. Notice where the line sits.

2. Write the one question each of these roles would ask about the Shared VPC design
   (see N02 for their instincts):
   - IT head
   - Network team lead
   - CISO
   - PCI auditor

### Part 2 — Subnet carving [laptop / paper]

Meridian's GCP range is `10.100.0.0/14`. The platform team must carve subnets
for the following service projects:

| Service project | Max hosts needed | Required isolation |
|-----------------|------------------|-------------------|
| mobile-api      | 50               | internet-facing OK |
| analytics       | 120              | internal only      |
| pci-cde         | 30               | no internet, no cross-subnet by default |
| mgmt            | 10               | SSH/admin only     |

Assign a `/24` to each (all fit; use `10.100.0.0/24`, `10.100.1.0/24`, etc.).
Verify: does each `/24` fall within `10.100.0.0/14`?

`10.100.0.0/14` covers `10.100.0.0` through `10.103.255.255`.
`10.100.x.0/24` for x = 0..3 are all valid within this range. ✓

### Part 3 — Policy gap analysis [laptop / paper]

Your client's current cloud setup: every product team has its own GCP project and
creates its own VPC with whatever CIDR they choose.

List three specific audit findings or operational problems this will cause within
18 months. For each finding, state which Shared VPC control would have prevented it.

### Part 4 — GCP CLI inspection [needs cloud account]

If you have a GCP project with Shared VPC configured:

```bash
# List host projects in the organisation
gcloud compute shared-vpc organizations list-host-projects ORGANISATION_ID

# List service projects attached to a host project
gcloud compute shared-vpc associated-projects list HOST_PROJECT_ID

# List subnets shared into a service project
gcloud compute networks subnets list-usable --project SERVICE_PROJECT_ID

# Show VPC firewall rules (only viewable from host project)
gcloud compute firewall-rules list --project HOST_PROJECT_ID --format="table(name,direction,priority,sourceRanges,targetTags,allowed)"
```

On AWS with RAM-shared subnets:

```bash
# List subnets shared with your account
aws ec2 describe-subnets --filters "Name=owner-id,Values=NETWORK_ACCOUNT_ID"

# List Transit Gateway attachments
aws ec2 describe-transit-gateway-vpc-attachments --filters "Name=state,Values=available"
```

## Say it back (self-check)

1. In a Shared VPC design, what can an app team's service project do — and what
   can it *not* do — to the subnets it uses?
2. Why does IP overlap between team-owned VPCs kill peering, and what does that
   force you to use instead?
3. What is the on-prem analogue of a host project — who plays that role at a bank?
4. How does GCP Shared VPC differ from AWS RAM subnet sharing + Transit Gateway?
   Name one thing each makes easier.
5. A PCI auditor asks: "show me every path that could reach the CDE." In a
   decentralised (each-team-owns-VPC) model vs a Shared VPC model, which is faster
   to answer and why?

## Talk to the IT/security head

**Ask:**

- "Who owns the VPC and subnet definitions in your cloud account today — is it a
  central platform team or individual product teams?"
  *Good answer:* a named platform/network-cloud team owns the host project or
  network account; product teams request resources, not create them.
  *Red flag:* "each team manages their own." That means no consistent IP plan,
  probable CIDR overlap, and no single audit trail.

- "How do you enforce that product teams can't modify firewall rules or create
  subnets without approval?"
  *Good answer:* IAM bindings on the host project restrict `compute.firewalls.*`
  and `compute.subnetworks.create` to the platform team; OPA or Config Connector
  policies enforce guardrails.
  *Red flag:* "we trust the teams" or "we review PRs." Trust is not a control.

- "If the CISO asked today for a complete map of every firewall rule that could
  reach the CDE subnet, how long would that take?"
  *Good answer:* "minutes — all rules are on the host project's VPC, one place to
  look."
  *Red flag:* "it depends on each team's project" — that is days, not minutes,
  and the auditor will notice.

- "How is your cloud IP range allocated — is there a central IPAM or a landing-zone
  document?"
  *Good answer:* a reference document (like `running-example.md`) assigns ranges by
  environment and region; no team self-assigns.
  *Red flag:* "teams pick whatever is free" — overlap is a matter of when, not if.

- "What happens to the network configuration if a service project is deleted?"
  *Good answer (Shared VPC):* the subnet stays; only the workloads go away;
  the IP range can be reused cleanly.
  *Red flag:* "the team owns the subnet, so it all disappears" — that means data
  and routes could vanish with a project deletion.

## Pitfalls & war stories

**The overlap discovered at peering time.** A fintech migrated three teams to GCP
independently. All three used `10.0.0.0/16` (the default). When they tried to peer
the VPCs for a shared auth service, all three peering requests failed: GCP rejects
peering between VPCs with overlapping CIDRs. The fix — renumbering two VPCs — cost
three months and a change freeze. Northwind's Eastfield Foods acquisition (see
`running-example.md`) is the on-prem version of the same story.

**"We'll centralize later."** Every cloud journey starts with "move fast now,
tighten governance later." At Meridian Bank's scale, "later" means a migration
project bigger than the original cloud project. The cost of retrofitting Shared VPC
onto 40 existing service projects (renumbering subnets, rebuilding firewall rules,
migrating Kubernetes node pools) is routinely underestimated by 5×.

**Security group sprawl on AWS.** AWS lets each application team manage its own
Security Groups per ENI, even inside shared subnets. Without guardrails (AWS
Config rules, SCP denying broad `0.0.0.0/0` ingress) teams quietly open ports to
save time. The CISO gets a posture scan report with 200 findings and zero confidence
in the network model.

**Confusing "shared subnet" with "no isolation."** App team leads sometimes resist
Shared VPC because they think they will share IP space with other teams' running
workloads — that touching one team's VM could affect another. In practice, VMs in
different service projects sharing the same subnet are isolated by VPC firewall rules
(tagged or targeted by service account), just as VMs in the same VLAN on-prem are
isolated by firewall policy. Sharing the *network plane* does not mean sharing the
*security plane*.

**GCP quota blindspot.** GCP firewall rules, routes, and VPC peering connections
are quota-limited at the VPC level. In a Shared VPC, all service projects share
those quotas. A single service project that creates 200 firewall rules (perhaps via
Terraform without `count` guards) can exhaust the VPC quota and block all other
teams. Platform teams must implement Terraform policy (e.g., Sentinel or OPA) to
cap per-project rule creation.

## Going deeper (optional)

- GCP Shared VPC documentation (official):
  `https://cloud.google.com/vpc/docs/shared-vpc` — covers IAM roles, host/service
  project setup, and subnet sharing in detail.
- AWS Resource Access Manager for VPC subnet sharing:
  `https://docs.aws.amazon.com/ram/latest/userguide/shareable.html`
- AWS Transit Gateway design guides:
  `https://docs.aws.amazon.com/vpc/latest/tgw/tgw-best-design-practices.html`
- Google Cloud Architecture Framework — Resource Hierarchy:
  `https://cloud.google.com/architecture/framework/system-design/resource-hierarchy`
- RFC 1918 (private address space) — the document that defines the ranges you are
  carving. Every non-overlapping IP plan rests on it.
- Pairs with N48 (hub-and-spoke / Transit Gateway / NCC) for the routing layer
  above the subnet; N49 (landing zones) for the organisational scaffolding that
  makes Shared VPC policy-enforceable; and N43 (VPC peering at scale) to understand
  why peering breaks down when you have many VPCs and why Shared VPC or Transit
  Gateway replaces it.

# Kata N49 — Landing zones & network foundations

> **Track:** Networking · **Module:** N9 Hybrid & multi-cloud · **Prereqs:** N27, N38, N40, N42, N48 · **Time:** ~40 min
> **Tags:** `landing-zone` `vpc` `hub-and-spoke` `shared-vpc` `hybrid` `cloud` `gcp` `aws`

## Why it matters

"We're moving to cloud" becomes a project failure the moment five product teams
each provision their own VPCs with overlapping CIDRs, no central egress, no
consistent firewall baseline, and no way to add interconnect later without a
rebuild. A **landing zone** is the network (and IAM) foundation that prevents that
failure. For a bank, it is also the object the auditor examines: "show me that
every workload runs in an environment that meets your baseline controls." If you
cannot describe your client's landing zone, you cannot defend their cloud
architecture — and you will lose the design-review argument to the IT head before
it starts.

## The mental model

### What a landing zone is — from first principles

Before cloud existed, an enterprise data center had a **baseline physical
infrastructure** that every application consumed: a shared core switch/router
fabric, a DMZ firewall, DNS resolvers, central syslog, and an IP address plan
governed by the network team. No application team rolled its own core switch.

A landing zone is exactly that concept applied to cloud:

```
  On-prem data center analogy             Cloud landing zone equivalent
  ──────────────────────────────────────────────────────────────────────
  Core switch / router fabric         →   Hub VPC (Shared VPC / Transit VPC)
  Firewall (default-deny ruleset)     →   Centralized firewall / FW policy
  IP address plan (RFC 1918, no OL)   →   Non-overlapping VPC CIDR allocation
  MPLS/leased-line to HQ              →   Dedicated Interconnect / Direct Connect
  Central DNS resolver                →   Cloud DNS + forwarding policy (N50)
  Central logging / SIEM feed         →   Log sinks → SIEM / Chronicle / S3
  Change-control gate                 →   Policy as code (Org Policy / SCP)
  Separate VLANs per BU               →   Separate spoke VPCs per team/env
```

The key idea: the **network team's decisions are baked in once**, at the
foundation layer. Product teams get a pre-wired spoke; they cannot break the
baseline. This is especially important for regulated workloads — it means every
application inherits the CDE-separation controls without having to re-implement
them.

### The three-layer structure

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    ORG / MANAGEMENT layer                   │
  │  Billing accounts · Org Policies / SCPs · IAM root grants   │
  └───────────────────────────┬─────────────────────────────────┘
                              │ hosts
  ┌───────────────────────────▼─────────────────────────────────┐
  │                    NETWORKING (HUB) layer                   │
  │  Shared/Hub VPC · Interconnect/VPN termination              │
  │  Central firewall · Cloud DNS · NAT · Flow logs → SIEM      │
  └──────┬───────────────────┬───────────────────────┬──────────┘
  peers  │  peers            │  peers                │  peers
  ┌───────▼───────┐   ┌────────▼────────┐   ┌──────────▼──────────┐
  │  Spoke VPC    │   │   Spoke VPC     │   │    Spoke VPC         │
  │  prod-core    │   │   prod-digital  │   │    non-prod          │
  │ 10.100.64.0/18│   │ 10.100.128.0/17 │   │   10.101.0.0/16      │
  └───────────────┘   └─────────────────┘   └──────────────────────┘
  (PCI CDE scope)     (mobile banking)       (dev/test)
```

The hub does NOT host application workloads — it is purely infrastructure. Spokes
are kept thin: subnets, VMs/pods, no cross-spoke routes except via the hub
firewall. East-west traffic between spokes is forced through the hub where it can
be inspected (see N27 for why this matters in a PCI environment).

### What "network foundation" means concretely

Every landing zone must answer these five questions at day one:

1. **CIDR allocation** — are all VPCs non-overlapping with each other AND with
   on-prem? (Meridian Bank's supernet is `10.0.0.0/8`; cloud is `10.100.0.0/14`
   for GCP and `10.104.0.0/14` for AWS — see running-example.md.)
2. **Egress path** — does internet egress exit through a central NAT gateway/
   firewall, or does each spoke have its own? (Central = easier to audit/block;
   per-spoke = harder to control but sometimes cheaper.)
3. **Hybrid path** — where does the Dedicated Interconnect / Direct Connect
   attachment land? (Always in the hub; spoke traffic hair-pins through it.)
4. **DNS architecture** — where do spoke VMs resolve names? (Central inbound/
   outbound forwarding in the hub; see N50.)
5. **Baseline policy** — what can a spoke team NOT do? (Disable flow logs, attach
   a public IP to a database VM, use a non-approved region.)

Get these wrong at day one and you pay for it every week of the project.

## Worked example

### Meridian Bank: GCP landing zone

Meridian is building its digital banking platform on GCP (primary) with AWS as
secondary. They must not overlap with on-prem (`10.0.0.0/8`) and the two clouds
must not overlap with each other (they will eventually be connected via NCC and
Transit Gateway — see N48).

**CIDR allocation (GCP):**

```
  GCP supernet: 10.100.0.0/14  (10.100.0.0 – 10.103.255.255, 262,144 addresses)

  Hub VPC:         10.100.0.0/18    (0–63, network infra — no workloads)
    ├─ interconnect-subnet:  10.100.0.0/24   (VLAN attachments)
    ├─ firewall-subnet:      10.100.1.0/24   (Palo Alto / Cloud NGFW VMs if used)
    └─ dns-subnet:           10.100.2.0/24   (inbound DNS forwarder endpoints)

  Spoke: prod-core (PCI/CDE):   10.100.64.0/18   (10.100.64.0–10.100.127.255)
    ├─ db-subnet:            10.100.64.0/24   (PostgreSQL, internal only)
    ├─ app-subnet:           10.100.65.0/24   (core banking app)
    └─ mgmt-subnet:          10.100.66.0/24   (bastion, ops tooling)

  Spoke: prod-digital:           10.100.128.0/17  (10.100.128.0–10.100.255.255)
    ├─ api-subnet:           10.100.128.0/24  (mobile backend APIs)
    └─ jobs-subnet:          10.100.129.0/24  (batch/analytics)

  Spoke: non-prod:               10.101.0.0/16    (dev + staging, 65,536 addresses)
```

Verify the math: `10.100.0.0/14` covers `10.100.x.x` through `10.103.x.x`.
Hub `/18` = 16,384 addresses (bits: 14 network + 4 more = 18 prefix; 18 − 14 = 4
bits from the /14 supernet). It occupies `10.100.0.0–10.100.63.255`. The next
aligned `/18` block starts at `10.100.64.0`, so prod-core is a `/18`
(`10.100.64.0–10.100.127.255`) — a `/17` cannot start on a `/18` boundary, it
must align on `10.100.0.0` or `10.100.128.0`. prod-digital takes the upper `/17`
(`10.100.128.0–10.100.255.255`) and non-prod takes a `/16` from the next block.
No block touches `10.0–10.99` (on-prem) or `10.104+` (AWS).

**Traffic flow — mobile app calling the core banking API:**

```
  Mobile client (internet)
        │ HTTPS :443
        ▼
  Cloud Load Balancer (global, anycast)        ← terminates TLS, L7
        │ HTTP/2 to backend
        ▼
  prod-digital / api-subnet (10.100.128.0/24)
  Mobile Banking Service pod
        │ gRPC → 10.100.65.10:8080
        │ (crosses spoke boundary → must route through hub firewall)
        ▼
  Hub VPC / firewall: policy check
  rule: allow prod-digital → prod-core port 8080  if source-tag=mobile-api
        │ allowed; forwarded
        ▼
  prod-core / app-subnet (10.100.65.0/24)
  Core Banking API                              ← PCI CDE boundary starts here
```

Every cross-spoke call is logged at the hub firewall. The security team gets a
clear audit trail. The auditor asks "show me how mobile banking reaches the CDE"
and the answer is one firewall policy document.

**On-prem path (Cloud Interconnect):**

Meridian runs a 10 Gbps Dedicated Interconnect (see N38) with two VLAN
attachments in `asia-south1` (Mumbai, for data-residency). Both attachments land
in the hub VPC on the `interconnect-subnet` (`10.100.0.0/24`). Cloud Router
advertises the GCP supernet (`10.100.0.0/14`) to on-prem via BGP; on-prem
advertises `10.0.0.0/8`. The spoke VPCs reach on-prem by routing through the hub
(hub is the next-hop for the on-prem prefix). No spoke ever has direct
interconnect access — that is enforced by org policy.

### Northwind FMCG: AWS landing zone

Northwind's AWS landing zone via AWS Organizations + Control Tower:

```
  Management Account
  └── Root OU
       ├── Infrastructure OU
       │    └── Network Account   (Transit Gateway, Direct Connect)
       ├── Production OU
       │    ├── ERP Account       VPC: 10.104.0.0/17
       │    └── Analytics Account VPC: 10.104.128.0/17
       └── Non-prod OU
            └── Dev Account       VPC: 10.105.0.0/16
```

AWS supernet for Northwind: `10.104.0.0/14` (10.104.0.0–10.107.255.255).
The Network Account owns the Transit Gateway (see N48) — analogous to the GCP hub
VPC. Direct Connect attachment lands here. SCPs enforced at the OU level prevent
any account from: (a) disabling VPC Flow Logs, (b) creating internet gateways in
the production OU without approval, (c) launching resources outside `ap-south-1`
or `us-east-1` (Northwind's cost constraint: minimize inter-region egress).

Because Northwind acquired Eastfield Foods (which uses `10.50.0.0/16` — clashing
with Northwind's `10.50.0.0/16` on-prem range), cloud workloads use only the
`10.104.0.0/14` supernet. The overlap problem lives entirely on-prem and is
addressed with NAT at the DC edge, not in cloud.

## Cloud mapping

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Tenancy / billing root | Physical DC + org chart | GCP Organization (Cloud Identity/Workspace) | AWS Organization + Management Account | Azure Management Group hierarchy |
| Governance & guardrails | IT policy + CAB | Org Policy constraints | Service Control Policies (SCPs) + AWS Config rules | Azure Policy + Blueprints |
| Hub network | Core switch fabric + firewall | **Shared VPC** host project or hub VPC in VPC peering topology | **Network Account** owning the **Transit Gateway** | Azure Virtual WAN hub or hub VNet |
| Spoke isolation | VLANs / separate DC segments | Spoke VPC projects (VPC peering to hub) | Spoke VPCs attached to Transit Gateway | Spoke VNets peered to hub |
| Baseline firewall policy | Central firewall (Palo Alto, Fortinet, etc.) | **Hierarchical Firewall Policies** + Cloud NGFW | **Network Firewall** + Security Groups / NACLs | Azure Firewall + NSG policy |
| IP governance | IPAM (Infoblox, etc.) | Manual allocation + Org Policy deny invalid ranges | AWS IPAM (VPC IPAM) | Azure Virtual Network Manager |
| Dedicated connectivity | MPLS / leased line to DC | **Cloud Interconnect** (Dedicated or Partner) | **AWS Direct Connect** | **Azure ExpressRoute** |
| Central logging / telemetry | Syslog → SIEM | VPC Flow Logs → Log sink → Chronicle/Pub/Sub | VPC Flow Logs → S3 → Security Hub / SIEM | VNet flow logs → Log Analytics → Sentinel (NSG flow logs retired 2025) |
| Landing zone automation | Gold image + Ansible | **Cloud Foundation Toolkit** (CFT) / Terraform blueprints | **AWS Control Tower** + Landing Zone Accelerator | **Azure Landing Zone** (ALZ) Bicep/Terraform |
| Policy enforcement timing | Manual change-control | Org Policy (preventive), Security Command Center (detective) | SCPs (preventive), Config Rules (detective) | Azure Policy (preventive + detective) |

**GCP specifics worth knowing:**
- GCP VPCs are **global** (one VPC spans all regions); subnets are regional. A hub
  VPC therefore naturally covers `asia-south1` and `us-central1` without peering.
- **Shared VPC** (see N52) is an alternative model: spoke projects share subnets
  FROM the host project rather than owning their own VPCs and peering them. Shared
  VPC is preferred in Google's own reference architecture; peering-based hub-spoke
  is a common alternative when stricter spoke isolation is needed.
- **VPC peering is non-transitive**: spoke A cannot reach spoke B via the hub in a
  pure peering topology — traffic must be NATted or routed through a hub appliance.
  This is why many GCP designs use Shared VPC (no peering) or Network Connectivity
  Center (see N48) for transitive routing.

**AWS specifics:**
- AWS VPCs are **regional**; cross-region needs Transit Gateway inter-region
  peering or a separate TGW per region.
- **AWS Control Tower** provisions an Account Vending Machine — new spoke accounts
  get baseline config (org CloudTrail, AWS Config) automatically via Account
  Factory. GuardDuty is *not* part of this baseline; it is a separate, optional
  enablement (delegated-admin in the audit/security account, or added via Landing
  Zone Accelerator).
- SCPs are **deny-only** restrictions applied at OU level; they do not grant
  permissions — IAM still governs what is allowed within the boundary.

## Do it (the exercise)

**Step 1 — Paper: carve the CIDR plan** [laptop / paper]

Given Meridian Bank's constraint (on-prem `10.0.0.0/8`, GCP `10.100.0.0/14`,
AWS `10.104.0.0/14`):

1. Confirm `10.100.0.0/14` covers exactly `10.100.0.0` through `10.103.255.255`.
   - `/14` = 14 network bits; host bits = 32 − 14 = 18; 2^18 = 262,144 addresses.
   - Last address: `10.100.0.0 + 262,143` = `10.103.255.255`. ✓
2. Carve a `/18` hub VPC from `10.100.0.0/14`. What is the next available address
   after the hub?
   - `/18` = 2^(32−18) = 16,384 addresses. `10.100.0.0 + 16,384 = 10.100.64.0`.
   - Next block starts at `10.100.64.0`. ✓ Note that `10.100.64.0` is a `/18`
     boundary, not a `/17` boundary — a `/17` must align on `10.100.0.0` or
     `10.100.128.0`. So the spoke beginning at `10.100.64.0` is a `/18`
     (`10.100.64.0/18`), exactly the prod-core block from the worked example.
3. How many `/24` subnets fit inside a `/18` spoke? Answer: 2^(24−18) = 64.

**Step 2 — Audit a real public landing zone reference** [laptop]

```bash
# Read GCP's Cloud Foundation Toolkit landing zone reference (no account needed):
curl -s https://cloud.google.com/architecture/security-foundations \
  | grep -i "shared vpc\|org policy\|hub"
# Or browse: https://cloud.google.com/architecture/security-foundations
```

Read section 2 (network design). Note: Shared VPC vs hub-spoke peering trade-off,
and where Cloud NGFW / Hierarchical Firewall Policy sits.

For AWS, browse:
```
https://docs.aws.amazon.com/prescriptive-guidance/latest/security-reference-architecture/network.html
```
Note where the Network Account lives in the OU hierarchy and what Transit Gateway
ownership implies for the network team's control model.

**Step 3 — Map the five foundation questions** [paper]

For a client you know (real or invented), answer in writing:

1. What is the cloud CIDR supernet? Does it overlap on-prem or the other cloud?
2. Where does internet egress exit? Central NAT or per-spoke?
3. Where does Dedicated Interconnect / Direct Connect terminate?
4. Where do spoke VMs resolve DNS? Who controls the forwarding rules?
5. List three things a spoke team MUST NOT do, and which guardrail prevents it
   (Org Policy constraint name for GCP, or SCP statement for AWS).

**Step 4 — [needs cloud account] Inspect an existing landing zone**

If you have a GCP org:
```bash
# List org policies at the org level
gcloud org-policies list --organization=ORG_ID

# Show VPC peering for the hub project
gcloud compute networks peerings list --project=HUB_PROJECT_ID

# Check hierarchical firewall policies
gcloud compute firewall-policies list --folder=FOLDER_ID
```

If you have AWS:
```bash
# List SCPs attached to an OU
aws organizations list-policies-for-target \
  --target-id OU_ID \
  --filter SERVICE_CONTROL_POLICY

# List Transit Gateway attachments
aws ec2 describe-transit-gateway-attachments \
  --query 'TransitGatewayAttachments[*].{VpcId:ResourceId,State:State}'
```

## Say it back (self-check)

1. What five decisions must a landing zone answer on day one, before any
   application lands?
2. Why must the hub VPC hold no application workloads?
3. Explain why VPC peering is non-transitive in GCP, and what that means for
   spoke-to-spoke traffic in a hub-spoke peering topology.
4. What is the difference between an Org Policy constraint (GCP) / SCP (AWS) and
   an IAM policy? Which prevents something even if IAM would allow it?
5. Meridian Bank's Dedicated Interconnect lands in the hub, not in each spoke. Why,
   and what is the security benefit?

## Talk to the IT/security head

**Ask:**

- "Do you have a landing zone, or are teams provisioning VPCs ad-hoc?" *(the
  answer reveals whether you're building on rock or sand — ad-hoc = CIDR overlap
  and audit gaps waiting to happen)*
- "Where does your Dedicated Interconnect / Direct Connect terminate — in a central
  network account/project, or spread across workload accounts?" *(hub termination
  = auditable choke point; distributed = hard to inventory)*
- "What guardrails prevent a developer from disabling Flow Logs or attaching a
  public IP to a database?" *(if there's no answer, the control doesn't exist)*
- "Is your CIDR plan documented and centrally governed? Who approves a new VPC
  CIDR?" *(lack of IPAM governance = future overlap; at a bank, the auditor will
  ask this)*
- "How long does it take to provision a new spoke VPC that meets your baseline
  controls?" *(if >2 weeks, teams are working around the landing zone — which is
  itself a risk)*

**A good answer sounds like:** "We use [CFT / Control Tower / ALZ], new accounts
come out of Account Factory with baseline config in 20 minutes, SCPs block
non-approved regions and public egress by default, Interconnect is in the network
account only, CIDR is allocated from a master plan in [IPAM tool / spreadsheet
version-controlled in git]."

**Red flags:**
- "Each team does their own VPC setup" → no central control, CIDR collision
  imminent, audit gap.
- "We'll sort the CIDR plan later" → you cannot add Interconnect to an overlapping
  network without a painful rework.
- "Flow Logs are too expensive so we disabled them in dev" → if a breach starts in
  dev, you have no forensic trail.
- "The landing zone is being built by the cloud team — the network team isn't
  involved" → at a bank this is a segregation-of-duties red flag; the network team
  must own the hub.

## Pitfalls & war stories

**The CIDR-overlap rebuild.** A bank's cloud team launches five VPCs in `10.0.0.0/8`
ranges — overlapping on-prem. Dedicated Interconnect comes up 18 months later.
Result: every route fails, every VPC must be rebuilt with new CIDRs, VMs must be
re-deployed. Estimated cost: 6–8 weeks of engineer time. The fix: treat the CIDR
plan as immutable infrastructure, allocated before the first VM.

**The rogue spoke.** An analytics team stands up a VPC with its own internet
egress "just for the ML training cluster" — in GCP there is no per-VPC "internet
gateway" object (that is AWS terminology); they simply rely on the default route
to the `default-internet-gateway` next hop plus public IPs on the notebook VMs.
Six months later a compromised notebook with a public IP exfiltrates 40 GB of
modelling data. Org Policy `constraints/compute.vmExternalIpAccess` (which
restricts external IPs on VMs) would have blocked the public-IP exfiltration path;
it was not set. (For NAT-based egress you would instead reach for firewall egress
rules and `constraints/compute.restrictCloudNATUsage`, which governs which subnets
may use Cloud NAT — note that neither constraint removes the VPC's default
internet route by itself; egress control is layered.)

**"Control Tower is the landing zone."** AWS Control Tower provisions accounts with
baseline monitoring, but it is NOT the network layer. Teams that assume Control
Tower means "we have a landing zone" discover they have no Transit Gateway, no
central firewall, and no CIDR governance. The landing zone is the *combination* of
account structure + network topology + guardrails.

**FSI change-control trap.** At Meridian, a new spoke VPC requires a change
request (CAB approval, see N02). Teams that bypass this by using existing subnets
in the wrong spoke violate segmentation controls. The PCI auditor looks for
workloads classified CDE running alongside non-CDE in the same subnet — that is an
immediate finding.

**Non-prod speaks to prod.** Without explicit deny rules in the hub firewall, a
developer tests a connectivity shortcut from the non-prod spoke to the prod-core
database subnet. It works — because the hub firewall defaulted to allow intra-VPC
peering. Default-deny at the hub, enforced by Hierarchical Firewall Policy / AWS
Network Firewall, prevents this.

## Going deeper (optional)

- GCP Security Foundations blueprint:
  `https://cloud.google.com/architecture/security-foundations` — the canonical
  GCP landing zone reference, including Shared VPC vs hub-spoke trade-off.
- AWS Security Reference Architecture (SRA):
  `https://docs.aws.amazon.com/prescriptive-guidance/latest/security-reference-architecture/` —
  account structure, network account, TGW placement.
- AWS Landing Zone Accelerator on AWS:
  `https://aws.amazon.com/solutions/implementations/landing-zone-accelerator-on-aws/`
- Microsoft Azure Landing Zone (CAF):
  `https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/`
  (Azure: TODO — fill in hub VNet / Virtual WAN detail)
- Pairs with: N48 (hub-and-spoke / Transit Gateway / NCC), N52 (Shared VPC),
  N50 (hybrid DNS), N40 (cloud IP planning), N42 (cloud firewall rules), S32
  (shared-responsibility model).
- RFC 1918 — private address space (`10/8`, `172.16/12`, `192.168/16`) — the
  reason enterprise supernets live in these ranges.

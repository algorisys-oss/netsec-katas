# Kata N41 — Route tables, internet/NAT gateways, egress design

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N12, N16, N39, N40 · **Time:** ~35 min
> **Tags:** `cloud` `routing` `route-table` `internet-gateway` `nat-gateway` `egress` `gcp` `aws`

## Why it matters

Every cloud workload eventually needs to talk to something outside its VPC — an
external API, a software update server, the public internet. *How* that outbound
path is built determines your cost, your blast radius, your compliance posture,
and whether your security team will approve the design. A VPC with misconfigured
routes either locks down workloads silently (traffic dropped, no error, hours of
debug) or exposes private services to the internet inadvertently (audit finding,
possible breach). At Meridian Bank the CISO will ask: "which of our cloud
workloads can reach the internet directly, and which are forced through inspection?"
If you can't answer from the route table, you can't defend the design.

## The mental model

### On-prem first: what a route table is

Every device that forwards packets — a router, a Linux server, a cloud VPC — keeps
a **route table**: an ordered list of rules mapping destination prefixes to next
hops. When a packet arrives, the device finds the *most-specific* matching route
(longest prefix match) and forwards accordingly.

```
Destination         Next hop
─────────────────────────────────────────
0.0.0.0/0           192.168.1.1   ← default route: "anything not matched = gateway"
10.0.0.0/8          10.10.0.1     ← internal supernet: stay inside
192.168.10.0/24     10.10.5.2     ← specific subnet via site VPN
```

The key rule: **more specific always wins**.
`10.100.1.5` matches both `0.0.0.0/0` and `10.0.0.0/8` — the `/8` wins.

### Cloud adds resource-level gateways as next-hops

On-prem, the next-hop is always an IP (another router). In cloud, next-hops are
*named resources*: an Internet Gateway, a NAT Gateway, a peering connection, a
router appliance. The logic is identical; only the vocabulary changes.

### The four egress patterns (on-prem reasoning carries over)

```
Pattern 1 — Full private (no internet egress)
   VM ──► [route: 0.0.0.0/0 → NONE / drop]
   Use: CDE, regulated data tiers, databases. No outbound, no inbound.

Pattern 2 — NAT egress (outbound only, RFC 1918 source hidden)
   VM ──► NAT Gateway ──► Internet
         (private IP)    (NAT GW's public IP)
   Source IP becomes the NAT GW's public IP. Internet cannot initiate connections
   back to the VM. Equivalent to PAT/NAPT on an on-prem firewall (see N16).

Pattern 3 — Direct internet (public IP on the VM)
   VM ──► Internet Gateway (no NAT)
         (VM has a public IP)
   VM is internet-reachable. Dangerous for backend workloads; valid for
   bastion hosts / network appliances behind a security group.

Pattern 4 — Egress through inspection (hub/firewall VM)
   VM ──► Firewall VM / NGFW ──► NAT/Internet
         (route 0.0.0.0/0 → firewall VM)
   All traffic inspected before egress. Needed for PCI / RBI compliance.
   More complex and costs money; the firewall is now a chokepoint.
```

### Cloud terminology map

```
On-prem                        GCP                       AWS
─────────────────────────────────────────────────────────────────────────
Router / routing table         Cloud Router +            VPC Route Table
                               VPC routes
"Permit internet egress"       Internet Gateway*         Internet Gateway (IGW)
                               (route 0.0.0.0/0 →        + route 0.0.0.0/0 → IGW
                                default-internet-gateway)
PAT / NAPT outbound only       Cloud NAT                 NAT Gateway (managed)
Static private subnet           Private subnet            Private subnet
(no public IP, NAT for egress) (no ext IP, Cloud NAT)    (no public IP, NAT GW)
Public-IP subnet                Public subnet             Public subnet
(VM has ext IP, direct egress) (VM has ext IP,            (VM has public IP,
                                0.0.0.0/0 → inet-gw)     0.0.0.0/0 → IGW)
Firewall between zones         Cloud NGFW / Palo Alto VM  AWS Network Firewall / VM
```

*GCP's default route to the internet is called `default-internet-gateway` — it is
an implicit resource, not a separately deployed object as in AWS.

### GCP specifics: routes live in the VPC, subnets inherit them

GCP VPC routes are **VPC-wide** by default. Every subnet in the VPC sees the same
route table unless you apply **Tags** to routes (only traffic from VMs with a
matching network tag follows that route). This is the main behavioural difference
from AWS, where each subnet has its own independent route table.

```
GCP VPC "meridian-prod"
 ├── Subnet asia-south1-app   10.100.1.0/24
 ├── Subnet asia-south1-data  10.100.2.0/24
 └── Routes (VPC-wide):
      10.100.1.0/24  → local (subnet route, auto-created)
      10.100.2.0/24  → local (subnet route, auto-created)
      0.0.0.0/0      → default-internet-gateway  [tagged: internet-egress-allowed]
      0.0.0.0/0      → cloud-nat-router          [tagged: nat-egress]
      (no tag match) → implicitly dropped if no default route applies
```

### AWS specifics: each subnet has its own route table

In AWS, you explicitly associate a route table with each subnet. The same VPC can
have a private subnet (route table points `0.0.0.0/0` → NAT Gateway) and a public
subnet (route table points `0.0.0.0/0` → Internet Gateway) — entirely by which
route table is attached.

```
AWS VPC "meridian-prod"  10.104.0.0/14
 ├── Public subnet  ap-south-1a  10.104.0.0/24
 │    Route table:  10.104.0.0/14 → local
 │                  0.0.0.0/0     → igw-xxxxxxxx  (Internet Gateway)
 │
 └── Private subnet ap-south-1a  10.104.1.0/24
      Route table:  10.104.0.0/14 → local
                    0.0.0.0/0     → nat-xxxxxxxx  (NAT Gateway in public subnet)
```

NAT Gateway itself lives in the **public** subnet and holds a public Elastic IP;
private subnets route through it to reach the internet without themselves being
internet-addressable.

## Worked example

Meridian Bank's GCP environment in `asia-south1` (Mumbai, satisfying RBI
data-residency). GCP supernet: `10.100.0.0/14`.

### Subnet breakdown

| Subnet | CIDR | Purpose | Egress pattern |
|--------|------|---------|----------------|
| `asia-south1-app` | `10.100.1.0/24` | Mobile banking app tier | Pattern 2 (Cloud NAT) |
| `asia-south1-data` | `10.100.2.0/24` | Databases, card data (CDE) | Pattern 1 (no egress) |
| `asia-south1-mgmt` | `10.100.3.0/24` | Jump hosts, ops tooling | Pattern 2 (Cloud NAT) |

CIDR math check:
- `10.100.0.0/14` covers `10.100.0.0` – `10.103.255.255` (2^18 = 262,144 addresses).
- Each `/24` is a slice of 256 addresses (252 usable in GCP after 4 reserved).
- The three subnets above (`.1`, `.2`, `.3`) are well within that supernet.

### Route table (GCP)

```
Route name                Priority  Destination    Next hop
──────────────────────────────────────────────────────────────────────────────
subnet-route-app          0         10.100.1.0/24  local (VPC fabric)
subnet-route-data         0         10.100.2.0/24  local (VPC fabric)
subnet-route-mgmt         0         10.100.3.0/24  local (VPC fabric)
nat-egress-app            1000      0.0.0.0/0      Cloud NAT router    [tag: nat-egress]
nat-egress-mgmt           1000      0.0.0.0/0      Cloud NAT router    [tag: nat-egress]
```

GCP has no "blackhole" / "drop" next-hop — a VPC route's next hop must be a real
resource (the default internet gateway, an instance, an internal load balancer, a
VPN tunnel, or a peering). You deny egress by **the absence of an applicable
default route**, not by a fake drop route.

VMs in `asia-south1-app` and `-mgmt` carry the network tag `nat-egress`, which
matches the two `0.0.0.0/0` routes above. VMs in `asia-south1-data` carry no such
tag, so **no `0.0.0.0/0` route applies to them at all** — there is simply no path
to any external next-hop, and outbound internet traffic from them is dropped at
the VPC level (the mechanism noted earlier: "no tag match → implicitly dropped if
no default route applies"). For belt-and-suspenders, pair this with an
egress-deny VPC firewall rule (or a hierarchical firewall policy) targeting the
data subnet. This is what the auditor wants: provable isolation at the routing
layer, not just the firewall layer.

### Cloud NAT egress IP

Cloud NAT is configured on the Cloud Router in `asia-south1`. It is assigned a
reserved static external IP, e.g. `34.100.150.10` (illustrative). Every outbound
connection from app-tier VMs appears to the internet as
coming from that single IP. Meridian's security team can whitelist that IP at
external partners — one IP, not 50 VM IPs.

### The compliance question this answers

PCI-DSS Requirement 1.3 mandates **restricting** traffic to and from the CDE to
only what is authorized and necessary — it does not flatly ban all outbound
traffic (v3.2.1 Req 1.3 prohibits *direct public access* between the internet and
CDE components, with 1.3.4 limiting unauthorized outbound; v4.0 Req 1.3.2:
"outbound traffic from the CDE is restricted to only that which is necessary").
Authorized, justified outbound is permitted with controls. Here Meridian's data
tier needs *no* internet egress, so the simplest control is to allow none: the
absence of a default route for `asia-south1-data` limits its outbound traffic to
only authorized destinations (i.e. none external) at the routing layer. The
firewall rules (see N42) add a second layer (defense in depth — recall S01). Both
are needed because the auditor will ask for both.

### Equivalent AWS design (for comparison)

Meridian's AWS environment: `10.104.0.0/14` in `ap-south-1` (Mumbai).

```
Subnet               CIDR             Route table             Egress
────────────────────────────────────────────────────────────────────────────
meridian-app-1a      10.104.1.0/24   private-rt (→ NAT GW)  NAT only
meridian-data-1a     10.104.2.0/24   no-egress-rt (local only)  None
meridian-mgmt-1a     10.104.3.0/24   private-rt (→ NAT GW)  NAT only
meridian-natgw-1a    10.104.0.0/24   public-rt  (→ IGW)     Direct (holds EIP)
```

The NAT Gateway lives in `meridian-natgw-1a` (a public subnet), with an Elastic
IP address. Private subnets route `0.0.0.0/0` to that NAT Gateway. The data
subnet's route table contains *only* the `10.104.0.0/14 → local` entry — there is
no default route, so all other traffic is dropped.

Key difference from GCP: in AWS you must **deploy** the NAT Gateway as a resource
(billable per hour + per GB). In GCP, Cloud NAT is also a separate resource
configured on a Cloud Router, but the networking model — VPC-wide routes with tags
vs per-subnet route tables — requires you to think differently.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Route table | Router RIB / static routes | VPC Routes (VPC-wide; tags control scope) | VPC Route Table (per-subnet association) | (Azure: TODO) |
| "Allow internet egress" gateway | Default gateway on edge router/firewall | `default-internet-gateway` (implicit; route points to it) | Internet Gateway (IGW, explicit resource, attached to VPC) | (Azure: TODO) |
| Outbound-only NAT (PAT) | NAT/PAT on edge firewall | Cloud NAT (regional, on Cloud Router) | NAT Gateway (per-AZ, lives in public subnet, has Elastic IP) | (Azure: TODO) |
| Private subnet (no public IP, NAT for outbound) | Internal VLAN, NAT at perimeter | Subnet + no external IP on VMs + Cloud NAT route | Private subnet + route table → NAT Gateway | (Azure: TODO) |
| Public subnet (VM has public IP) | DMZ with public IP | Subnet + external IP on VM + route to `default-internet-gateway` | Public subnet + IGW + public IP on instance | (Azure: TODO) |
| Forced egress through inspection | Policy-based routing to firewall | Policy-based routing / custom next-hop to NGFW VM | Route table `0.0.0.0/0` → Network Firewall / FW appliance | (Azure: TODO) |
| Reserved/static NAT IP | Static NAT, fixed public IP | Reserved external IP on Cloud NAT | Elastic IP on NAT Gateway | (Azure: TODO) |

## Do it (the exercise)

### Part 1 — Read a VPC route table from the CLI [needs cloud account]

**GCP:**
```bash
# List all routes in your project
gcloud compute routes list --project=YOUR_PROJECT

# See the next-hop type for each (internet-gateway, instance, vpn-tunnel, etc.)
gcloud compute routes describe default-route-XXXXX --project=YOUR_PROJECT
```

**AWS (requires aws CLI configured):**
```bash
# List route tables in a VPC
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=vpc-XXXXXX" \
  --query 'RouteTables[*].{ID:RouteTableId,Routes:Routes}' \
  --output table
```

### Part 2 — Verify egress path from a running VM [needs cloud account]

From an app-tier VM (should have NAT egress):
```bash
# Does this VM have an external IP? (expect: no, if private)
curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/

# What public IP does outbound traffic appear as?
curl -s https://ifconfig.me
# Should return the Cloud NAT / NAT Gateway IP, not the VM's private IP.
```

From a data-tier VM (should have no egress):
```bash
# This should time out — there is no route to the internet.
curl --connect-timeout 5 https://ifconfig.me
# Expected: curl: (28) Connection timed out after 5001 milliseconds
```

### Part 3 — Trace the egress decision on paper [laptop]

Draw a table for Meridian Bank's GCP setup:

| VM | Private IP | Network tag | Matching route | Actual next-hop | Reaches internet? |
|----|-----------|-------------|----------------|-----------------|-------------------|
| app-server-01 | 10.100.1.5 | nat-egress | 0.0.0.0/0 → Cloud NAT | Cloud NAT → 34.100.150.10 | Yes (NAT only) |
| db-primary-01 | 10.100.2.10 | (none) | no 0.0.0.0/0 route applies | (no external next-hop) | No |
| jumphost-01 | 10.100.3.4 | nat-egress | 0.0.0.0/0 → Cloud NAT | Cloud NAT → 34.100.150.10 | Yes (NAT only) |

Fill in the same table for the AWS equivalent design.

### Part 4 — Calculate the cost of egress [laptop / paper]

Northwind's analytics platform in AWS `ap-south-1` exports 5 TB/month of
processed data to an on-prem data warehouse via a NAT Gateway (rather than Direct
Connect — a common cost mistake). AWS NAT Gateway data processing rate in
`ap-south-1` is $0.045/GB (verify current pricing in AWS docs).

5 TB = 5,120 GB × $0.045 = **$230.40/month NAT Gateway processing fee** —
*before* any data transfer charges. At Northwind's scale this compounds quickly
and is the kind of number that gets an architect's proposal rejected. Lesson:
use a Direct Connect private connection for bulk on-prem transfers; reserve
NAT Gateway for public internet egress (see N38, N51).

## Say it back (self-check)

1. What is longest-prefix match and why does it matter when a route table has
   both `10.0.0.0/8` and `0.0.0.0/0` entries?
2. Describe the four egress patterns. Which pattern is correct for a PCI-DSS
   cardholder data environment? Why?
3. In GCP, how do you send different VMs in the same VPC on different egress paths?
   How does AWS achieve the same result?
4. In AWS, why does a NAT Gateway live in a *public* subnet rather than the
   private subnet it serves?
5. A new VM is deployed in `asia-south1-data` and immediately starts pulling
   OS updates from `packages.debian.org`. What does this tell you about your
   route/tag configuration?

## Talk to the IT/security head

**Ask:**

- "Which subnets in your cloud VPC have a default route to the internet — and can
  you show me the route table?" *(The IT head should be able to pull this in under
  two minutes. If not, the environment lacks visibility.)*

- "For your CDE or regulated data-tier subnets, how do you prove at the routing
  layer — not just the firewall layer — that those VMs cannot reach the internet?"
  *(Good answer: there is no `0.0.0.0/0` route in the subnet/route-tag for those
  VMs. Red flag: "the firewall blocks it" — that's only one layer.)*

- "What public IP does your cloud outbound traffic appear as to the internet, and
  is that IP in your firewall allowlists at external partners?" *(Good answer: one
  or a small, known set of static IPs from the NAT gateway. Red flag: "it varies"
  — means VMs have individual external IPs, blast radius is hard to reason about.)*

- "Have you looked at your NAT Gateway data-processing costs this month — and do
  you have a split between internet-bound traffic and traffic that should be using
  Private Service Connect or Direct Connect instead?" *(At Northwind or any
  data-heavy client this is a money question disguised as a network question.)*

- "If a new VM is spun up in the app tier, does it automatically inherit the
  correct egress policy, or does someone have to configure it manually?"
  *(Good answer: the subnet or network tag enforces it automatically. Red flag:
  manual per-VM configuration — it will be wrong at scale.)*

**Red flags to listen for:**

- "All our subnets have access to the internet — we control it with security
  groups." Route-level isolation is a separate, stronger control from firewall
  rules. Relying only on security groups/NACLs is one misconfiguration away from
  exposure.
- Inability to name the NAT gateway's public IP(s) — this means external partner
  allowlisting is either broken or absent.
- "We use direct internet egress from every VM because NAT Gateway is simpler."
  This is a blast-radius and cost problem at scale.

## Pitfalls & war stories

**The missing default route that silently breaks production.** A team migrates a
service to a new private subnet. They forget to attach the right route table (AWS)
or tag the VMs (GCP). Software update checks, metric push, license calls — all time
out. The service appears healthy (it's stateless) but alerting silently dies.
Debug takes hours because "it looks up." Always verify egress with `curl
https://ifconfig.me` immediately after provisioning.

**CDE VM deployed in the wrong subnet.** A card-processing microservice is
accidentally deployed in the app subnet (Pattern 2) rather than the data subnet
(Pattern 1). It has outbound internet access. The auditor notices. In a bank this
is a P1 finding: evidence that network controls are not automatically enforced.
Automation (infra-as-code, enforced subnet tags) is the fix, not a stern email.

**NAT Gateway egress costs surprising finance.** Northwind's team routes all
analytics data through the NAT Gateway to reach the on-prem data lake, not
realizing Direct Connect (N38) would bypass the per-GB processing fee. At 50 TB/
month this is >$2,300/month in NAT Gateway fees alone. The network team and the
finance team rarely look at the same dashboard.

**GCP network-tag drift.** In GCP, network tags are set per VM (or per managed
instance group template). The risk runs the other way from a deny: an
*untagged* default route (a `0.0.0.0/0` route with no tag) applies to **every** VM
in the VPC. If such a route to the internet gateway exists, a VM that is supposed
to be isolated gets internet egress the moment it is created — there is no
"blackhole" route to fall back on (GCP has no drop next-hop). Keep `0.0.0.0/0`
routes tagged so they apply only to intended VMs, and back deny with an egress
firewall rule. Unlike AWS (where the subnet's route table applies
unconditionally), GCP's tag-based approach requires governance: enforce tags via
org policy or resource manager constraints, not documentation.

**Confusing Cloud NAT with a NAT VM appliance.** Cloud NAT (GCP) and NAT
Gateway (AWS) are managed services: you do not manage their HA, capacity, or
patching. A NAT *VM* (running masquerade on a custom Compute instance) requires
you to manage its HA (if it dies, all outbound breaks) and is not the recommended
pattern for production. Know which one is in the design.

## Going deeper (optional)

- GCP Cloud NAT overview and logging:
  https://cloud.google.com/nat/docs/overview
- AWS NAT Gateway concepts (including AZ-awareness — put one per AZ for HA):
  https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html
- AWS VPC Route Tables — understanding route priority and subnet association:
  https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html
- RFC 1918 (private address space) — the reason NAT exists: https://datatracker.ietf.org/doc/html/rfc1918
- PCI-DSS v4.0 Requirement 1.3 (restricting inbound/outbound traffic to and from
  the CDE): https://www.pcisecuritystandards.org/document_library/
- Pairs with: N16 (NAT & PAT — the on-prem foundation), N39 (VPC mental model),
  N40 (subnets & regions), N42 (cloud firewalls — the second layer above routes),
  N38 (Direct Connect / Cloud Interconnect — bypassing NAT for private paths),
  N51 (egress cost trap in multi-cloud), S01 (defense in depth — why routes + FW).

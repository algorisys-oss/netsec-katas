# Kata N42 — Cloud firewalls: GCP rules / AWS SG+NACL / Azure NSG

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N26, N39, N40, N41 · **Time:** ~40 min
> **Tags:** `firewall` `cloud` `gcp` `aws` `azure` `segmentation` `vpc` `l4-transport`

## Why it matters

Every cloud workload sits behind a firewall — but "firewall" means something
different in GCP, AWS, and Azure. If you spec a cloud design without knowing the
model, you'll either leave ports open you think are closed, or spend a week in
change-control fighting rules that contradict each other. At Meridian Bank, the
network and security teams will ask *exactly* where each firewall lives, what
state it tracks, and who can change it. Get the model wrong in the design and you
own the gap when the auditor finds it.

## The mental model

On-prem, a firewall is a **physical box in a rack**. Packets arriving at the
data-center edge hit the firewall; the firewall checks a rule table (source IP,
dest IP, port, protocol, connection state) and permits or drops.

In cloud, that concept is distributed: instead of one box, every virtual machine
interface, subnet, or VPC edge carries a software-enforced packet filter.
Three important shifts from on-prem:

```
  ON-PREM FIREWALL                   CLOUD FIREWALL

  ┌─────────────────┐                ┌──────────────────────────┐
  │  Internet       │                │  VPC                     │
  │       │         │                │  ┌────────┐  ┌────────┐  │
  │   [Firewall]    │                │  │ VM-A   │  │ VM-B   │  │
  │       │         │                │  │ [rule] │  │ [rule] │  │
  │  Internal LAN   │                │  └────────┘  └────────┘  │
  └─────────────────┘                │     ↑ rule evaluated      │
                                     │     at each NIC/subnet    │
  single chokepoint                  └──────────────────────────┘
  east-west blind spot               per-resource enforcement
```

**Key shift 1 — stateful by default.** The primary cloud firewall construct in
each provider (GCP VPC rules, AWS Security Groups, Azure NSGs) is stateful:
if you allow outbound TCP to port 443, the return traffic is automatically
permitted; you never need a rule for reply packets. (AWS NACLs are the stateless
exception — see the AWS section.)

**Key shift 2 — deny by default.** GCP and AWS deny by default; Azure NSGs
permit VNet-internal traffic by default (see Azure section). For GCP and AWS,
without an explicit allow rule, traffic is dropped. This is the right default;
on-prem devices often arrive permissive and need to be locked down.

**Key shift 3 — east-west coverage.** On-prem firewalls often only see
north-south traffic (internet ↔ inside). Cloud rules apply to VM-to-VM traffic
within the same VPC (east-west) without hair-pinning through a central box.
This is the micro-segmentation gain the CISO at Meridian Bank wants (see N27).

### GCP VPC Firewall Rules

GCP applies rules **at the VM level** (the hypervisor NIC), not at the subnet
boundary. A rule has:

- **Direction:** INGRESS or EGRESS
- **Match:** source/dest CIDR or source/dest service account or network tag
- **Protocol + port:** e.g. `tcp:443`, `tcp:0-65535`, `all`
- **Action:** ALLOW or DENY
- **Priority:** 0–65535 (lower = higher priority); GCP evaluates lowest number
  first and stops at first match; the implied (default) rules — including the
  implicit deny-all — sit at priority 65535
- **Target:** ALL instances, or by tag (e.g. `tag:web-server`), or by service
  account

The tag and service-account targeting is GCP's killer feature for architects:
you can say "all VMs tagged `pci-app` may receive TCP:8080 from VMs tagged
`pci-lb`" without knowing any IP addresses. That's more durable than CIDRs
when IPs change at scale.

```
  GCP rule evaluation (ingress, lower priority number = checked first):

  Priority 100 : ALLOW  tcp:443  from 0.0.0.0/0  → tag:web-server
  Priority 200 : ALLOW  tcp:22   from 10.0.0.0/8 → tag:bastion
  Priority 1000: DENY   all      from 0.0.0.0/0  → all  (explicit deny)
  Priority 65535: DENY  all      (implicit GCP default)
```

GCP also offers **Firewall Policies** (hierarchical): org-level → folder-level
→ project-level → VPC-level. An org policy can enforce "never allow TCP:22 from
0.0.0.0/0" across every project; VPC-level rules cannot override it. This is
the right control for Meridian Bank's central security team (see N27, pairs
with S35).

### AWS Security Groups and NACLs

AWS has **two distinct layers** of firewall control:

**Security Groups (SGs)** — stateful, attached to an ENI (Elastic Network
Interface, the VM's NIC). Rules are allow-only: there is no DENY rule in an SG.
Traffic not matched by any rule is implicitly denied. SGs are the primary
control.

```
  AWS SG on an EC2 instance (inbound rules):

  Type         Protocol  Port   Source
  HTTPS        TCP       443    0.0.0.0/0    ← internet access
  Custom TCP   TCP       8080   sg-0a1b2c3d  ← only from the app-tier SG
  SSH          TCP       22     10.104.0.0/14 ← only from Meridian AWS range
```

Referencing another SG as source (instead of a CIDR) is the AWS equivalent of
GCP's network tags: "allow from any instance that belongs to sg-app-tier."

**Network ACLs (NACLs)** — stateless, attached to a subnet. Custom rule
numbers run 1–32766, evaluated in numbered order (lowest first); first match
wins. There is a non-removable catch-all DENY shown as rule `*`, evaluated
last. Because they are stateless, you must write rules for both
directions: an inbound allow on port 443 requires an outbound allow on the
ephemeral reply port range (1024–65535) or the return packets are dropped.

```
  AWS NACL on the web-tier subnet (inbound and outbound rules shown):

  Inbound:
  Rule  Protocol  Port       Source         Action
  100   TCP       443        0.0.0.0/0      ALLOW
  200   TCP       1024-65535 0.0.0.0/0      ALLOW  ← ephemeral return
  *     all       all        0.0.0.0/0      DENY   (implicit)

  Outbound:
  Rule  Protocol  Port       Dest           Action
  100   TCP       1024-65535 0.0.0.0/0      ALLOW  ← reply to clients
  200   TCP       443        0.0.0.0/0      ALLOW  ← outbound HTTPS
  *     all       all        0.0.0.0/0      DENY
```

Most AWS architects use SGs for the real control work (stateful, per-instance)
and NACLs only for a coarse subnet-level guard (e.g. "never allow any traffic
from this CIDR block"). Think of SGs as the fine-grained inner lock, NACLs as
the outer dead-bolt.

### Azure NSGs (Network Security Groups)

Azure NSGs are stateful and can be attached at two scopes: **subnet** or
**NIC**. Rules have a priority (100–4096, lower = higher priority), a direction
(inbound/outbound), source, dest, port, protocol, and action (Allow/Deny).
Azure also provides **Default security rules** pre-populated in every NSG that
you cannot delete but can override with lower priority numbers:

```
  Azure NSG default inbound rules (pre-populated):
  Priority  Name                       Action
  65000     AllowVnetInBound           Allow  ← all VNet-internal traffic
  65001     AllowAzureLoadBalancerInBound Allow ← Azure LB health probes
  65500     DenyAllInBound             Deny   ← everything else
```

The AllowVnetInBound default is a common gotcha: by default, every VM in a VNet
can reach every other VM on any port. You must add explicit DENY or restrict
rules to lock that down. GCP and AWS start more restrictive; Azure starts more
permissive.

(Azure: advanced constructs — Application Security Groups, Azure Firewall, and
Azure Policy for NSGs — TODO: deepen in a later pass.)

## Worked example

Meridian Bank runs its mobile-banking backend in GCP (`10.100.0.0/14`). The
architecture has three tiers in the same VPC (see N39–N41):

```
  Internet
      │
  Cloud Load Balancer (GCP-managed, not a VM)
      │
  [Subnet: 10.100.1.0/24]   web-tier (tag: web-server)
      │
  [Subnet: 10.100.2.0/24]   app-tier (tag: app-server)
      │
  [Subnet: 10.100.3.0/24]   db-tier  (tag: db-server)
      │
  Cloud SQL (managed, peered VPC service — Private Service Connect)
```

**GCP firewall rules for this design:**

```
  Priority  Direction  Action  Protocol:Port  Source/Target
  ──────────────────────────────────────────────────────────────────────
  100       INGRESS    ALLOW   tcp:443        0.0.0.0/0  → tag:web-server
  200       INGRESS    ALLOW   tcp:8080       tag:web-server → tag:app-server
  300       INGRESS    ALLOW   tcp:5432       tag:app-server → tag:db-server
  400       INGRESS    ALLOW   tcp:22         10.40.0.0/16 → tag:bastion
  450       INGRESS    ALLOW   tcp:22         tag:bastion → tag:web-server,app-server
  900       INGRESS    DENY    all            0.0.0.0/0  → all
  65535     (implicit) DENY    all            (GCP default)
```

Rule 100 allows HTTPS from the internet to web-tier VMs only. Rule 200 allows
the web tier to reach the app tier on port 8080 — no other source can. Rule 300
allows only the app tier to reach PostgreSQL on port 5432. No east-west traffic
is permitted that isn't explicitly allowed. The two SSH rules form the bastion
path: rule 400 admits SSH **to** the bastion (tag `bastion`) only from the
corp-office range (`10.40.0.0/16`), and rule 450 admits SSH **from** the bastion
on to the web and app tiers. SSH never reaches web/app VMs directly from outside.

**Equivalent in AWS** (Meridian's AWS secondary at `10.104.0.0/14`):

```
  SG: sg-web-tier
    Inbound:  ALLOW tcp:443  0.0.0.0/0
    Outbound: ALLOW tcp:8080 sg-app-tier    ← SG reference, not CIDR

  SG: sg-app-tier
    Inbound:  ALLOW tcp:8080 sg-web-tier
    Outbound: ALLOW tcp:5432 sg-db-tier

  SG: sg-db-tier
    Inbound:  ALLOW tcp:5432 sg-app-tier
    Outbound: (none needed — RDS initiates nothing)
```

No NACL changes are required if you're happy with subnet-default allow-all
(SGs carry the real enforcement). For PCI compliance, Meridian's security team
would add NACLs at the CDE subnet to enforce a hard outer boundary.

**What the auditor will check:**
- No `0.0.0.0/0` in inbound rules except at the web tier's port 443.
- No `0.0.0.0/0` in any rule targeting the db-tier.
- SSH/RDP not open from the internet.
- All rule changes are logged (GCP Audit Logs / AWS CloudTrail).
- In AWS: no NACL rule that inadvertently allows unrestricted inbound.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Primary firewall construct | Physical/virtual FW appliance (Cisco ASA, Palo Alto) | **VPC Firewall Rules** (or Firewall Policy) | **Security Group (SG)** | **Network Security Group (NSG)** |
| Stateful or stateless | Both exist; stateful FW is standard | Stateful (always) | SG: stateful; NACL: stateless | NSG: stateful |
| Scope of attachment | Network zone / interface | VM NIC (hypervisor-level) | ENI (per VM interface) | Subnet or NIC |
| Second/outer layer | Separate DMZ firewall | Hierarchical Firewall Policy (org/folder level) | **NACL** (subnet, stateless) | (Azure: TODO — Azure Firewall + Policy) |
| Rule matching | IP, port, protocol, state | IP, port, protocol, network tag, service account | IP/CIDR, port, protocol, SG reference | IP, port, protocol, priority |
| Default stance | Typically permit-then-restrict on legacy; deny on new deployments | Implicit deny-all | Implicit deny-all | Default rules allow all VNet-internal; deny internet inbound |
| Policy hierarchy | Centralized FW management (Panorama, FMC) | Hierarchical Firewall Policy: org → folder → project → VPC | AWS Firewall Manager (separate service) | (Azure: TODO — Azure Policy + Firewall Manager) |
| Change audit trail | Firewall management platform logs | Cloud Audit Logs (`gcloud logging`) | CloudTrail | Azure Activity Log |
| East-west coverage | Requires explicit hair-pinning through FW | Yes — rules evaluate for VM-to-VM in same VPC | Yes — SGs evaluate for instance-to-instance | Yes — NSGs evaluate for VNet-internal traffic |
| Micro-segmentation primitive | VLAN + ACL or host-based FW | Network tag / service account targeting | SG referencing another SG | Application Security Group (ASG) |

## Do it (the exercise)

### Part A — paper design [laptop]

Take the Meridian Bank three-tier layout above and add a fourth tier: a
**bastion host** in `10.100.10.0/24` (subnet: `bastion-subnet`) that operators
use to SSH into web-tier and app-tier VMs. Write the GCP firewall rules needed:

1. Allow TCP:22 from the corp-office range (`10.40.0.0/16`) to the bastion VM
   (tag: `bastion`).
2. Allow TCP:22 from the bastion VM to web-tier and app-tier VMs.
3. Deny TCP:22 from anywhere else to web-tier and app-tier VMs.

State the priority order that makes this work. Verify that a direct SSH attempt
from `0.0.0.0/0` to an app-tier VM would be dropped, and trace which rule drops
it.

### Part B — inspect your own machine's firewall [laptop]

```bash
# Linux: see what iptables/nftables allows
sudo iptables -L -n -v       # if your distro uses iptables
sudo nft list ruleset         # if your distro uses nftables (Ubuntu 22+)
```

Identify: (a) which chain handles inbound packets, (b) what the default policy
is (ACCEPT or DROP), (c) whether connection state is tracked. This is the same
stateful-vs-stateless question, just on your laptop rather than a VPC.

### Part C — cloud console inspection [needs cloud account]

**GCP:**
```bash
# List all VPC firewall rules in a project
gcloud compute firewall-rules list \
  --format="table(name,direction,priority,sourceRanges.list():label=SRC,\
targetTags.list():label=TARGET,allowed[].map().firewall_rule().list():label=ALLOW)"
```

**AWS:**
```bash
# List security groups and their inbound rules
aws ec2 describe-security-groups \
  --query 'SecurityGroups[*].{Name:GroupName,Rules:IpPermissions}' \
  --output table
```

Look for any rule with source `0.0.0.0/0` and port 22 or 3389 (RDP). In a
regulated shop, that finding triggers an immediate incident.

## Say it back (self-check)

1. What makes a cloud firewall "stateful," and why does it matter for writing
   outbound rules?
2. In AWS, what is the difference between a Security Group and a NACL? Which
   is stateful? Which requires you to write rules for both directions?
3. In GCP, how does targeting by **network tag** differ from targeting by CIDR,
   and why does it matter when VMs are replaced or scaled?
4. Azure NSGs include a default rule `AllowVnetInBound`. What does it do, and
   why is it a concern in a PCI-scoped environment?
5. Why does GCP's **Hierarchical Firewall Policy** matter for Meridian Bank's
   central security team more than per-VPC rules alone?

## Talk to the IT/security head

**Ask:**

- "Are your cloud firewall rules managed centrally (org/folder policy) or per
  team/VPC? Who can override the central policy?" *(reveals governance model;
  per-team with no central guardrails is a posture risk)*
- "Do you have an automated process to detect and alert on `0.0.0.0/0` ingress
  rules being added?" *(should be yes; if not, that's an open control gap)*
- "In AWS, are you relying on Security Groups alone, or are NACLs also part of
  the CDE boundary?" *(PCI auditors expect both for the cardholder network
  segment)*
- "Who can approve a firewall rule change in the cloud, and is that the same as
  or different from the on-prem change process?" *(segregation of duties should
  carry forward; cloud's self-service nature often erodes it)*
- "Are firewall rule changes captured in your audit log and fed into the SIEM?"
  *(Meridian Bank's RBI and PCI obligations require this)*

**A good answer sounds like:** central policy enforced at org level with
project-level teams able to add (but not override) rules; alerts fire within
minutes for any 0.0.0.0/0 port-22 rule; all changes are in CloudTrail /
Audit Logs and correlated in the SIEM. Change approval still requires a named
second party even in cloud.

**Red flags:**
- "Each team manages their own security groups" with no central visibility or
  guardrails — lateral movement is one misconfiguration away.
- "We don't use NACLs, just SGs" in a PCI environment — auditor may flag the
  lack of subnet-level boundary.
- Rule counts in the hundreds with no naming convention — nobody knows what is
  or isn't needed; rule sprawl is technical debt that hides open paths.
- "Cloud changes go straight to prod without a CAB step" — in FSI this is a
  control failure (see N35).

## Pitfalls & war stories

**The Azure default allow gotcha.** A team migrating from AWS assumed Azure
NSGs were deny-by-default like SGs. They created an NSG, attached it to a
subnet, added one rule to allow TCP:443 inbound, and moved on. The default
`AllowVnetInBound` rule meant every other VM in the VNet could reach their
database on any port. They found it in the first penetration test, not in review.

**GCP tag creep.** Tags in GCP are just strings on a VM; any project editor can
add them. A developer tagged their personal test VM `pci-app` to get around a
deployment blocker, and it inherited the production firewall rules including
database access. Hierarchical Firewall Policy with restrict-by-service-account
(not just tag) prevents this.

**AWS NACL ephemeral-port trap.** A team added a NACL to tighten their CDE
subnet. They allowed inbound TCP:443 but forgot the outbound rule for ephemeral
ports (1024–65535). HTTPS connections started timing out — the SYN got through,
but the server's SYN-ACK was dropped on egress. Three hours of debugging, one
forgotten NACL outbound rule.

**Stateless NACL + stateful SG mismatch.** If a NACL drops return traffic that
the SG would allow, the connection still fails. The NACL is checked first (at
the subnet boundary), then the SG (at the NIC). A drop at either layer kills
the packet. Always troubleshoot both layers when AWS traffic mysteriously drops
(see N55 for the layer-by-layer playbook).

**"The VPC is private, it doesn't need firewall rules."** Cloud VPCs have no
internet gateway by default — but east-west paths still exist. A compromised
web-tier VM in the same VPC can reach the database directly if there is no
firewall rule stopping it. Perimeter security and internal segmentation are
both required; one does not substitute for the other (see S01, defense in
depth).

## Going deeper (optional)

- GCP: [VPC firewall rules overview](https://cloud.google.com/vpc/docs/firewalls)
  and [Hierarchical firewall policies](https://cloud.google.com/vpc/docs/firewall-policies).
- AWS: [Security groups for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
  and [Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html).
- [RFC 6335](https://www.rfc-editor.org/rfc/rfc6335) (IANA port registry) —
  defines the port categories and the dynamic/ephemeral range (49152–65535).
  In practice the OS picks the actual range: Linux uses 32768–60999 by default
  (check `/proc/sys/net/ipv4/ip_local_port_range`), which is why NACL ephemeral
  rules are written defensively as 1024–65535.
- [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293) (TCP, obsoletes RFC 793) —
  the reference for connection establishment and stateful tracking.
- Pairs with N26 (on-prem stateful firewalls) and N27 (segmentation / DMZ
  design) for the underlying principles.
- S35 (cloud network security) revisits these controls through a CISO lens
  and adds CSPM tooling (Security Command Center / AWS GuardDuty findings for
  exposed SGs).

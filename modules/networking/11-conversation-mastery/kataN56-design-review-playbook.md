# Kata N56 — Design-review playbook: the questions that expose risk

> **Track:** Networking · **Module:** N11 Conversation mastery · **Prereqs:** N01, N02, N27, N29, N39, N42, N48, N55, S01 · **Time:** ~35 min
> **Tags:** `architecture-review` `conversation` `first-principles` `risk-management` `segmentation` `hybrid` `fsi` `meridian-bank`

## Why it matters

Most design reviews fail because the reviewer asks *feature* questions — "does
it have a firewall?" — instead of *risk* questions — "what is the blast radius
if that firewall is misconfigured?" You can walk into any hybrid/cloud design
review and look competent by cycling through the same ten risk vectors every
time. The IT head and CISO are looking for someone who will spot what they
missed; this kata gives you that checklist and the language to use it.

The skill transfers across cloud, on-prem, and hybrid. Memorize the frame;
adapt the questions to the stack.

## The mental model

A design review is not a feature audit. It is a **risk surface walk**. You move
through the design asking: *what breaks, who can reach what they shouldn't, and
what's the blast radius?*

There are seven risk vectors every network design must answer for:

```
  1. REACHABILITY      Can the wrong thing reach a sensitive resource?
  2. BLAST RADIUS      If one node is compromised, how far does it spread?
  3. EGRESS / DATA     Can data leave the org? Through what path?
  4. OBSERVABILITY     Is there a place in this design where traffic is invisible?
  5. AVAILABILITY      Single points of failure? What's the DR story?
  6. CHANGE SURFACE    What changes frequently? Who approves it?
  7. COMPLIANCE SCOPE  Does this design widen a regulated zone (CDE, data-residency)?
```

Walk a design in this order. Most reviewers stop at #1. The risk usually hides
in #3–#6.

### The review posture

Before asking anything, orient yourself on the diagram:

```
  STEP 1: Identify the trust boundaries
          ─ where does a zone change? (internet → DMZ → app → data)
          ─ where does the cloud boundary sit relative to on-prem?
          ─ where does a PCI / regulated zone start and end?

  STEP 2: Find every path traffic can take
          ─ north-south (external → internal)
          ─ east-west (service-to-service inside)
          ─ management plane (admin access, jump hosts, bastion)

  STEP 3: Ask: for each path, what is the control, and what breaks if it fails?
```

The paths that don't appear on the diagram are where the risk lives. Ask for
the "as-built" not the "intended."

### The seven questions (one per vector)

| # | Vector | The question that exposes it |
|---|--------|------------------------------|
| 1 | Reachability | "What is the shortest path from the internet to the database — list every hop?" |
| 2 | Blast radius | "If the app tier is compromised, what can it reach laterally?" |
| 3 | Egress / data | "Show me every path data can leave the environment." |
| 4 | Observability | "Where in this design is traffic NOT logged or inspected?" |
| 5 | Availability | "Where is the single point of failure? What is the failover time?" |
| 6 | Change surface | "What changes without a change-control ticket?" (auto-scaling, DNS, certs) |
| 7 | Compliance scope | "Which systems does this design pull into PCI / RBI scope?" |

A confident designer will have a crisp answer for all seven. Vague answers on
#3 and #4 are the most common red flags in cloud and hybrid designs.

## Worked example

Meridian Bank is reviewing a proposed architecture for its new digital-banking
platform. The design connects the GCP environment (`10.100.0.0/14`) to HQ-DC1
(`10.10.0.0/16`) via a dedicated interconnect (see N38). The region is pinned
in-country (`asia-south1`) because Meridian's data-residency rule governs region
choice for regulated/customer data (see N29). Here is a simplified view of what
the architect handed the review panel:

```
  Internet
     │
  [Cloud LB / WAF]       (GCP, public IP, global)
     │
  [App VMs — app-subnet]  10.100.1.0/24   (GCP asia-south1 — in-country, per residency)
     │
  [DB — db-subnet]        10.100.2.0/24   (GCP asia-south1 — in-country, per residency)
     │                        │
  [Cloud Interconnect] ───────┘ ← "dedicated, private path"
     │
  [Core banking — HQ-DC1]  10.10.0.0/16
```

Walk the seven vectors:

**1. Reachability** — "List every hop from the internet to the database."

```
  Internet → Cloud LB (public IP) → app-subnet (10.100.1.0/24) → db-subnet (10.100.2.0/24)
```

That is two internal hops once inside the VPC: LB → app-subnet, then
app-subnet → db-subnet. Is there a firewall rule between app-subnet and db-subnet?
The diagram doesn't show one. Ask: "What GCP firewall rule restricts app-tier
to db-tier? Show me the rule." If the answer is "we use VPC default," the
default on GCP allows all traffic *within* the VPC — the database is reachable
from the app tier on any port. That may be intentional; document that it is.

**2. Blast radius** — "If the app tier is compromised, what can it reach?"

With no east-west rule between app and db subnets, a compromised app VM can
reach `10.100.2.0/24` on all ports. Via the interconnect, can it reach
`10.10.0.0/16`? Ask: "What firewall rule on the interconnect side restricts
traffic originating from `10.100.1.0/24`?" A missing or over-broad rule here
means an attacker who pops a web VM can pivot to the core banking host. This
is the canonical FSI risk.

**3. Egress / data** — "Show me every path data can leave GCP."

On GCP, traffic from `db-subnet` to the internet requires either a Cloud NAT
gateway or a VM with a public IP. Ask: "Does `db-subnet` have a Cloud NAT
attached?" If yes, what is the egress rule? If the security team believes DB
traffic is isolated to the VPC and the interconnect, a misconfigured Cloud NAT
silently opens an exfiltration path. Verify: GCP VPC firewall egress default
allows all outbound unless explicitly restricted (unlike AWS security groups,
where the default also allows all outbound).

**4. Observability** — "Where is traffic NOT logged?"

On GCP, VPC Flow Logs must be enabled per subnet. Ask: "Are flow logs enabled
on both `app-subnet` and `db-subnet`? Where do they go?" East-west traffic
between two subnets in the same VPC is logged only if flow logs are on.
Traffic crossing the Cloud Interconnect is not automatically inspected by any
layer-7 service — only flow logs capture it at L3/L4. If neither subnet has
flow logs, the design has a blind spot the CISO will flag.

**5. Availability** — "What is the single point of failure?"

The Cloud Interconnect is a single physical path here. Ask: "Is there a second
Interconnect attachment in a different GCP zone / a backup VPN?" For Meridian
Bank, the core-banking path is tier-1 (no degraded-mode option), so a single
interconnect means any fiber cut = payments down. The fix is two attachments
in separate metro locations with a BGP failover (see N38, N36).

**6. Change surface** — "What changes without a ticket?"

Autoscaling adds VMs to `app-subnet`. Each new VM inherits the VPC firewall
rules — good. But if someone manually added an "allow-all-ingress" rule during
a debug session last Tuesday, autoscaled VMs silently inherit it. Ask:
"What is the change-control process for GCP firewall rules? Are they managed
by Terraform / IaC, and does a PR gate it?" In a bank, the answer must be yes.
Manually-applied firewall rules that don't go through IaC are invisible to the
audit trail (see N02 on CAB culture).

**7. Compliance scope** — "Which systems does this design pull into PCI scope?"

Any system that can reach `10.100.2.0/24` (where card tokens live) is
potentially in PCI scope. The cloud LB and app VMs are already in scope. Does
the interconnect make the core-banking host `10.10.0.0/16` in scope too? Under
PCI-DSS v4.0 scoping guidance, a system is in scope (CDE or "connected-to" /
security-impacting) if it can communicate with systems that store, process, or
transmit cardholder data. Ask: "Does core banking
at `10.10.x.x` touch card numbers, or only account numbers?" The answer
determines whether Meridian's entire DC1 is now in CDE — a significant audit
expansion. See N29 for the full compliance-scoping lens.

## Cloud / vendor mapping (when applicable)

The seven-vector review is cloud-agnostic, but the specific controls differ:

| Review vector | On-prem | GCP | AWS | Azure |
|---------------|---------|-----|-----|-------|
| East-west firewall | ACL between VLANs; zone-based FW | VPC firewall rules (stateful, tag-based) | Security Groups (per-ENI, stateful) + NACLs (subnet, stateless) | NSG (subnet or NIC, stateful) |
| Egress restriction | Perimeter FW default-deny out | VPC egress firewall rules (default allow — must add deny rules) | Security Group default ALLOWS all outbound (add explicit egress restriction to deny); custom NACL default-deny, default NACL allow | NSG default allow outbound — add deny rules to restrict |
| Flow logging | NetFlow/sFlow from switches | VPC Flow Logs per subnet (enable explicitly) | VPC Flow Logs per ENI/subnet (enable explicitly) | NSG Flow Logs (enable explicitly; stored in Storage Account) |
| Connectivity blind spot | Unmonitored switch ports; dark VLAN | Intra-VPC east-west if flow logs off; IAP tunnels not in VPC flow | Same-SG same-host traffic not in VPC flow | Intra-VNet traffic without NSG flow logs |
| Config drift / IaC | Gold config + RANCID diff | Terraform / Config Controller (KRM) / Config Sync (Deployment Manager deprecated); Org Policy for constraint enforcement | CloudFormation / Terraform; AWS Config rules | ARM / Bicep / Terraform; Azure Policy |
| Compliance scoping | PCI segmentation: ASV scan boundary | Shared VPC + VPC Service Controls for CDE isolation | VPC + Security Hub for CDE; AWS Macie for data | (Azure: TODO) |
| Single point of failure | Dual-homed core switch + HSRP | Dual Interconnect attachments in 2 metro areas + BGP | Dual Direct Connect connections in 2 AZs + BGP | (Azure: TODO) |

**Key GCP-vs-AWS difference the review must surface:** GCP VPC firewall rules
are global (apply across all regions in the VPC); AWS Security Groups are
per-resource and do not automatically propagate. A GCP "allow-all-internal"
rule affects every subnet; an AWS SG opened wide affects only the resources
it's attached to. This changes the blast-radius answer.

## Do it (the exercise)

### Part A — paper drill [laptop / paper]

Take any architecture diagram you have access to (a project you've worked on,
a public reference architecture, or sketch Meridian Bank's diagram from the
worked example above). Run all seven vectors:

1. Draw the **trust boundaries** as dashed lines on the diagram.
2. Trace every **traffic path** (north-south, east-west, management) as arrows.
3. For each path, write: control present | control missing | unknown.
4. Score the design: how many of the seven vectors have a clean answer vs a gap?

A gap is not a blocker — it is a question you now own in the review meeting.

### Part B — live review simulation [laptop]

Pick an open-source reference architecture (e.g. the GCP "three-tier web app"
reference at `cloud.google.com/architecture`) and walk the seven-question
checklist in order. Write one question and one expected answer per vector.

### Part C — rule verification [needs cloud account]

On a GCP project you control:

```bash
# List all VPC firewall rules and their direction/action
gcloud compute firewall-rules list \
  --format="table(name,network,direction,priority,sourceRanges.list(),targetTags.list(),allowed[].map().firewall_key().list())"
```

Look for:
- Any rule with `sourceRanges: 0.0.0.0/0` (internet-open ingress)
- Any rule with `direction: EGRESS` and `action: ALLOW` + `destinationRanges: 0.0.0.0/0` (unrestricted egress)
- Absence of a deny rule lower in priority than the allows (GCP evaluates lowest
  number = highest priority; default implicit-deny is priority 65535)

On AWS:

```bash
# List security groups with open ingress (port 0–65535 from 0.0.0.0/0)
aws ec2 describe-security-groups \
  --query "SecurityGroups[?IpPermissions[?IpRanges[?CidrIp=='0.0.0.0/0']]].{Name:GroupName,Id:GroupId,Rules:IpPermissions}" \
  --output table
```

## Say it back (self-check)

1. Name the seven risk vectors in order without looking. Which one do most
   reviewers skip?
2. What is GCP's *default* stance on egress within a VPC, and how does it
   differ from AWS Security Groups?
3. Why is the "change surface" vector particularly important for autoscaling
   environments in a bank?
4. A DB subnet has no public IP and no NAT gateway. Can data still leave? What
   would you check?
5. What makes a system "in PCI scope" even if it doesn't store card numbers?

## Talk to the IT/security head

**Ask:**

- "Can you walk me through the shortest path from the internet to your most
  sensitive data store — hop by hop?" *(Vector 1; tests whether they've actually
  traced this themselves.)*

- "If one of your app-tier VMs were compromised today, what could it reach
  without any additional credentials?" *(Vector 2; the answer should be
  "nothing outside its subnet"; anything broader is a lateral-movement risk.)*

- "Where in this design is traffic completely invisible — no logs, no
  inspection?" *(Vector 4; many teams haven't asked this. East-west inside a
  cloud VPC is the common blind spot.)*

- "Which of your firewall or security-group rules are managed in code, and
  which were applied manually?" *(Vector 6; in a bank, manually-applied rules
  that bypass IaC are a change-control failure and an audit finding.)*

- "This design adds a path to X — does that pull X into PCI scope?" *(Vector 7;
  forces the team to have done the scoping conversation, not defer it.)*

**A good answer sounds like:** the engineer can trace the path hop-by-hop, name
the specific firewall rule or security group that controls each hop, and state
the log destination for each zone. They distinguish what is IaC-managed from
what was applied by hand. They know the compliance-scope boundary and can name
the control that enforces it.

**Red flags:**

- "It's behind the firewall" — unable to name a specific rule.
- "We have flow logs" without being able to say which subnets they're on.
- Blank look at the east-west lateral movement question — suggests the network
  is flat inside the cloud tier.
- "That's not in scope" without a documented scoping decision — this is an
  auditor's open question, not a closed one.
- IaC mentioned but no PR/review process described — IaC in a personal repo
  with no gate is not audit-clean.

## Pitfalls & war stories

**"The firewall is at the perimeter" fallacy.** At a major FSI, a cloud
migration moved workloads into a VPC but retained a perimeter-only firewall
mindset. All 40 subnets could talk to each other freely. When a compromised
CI/CD runner in the dev subnet was used to pivot to the production database in
the same VPC, the investigation found no east-west logs and no firewall rule
preventing the path. The breach dwell time was 11 days. The fix (VPC Service
Controls + micro-segmentation) was retroactive. See S01 on defense in depth:
the perimeter is one layer, not all of them.

**Cloud NAT left on for "testing," left on for production.** At an FMCG
scaling onto AWS, a developer added a NAT Gateway to a private subnet during a
debugging session and never removed it. The subnet holding pricing data had
outbound internet access for six months. No egress firewall rule blocked it;
VPC flow logs were off. The change was not in the IaC. The review found it
only because a consultant asked Vector 3: "Show me every egress path."

**PCI scope creep via interconnect.** Meridian Bank connected a new cloud
analytics platform to HQ-DC1 via interconnect for data feeds. Nobody scoped
whether the analytics platform could route to the CDE. It could — through
`10.10.5.0/24` (a shared VLAN not isolated from the CDE). The QSA expanded
the PCI scope in the next audit to include the entire analytics VPC. Remediation
cost: six months and a re-segmentation project. Always ask Vector 7 before
approving any interconnect or peering change.

**The autoscaled firewall surprise.** On GCP, a team added a permissive
temporary firewall rule (priority 100, allow-all ingress) to debug a production
issue. The rule was never removed. Three months of autoscaling later, every new
VM inherited the rule. The security scan found it; the team didn't know it
existed. In a regulated shop, this is both a breach-risk and a CAB violation.
IaC + org-policy constraints that block rules with `0.0.0.0/0` ingress below a
minimum priority are the preventive control (see N42).

## Going deeper (optional)

- **NIST SP 800-53 Rev 5, CA-7 (Continuous Monitoring) and SC-7 (Boundary
  Protection)** — the control families behind Vectors 1–3.
- **PCI-DSS v4.0, Requirements 1 (Network Security Controls) and 10 (Log and
  Monitor)** — audit-language versions of Vectors 1 and 4.
- **GCP: VPC Firewall Rules overview** —
  `cloud.google.com/vpc/docs/firewalls` — covers priority, targets, and the
  implied rules (ingress deny-all at 65535, egress allow-all at 65535).
- **AWS: Security Group vs NACL comparison** —
  `docs.aws.amazon.com/vpc/latest/userguide/VPC_Security.html`
- Pairs with **N55** (structured troubleshooting — same layer-by-layer walk,
  used for faults rather than risk), **N29** (compliance scoping), **N42**
  (cloud firewall mechanics), and **S03** (threat modeling with STRIDE — the
  threat-model is the upstream artifact a design review validates).

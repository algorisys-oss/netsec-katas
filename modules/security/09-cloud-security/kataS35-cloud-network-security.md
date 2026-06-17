# Kata S35 — Cloud network security: GCP/AWS/Azure controls

> **Track:** Security · **Module:** S9 Cloud security posture · **Prereqs:** N42, S01, S32, S34 · **Time:** ~40 min
> **Tags:** `cloud` `security` `vpc` `firewall` `segmentation` `gcp` `aws` `defense-in-depth`

## Why it matters

Moving workloads to cloud does not make them inherently more secure — it changes
*where* the controls live and *who* is responsible for configuring them. The
shared-responsibility model (see S32) means the cloud provider secures the
physical infrastructure; you secure everything from the operating system upward,
including every network policy, service endpoint, and API exposure decision.

At Meridian Bank, the CISO's first question about any cloud workload is: "What
can reach it, and can anything inside it reach out that shouldn't?" Getting that
wrong in cloud is worse than on-prem because misconfiguration can be replicated
across regions in seconds and may be quietly exploitable from the public internet
before anyone notices. Cloud network security is the control layer that answers
the CISO's question with evidence, not reassurance.

## The mental model

Cloud network security is not a single control — it is a stack of four
overlapping layers, each catching what the layer above missed:

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  Layer 1 — Org-level guardrails                                  │
  │  Deny public IPs on VMs, restrict regions, block open buckets.   │
  │  (GCP Org Policy · AWS SCP · Azure Policy)                       │
  ├──────────────────────────────────────────────────────────────────┤
  │  Layer 2 — VPC perimeter controls                                │
  │  Limit which VPCs talk to each other, to the internet, and to    │
  │  managed services. Enforce private-only egress.                  │
  │  (GCP VPC SC · AWS VPC endpoints/NACLs · Azure Private Endpoint) │
  ├──────────────────────────────────────────────────────────────────┤
  │  Layer 3 — Instance/workload firewall                            │
  │  Per-VM or per-pod stateful rules. Source: CIDR, tag, or         │
  │  identity. Default-deny.                                         │
  │  (GCP Firewall Rules+Policy · AWS SG · Azure NSG)                │
  ├──────────────────────────────────────────────────────────────────┤
  │  Layer 4 — Edge / application layer                              │
  │  WAF, DDoS protection, TLS termination, rate limiting at the     │
  │  internet perimeter.                                             │
  │  (GCP Cloud Armor · AWS WAF+Shield · Azure WAF+DDoS Protection)  │
  └──────────────────────────────────────────────────────────────────┘
```

The key insight for architects: **N42 taught you Layer 3 in depth**. This kata
fills in the layers above and below it, and connects all four to the audit and
compliance evidence the CISO and regulators need.

### Layer 1 — Org-level guardrails (preventive)

Org-level controls are **preventive** and **non-bypassable**: even an admin with
full project permissions cannot violate them. This is the governance primitive
that scales across 100 projects without per-project configuration.

| GCP Org Policy | AWS SCP | Azure Policy |
|---|---|---|
| Prevent VMs from getting external IPs: `constraints/compute.vmExternalIpAccess` set to `allowedValues: []` | Deny `ec2:AllocateAddress` in prod OUs except by the platform account | `Deny effect` policy: `Microsoft.Network/publicIPAddresses` creation blocked in production subscriptions |
| Restrict resource regions to `asia-south1` for data-residency | SCP denying EC2/RDS in non-approved regions | Azure Policy `allowedLocations` initiative |
| Enforce VPC Flow Logs on all subnets (no built-in constraint — use a custom Org Policy constraint or an SCC detector) | SCP requiring GuardDuty + CloudTrail enabled on all accounts | Azure Policy `deployIfNotExists` for NSG flow logs |

At Meridian Bank, the GCP Org Policy enforcing `asia-south1` for regulated data
and blocking external IP addresses on production VMs are the two controls the
CISO presents to the RBI auditor. They are enforced before any individual VPC
or firewall rule is evaluated.

### Layer 2 — VPC perimeter controls

This is where you control what your cloud workloads can *talk to* — especially
managed services (storage, databases, ML APIs) and the internet. Two distinct
problems:

**Problem A — exfiltration via managed services.** An attacker who compromises a
cloud VM could copy data to `gs://attacker-bucket` or `s3://attacker-bucket`
outside your organization. Standard VPC firewall rules cannot stop this because
the traffic goes to a well-known Google or AWS hostname, not a blocked IP.

**Problem B — internet exposure of services.** A misconfigured Cloud Storage
bucket, an RDS instance with a public IP, or a GKE service with `type:
LoadBalancer` and no restriction silently exposes data to the internet.

**GCP answer — VPC Service Controls (VPC SC):**
A VPC SC perimeter wraps a set of GCP projects and API services in a logical
boundary. Access to a protected service (e.g. `bigquery.googleapis.com`,
`storage.googleapis.com`) is allowed only from inside the perimeter or from
explicitly listed access levels (e.g. corporate IP ranges). Traffic to a
protected service from outside the perimeter — including from a compromised VM
in a *different* project — returns `PERMISSION_DENIED`, even if the caller has
IAM access.

```
  VPC SC perimeter (Meridian Bank — GCP):

  ┌─── Perimeter: meridian-prod ──────────────────────────────────┐
  │  Projects: mobile-backend, analytics-gcp, data-warehouse      │
  │  Protected: storage.googleapis.com, bigquery.googleapis.com   │
  │                                                               │
  │  10.100.0.0/14 (GCP VPCs)                                    │
  │                                                               │
  │  ← access from on-prem 10.10.0.0/16 over Interconnect: OK    │
  │  ← access from google.com/accounts external user: DENIED      │
  │  ← VM outside perimeter copying to gs://...: DENIED           │
  └────────────────────────────────────────────────────────────────┘
```

VPC SC is the GCP control the CISO cites when asked "what stops a compromised
cloud role from exfiltrating our BigQuery data externally?"

**AWS answer — VPC Endpoints + SCPs + Resource Policies:**
AWS does not have a direct VPC SC equivalent as a single control. Instead, it
layers three mechanisms:

1. **VPC Gateway/Interface Endpoints** (see N44) route traffic to S3, DynamoDB,
   and other services inside the AWS network rather than via public internet.
2. **S3 Bucket Policy + `aws:sourceVpc`/`aws:sourceVpce` condition** restricts
   bucket access to requests originating from a specific VPC or endpoint ID,
   preventing access from outside the VPC.
3. **SCP `Deny` with `aws:RequestedRegion` condition** blocks data movement to
   unapproved regions.

```
  S3 bucket policy restricting to Meridian AWS VPC (example):
  {
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::meridian-regulated-data/*"],
    "Condition": {
      "StringNotEquals": {
        "aws:sourceVpce": "vpce-0a1b2c3d4e5f6a7b8"
      }
    }
  }
```

**Azure — Private Endpoint + Service Endpoint Policies:**
Azure uses Private Endpoints (see N44) combined with Network Service Tags and
Service Endpoint Policies to restrict access to PaaS services to approved VNets.
`(Azure: TODO — NSP / network security perimeter preview as of 2025 is in flux)`

### Layer 3 — Instance/workload firewall (recap from N42)

This layer is covered in depth in N42. Key principles for security-posture
review:

- **Default-deny everywhere.** GCP: the implicit final rule denies all. AWS: SGs
  allow-only (unlisted = deny). Azure: must verify no `AllowVNetInBound` default
  opens lateral paths inside the VNet (the Azure permissive-default gotcha).
- **Tag/identity targeting over CIDRs.** Rules that say "allow from the app-tier
  service account" are more durable and auditable than rules citing raw IPs.
- **Hierarchical enforcement (GCP).** A Firewall Policy at org or folder scope
  can insert a hard `DENY tcp:22 from 0.0.0.0/0` that no project admin can
  override — the right control for bastion-only SSH access.
- **Least privilege, least port.** A rule that says `tcp:0-65535` or `all` on
  an internet-facing rule is a red flag in any cloud security review.

### Layer 4 — Edge and WAF

The internet-facing perimeter needs three controls that firewall rules alone
cannot provide:

- **WAF (Web Application Firewall):** inspects HTTP at L7 for SQLi, XSS, OWASP
  Top 10 (see S13). Applied at the cloud load balancer, not inside the VPC.
- **DDoS protection:** absorbs volumetric attacks upstream; the basic managed
  tier is on by default; advanced tiers add adaptive policies and SLA (important
  for banking uptime commitments).
- **IP allow/deny lists:** country-based blocks, known-bad IP reputation feeds,
  rate limiting per IP.

| Control | GCP | AWS | Azure |
|---|---|---|---|
| WAF | Cloud Armor (OWASP CRS built-in) | AWS WAF (managed rule groups) | Azure WAF (Front Door or App Gateway) |
| DDoS — basic | Cloud Armor standard | AWS Shield Standard (always on, free) | Azure DDoS Protection Basic |
| DDoS — advanced | Cloud Armor Managed Protection Plus | AWS Shield Advanced (SLA + SOC response) | Azure DDoS Protection Standard |
| IP-based blocking | Cloud Armor security policies | AWS WAF IP sets + rate-based rules | Azure WAF custom rules |

Cloud Armor security policies attach to the GCP External HTTPS Load Balancer
backend service. They can deny requests before they ever reach a VM.

## Worked example

**Meridian Bank — GCP cloud network security design:**

The mobile banking backend lives in GCP `asia-south1` using the
`10.100.0.0/14` range (see `reference/running-example.md`). The architecture
uses three VPCs:

```
  ┌──────────────────────────────────────────────────────────────┐
  │  Meridian GCP — asia-south1                                  │
  │                                                              │
  │  ┌─── mobile-frontend VPC (10.100.0.0/16) ──────────┐       │
  │  │  External HTTPS LB  ←── [Cloud Armor policy]     │       │
  │  │    WAF: OWASP CRS + rate-limit 1000 req/min/IP   │       │
  │  │  web-tier VMs  tag:mobile-web  (10.100.1.0/24)   │       │
  │  └──────────────┬────────────────────────────────────┘       │
  │                 │ VPC peering / Shared VPC                   │
  │  ┌─── app VPC (10.101.0.0/16) ───────────────────────┐      │
  │  │  app-tier VMs  tag:mobile-app  (10.101.1.0/24)    │      │
  │  │  Firewall: INGRESS tcp:8080 from tag:mobile-web   │      │
  │  │  Firewall: EGRESS  tcp:5432  to 10.10.20.0/24     │      │
  │  │           (DB in CDE via Interconnect)             │      │
  │  └──────────────┬────────────────────────────────────┘       │
  │                 │ Cloud Interconnect → 10.10.0.0/16          │
  │  ┌─── data VPC (10.102.0.0/16) ───────────────────────┐     │
  │  │  Cloud Storage bucket: meridian-analytics-prod      │     │
  │  │  BigQuery dataset: mobile_events                    │     │
  │  │  VPC SC perimeter — access from 10.100.0.0/14 only │     │
  │  └────────────────────────────────────────────────────┘      │
  └──────────────────────────────────────────────────────────────┘
```

**Org Policy (layer 1) active for Meridian production folder:**
- `constraints/compute.vmExternalIpAccess` → denied for all VMs.
- `constraints/gcp.resourceLocations` → `asia-south1` only.
- VPC Flow Logs enforced on all subnets via a custom Org Policy constraint
  (no built-in constraint exists) plus an SCC detector for drift.

**VPC SC (layer 2) perimeter rule:**
```
  Perimeter: meridian-prod
  Projects:  mobile-backend, analytics-gcp, data-warehouse
  Services:  storage.googleapis.com, bigquery.googleapis.com
  Access levels:
    - On-prem engineers: from 203.0.113.0/24 (Meridian HQ egress) OR
      via Cloud Interconnect from 10.10.0.0/16
  Deny-by-default: all other access to protected services → PERMISSION_DENIED
```

**Firewall rule hierarchy (layer 3):**
```
  Org Firewall Policy (priority 1):
    DENY  tcp:22 from 0.0.0.0/0 to all  [no SSH from internet — ever]
    DENY  tcp:3389 from 0.0.0.0/0 to all [no RDP from internet]

  Folder Policy — production folder:
    ALLOW tcp:22 from 10.10.0.0/16 to tag:bastion [on-prem jump host only]

  VPC Firewall Rules — app VPC:
    ALLOW tcp:8080 INGRESS from tag:mobile-web to tag:mobile-app
    ALLOW tcp:5432 EGRESS  from tag:mobile-app  to 10.10.20.0/24 (CDE)
    DENY  all                                    [explicit, priority 999]
    [implicit deny-all at 65535]
```

**Cloud Armor policy (layer 4) on External HTTPS LB:**
```
  Rule 1: Priority 1000 — preconfigured-expr-sets sqli-canary → DENY 403
  Rule 2: Priority 1100 — preconfigured-expr-sets xss-canary  → DENY 403
  Rule 3: Priority 2000 — rate-based ban: > 1000 req/min per IP → BAN 600s
  Rule 4: Priority 3000 — src.region_code == "XX" (sanctioned) → DENY 403
  Default: ALLOW
```

**Net result:** an attacker who compromises a mobile-app VM cannot:
- SSH to it from the internet (org policy blocks it, Layer 1 + 3).
- Exfiltrate data to an external GCS bucket (VPC SC, Layer 2).
- Reach any internal system except the CDE DB on port 5432 (firewall, Layer 3).
- Attack the public endpoint with SQLi or a request flood (Cloud Armor, Layer 4).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---|---|---|---|---|
| Org-level preventive guardrail | Active Directory Group Policy / change-control | Org Policy constraints | Service Control Policies (SCPs) | Azure Policy initiatives |
| API/service perimeter (exfiltration control) | NGFW with app-ID blocking cloud storage domains | VPC Service Controls | VPC Endpoint + S3 bucket policy `aws:sourceVpce` | Private Endpoint + NSP (Azure: TODO) |
| Instance firewall (stateful) | Host-based firewall (iptables, Windows Firewall) | GCP VPC Firewall Rules + Firewall Policies | Security Groups (SG) | Azure NSG at NIC or subnet |
| Subnet-level packet filter (stateless) | ACL on router/switch | GCP VPC firewall rules cover this (no separate stateless ACL construct) | Network ACL (NACL) | NSG at subnet scope |
| Hierarchical / enterprise-enforced rules | Vendor-managed rule push from NGFW manager | Hierarchical Firewall Policy (Org → Folder → VPC) | AWS Firewall Manager (centrally managed SGs/WAF) | Azure Firewall Manager |
| WAF | Physical WAF appliance (F5, Fortinet) | Cloud Armor (OWASP CRS) | AWS WAF + managed rule groups | Azure WAF (Front Door / App Gateway) |
| DDoS — volumetric | Scrubbing center / ISP blackhole | Cloud Armor Standard / Managed Protection Plus | AWS Shield Standard / Shield Advanced | Azure DDoS Protection Basic / Standard |
| Network flow evidence | NetFlow / IPFIX from firewall | VPC Flow Logs (subnet-level) | VPC Flow Logs (per-ENI or subnet) | NSG Flow Logs → Traffic Analytics |
| Packet-level inspection / IDS | Inline IPS or SPAN-fed IDS | Cloud IDS (Palo Alto, via Packet Mirroring) | AWS Network Firewall / Traffic Mirroring → IDS | Azure Firewall Premium (IDPS) |

## Do it (the exercise)

**Exercise A — threat-model four attack paths [paper]**

For the Meridian Bank GCP design in the worked example, decide which control
(layer 1–4) stops each path, and what evidence you would show the auditor:

| Attack path | Which layer stops it? | Evidence artifact |
|---|---|---|
| Attacker queries `storage.googleapis.com` from a compromised VM in a different GCP project | ? | ? |
| Developer accidentally sets firewall rule: `ALLOW all from 0.0.0.0/0` on an app VM | ? | ? |
| Bot sends 50,000 SQLi probes against `https://mobile.meridian.example` | ? | ? |
| VM in `mobile-app` tries to SSH to another VM in `mobile-app` | ? | ? |

*(Answers: VPC SC / Org Firewall Policy at org scope overrides project rule /
Cloud Armor OWASP CRS / no rule allows port 22 between same-tag VMs → implicit
deny)*

**Exercise B — read a GCP Firewall Policy rule [needs cloud account or use docs]**

In a GCP project, list the effective firewall rules for a VM:
```bash
# [needs cloud account]
gcloud compute firewall-rules list --format="table(name,direction,priority,sourceRanges,targetTags,allowed)" \
  --project=YOUR_PROJECT

# Show effective rules for a specific VM (includes inherited Firewall Policies):
gcloud compute instances network-interfaces get-effective-firewalls \
  --instance=INSTANCE_NAME \
  --network-interface=nic0 \
  --zone=asia-south1-a
```
Note whether any rule has `sourceRanges: 0.0.0.0/0` on a non-port-443 inbound
rule — that is a finding to report.

**Exercise C — audit S3 bucket exposure [needs cloud account]**

```bash
# [needs cloud account — AWS]
# List all S3 buckets and check public-access settings:
aws s3api list-buckets --query "Buckets[].Name" --output text | tr '\t' '\n' | \
  xargs -I {} aws s3api get-public-access-block --bucket {} 2>/dev/null

# A bucket without BlockPublicAcls=true and BlockPublicPolicy=true is a finding.
```

**Exercise D — Cloud Armor rule structure [paper, laptop for docs]**

Using the GCP Cloud Armor documentation, write a security policy rule that:
- Blocks any IP in the range `192.0.2.0/24` (test range — safe to use).
- Rate-limits all other IPs to 500 requests per minute, banning for 300 seconds
  if exceeded.

Verify your syntax against:
`https://cloud.google.com/armor/docs/security-policy-overview`

## Say it back (self-check)

1. Name the four layers of cloud network security in order and give one GCP
   construct for each.
2. What problem does VPC Service Controls solve that VPC Firewall Rules cannot?
3. In AWS, what is the difference between a Security Group and a Network ACL,
   and when would you use each?
4. Why is the Azure `AllowVnetInBound` default rule a security risk if you do
   not add explicit DENY rules?
5. What does Cloud Armor protect that a GCP VPC Firewall Rule on a VM cannot?

## Talk to the IT/security head

**Ask:**

- "Do you have an org-level policy preventing VMs from being assigned public IPs
  in production? Can you show me the control?" *(A good answer: "Yes, GCP Org
  Policy `compute.vmExternalIpAccess` is set to deny in our production folder" —
  with evidence, not just a claim.)*

- "What stops a compromised GCP service account from exfiltrating data to an
  external Cloud Storage bucket?" *(A good answer: "VPC Service Controls
  perimeter — the service account's project is inside the perimeter, and writes
  to buckets outside the perimeter return PERMISSION_DENIED regardless of IAM."
  A concerning answer: "We audit it with Security Command Center." Auditing is
  not prevention.)*

- "For your internet-facing cloud services, what WAF rule set is active, and when
  was it last reviewed?" *(A good answer: names a specific rule set — OWASP CRS,
  a managed Cloud Armor preconfigured rule group — and a review date in the last
  quarter. Red flag: "the LB protects it" — load balancers do not inspect HTTP
  payloads.)*

- "If a developer accidentally opens port 22 to 0.0.0.0/0 in a project firewall
  rule, how quickly is it detected and blocked?" *(A good answer: "Org Firewall
  Policy at priority 1 blocks it before any project rule applies; Security
  Command Center alerts us in under five minutes." A weak answer: "we'd catch it
  in the next audit.")*

- "What are your VPC Flow Logs retention period and who reviews them?" *(FSI
  minimum: 12 months retention per RBI and PCI-DSS v4.0 Req 10.5.1 (with at
  least 3 months immediately available); a good answer
  specifies both. Reviewing them only on incident is a detection gap.)*

**Red flags to listen for:**

- "We have a WAF" with no mention of which rule set is active — a WAF with no
  rules enabled is a pass-through.
- "We don't need VPC SC, we have tight IAM" — IAM and VPC SC are orthogonal
  controls; a stolen credential inside the perimeter can still exfiltrate without
  VPC SC.
- "Our cloud SGs are managed per-team" with no central Firewall Policy — in a
  regulated environment, this means no auditable guarantee on the
  internet-exposure baseline.
- No explicit answer on VPC Flow Log retention — if they do not know, the logs
  are likely not meeting RBI/PCI requirements.

## Pitfalls & war stories

**The permissive-default Azure trap.** Every new Azure VNet has
`AllowVnetInBound` (priority 65000) allowing all intra-VNet traffic on all
ports. Banks that lift-and-shift without adding explicit DENY rules between
tiers discover after the penetration test that any compromised web-tier VM could
reach the database port directly. The fix is NSG rules at the subnet level for
each tier, added *before* workloads go live.

**"IAM is enough" — the exfiltration blind spot.** A GCP project with tight
IAM but no VPC SC perimeter can still have its data exfiltrated by a compromised
role that has `storage.objects.get` — it just copies to a bucket outside your
org. VPC SC closes the gap IAM cannot.

**Cloud Armor not attached to the right LB.** Cloud Armor policies must be
attached to the **backend service** of a GCP External HTTPS Load Balancer. They
do *not* protect Internal LBs or anything accessed via Private Service Connect
or direct VM IPs. An architect who says "Cloud Armor is on" should verify the
attachment point covers every internet-exposed surface.

**NACL ephemeral port miss (AWS).** AWS Network ACLs are stateless. A developer
who writes a clean-looking NACL — "ALLOW INBOUND 443" — then wonders why
responses are dropped has forgotten the outbound ephemeral return rule
(ALLOW OUTBOUND 1024–65535). This is a common misconfiguration in regulated
AWS accounts where NACLs are added as an extra layer but written by someone
familiar only with stateful SG semantics. See N42.

**VPC SC breaking legitimate service access.** At Meridian Bank, enabling VPC
SC on the data-warehouse project with `DRY_RUN` first is mandatory: going
straight to `ENFORCED` mode frequently breaks scheduled Cloud Scheduler or
Dataflow jobs that run from outside the perimeter. Always use dry-run for one
week, audit the violations, then add legitimate access levels before enforcing.

**FSI-specific: flow log gaps during cloud migration.** During a phased
migration, production flows split between on-prem (NetFlow) and cloud (VPC Flow
Logs). The two telemetry streams are in different tools and formats. The IT head
and CISO need a single view — the gap here is not technical, it is a SIEM
integration project that must precede the migration, not follow it.

## Going deeper (optional)

- GCP VPC Service Controls overview and dry-run mode:
  `https://cloud.google.com/vpc-service-controls/docs/overview`
- GCP Hierarchical Firewall Policies:
  `https://cloud.google.com/firewall/docs/firewall-policies-overview`
- AWS Security Groups vs NACLs deep dive:
  `https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html`
- AWS Shield documentation and pricing tiers:
  `https://aws.amazon.com/shield/`
- Cloud Armor security policies and preconfigured WAF rules:
  `https://cloud.google.com/armor/docs/security-policy-overview`
- NIST SP 800-210 — General Access Control Guidance for Cloud Systems.
- Pairs with N42 (cloud firewalls), S32 (shared responsibility), S34 (CSPM),
  and S36 (cloud logging and detection).

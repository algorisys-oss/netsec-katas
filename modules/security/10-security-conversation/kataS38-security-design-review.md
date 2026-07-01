# Kata S38 — Security design-review playbook: the questions that expose risk

> **Track:** Security · **Module:** S10 Security conversation mastery · **Prereqs:** S01, S03, S07, S26, N27, N56 · **Time:** ~40 min
> **Tags:** `security` `architecture-review` `conversation` `risk-management` `fsi` `meridian-bank` `defense-in-depth` `capstone`

## Why it matters

Every significant system design passes through a security review before it
reaches production — at a bank, that review typically involves the CISO, a
GRC analyst, a network-security engineer, and often an external auditor. If
you walk in without a structured way to probe the design, you will miss the
control that is absent, the trust boundary that is implicit, or the blast
radius that is understated. Conversely, if you ask the right questions in the
*right order*, you drive the conversation rather than react to it — and you
catch the risk before it becomes an incident or a finding.

This kata gives you the playbook: a repeatable mental checklist of eight
question clusters that surfaces the most common security gaps in enterprise and
cloud designs. It is the security counterpart to N56 (the networking
design-review playbook) and the conversation layer on top of S01 (mindset),
S03 (threat modeling), and S26 (Zero Trust).

## The mental model

A security design review is a structured *risk walk*, not a features audit.
The goal is to answer one question: **if this design is built as drawn, what is
the worst thing that can go wrong, and how far does it spread?**

To answer that, you walk eight dimensions in order. The order matters — each
layer assumes the previous one.

```
  QUESTION CLUSTER                  WHAT YOU ARE REALLY TESTING
  ──────────────────────────────────────────────────────────────
  1. Scope & assets                 "What are we protecting and why?"
  2. Trust boundaries               "Where does trust change — and is it enforced?"
  3. Identity & access              "Who can do what, and how is that verified?"
  4. Data flows & exposure          "Where does sensitive data travel, in what form?"
  5. Encryption & key control       "Is data protected in transit, at rest, in use?"
  6. Blast radius & segmentation    "If this component is compromised, how far can
                                     an attacker go?"
  7. Detection & response           "Would we know within an hour? Within a day?
                                     Could we contain it without shutting down?"
  8. Compliance & evidence          "Can we demonstrate each control to an auditor?"
```

Work clusters 1–4 on the whiteboard *before* asking about specific controls.
Architects who skip to cluster 5 ("is it encrypted?") before establishing
trust boundaries and data flows miss the harder risks — the path that bypasses
encryption altogether.

### The two lenses to hold simultaneously

```
  ATTACKER LENS                     AUDITOR LENS
  ─────────────────────────────     ─────────────────────────────
  "Where would I enter?"            "What evidence proves the control?"
  "What can I reach from there?"    "Who can override or bypass it?"
  "How long before detection?"      "What's the change-control trail?"
  "What's my payload / exfil?"      "Is the risk formally accepted?"
```

Use the attacker lens to find gaps; use the auditor lens to check whether gaps
are compensated or at least acknowledged.

## Worked example

Meridian Bank is proposing a new architecture: a customer-facing analytics
portal running in GCP (`10.100.0.0/14`) that must pull aggregated transaction
data from the core banking system in HQ-DC1 (`10.10.0.0/16`). The connection
crosses a Dedicated Cloud Interconnect (see N38). A junior architect has drawn
the following topology:

```
   Internet
      │
      ▼
  [Cloud Armor / WAF]          ← GCP external HTTPS LB (anycast VIP)
      │
  [App tier — GCP, 10.100.4.0/24]
      │  (private, GCP VPC)
  [Aggregation service, 10.100.8.0/24]
      │
  [Cloud Interconnect]
      │
  [Core banking firewall, HQ-DC1]
      │
  [Core banking DB, 10.10.20.0/24]   ← CDE (PCI scope)
```

Walk the eight clusters against this diagram:

**Cluster 1 — Scope & assets.**
The CDE subnet `10.10.20.0/24` is PCI-scoped cardholder data. The analytics
portal is *not* in scope if it only receives aggregated, non-PAN data. Key
question: does the aggregation service ever touch raw card numbers, or only
derived analytics? If the former, PCI scope expands to GCP — a much larger
compliance burden.

**Cluster 2 — Trust boundaries.**
There are three zone transitions: (a) internet → GCP edge, (b) GCP app tier →
GCP aggregation tier, (c) GCP → HQ-DC1 over Interconnect. The diagram shows a
WAF at (a) and a firewall at (c). Boundary (b) is not shown — is there any
control between the app tier and the aggregation service? A compromised app VM
in `10.100.4.0/24` should not be able to query the Interconnect directly.

**Cluster 3 — Identity & access.**
Who authenticates to the aggregation service? Service accounts? mTLS? Is the
cloud-to-core path authenticated at the application layer, or does it rely
solely on the Interconnect being a private circuit? Private circuits are not an
identity control — an insider or a compromised GCP project can send traffic
over them (see N38, N44).

**Cluster 4 — Data flows & exposure.**
Draw the data path: core DB → aggregation service → portal app → end user's
browser. At each hop: is the data in raw or aggregated form? Does a log, a
cache, or a temporary file anywhere store PAN-adjacent data? The aggregation
service is where scope is either contained or exploded.

**Cluster 5 — Encryption & key control.**
- Transit: TLS on the public edge (the external HTTPS load balancer terminates
  TLS; Cloud Armor inspects), TLS re-encryption to the app tier, and... what
  between aggregation service and core banking? Interconnect is private but *not*
  encrypted by default. Encrypting the internal path is a defense-in-depth
  control (and is typically required by organizational policy and the intent of
  PCI-DSS Req 4); a TLS session or MACsec on the Interconnect attachment provides
  it (see N38). Note that Req 4.2.1's letter is scoped to open, public networks
  — it does not by itself mandate encryption on a private dedicated circuit.
- At rest: who controls the KMS key for the analytics store? A Cloud KMS
  customer-managed key (CMEK) with appropriate key IAM is the minimum for
  financial data in GCP.

**Cluster 6 — Blast radius & segmentation.**
If the app tier (`10.100.4.0/24`) is fully compromised:
- Can an attacker reach the aggregation tier? (Missing boundary from cluster 2.)
- Can they pivot to the Interconnect and reach `10.10.20.0/24`?
- Can they exfiltrate data via the GCP internet egress path?

The current diagram has a flat path from internet to CDE with only one control
at each end. If Cloud Armor is bypassed (it can be — see N25, N28), and the
app firewall rules allow all ports between the two GCP tiers, the attacker is
one hop from the core banking firewall with a private source IP.

**Cluster 7 — Detection & response.**
- GCP-side: are VPC Flow Logs enabled on `10.100.4.0/24` and `10.100.8.0/24`?
  Is Security Command Center (CSPM) active? Are alerts routed to Meridian's SIEM?
- HQ-DC1-side: does NetFlow on the Interconnect-facing interface feed the NDR?
  Is there a baseline for what "normal" aggregation traffic looks like?
- Response: if an anomaly is detected at 2 a.m., does the runbook allow the
  on-call to block the Interconnect attachment without a CAB meeting? (Almost
  certainly not — that's a design constraint to document, not fix overnight.)

**Cluster 8 — Compliance & evidence.**
- PCI-DSS Req 11: network segmentation documented and tested? If PAN-adjacent
  data transits the GCP boundary, expect annual penetration testing (and after
  any significant change), plus segmentation testing at least every 6 months for
  service providers / every 12 months otherwise. (The only PCI activity on a
  quarterly cadence is ASV vulnerability *scanning* under Req 11.3.2 — not pen
  testing.)
- RBI / PMLA retention: audit logs for all access to `10.10.20.0/24` retained per
  the applicable retention policy (security logs ≥6 months online, with longer
  archival retention per the applicable RBI direction; transaction/KYC records
  5 years under PMLA), with integrity protection.
- Data residency: is `asia-south1` (Mumbai) the GCP region in use? If analytics
  data includes customer identifiers, DPDP Act obligations apply.

The review surfaces five issues not visible at first glance: (1) missing
internal GCP boundary, (2) no application-layer auth on the core path, (3) no
in-transit encryption on the Interconnect segment, (4) CDE scope ambiguity
depending on data content, and (5) Interconnect teardown not in the incident
runbook.

## Cloud / vendor mapping (when applicable)

| Review element | On-prem | GCP | AWS | Azure |
|----------------|---------|-----|-----|-------|
| Trust boundary enforcement | Firewall / VLAN / DMZ | Hierarchical Firewall Policy, VPC firewall rules | Security Groups + NACLs, AWS Network Firewall | NSG, Azure Firewall |
| Identity on service paths | Kerberos / mutual TLS / client cert | Workload Identity, mTLS via Cloud Service Mesh | IAM Roles for EC2/ECS, mTLS via ACM PCA | Managed Identity, mTLS |
| In-transit encryption | MACsec on WAN circuits | MACsec on Dedicated Interconnect, or TLS | MACsec on Direct Connect, or TLS | MACsec on ExpressRoute, or TLS |
| Key management evidence | HSM / SafeNet | Cloud KMS (CMEK), Cloud HSM | AWS KMS (CMEK), CloudHSM | Key Vault (BYOK) (Azure: TODO full detail) |
| Posture / misconfiguration | Manual audit | Security Command Center | AWS Security Hub, GuardDuty | Microsoft Defender for Cloud |
| Flow telemetry | NetFlow / sFlow | VPC Flow Logs → Cloud Logging | VPC Flow Logs → CloudWatch/S3 | VNet flow logs → Log Analytics (NSG flow logs retired 2025) |
| Change evidence for auditors | CMDB + change tickets | Cloud Audit Logs (immutable) | CloudTrail | Azure Activity Log |
| Blast-radius isolation | Physical segmentation | VPC perimeter + VPC-SC | VPC + SCP (org-level deny) | VNet + Management Groups |

## Do it (the exercise)

Pick a real or plausible design you know (a cloud-connected system, a
partner-integration, a new SaaS ingestion pipeline). Work through every cluster
below. Write one line per cell. The discipline of filling *every* cell reveals
gaps faster than free-form review.

**[laptop / paper] — 30 min**

```
CLUSTER              YOUR ANSWER                       CONFIDENCE (H/M/L)
─────────────────────────────────────────────────────────────────────────
1. What assets?      ________________________________  ___
   Crown jewels?     ________________________________  ___

2. Trust boundaries  List each zone transition:        ___
   (name each)       ________________________________
                     Enforcement mechanism per hop?    ___

3. Who authn/authz?  Service-to-service auth type?     ___
   Rotation cadence? ________________________________  ___

4. Data path         Raw or processed at each hop?     ___
   Logging stops?    ________________________________  ___

5. Encryption        In transit (each segment)?        ___
   At rest (each store)?  ___________________________  ___
   Key control (who can rotate)?  __________________  ___

6. Blast radius      Worst-case breach start point?    ___
   How far can it spread?  ________________________   ___
   Chokepoints that stop it?  _____________________   ___

7. Detection         First alert in what time?         ___
   Runbook exists?   ________________________________  ___
   Contain w/o CAB?  ________________________________  ___

8. Compliance        Which frameworks apply?           ___
   Control evidence  ________________________________  ___
   Open risks        ________________________________  ___
```

**[needs cloud account] — optional extension**
For the Meridian GCP project:
1. Enable VPC Flow Logs on one subnet and export to Cloud Logging. Run
   `gcloud logging read 'logName=~"vpc_flows"' --limit=5` to confirm capture.
2. Check Security Command Center → Findings for any HIGH findings on the project.
3. Run `gcloud asset search-all-iam-policies --scope=projects/PROJECT_ID \
   --query='roles/owner'` and verify no service accounts hold `roles/owner`.

## Say it back (self-check)

1. Name the eight review clusters in order and explain why the order matters.
2. What is a trust boundary, and why must it be *enforced* rather than just
   documented?
3. Dedicated Interconnect is a private circuit. Why is it not an identity or
   encryption control?
4. An architect says "everything is encrypted in transit." What follow-up
   questions do you ask to test that claim?
5. What is the difference between blast radius (cluster 6) and scope ambiguity
   (cluster 1), and why must you address scope first?

## Talk to the IT/security head

**Ask — Cluster 1 (scope):**
- "What are the three systems whose compromise would cause a regulatory notification
  or material business impact?" *(Forces explicit asset prioritization; good CISO
  answers without hesitation.)*
- "Is this new service in PCI scope? When did you last review where the scope
  boundary falls?" *(Scope creep is the most common PCI gap.)*

**Ask — Cluster 2 (trust boundaries):**
- "Walk me through each network zone transition in this design and the control
  that enforces it — not the one that *should* be there, the one that *is*."
  *(The gap between should and is is where risk lives.)*
- "What happens if a VM in the app tier is compromised — what can it reach?"
  *(Tests whether blast-radius thinking is in the design or post-hoc.)*

**Ask — Cluster 3 (identity):**
- "How does service A authenticate to service B on this path? Is it a shared
  secret, a certificate, or a workload identity?" *(Shared secrets that don't
  rotate are the most common finding in FSI cloud reviews.)*
- "Who can rotate or revoke those credentials, and what is the rotation cadence?"

**Ask — Cluster 7 (detection):**
- "If an attacker exfiltrated 10 GB of data from this system on a Saturday
  night, when would your team know?"
- "Does the containment runbook for this service require a CAB approval, or can
  on-call act immediately?" *(Answer reveals whether the change-control culture
  has been reconciled with incident speed.)*

**A good answer sounds like:** the CISO can walk cluster 1 → 2 → 6 fluently
from memory, names specific controls (not categories), and acknowledges the
open risks with documented acceptance — "we know the Interconnect isn't
encrypted, it's a risk-accepted item pending MACsec rollout, tracked in the
register."

**Red flags to listen for:**
- "Our firewall team handles that" (no evidence the speaker knows what controls
  exist) — the firewall team may be in a different org with different context.
- "We're PCI compliant" used as a proxy for security — compliance is a floor.
- No answer for cluster 7: "we'd get an alert" with no named SIEM, no runbook,
  no time estimate.
- "We'll add encryption later" on a path that carries regulated data today.
- Inability to name what is in scope vs out of scope for PCI or RBI.

## Pitfalls & war stories

**The implicit trust boundary.** The single most common finding in FSI cloud
reviews: a firewall exists at the perimeter but internal tiers are flat. Traffic
from a compromised app VM can reach the database directly because "they're in
the same VPC." VPCs are not security boundaries within themselves — GCP
firewall rules and AWS Security Groups must be applied to every pair of tiers,
not just the perimeter. See N27 (micro-segmentation) and S26 (Zero Trust).

**Scope explosion at the last minute.** Meridian's analytics portal starts as
"aggregated, non-PCI data" and six months later, one engineer adds a raw-
transaction debug endpoint for troubleshooting. Now PAN-adjacent data transits
GCP, scope has expanded silently, and the next QSA visit finds an uncontrolled
CDE. Scope must be *technically enforced* (DLP, data-type tagging) not just
assumed from architecture intent.

**Private circuit ≠ encryption.** At multiple FSI clients: "we use Dedicated
Interconnect / Direct Connect so we don't need TLS on the internal path." An
Interconnect is a private Layer 2 circuit between you and the cloud provider.
It is not encrypted. A rogue process on a shared device in the carrier PoP, a
misconfigured VLAN attachment, or a supply-chain compromise at the colocation
facility can all read unencrypted traffic on that circuit. Note that PCI-DSS
Req 4.2.1's letter is scoped to "open, public networks" and does not, by itself,
mandate encryption on a private dedicated circuit — but as a defense-in-depth
control (and to satisfy the intent of Req 4 and most organizations' internal
encryption policy), encrypting PAN-adjacent traffic on the internal path is the
right call. Don't let "Req 4.2.1 doesn't strictly apply here" become an excuse
to leave the link in cleartext.

**The CAB / containment paradox.** In regulated FSI environments, change-control
means even a patch or a firewall rule change needs a CAB slot (often 48–72 hours
notice). Incident response requires minutes. These are in direct conflict.
Resolution: maintain a pre-approved emergency change type ("break-glass" CAB
waiver with post-hoc documentation), and drill it. Architects who design systems
without consulting the change-control process discover the conflict at the worst
moment.

**Over-reliance on CSPM.** Cloud Security Command Center / AWS Security Hub /
Defender for Cloud catch misconfiguration in the *control plane* (public
buckets, overly-permissioned roles, missing flow logs). They do not catch
compromised application logic, insider threats, or attacker activity that uses
correctly-configured access paths. CSPM is cluster 8 evidence; NDR and SIEM
are cluster 7 detection. Both are needed; neither replaces the other.

**Northwind counter-example.** Northwind FMCG acquired Eastfield Foods, which
brought overlapping `10.50.0.0/16` (see running-example.md). The network team
solved the overlap with NAT. The security team was never informed. Result: VPC
Flow Logs from Northwind's AWS primary reported traffic to `10.50.x.x` that
the SIEM flagged as internal — but half those IPs were now Eastfield equipment
with different patch levels and no EDR. The blast radius of a compromise at any
of those IPs was invisible. IP-overlap problems are data security problems, not
just routing problems (see N11).

## Going deeper (optional)

- NIST SP 800-53 Rev 5 — the control catalog; CA-2 (Security Assessments) and
  RA-3 (Risk Assessment) are the formal home of this playbook.
- OWASP Threat Modeling Cheat Sheet — a structured complement to the cluster
  approach taught here; pairs with S03.
- PCI-DSS v4.0 Requirements 1 (network segmentation), 4 (encryption in transit),
  10 (audit logging) — the three requirements most exposed by clusters 2, 5, 8.
- GCP Security Foundations Blueprint —
  cloud.google.com/architecture/security-foundations — opinionated reference
  for cluster 8 evidence in a GCP landing zone.
- AWS Security Reference Architecture —
  docs.aws.amazon.com/prescriptive-guidance/latest/security-reference-architecture
  — equivalent for AWS.
- "Threat Modeling: Designing for Security" by Adam Shostack — full-length
  treatment of the structured approach introduced in S03.
- Pairs with: S01 (mindset), S03 (threat modeling), S26 (Zero Trust), N27
  (segmentation), N38 (Interconnect), N56 (networking design-review counterpart).

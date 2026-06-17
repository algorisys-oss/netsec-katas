# Kata N29 — PCI-DSS / RBI / data-residency: how compliance shapes the network

> **Track:** Networking · **Module:** N5 Network security & perimeter · **Prereqs:** N26, N27, N28, S01 · **Time:** ~40 min
> **Tags:** `security` `compliance` `pci-dss` `rbi` `data-residency` `segmentation` `fsi` `meridian-bank`

## Why it matters

Compliance frameworks are not bureaucracy layered on top of a network design —
they *are* the design brief for a regulated client. At Meridian Bank, PCI-DSS
tells the network team where card data may live, who may touch it, and what must
log every packet in and out. RBI's IT frameworks tell the CISO what controls must
be certified and how long audit evidence must be retained. Data-residency rules
tell the cloud architect which regions are allowed. If you propose a network
architecture without understanding these constraints, you will lose the CISO's
trust before you finish your first slide. This kata translates the three major
compliance pressures an FSI architect faces into their concrete network
consequences.

## The mental model

### The compliance → network translation chain

Every compliance requirement eventually becomes one of five network actions:

```
  COMPLIANCE REQUIREMENT          NETWORK CONSEQUENCE
  ─────────────────────────────────────────────────────────────────────
  Isolate regulated data          Separate network zone + firewall rules
  Restrict who can reach it       ACLs / security groups / micro-seg
  Log everything in/out           Flow logs + SIEM feed on every boundary
  Encrypt in transit              TLS mandatory on every path into the zone
  Keep data in-country            Region pinning + egress block to other regions
  Prove it to an auditor          Network diagram + rule base + log samples
```

The mental shortcut: **compliance = scoping + logging + encryption + geography**.
Get those four right and most audits are defensible.

### PCI-DSS: the cardholder data environment (CDE)

PCI-DSS (Payment Card Industry Data Security Standard) v4.0 defines a **CDE** as
any system that stores, processes, or transmits cardholder data (CHD) — card
numbers (PANs), CVVs, PINs — *plus every system connected to it*. That second
clause is the trap architects miss: connect your monitoring server to the CDE and
it joins the CDE, broadening scope and audit cost.

The fundamental PCI network demand is **segmentation**:

```
  Internet
      │
  ┌───▼──────────────────────────────────────────────────────────┐
  │  EXTERNAL ZONE (DMZ)                                         │
  │  Payment gateway · 3DS server · MPI                          │
  └───┬──────────────────────────────────────────────────────────┘
      │  Only port 443 inbound, only card-auth ports outbound
  ┌───▼──────────────────────────────────────────────────────────┐
  │  CDE (Cardholder Data Environment)         ← PCI SCOPE       │
  │  Card processing · HSM · tokenisation engine                 │
  │  10.10.20.0/24                                               │
  └───┬──────────────────────────────────────────────────────────┘
      │  Explicit firewall allow-list only; default-deny in both
      │  directions; all traffic logged
  ┌───▼──────────────────────────────────────────────────────────┐
  │  INTERNAL NETWORK (HQ-DC1)                 ← out of scope    │
  │  Core banking · staff systems                                │
  │  10.10.3.0/24 onward                                         │
  └──────────────────────────────────────────────────────────────┘
```

Key PCI-DSS network requirements (v4.0, requirements 1 and 10):
- **Req 1.2**: network controls between the CDE and all other networks.
- **Req 1.3.1**: inbound traffic to the CDE restricted to what is necessary.
- **Req 1.3.2**: outbound traffic from the CDE restricted to what is necessary.
- **Req 10.2**: audit logs covering every access to CHD and system components.
- **Req 10.5.1**: logs retained for at least 12 months; 3 months immediately
  available (online/hot).

"Necessary" is the operative word in Reqs 1.3.1 and 1.3.2. A firewall rule that
says "allow any from 10.10.0.0/16 to CDE" is a PCI finding. Rules must name
specific source IPs and ports.

### RBI IT frameworks: what they add

The Reserve Bank of India's Master Directions on IT Framework for Banks (2023
edition) and its predecessor guidelines add several network-level controls beyond
PCI:

- **Logical access controls**: production systems must be accessible only from
  dedicated management networks; developer access to production is prohibited.
- **Network segregation**: internet-facing systems in a DMZ, a separate zone for
  SWIFT/interbank payments, core banking isolated from internet paths.
- **Change management**: all network changes need a change record, impact
  assessment, and post-implementation review. The CAB is not optional (see N02).
- **Audit trail retention**: typically 8 years for banking records (longer than
  PCI's 12 months) — logs must be tamper-evident and offloaded from the device
  they protect.
- **Vendor access**: third-party access must use dedicated jump hosts, be
  time-limited, and be logged end-to-end.

The RBI also expects banks to conduct **annual VAPT** (Vulnerability Assessment &
Penetration Testing) on critical systems and report findings to the board. Network
architecture changes made in response to VAPT findings must be tracked.

### Data residency: where bytes may live

Data-residency rules restrict which geographic region may hold or process data.
For Indian banks this comes from RBI (customer data must be stored in India),
reinforced by the Digital Personal Data Protection Act 2023 (DPDP Act). The
consequence is architectural:

```
  Allowed (India regions)           Blocked (foreign egress)
  ─────────────────────────────────────────────────────────────
  GCP  asia-south1 (Mumbai)         Any GCP region outside India
       asia-south2 (Delhi)
  AWS  ap-south-1  (Mumbai)         Any AWS region outside India
       ap-south-2  (Hyderabad)
  Azure centralindia (Pune)         Any Azure region outside India
        southindia  (Chennai)
        westindia   (Mumbai)
```

These lists are illustrative, not exhaustive — cloud providers add India regions
over time. Before pinning an "allowed regions" org policy, enumerate the *current*
full set per provider (or you risk an over-restrictive policy that blocks a
legitimate in-country region).

Data-residency enforcement is not just a cloud configuration checkbox. It requires:
1. All **data stores** (DBs, object storage, queues) provisioned in allowed
   regions only.
2. **Replication** blocked from going outside the allowed region set (e.g., no
   cross-region backup to us-east-1).
3. **DNS and routing** that ensures traffic from the bank's app never hairpins
   through a foreign CDN PoP that might cache regulated data.
4. **Audit evidence**: the bank's CISO must be able to prove to the RBI auditor
   that no CHD or personal data left the country — cloud org-level policies and
   their logs are that evidence.

## Worked example

### Meridian Bank: carving the CDE out of HQ-DC1

Meridian Bank's HQ-DC1 uses `10.10.0.0/16` (see `reference/running-example.md`).
The network team must carve a PCI-scoped CDE subnet and demonstrate isolation.

**Subnet allocation:**

```
  10.10.0.0/16   HQ-DC1 supernet
  ├── 10.10.0.0/24   Management / jump-host VLAN       (254 host addrs)
  ├── 10.10.2.0/24   DMZ — internet-facing services    (254 host addrs)
  ├── 10.10.3.0/24   Core banking (internal)           (254 host addrs)
  ├── 10.10.4.0/24   SWIFT / interbank payments        (254 host addrs)  ← additional RBI zone
  ├── 10.10.20.0/24  CDE — card processing, HSM        (254 host addrs)  ← PCI scope
  └── 10.10.5.0/24 – 10.10.255.0/24   Reserved / staff / DR paths (excl. .20)
```

Each /24 is a separate VLAN with a dedicated Layer-3 interface on the firewall
(see N27). No routing exists between subnets unless there is an explicit firewall
allow rule. Default-deny is the baseline — every unlisted flow is dropped and
logged.

**Allowed flows to/from the CDE (10.10.20.0/24):**

```
  Source            Destination       Port(s)          Purpose
  ──────────────────────────────────────────────────────────────────────────
  10.10.2.0/24      10.10.20.0/24     TCP 8443         Payment gateway → card processor
  10.10.0.0/24      10.10.20.0/24     TCP 22 (SSH)     Jump-host admin access
  10.10.20.0/24     10.10.0.50/32     TCP 514 (syslog) CDE → log aggregator (SIEM)
  10.10.20.0/24     10.10.0.51/32     UDP 123 (NTP)    CDE → internal NTP server
  (all other flows)                                    DROP + log
```

The log aggregator at `10.10.0.50` and the NTP server at `10.10.0.51` are
deliberately **out of CDE scope** — they receive data from the CDE but have
no path back in, so they do not inherit PCI scope. This is the "one-way valve"
pattern for keeping monitoring out of scope.

### Cloud path: GCP digital-banking backend to CDE

Meridian Bank's mobile banking backend runs in GCP `asia-south1` (Mumbai) on
`10.100.0.0/14` (see `reference/running-example.md`). When the mobile app
needs to initiate a card payment:

```
  Mobile app (user device)
      │ HTTPS 443
      ▼
  GCP asia-south1   10.100.0.0/14
  ├── public LB → mobile-banking API (in PCI-out-of-scope VPC)
  │       │  internal HTTPS 443 only
  │       ▼
  │   tokenisation service  ← converts PAN to token BEFORE it leaves GCP
  │       │  no raw PAN crosses the VPN; only token + amount
  │       ▼
  │   Cloud VPN / Dedicated Interconnect
  │       │
  └───────▼──────────────────────────────────────────────────
  HQ-DC1  10.10.0.0/16  (on-prem)
      │
      ▼
  CDE  10.10.20.0/24  ← raw PAN lives ONLY here
```

Tokenising before the data crosses the interconnect means the GCP side is **out
of PCI scope** — no CHD is stored or processed there. This is the single most
important cloud scoping decision for a bank on GCP/AWS.

Data residency is maintained because:
- The GCP resources are in `asia-south1` only; the VPC has an org-level policy
  (`constraints/gcp.resourceLocations`) restricting all resource creation to
  `in:in-locations`.
- No GCP storage bucket or BigQuery dataset has a replica outside India.
- The interconnect terminates in Mumbai; traffic never crosses a foreign PoP.

## Cloud / vendor mapping (when applicable)

| Compliance need | On-prem | GCP | AWS | Azure |
|-----------------|---------|-----|-----|-------|
| Network segmentation / CDE isolation | Firewall VLAN per zone | VPC with separate subnet + firewall rules; VPC Service Controls for API-level perimeter | Security Groups + NACLs per subnet; separate VPC per scope level | (Azure: TODO) |
| Data-residency enforcement | Physical location of hardware | Org Policy `constraints/gcp.resourceLocations` pinned to `in:in-locations` | Service Control Policies (SCPs) in AWS Organizations blocking non-`ap-south-1` resource creation | (Azure: TODO) |
| Audit log completeness | Syslog/SNMP to SIEM; firewall logs | Cloud Audit Logs (Admin Activity + Data Access logs); VPC Flow Logs | CloudTrail (management + data events); VPC Flow Logs | (Azure: TODO) |
| Log retention (PCI: 12 mo; RBI: 8 yr) | SIEM/NAS with retention policy | Cloud Logging log buckets with retention lock; export to Cloud Storage with Object Lock | CloudWatch Logs with retention + S3 with Object Lock | (Azure: TODO) |
| Encryption in transit to CDE / regulated zone | TLS 1.2+ on every path; IPsec on WAN | External HTTPS LB with an SSL policy pinning min TLS 1.2+ (TLS-min-version is set on the LB SSL policy, not via an org constraint); Google-managed certs; Cloud Armor in front of the LB; VPC Service Controls for the API perimeter | ACM-managed certs; ALB/NLB SSL policy requiring TLS 1.2+ | (Azure: TODO) |
| Tokenisation (keep CHD out of cloud) | HSM + tokenisation engine on-prem | Cloud HSM (Cloud KMS with HSM-backed key); tokenisation logic in GKE, PAN never reaches GCP | AWS CloudHSM + tokenisation in Lambda/ECS, PAN stays on-prem | (Azure: TODO) |
| Vendor / third-party access logging | Jump host + privileged access management (PAM) | Identity-Aware Proxy (IAP) with access log; Cloud Identity + MFA | AWS Systems Manager Session Manager (no open SSH); CloudTrail session logs | (Azure: TODO) |
| Pentest / VAPT evidence | Internal team + third-party pentest report | Google Cloud-specific pentest policy (no prior approval for own infra); Vulnerability Scanning via Security Command Center | AWS pentest policy (own infra, no pre-approval for most services); Inspector for vuln scanning | (Azure: TODO) |

**GCP-first note:** VPC Service Controls (VPC SC) is the GCP-specific construct
that goes beyond firewall rules — it creates a **security perimeter** around GCP
APIs (BigQuery, Cloud Storage, etc.) so that even if an IAM role is compromised,
data cannot be exfiltrated to a resource outside the perimeter. There is no exact
AWS equivalent; the closest is a combination of SCPs + VPC endpoints + resource
policies. Understand this distinction before advising a bank migrating to GCP.

## Do it (the exercise)

### Part 1 — Scope the CDE on paper [laptop / paper]

Using Meridian Bank's HQ-DC1 (`10.10.0.0/16`):

1. Draw the four zones from the worked example (Management, CDE, DMZ, Core
   banking). For each zone write:
   - The subnet (already given above).
   - Two services that live there.
   - One flow that must be allowed across a zone boundary.
2. For each allowed cross-zone flow, write it as a firewall rule:
   `ALLOW src=<IP/mask> dst=<IP/mask> proto=TCP dport=<port>`.
   Confirm you have a matching DROP rule for everything else.
3. Mark which zones are "in PCI scope." The rule: if a zone can reach CHD — even
   to forward it — it is in scope unless it is one-way (send-only, like syslog).

### Part 2 — Verify data-residency org policy (GCP) [needs cloud account]

If you have a GCP project:
```bash
# List org policies on the project/org — check for resource location constraints
gcloud resource-manager org-policies list \
  --project=YOUR_PROJECT_ID

# Describe the resource location constraint
gcloud resource-manager org-policies describe \
  constraints/gcp.resourceLocations \
  --project=YOUR_PROJECT_ID
```
A compliant project will show `in:in-locations` under `allowedValues`. An
unconstrained project (no policy returned, or `allValues: ALLOW`) means any region
can be used — an RBI finding.

### Part 3 — Inspect flow log coverage [needs cloud account]

```bash
# Confirm flow logs are enabled on a GCP subnet (compliance requires ALL subnets
# in the regulated VPC to have flow logs on)
gcloud compute networks subnets describe SUBNET_NAME \
  --region=asia-south1 \
  --format="value(enableFlowLogs,logConfig)"
```
Expected output for a compliant subnet:
```
True
aggregationInterval=INTERVAL_5_SEC;flowSampling=1.0;metadata=INCLUDE_ALL_METADATA
```
`flowSampling=1.0` means 100% of flows are captured — the PCI requirement.
Default GCP flow log sampling is 0.5 (50%); you must set it to 1.0 explicitly.

### Part 4 — Pen-and-paper scoping drill [laptop / paper]

A colleague proposes adding a "fraud analytics" server to the CDE subnet
(`10.10.20.0/24`) so it can read card transactions in real time. Evaluate:
- Does this put the analytics server in PCI scope? (Yes — it is now directly
  on the CDE subnet.)
- What alternative keeps analytics out of scope? (Consume a tokenised or
  aggregated feed from outside the CDE; the analytics server never sees raw PANs.)
- Write the firewall rule that implements the safer design.

## Say it back (self-check)

1. What is the CDE and what is the rule that determines whether a system is
   in scope?
2. Name three specific PCI-DSS v4.0 requirement numbers and what each demands
   of the network.
3. What does RBI add beyond PCI in terms of network controls that a bank must
   implement?
4. Why does tokenising card data before it crosses a cloud VPN keep the cloud
   side out of PCI scope?
5. What GCP org-level policy enforces data residency, and why is a firewall rule
   alone insufficient to enforce it?

## Talk to the IT/security head

**Ask:**

- "Which subnets are in your PCI CDE scope today, and how is that boundary
  enforced at the firewall?" *(A good answer names specific subnets, VLANs or
  security groups, and the default-deny rule that enforces the boundary. Vague
  answers like "our card systems are in a secure area" suggest the boundary has
  not been formally scoped.)*

- "How do you enforce data residency in cloud — is it an org-level policy or
  just a convention?" *(Policy beats convention every time. Conventions break
  when a developer creates a bucket in `us-east-1` "just for a test.")*

- "What is your log retention configuration, and how do you prove logs haven't
  been tampered with?" *(Expected: SIEM with immutable storage, Object Lock / log
  bucket lock, and a retention period that meets both PCI 12-month and RBI 8-year
  obligations. No log integrity mechanism = an audit finding.)*

- "When was your last VAPT on the CDE, and how many open findings remain?" *(RBI
  expects annual VAPT; PCI Req 11 requires external penetration testing at least
  annually. Unresolved high findings months after the test is a red flag.)*

- "If a new service needs to connect to the CDE, what does the approval path look
  like and how long does it take?" *(Good answer: named process, named approvers,
  documented lead time — typically CAB-gated. "We just open a ticket and it gets
  done" means there is no scoping control, which is a PCI Req 1 finding.)*

**Red flags to listen for:**

- "Our CDE is the whole data center" — no meaningful segmentation; scope is
  maximum, audit cost is maximum, blast radius is maximum.
- "We restrict regions in code, not policy" — a developer mistake can place data
  in the wrong region and nobody will know until the auditor asks.
- "We haven't done a VAPT in a while" — RBI-regulated banks must; if they haven't,
  something has gone wrong in governance.
- "The cloud team handles compliance" separately from "the security team handles
  compliance" — split ownership with no integration means gaps in evidence.

## Pitfalls & war stories

- **Scope creep via monitoring.** The most common PCI audit finding is a
  monitoring or logging system sitting inside the CDE subnet "for convenience."
  Once it is on the CDE subnet, it is in scope, the vendor who supports it needs
  PCI-compliant access, and the licensing cost of the SIEM doubles. The fix:
  one-way syslog from CDE to an out-of-scope log aggregator, never the reverse.

- **"Tokenisation at the database, not the edge."** Some teams store raw PANs in
  the app layer, tokenise them only when writing to the database. The app server
  then joins the CDE. Tokenise at the *earliest possible point* — ideally at the
  payment gateway before the PAN reaches your infrastructure at all. This is the
  difference between a CDE of two servers and a CDE of fifty.

- **Regional replication as a residency escape.** A bank set up GCP Cloud
  Storage in `asia-south1` correctly — then enabled multi-region replication
  "for DR." The replicas landed in Singapore. The RBI auditor found it. Fix:
  use `regional` storage class, not `multi-regional`; lock it with org policy.

- **MPLS and VAPT timing.** Meridian Bank's MPLS WAN connects 220 branches to
  HQ-DC1. A VAPT found that branch VLANs could reach the CDE through an
  undocumented routing leak. The branch network was never modelled as CDE-adjacent
  in the scoping questionnaire — the assumption was that MPLS is private so it
  doesn't matter. Private ≠ isolated. Every network path to the CDE must be in
  scope, including MPLS branches.

- **Northwind contrast.** Northwind FMCG processes customer credit-card payments
  at 3,000 retail points (see `reference/running-example.md`). Their instinct is
  to route all card traffic over the existing SD-WAN to avoid complexity. That
  places every SD-WAN node in PCI scope. The correct design: route card traffic
  from PoS terminals directly to a hosted payment gateway (e.g., Stripe, Razorpay)
  that takes PCI liability, keeping Northwind's infrastructure entirely out of
  scope. Compliance shapes the WAN topology, not just the data center.

## Going deeper (optional)

- **PCI-DSS v4.0** — the standard itself (PCI Security Standards Council, 2022).
  Requirements 1, 2, and 10 are the network-relevant sections. Free download at
  pcisecuritystandards.org.
- **RBI Master Directions on IT Framework for Banks** (2023 revision) — search
  the RBI website for "Master Direction – Reserve Bank of India (Information
  Technology Governance, Risk, Controls and Assurance Practices) Directions, 2023."
- **DPDP Act 2023** — Digital Personal Data Protection Act; Ministry of Electronics
  and IT (MeitY) website; relevant for architects handling Indian personal data.
- **GCP org policies reference** — `constraints/gcp.resourceLocations` in the
  Google Cloud documentation; pairs with N40 (cloud IP planning) and N49 (landing
  zones).
- **PCI tokenisation guidelines** — "PCI SSC Information Supplement: Tokenization"
  (2011, still canonical for design decisions); pairs with S18 (tokenisation &
  masking).
- Cross-reference: **N26** (firewalls — default-deny rule design), **N27**
  (DMZ and segmentation — the zone model), **N28** (IDS/IPS — the detection
  layer the auditor asks for), **S18** (tokenisation in practice), **S29**
  (frameworks map: where PCI-DSS sits next to NIST CSF and ISO 27001).

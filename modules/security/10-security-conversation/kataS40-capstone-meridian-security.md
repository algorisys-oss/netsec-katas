# Kata S40 — Capstone: security architecture for Meridian Bank's hybrid platform

> **Track:** Security · **Module:** S10 Security conversation mastery · **Prereqs:** S01, S38, S39, N59 · **Time:** ~45 min
> **Tags:** `security` `capstone` `fsi` `meridian-bank` `hybrid` `defense-in-depth` `architecture-review` `conversation`

## Why it matters

You have walked every layer: CIA triad, IAM, crypto/PKI, appsec, data security,
secops, incident response, Zero Trust, GRC, and cloud security posture. This kata
puts it all in one room. Meridian Bank's CISO and auditor are reviewing the
proposed hybrid platform — GCP primary, AWS secondary, on-prem HQ-DC1 and DC2 —
and they will ask questions you must answer in risk language, not feature language.
The kata is a practice run for that conversation. Every claim you make, the CISO
will probe. Every gap the auditor finds is a finding. Do not hand-wave.

## The mental model

A security architecture review is not a checklist pass. It is a structured walk of
**trust boundaries** — every line on the diagram where the threat level changes.
The CISO wants to know: what controls sit at each boundary, who owns them, and what
is the residual risk if one fails?

For a hybrid FSI platform the boundary map looks like this:

```
  INTERNET
      │
      ▼
  [WAF / Cloud Armor / AWS WAF]  ← L7 boundary (S13, N25)
      │
      ▼
  [GCP supernet 10.100.0.0/14]   ← whole GCP address space
      │
      ▼
  [GCP: DMZ/perimeter subnet 10.100.0.0/22]  ← public-cloud perimeter
      │ Private Service Connect / HA VPN
      ▼
  [GCP: App VPC — workloads 10.100.4.0/22]   ← internal cloud zone
      │ Cloud Interconnect (10 Gbps) to HQ-DC1
      ▼
  [HQ-DC1: 10.10.0.0/16]        ← on-prem enterprise core
      │ VLAN / firewall boundary
      ▼
  [CDE: 10.10.20.0/24]          ← PCI-scoped segment (N29, S18)
      │ DR link (dedicated circuit)
      ▼
  [DC2: 10.20.0.0/16]           ← disaster-recovery site
```

Three principles thread through every layer of this design:

1. **Default-deny at every boundary.** No path is permitted unless it is
   explicitly justified by a business requirement, documented, and approved.
2. **Defense in depth.** If the WAF fails, the cloud firewall still blocks.
   If the cloud firewall is misconfigured, the on-prem NGFW stops it. If the
   NGFW is bypassed, the CDE VLAN boundary holds. The auditor will ask "what
   is the next layer?" for every control you name.
3. **Least privilege at every plane.** Network paths are minimally scoped.
   IAM roles have minimum permissions. Encryption keys are scoped per zone.
   Secrets never cross trust boundaries as plaintext.

**The three planes an architect must account for:**

```
  DATA PLANE     — application traffic flows (what we've been mapping)
  CONTROL PLANE  — routing updates, BGP, DNS, orchestration API calls
  MANAGEMENT     — SSH/API admin access to infra; bastion hosts; break-glass
```

The management plane is the highest-value target and is usually the
least-documented boundary. Auditors find it every time.

## Worked example

We will walk the three highest-risk paths in Meridian Bank's hybrid platform and
name the control at each boundary.

### Path 1 — Internet customer to mobile-banking API (GCP)

```
  Mobile client → internet
    → GCP external HTTPS LB (anycast VIP, global)
    → Cloud Armor L7 policy (WAF rules: OWASP CRS, Meridian custom rules)
    → API Gateway (mTLS to backend, OAuth2 token validation)
    → App VMs in subnet 10.100.4.0/22 (GCP VPC)
    → Cloud Interconnect (MACsec-encrypted) → HQ-DC1
    → Core-banking API listener on 10.10.1.50:8443
    → CDE boundary firewall → CDE subnet 10.10.20.0/24
```

**Controls at each boundary:**

| Boundary | Primary control | Failure backstop |
|----------|----------------|-----------------|
| Internet → LB | TLS 1.3 mandatory, HSTS | Cloud Armor DDoS L3/L4 |
| LB → WAF | Cloud Armor OWASP CRS + rate limit | GCP Firewall default-deny |
| WAF → App VPC | VPC firewall: allow src=LB only, port 443 | Cloud IAP if admin path |
| App VPC → on-prem | Cloud Interconnect + MACsec; HA VPN failover | BGP prefix filtering (N14) |
| On-prem perimeter | NGFW: stateful, default-deny; IDS in parallel | NetFlow to SIEM (S20) |
| Core-banking → CDE | Internal VLAN firewall: allow app-srv IPs only | Tokenization at ingest (S18) |

**Numbers that matter:**

- Cloud Armor rate limit: 1,000 req/s per client IP (configurable) — set it and
  test it before go-live; an unlimited WAF is decoration.
- Cloud Interconnect: 10 Gbps dedicated; latency HQ-DC1 to GCP asia-south1
  (Mumbai) ≈ 3–5 ms over the co-lo cross-connect at Equinix MU1. Verify with
  `mtr` after circuit up; do not accept the SLA number as truth.
- CDE subnet `10.10.20.0/24` has 254 host addresses. Only card-processing
  servers live there; PANs are tokenized before reaching any other subnet
  (see S18). PCI-DSS Req 1.3 restricts network access to/from the CDE, and Req
  1.4.1 mandates the default-deny posture — explicit permit rules with no
  default-allow on the NSCs between trusted and untrusted networks.

### Path 2 — DevOps engineer accessing GCP workloads (management plane)

```
  Engineer laptop → corporate Wi-Fi / 10.40.x.x
    → ZTNA broker (identity + device posture check)  ← not a VPN
    → Cloud IAP TCP forwarding tunnel → GCP VM (no public IP)
    → SSH to 10.100.8.15 (jump host in mgmt subnet)
    → From jump host: SSH to target VM
```

**Why this matters to the CISO:** a VPN that gives a flat `10.100.0.0/14` route
is a lateral-movement invitation. ZTNA (see S26–S27) grants per-VM sessions after
identity verification. The engineer never has an IP on the cloud VPC. Cloud IAP
enforces this with `roles/iap.tunnelResourceAccessor` per VM, logged to Cloud
Audit Logs. Every session is an audit record.

**Red flag if you see:** a bastion with `0.0.0.0/0` as SSH source — this is an
open door and a PCI finding every time.

### Path 3 — Ransomware lateral movement scenario (incident-response lens)

```
  Attacker lands on a compromised workstation in 10.40.x.x (corp office)
    → attempts SMB pivot to 10.10.x.x (HQ-DC1)
    → firewall between 10.40.0.0/16 and 10.10.0.0/16:
        corp office → HQ-DC1: no SMB (port 445) permitted
        only HTTPS (443) and app-specific APIs allowed
    → attempts lateral move within 10.10.x.x:
        micro-segmentation (GCP VPC firewall rules (network tags/service accounts) / on-prem VLAN firewall):
        each server can reach only its declared upstream/downstream
    → attempts pivot to CDE 10.10.20.0/24:
        CDE firewall: allow-list of 4 app-server IPs only, no corp subnet
    → blocked at each hop; NDR detects anomalous east-west flows (S20)
```

**Blast radius (see N01, N27):** with segmentation, a compromise in `10.40.x.x`
cannot reach the CDE. Without it, one compromised workstation owns the whole bank.

## Cloud mapping

| Security control | On-prem | GCP | AWS | Azure |
|-----------------|---------|-----|-----|-------|
| WAF + DDoS | Palo Alto / F5 + scrubbing | Cloud Armor | WAF + Shield Advanced | (Azure: TODO) |
| L7 firewall (perimeter) | NGFW (Palo Alto / Fortinet) | Cloud NGFW / hierarchical firewall policy | Network Firewall | (Azure: TODO) |
| East-west micro-seg | VLAN + internal FW | VPC firewall rules + network tags | Security Groups + NACLs | (Azure: TODO) |
| IAM: workload identity | Service accounts (AD) | Workload Identity Federation | IAM Roles for Service Accounts | (Azure: TODO) |
| Secrets management | CyberArk / HashiCorp Vault | Secret Manager + Cloud KMS | AWS Secrets Manager + KMS | (Azure: TODO) |
| Audit logging | SIEM ingestion (Splunk/QRadar) | Cloud Audit Logs → Chronicle | CloudTrail → Security Lake | (Azure: TODO) |
| Posture management | Manual / periodic VA | Security Command Center | GuardDuty + Security Hub | (Azure: TODO) |
| Encryption at rest | TDE / disk encryption | CMEK (Cloud KMS) | SSE with CMK (KMS) | (Azure: TODO) |
| Encryption in transit | TLS 1.3, MACsec on circuits | MACsec on Interconnect; TLS by default | MACsec on Direct Connect; TLS by default | (Azure: TODO) |
| Data classification + DLP | Varonis / manual tagging | Cloud DLP + data catalog | Macie + Lake Formation | (Azure: TODO) |

**GCP-specific note:** `VPC Service Controls` create an API-level security
perimeter around GCP services (Cloud Storage, BigQuery, Spanner). Even if an IAM
role is over-permissioned, a VPC SC perimeter blocks exfiltration to outside
projects — no AWS equivalent at the API level.

**AWS-specific note:** `Service Control Policies` (SCPs) in AWS Organizations are
the account-level guardrail, capping the maximum permissions any IAM entity can
have. Use them to `Deny` the actions that turn OFF public-access blocking — e.g.
`s3:PutBucketPublicAccessBlock` and `s3:PutAccountPublicAccessBlock` — at the OU
level so no team can accidentally make a bucket public (optionally pair with a
`Deny` on `s3:PutBucketPolicy` / `s3:PutBucketAcl`).

## Do it (the exercise)

### Exercise A — draw and annotate the trust-boundary map [laptop / paper]

1. Sketch (paper or draw.io) Meridian Bank's hybrid platform from memory:
   GCP VPC, AWS VPC, HQ-DC1, DC2, the CDE subnet, and the internet edge.
   Use the IP ranges from `reference/running-example.md`.
2. On each boundary line, write:
   - The primary control (WAF, firewall, VLAN, IAP, etc.)
   - Who owns it (network team, cloud security, CISO)
   - The residual risk if that control fails
3. Identify every management-plane path (SSH, API calls to cloud control plane,
   DNS update paths). Mark them in red. These are what an auditor looks for first.

### Exercise B — spot what is missing from this design [laptop / paper]

The following design description has five security gaps. Find them.

```
  Meridian Bank GCP setup:
  - VMs in 10.100.4.0/22 have public IPs
  - Cloud Armor is configured with the default managed rule set, no custom rules
  - SSH to VMs allowed from 0.0.0.0/0 (port 22)
  - A single Cloud KMS key encrypts all disks across all VPCs
  - Cloud Audit Logs enabled but not exported to any SIEM
  - Service account for the mobile-banking app has "Project > Editor" role
  - Cloud Interconnect to HQ-DC1 has no MACsec; data crosses the carrier unencrypted
```

Write down each gap, the control that should close it, and the compliance
standard it violates (PCI-DSS, RBI, CIA, or SOC 2 as appropriate).

*(Answers: public IPs on VMs expose them without a WAF layer; SSH from any source
violates least-privilege and enables brute force; one shared KMS key violates
key-per-zone isolation and blast-radius control; audit logs not exported = no
detection; Project Editor is massively over-permissioned — violates least
privilege; no MACsec on Interconnect exposes data in transit to carrier and
violates PCI-DSS Req 4.2.1.)*

### Exercise C — simulate a CISO Q&A [laptop / paper]

A colleague plays the CISO and asks the questions in **Talk to the IT/security
head** below. You must answer each from memory using the Meridian Bank design. If
you cannot answer, that is the gap to close before the real review.

### Exercise D — check your posture baseline [needs cloud account]

In a GCP project (free-tier OK with a sandbox project):

```bash
# List all VMs with public IPs
gcloud compute instances list --format="table(name,networkInterfaces[].accessConfigs[].natIP)"

# List all firewall rules allowing 0.0.0.0/0 inbound
gcloud compute firewall-rules list \
  --filter="direction=INGRESS AND sourceRanges:0.0.0.0/0" \
  --format="table(name,network,allowed,targetTags)"

# List service accounts with Project-level Editor or Owner bindings
gcloud projects get-iam-policy <PROJECT_ID> \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/editor OR bindings.role:roles/owner" \
  --format="table(bindings.members)"
```

Each non-empty output from these three commands is a finding in a real FSI
environment.

## Say it back (self-check)

1. Name the five trust boundaries in Meridian Bank's hybrid platform and one
   primary control at each.
2. What is the management plane and why does the auditor always check it first?
3. If Cloud Armor fails, what is the next control that prevents a web attack from
   reaching the core-banking API? (There must be at least one more layer — name it.)
4. Why does PCI-DSS Req 1.4.1 specifically require a default-deny posture (with
   Req 1.3 restricting access to/from the CDE), and which cloud constructs
   enforce this in GCP and AWS?
5. A service account has `roles/editor` on the production GCP project.
   State the business risk, the correct replacement, and which compliance
   framework flags it.

## Talk to the IT/security head

**Questions to ask — and what good answers sound like:**

---

**Q1: "Walk me through every trust boundary in the design. What sits at each one?"**

A good answer names concrete controls per boundary (firewall model, WAF policy,
IAM restriction) and states the *next* control if the primary fails. The CISO can
draw the diagram from memory.

Red flag: "We have a firewall" with no specifics on placement, ownership, or rules.
That is a single control with no depth.

---

**Q2: "How do you ensure the CDE is isolated end-to-end — in cloud, in transit, and
on-prem? Who can enumerate the paths in and out?"**

A good answer: the CDE VLAN `10.10.20.0/24` has an allow-list firewall rule to
exactly four app-server IPs. No corp-office range (`10.40.x.x`) can reach it.
Cloud workloads reach it only via the Core Banking API on port 8443, not the
raw segment. Any new path requires a CAB-approved firewall rule. The network
team can pull the rule base in 5 minutes; the CISO's team reviews it quarterly.

Red flag: "The CDE is on a separate VLAN" with no further specifics. A VLAN is
boundary, not protection. The rules matter.

---

**Q3: "What is your encryption posture — in transit, at rest, and in use — and who
manages the keys?"**

A good answer covers: MACsec on Cloud Interconnect circuits, TLS 1.3 everywhere
with no TLS 1.0/1.1 permitted, CMEK per workload zone in Cloud KMS (not shared
keys), HSM-backed keys for CDE data, key rotation schedule (annual minimum; 90
days for PCI-scoped data), and who has `roles/cloudkms.admin` (a tiny named list,
not a team alias).

Red flag: "We use TLS everywhere and cloud-managed encryption." Cloud-managed
means the cloud provider holds the key. For FSI CMEK/BYOK is the expectation.

---

**Q4: "Show me the management-plane access path for a production firewall change.
Who touches it, how is it authenticated, and where is the log?"**

A good answer: changes are made from a named jump host via MFA-protected SSH,
the engineer identity is tied to a PAM-vaulted credential, the session is
recorded (session recording in the PAM tool), changes are committed to version
control (Oxidized/RANCID), and the CAB approval ticket is in ServiceNow with the
approver named. The SIEM has an alert for any SSH to the firewall outside a
change window.

Red flag: "Engineers SSH from their laptops with their own keys." No MFA, no
vaulted creds, no session record = a critical finding in any FSI audit.

---

**Q5: "If we had a ransomware incident today — a workstation in the corp office
is compromised — what is the blast radius, and how would you know in under an hour?"**

A good answer: the corp-office range `10.40.0.0/16` has no firewall path to the
CDE `10.10.20.0/24` or core-banking tier. East-west movement within `10.40.x.x`
is detectable via NDR (anomalous SMB sweep within 5 minutes of start). The
SIEM (Chronicle/Security Lake) would alert the SOC from NetFlow anomaly within
15 minutes. Containment is port-level isolation from the switch, not a
full-site takedown. The CISO can name the incident commander and the runbook.

Red flag: "We would check the firewall logs." Logs are evidence, not detection.
Detection requires a tool that baselines normal and alerts on deviation.

## Pitfalls & war stories

**The shared KMS key problem.** A bank migrated all workloads to GCP using one
Cloud KMS key per region — simpler to manage. An over-permissioned service account
with `cloudkms.cryptoKeyEncrypterDecrypter` on that key could decrypt any disk in
the region. The blast radius was the entire cloud estate. The correct design: one
key per workload classification (CDE data, non-CDE production, dev/test), with
separate IAM bindings per key.

**"We have Cloud Armor" ≠ "we have WAF."** Cloud Armor with only the default
managed rule set and no rate limiting is configured, not tuned. Effective WAF
requires custom rules for the application (e.g., block countries Meridian does
not operate in, rate-limit by account ID, block oversized payloads to
card-processing endpoints). Uncustomized WAF gets bypassed in the first real
test.

**The interconnect that skips MACsec.** Cloud Interconnect gives a private path,
but the physical fiber between your co-lo cage and the GCP meet-me room is
managed by the facility. Without MACsec (IEEE 802.1AE) negotiated between your
CE router and GCP's PE, data crossing the cross-connect is plaintext. PCI-DSS
Req 4.2.1 requires protection of PAN in transit across open/public networks.
Carrier fiber at a co-lo counts.

**The "everything is Zero Trust now" pitch.** ZTNA for remote access (S26–S27)
is not a network segmentation substitute. An FSI with ZTNA for remote access
but a flat east-west data center is not Zero Trust. The CISO will ask about
east-west micro-segmentation separately — they are different controls.

**Forgetting the control plane.** BGP route tables flowing over Cloud Interconnect
and DNS updates are control-plane traffic. A misconfiguration (or attack) that
poisons a BGP route or a private DNS zone can redirect traffic silently, bypassing
every data-plane control. Prefix filtering (N14), RPKI validation, and private
DNS zone integrity monitoring are the controls — and they are usually owned by
network-ops, not the security team. The architect must ask who owns them.

**The audit log that no one reads.** Cloud Audit Logs enabled on GCP, CloudTrail
on AWS — but exported to a storage bucket with no SIEM integration, no alert, and
a 30-day retention. Logs are evidence for forensics; they are not detection.
At Meridian Bank, RBI requires ≥6 months online, with longer archival retention
per the applicable RBI direction, for logs from critical systems.
Confirm the retention policy and the alert rule, not just the "logs enabled" checkbox.

## Going deeper (optional)

- PCI-DSS v4.0 Requirements 1 (network controls), 4 (encryption in transit), 7
  (access control), 10 (audit logging) — the specific reqs that map to this design.
- NIST SP 800-53 Rev 5: SC (System and Communications Protection) controls are the
  on-prem equivalent of PCI-DSS network requirements.
- RBI Master Directions on IT Governance (2023): sections on network segmentation,
  VAPT, and change control — the Indian FSI anchor document.
- GCP Security Foundations Blueprint: google.com/cloud/security-foundations — the
  reference landing-zone design that implements many controls in this kata.
- AWS Security Reference Architecture (SRA): aws.amazon.com/solutions/guidance/
  security-reference-architecture — the AWS equivalent.
- Revisit N59 (networking capstone) alongside this kata — the network design and
  the security design are the same platform viewed from different angles.
- Pairs with S38 (security design-review playbook) and S39 (talking compliance
  with a CISO); those katas give you the vocabulary, this one tests the
  conversation end-to-end.

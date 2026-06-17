# Kata S20 — Logging, telemetry & the SIEM; what to collect and why

> **Track:** Security · **Module:** S5 Security operations · **Prereqs:** S01, N54 · **Time:** ~35 min
> **Tags:** `security` `siem` `telemetry` `detection-engineering` `soc` `compliance` `fsi` `meridian-bank`

## Why it matters

Every security incident that ends badly has a post-mortem with the same line: "the
signals were there — we just weren't collecting them." Logging is not an IT
housekeeping task; it is the raw material for detection, investigation, forensics,
and audit evidence. At Meridian Bank, PCI-DSS Requirement 10 mandates specific log
categories, retention windows, and alerting thresholds. The RBI IT Framework adds
its own retention and access requirements. A SIEM is the system that ingests those
logs, correlates them across sources, and surfaces actionable alerts — but a SIEM
is only as good as the logs fed into it. Architects who understand *what* to
collect and *why* can validate a security design without running a SOC for a living.

## The mental model

### From event to alert: the data pipeline

Every action on a system leaves a record. The challenge is that those records are
scattered across dozens of sources, in different formats, at enormous volume. The
logging and SIEM pipeline turns raw events into actionable detections:

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                        EVENT SOURCES                                │
 │  Firewalls · Servers · Apps · Identity (AD/IAM) · Cloud APIs       │
 │  Network flows (NetFlow/VPC Flow Logs) · DNS · Endpoints (EDR)     │
 └──────────────────────┬──────────────────────────────────────────────┘
                        │  ship logs (syslog/agent/API pull)
                        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │                  LOG AGGREGATION / SIEM INGEST                      │
 │  Normalize to common schema (timestamp, src, dst, user, action)     │
 │  Parse, enrich (GeoIP, asset inventory, threat intel)               │
 └──────────────────────┬──────────────────────────────────────────────┘
                        │  correlation rules / ML analytics
                        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │           DETECTION: RULES · ANALYTICS · THREAT INTEL               │
 │  Threshold alert: 5 failed logins in 60 s                           │
 │  Behavioral: user accessing 10× normal data volume                  │
 │  IOC match: known-bad IP in connection logs                         │
 └──────────────────────┬──────────────────────────────────────────────┘
                        │  alert + context
                        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │                SOC ANALYST / SOAR AUTOMATION                        │
 │  Triage → Investigate → Contain → Eradicate → Recover (see S23)    │
 └──────────────────────────────────────────────────────────────────────┘
```

### What to collect: the six source categories

Not everything is equally valuable. Prioritize by detection coverage:

| # | Source category | What it tells you | Examples |
|---|----------------|-------------------|---------|
| 1 | **Identity & auth** | Who authenticated, from where, when; failures | AD/LDAP, Okta, GCP/AWS IAM, SSH auth logs |
| 2 | **Network perimeter** | What traversed the boundary | Firewall allow/deny, VPN session, proxy access |
| 3 | **DNS queries** | What hosts were contacted (even before a connection) | On-prem DNS server, Cloud DNS query logs, Route 53 resolver |
| 4 | **Cloud control plane** | Configuration changes, privilege escalation | GCP Cloud Audit Logs, AWS CloudTrail |
| 5 | **Endpoint / server** | Process execution, file changes, lateral movement | Windows Event Log, Linux auditd, EDR telemetry |
| 6 | **Application** | Suspicious transactions, input attacks, API abuse | App error logs, WAF alerts (N25), API gateway access log |

### Log quality: the four properties that matter

A log entry is useful only if it has:
- **Timestamp** — UTC, sub-second precision, synchronized via NTP (RFC 5905).
  Log correlation fails if clocks drift. Two clocks 5 seconds apart make a
  causality chain invisible.
- **Identity** — Who did it. Not just a source IP; a username or service account.
  IPs rotate; identities are more stable.
- **Action** — What happened, and whether it succeeded or failed. Failed actions
  are often the signal.
- **Context** — On what resource, from what system. "User X called DeleteBucket"
  is an alert; "a process called something" is noise.

### Retention: compliance drives the floor

| Framework | Log category | Minimum retention |
|-----------|-------------|-------------------|
| PCI-DSS v4.0 Req 10.5.1 | All in-scope system logs | 12 months (3 months online/searchable) |
| RBI IT Framework | Audit and access logs | 5 years |
| GDPR / DPDP | Logs containing personal data | As short as necessary (tension with above) |
| General security practice | Critical logs | 1 year warm + archive |

GDPR and PCI pull in opposite directions on logs containing card or personal data:
keep them short (GDPR) vs keep them long (PCI). The resolution is **log
minimization** — strip PAN, card expiry, and personal fields before the SIEM
ingests; the structural event (who did what, succeeded/failed, from where) is
retained but the sensitive value is masked or tokenized.

## Worked example

Meridian Bank's HQ-DC1 (`10.10.0.0/16`) hosts the core banking system and the
CDE (`10.10.20.0/24`). The mobile banking backend runs in GCP (`10.100.0.0/14`).
The bank's SOC ingests the following sources into a centralized SIEM:

```
Meridian Bank — Log collection topology

  [GCP mobile backend]        [HQ-DC1 on-prem]         [Branches]
  10.100.0.0/14               10.10.0.0/16              10.30.0.0/16
       │                            │                        │
       │  Cloud Audit Logs          │  Syslog/agent          │ Firewall logs
       │  VPC Flow Logs             │  Windows Event Log     │ VPN auth
       │  Cloud Armor WAF           │  Active Directory      │
       └──────────────────┐ ┌───────┘                        │
                          │ │         ┌──────────────────────┘
                          ▼ ▼         ▼
                    ┌───────────────────────┐
                    │       SIEM             │
                    │  (on-prem or cloud)    │
                    │  normalized, correlated│
                    └───────────┬───────────┘
                                │
                         SOC analyst
```

**Scenario: credential stuffing attack on the mobile banking login API.**

The attacker has a list of leaked username/password pairs and sprays them against
`api.mobile.meridian.example` (public IP: the GCP external LB VIP).

What each log source contributes:

1. **Cloud Armor WAF** (N25) → sees 50,000 POST `/auth/login` requests from
   200 distinct source IPs in 10 minutes. Each individual IP is under the
   per-IP rate limit. This is distributed credential stuffing.

2. **GCP VPC Flow Logs** (N54) → show that flows from those source IPs are all
   hitting the same destination port (443) with no variation — automated tool
   fingerprint.

3. **App authentication log** → 47,000 `AUTHN_FAIL` events; 300 `AUTHN_SUCCESS`.
   The 300 successes are the accounts that were actually compromised.

4. **Cloud DNS query log** → each compromised account session immediately queries
   `api.payments.meridian.example` — the payment endpoint. Lateral progression
   signal.

5. **GCP Cloud Audit Log** → 12 of those accounts call `ListAccounts` API, a
   high-privilege read not in the normal mobile app flow. Anomalous API usage.

**The SIEM correlation rule** that catches this is not "5 failed logins from one
IP" (too narrow) — it's:

```
IF  count(distinct src_ip with AUTHN_FAIL) > 200  in 10 min
AND count(AUTHN_SUCCESS) > 50  in same window
AND (new_session_follows_AUTHN_SUCCESS AND query_touches_payment_API)
THEN  alert: CREDENTIAL_STUFFING_WITH_ACCOUNT_TAKEOVER  severity: CRITICAL
```

Without the application log and the DNS query log alongside the WAF alert, this
looks like a blocked attack. With all three, the SOC sees the successful
compromises immediately.

**A note on per-account lockout vs. detection.** PCI-DSS v4.0 **Req 8.3.4** is an
*authentication* control: it requires Meridian to lock out a user account after no
more than 10 invalid authentication attempts, for a minimum of 30 minutes (this
threshold was 6 in the older v3.2.1 Req 8.1.6). That lockout limits brute-force
against a *single* account — but it does nothing against the attack above, where
each account sees only one or two attempts spread across 200 IPs. Lockout (Req 8)
and the behavioral SIEM correlation (Req 10 logging/alerting) are different
controls solving different problems; both are needed. Do not mistake a per-account
lockout threshold for a detection capability against distributed credential stuffing.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| System/app logs | Syslog / Windows Event Forwarding | Cloud Logging (structured JSON log sink) | CloudWatch Logs | Azure Monitor Logs |
| Cloud control-plane audit | N/A | Cloud Audit Logs (Admin Activity, Data Access) | CloudTrail | Azure Activity Log |
| Network flow records | NetFlow / IPFIX from router | VPC Flow Logs (N54) | VPC Flow Logs | NSG Flow Logs |
| DNS query logging | On-prem DNS debug log / DDI tool | Cloud DNS query logging (per-zone policy) | Route 53 Resolver Query Logging | Azure DNS diagnostic logs |
| Threat detection / SIEM | Splunk, QRadar, ArcSight | Chronicle (Google SecOps) | Amazon Security Hub + GuardDuty | Microsoft Sentinel |
| Cloud-native threat detection | N/A | Security Command Center (SCC) | GuardDuty | Microsoft Defender for Cloud |
| WAF / perimeter logs | On-prem NGFW / WAF | Cloud Armor request log | AWS WAF log to S3 / CloudWatch | Azure WAF diagnostics |
| Log export to SIEM | Syslog forward / agent | Log Sink → Pub/Sub or GCS or BigQuery | Kinesis Firehose → S3 | Diagnostic Settings → Event Hub |

**GCP note:** Cloud Audit Logs has two tiers you must explicitly enable:
- *Admin Activity* — logged automatically, no charge, captures all write
  operations to cloud resources.
- *Data Access* — **disabled by default**, must be explicitly enabled per service;
  captures read operations. Missing Data Access logs is the single most common
  GCP logging gap in FSI reviews.

**AWS note:** CloudTrail logs management events by default. Data events (e.g. S3
object-level `GetObject`, Lambda invocations) are **off by default** and charged
separately. In a PCI-scoped AWS account, data events on S3 buckets holding
cardholder data must be enabled.

## Do it (the exercise)

**Part A: Map your log sources [laptop / paper]**

1. Take Meridian Bank's GCP environment (VPC `10.100.0.0/14`, external HTTPS LB,
   Cloud Armor WAF, one GKE cluster, Cloud SQL for PostgreSQL).
2. List every log source that would be needed to answer: "Did anyone exfiltrate
   customer data in the last 30 days?" Fill this table:

   | Source | Log type | What it answers | Retention needed |
   |--------|----------|-----------------|-----------------|
   | ... | ... | ... | ... |

   Minimum complete answer: Cloud Audit Log (Data Access for Cloud SQL), VPC Flow
   Logs, Cloud Armor, Cloud DNS, GKE workload logs.

**Part B: Verify GCP logging is on [needs cloud account]**

```bash
# Check Cloud Audit Log config for a project
gcloud projects get-iam-policy PROJECT_ID --format=json \
  | python3 -c "
import sys, json
pol = json.load(sys.stdin)
for b in pol.get('auditConfigs', []):
    print(b['service'], [l['logType'] for l in b.get('auditLogConfigs', [])])
"
```
If `DATA_READ` and `DATA_WRITE` are missing from `allServices`, Data Access logs
are off — a common gap in new GCP projects.

**Part C: Enable VPC Flow Logs on a subnet [needs cloud account]**

```bash
# Enable flow logs (5-min aggregation, metadata fields included)
gcloud compute networks subnets update SUBNET_NAME \
  --region=REGION \
  --enable-flow-logs \
  --logging-aggregation-interval=INTERVAL_5_MIN \
  --logging-flow-sampling=1.0 \
  --logging-metadata=INCLUDE_ALL_METADATA
```
Note: `--logging-flow-sampling=1.0` means 100% of flows are exported. In
high-traffic production, reduce to `0.5` or lower to control Logging costs.

**Part D: Write a detection rule [laptop / paper]**

Write a pseudocode SIEM rule for: "Any GCP IAM role binding granted to an external
account (`user:*@gmail.com`) on a project that contains CDE workloads."

```
IF  event.source = "cloudaudit.googleapis.com"
AND protoPayload.methodName = "SetIamPolicy"
AND protoPayload.request.policy.bindings[*].members CONTAINS "user:*@gmail.com"
AND resource.labels.project_id IN [cde_project_list]
THEN alert: EXTERNAL_ACCOUNT_CDE_IAM_GRANT  severity: HIGH
```

## Say it back (self-check)

1. Name the six source categories for log collection and give one concrete example
   of a threat that each would detect that the others might miss.
2. What four properties make a log entry actionable? Why does clock skew matter
   for incident response?
3. PCI-DSS v4.0 Req 8.3.4 mandates a per-account lockout after a fixed number of
   invalid attempts. Why is a fixed per-account failure threshold (an authentication
   control under Req 8) insufficient on its own for detecting *distributed*
   credential stuffing, and what does Req 10.5.1 require for log retention?
4. What is the difference between GCP Cloud Audit Log Admin Activity and Data
   Access logs, and which one is off by default?
5. Why can't you simply log everything? What tension does GDPR introduce, and how
   do architects resolve it?

## Talk to the IT/security head

**Ask:**
- "Which log sources are currently feeding the SIEM, and when was the list last
  reviewed?"
  *A good answer:* names specific sources (AD, firewall, endpoint, cloud), with a
  periodic review cadence. Red flag: "everything goes in" with no curation — it
  usually means noisy sources crowd out signal and storage costs are uncontrolled.

- "Are GCP/AWS Data Access logs enabled for your in-scope cloud services?"
  *A good answer:* yes, explicitly enabled per service, with budget allocated for
  the volume. Red flag: "we have CloudTrail turned on" — management events only;
  data-level reads of card data are not captured.

- "What's your log retention policy, and how does it handle the GDPR vs PCI
  tension for logs that contain personal data?"
  *A good answer:* personal fields are masked/tokenized before ingest; structural
  event metadata is retained for the PCI/RBI window. Red flag: "we keep
  everything" (GDPR risk) or "we purge after 90 days" (below PCI minimum of 12
  months, 3 online).

- "How long does it take from an event occurring to a SIEM alert being raised?"
  *A good answer:* near-real-time for critical sources (< 5 min), with an SLA.
  Red flag: "we batch-load logs nightly" — a breach has 8+ hours of undetected
  dwell before a single alert fires.

- "When did you last test that a specific detection rule actually fires?"
  *A good answer:* red/purple team exercise or SIEM rule validation test in the
  last quarter. Red flag: rules were written two years ago and never validated —
  "we assume they work."

## Pitfalls & war stories

**Collecting volume, missing signal.** A large Indian bank ingested 50 GB/day into
their SIEM. After a breach investigation, analysts discovered the compromised
service's application log was not in scope — only the firewall was. They had
perfect network visibility and zero application visibility. The attacker had valid
credentials; no firewall rule fired.

**Clock drift breaks correlation.** A Northwind plant network had NTP misconfigured
on its OT historian server (clocks set to local time, no UTC). An incident that
spanned the corporate network (`10.50.0.0/16`) and the plant could not be
reconstructed because the two log streams differed by 5.5 hours. Causality was
impossible to establish.

**Data Access logs off, auditor unhappy.** In a PCI-DSS QSA audit of a GCP-hosted
PCI scope, Req 10.2.1 (log all individual access to cardholder data) failed
because Cloud SQL Data Access logs were not enabled. The finding was a CAT1
(blocker); the bank's QSA certification was delayed three months.

**Log masking too aggressive.** A SOC team masked all IP fields from firewall logs
to protect user privacy. Lateral movement alerts that depend on src/dst IP became
impossible to correlate. Masking should target *values* (PANs, names, email), not
structural network fields.

**SIEM alert fatigue.** Meridian's SOC briefly tuned their failed-login rule to
`> 1 failure in 60 s` as a test. 4,000 alerts/day. Analysts learned to close
without reading. The effective MTTR for real incidents tripled. Alert thresholds
must be calibrated against baseline noise, not set at the minimum technically
meaningful value.

**Forgetting the cloud control plane.** Most on-prem SIEM deployments collect
network and endpoint logs well. When workloads move to GCP or AWS, architects
often forget that the control plane — IAM changes, firewall rule edits, storage
bucket creation — produces its own audit trail in a completely separate log stream.
Cloud configuration drift is one of the top cloud-breach vectors (S34); missing
the control-plane log means that vector is blind.

## Going deeper (optional)

- PCI-DSS v4.0 Requirement 10 (full text): the specific log categories, alert
  thresholds, and retention requirements for PCI scope.
- NIST SP 800-92 *Guide to Computer Security Log Management* — framework-neutral
  guide to what to collect and how to manage it.
- GCP Cloud Audit Logs documentation: `cloud.google.com/logging/docs/audit` —
  definitive reference for Admin Activity, Data Access, System Event, and Policy
  Denied log types.
- AWS CloudTrail documentation and the CloudTrail Lake query interface for
  long-term, SQL-queryable log retention.
- MITRE ATT&CK Data Sources (`attack.mitre.org/datasources`) — maps each
  adversary technique to the log source that would detect it; use this to audit
  SIEM source coverage against your threat model.
- Pairs with: N54 (VPC Flow Logs and packet mirroring — the network telemetry
  input to this pipeline), S21 (detection engineering and SOAR — what happens
  after the alert fires), S23 (incident response — what the SOC does with the
  alerts).

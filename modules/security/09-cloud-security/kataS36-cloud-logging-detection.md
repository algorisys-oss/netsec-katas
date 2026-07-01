# Kata S36 — Logging & detection in cloud (SCC / GuardDuty / Defender)

> **Track:** Security · **Module:** S9 Cloud security posture · **Prereqs:** S34, S35, N54 · **Time:** ~35 min
> **Tags:** `security` `cloud` `siem` `detection-engineering` `gcp` `aws` `cspm` `flow-logs`

## Why it matters

Cloud platforms generate enormous volumes of events — API calls, network flows,
identity changes, resource mutations — and most of it is discarded by default.
When a CISO at Meridian Bank asks "would we know within the hour if someone
exfiltrated a GCS bucket?" the honest answer depends entirely on what you chose
to log and whether anything monitors it. Cloud-native detection services (GCP
Security Command Center, AWS GuardDuty, Microsoft Defender for Cloud) automate
much of the tedious baseline work, but they are not magic: they need to be
enabled, tuned, and wired into a response workflow. As the architect, you decide
the collection architecture; the SOC consumes it.

## The mental model

**Why cloud logging is different from on-prem**

On-prem, a SIEM ingests syslog from firewalls, NetFlow from routers, and Windows
Event Log from DCs — sources the network team already owns. In cloud, the
equivalent signals are scattered across a hierarchy:

```
  Cloud account / project
  │
  ├── Control plane  (who called which API, from where, with what result)
  │   GCP: Cloud Audit Logs (Admin Activity + Data Access)
  │   AWS: CloudTrail
  │   Azure: Activity Log / (Azure: TODO for Entra Audit Log)
  │
  ├── Network plane  (who talked to whom, on which ports)
  │   GCP: VPC Flow Logs  (see N54)
  │   AWS: VPC Flow Logs  (see N54)
  │   Azure: VNet flow logs (NSG flow logs retired 2025; Azure: TODO)
  │
  ├── Identity plane  (logins, token issues, privilege escalations)
  │   GCP: Cloud Identity audit events
  │   AWS: CloudTrail + IAM credential reports
  │
  └── Resource / config plane  (what changed, who made it non-compliant)
      GCP: Cloud Asset Inventory change notifications
      AWS: AWS Config
```

**The three-layer detection stack**

```
  ┌─────────────────────────────────────────────────┐
  │  LAYER 3 — INTELLIGENT DETECTION                │
  │  GCP: Security Command Center (SCC) Premium     │
  │  AWS: GuardDuty                                 │
  │  Azure: Defender for Cloud (Azure: TODO)        │
  │  What: ML + threat intel → findings/alerts      │
  └───────────────────────┬─────────────────────────┘
                          │ sources
  ┌───────────────────────▼─────────────────────────┐
  │  LAYER 2 — CENTRALISED LOG STORAGE              │
  │  GCP: Cloud Logging (Log Buckets)               │
  │  AWS: CloudWatch Logs / S3 (log archive)        │
  │  Drain to: GCP Chronicle SIEM / Splunk / Sentinel│
  └───────────────────────┬─────────────────────────┘
                          │ feeds
  ┌───────────────────────▼─────────────────────────┐
  │  LAYER 1 — RAW TELEMETRY SOURCES                │
  │  Audit logs · VPC Flow Logs · DNS query logs    │
  │  Container logs · WAF logs · LB access logs     │
  └─────────────────────────────────────────────────┘
```

**Three categories of finding, by detection mechanism:**

1. **Signature / rule-based** — known bad (e.g. SSH brute-force, mining process
   name). Fast, low false-positive rate, misses novel attacks.
2. **Anomaly / baseline-based** — unusual for *this resource* (e.g. a Cloud
   Function calling an API it never calls). ML-driven; needs a baselining period.
3. **Threat-intelligence (IoC) matching** — known malicious IPs, domains, hashes.
   Only as current as the feed; misses targeted attackers with fresh infrastructure.

GuardDuty and SCC Premium use all three. The SOC team tunes which findings
generate pages vs tickets vs logged-only.

**Retention and the compliance constraint**

RBI Master Directions and PCI-DSS v4.0 Requirement 10 both mandate log retention.
PCI-DSS requires at least **12 months** of audit-log retention (3 months immediately
accessible). RBI directions commonly drive **2-year-plus** retention for
security-relevant logs (the exact obligation varies by data/log type and by which
RBI direction applies, rather than a single universal rule).
This is an architectural decision: you must provision log storage *before* enabling
logging, or you'll generate events that flow nowhere.

## Worked example

Meridian Bank's GCP landing zone (`10.100.0.0/14`, asia-south1 region) runs its
mobile banking API. The CISO wants to know within 30 minutes if:
- A service account is used from an IP outside India.
- Any GCS bucket holding customer data is made public.
- SSH port 22 opens on the CDE subnet (`10.10.20.0/24`, on-prem side).

**Mapping each requirement to a detection source:**

```
Requirement                    Source log                  Detection mechanism
─────────────────────────────────────────────────────────────────────────────
SA login from non-IN IP        Cloud Audit Log (Admin Act.)  SCC Anomaly finding
                                                             + custom log metric
GCS bucket made public         Cloud Audit Logs (Admin Act.) SCC "Public bucket"
                               + Cloud Asset Inventory       built-in finding
SSH/22 opened in firewall rule Cloud Audit Log (Admin Act.)  Custom alerting policy
                               (firewall rule mutation event) on log filter
```

**What SCC Premium actually generates for the bucket exposure:**

```
Finding type: PUBLIC_BUCKET_ACL
Severity:     HIGH
Resource:     //storage.googleapis.com/meridian-customer-docs
Project:      meridian-prod (project-id: 429181234)
Explanation:  Bucket is publicly readable (allUsers READ permission).
              VPC Service Controls perimeter: NOT applied to this bucket.
Active since: 2026-06-17T04:12:00Z
```

**What GuardDuty generates for analogous AWS exposure (Northwind AWS account):**

```
Finding type: Policy:S3/BucketBlockPublicAccessDisabled
Severity:     LOW  (score 2.0 / 10)
Resource:     arn:aws:s3:::northwind-plant-telemetry
Account:      123456789012
Region:       ap-south-1
Detail:       S3 Block Public Access was disabled for the bucket.
              The bucket policy does not yet grant public access, but
              the protective control has been removed.
```

Note the difference: GCP SCC finds the *consequence* (allUsers READ), while
GuardDuty finds the *removal of a control* (Block Public Access disabled). Both
matter; together they give defense-in-depth in detection.

**Log volume estimate for Meridian Bank GCP (helps size the SIEM budget):**

```
Source                  Typical volume (mobile banking, 100k users)
────────────────────────────────────────────────────────────────────
VPC Flow Logs           ~5 GB/day per prod subnet (sampled at 1:10)
Cloud Audit (Admin)     ~200 MB/day  (low volume, high value — keep forever)
Cloud Audit (Data)      ~50 GB/day   (GCS, BQ reads — selective enable)
GKE container logs      ~20 GB/day   (app logs; retention 30 days online)
WAF / Cloud Armor logs  ~1 GB/day
```

Data Access audit logs for every GCS/BQ read are **off by default** because of
volume and cost — you enable them selectively for high-sensitivity buckets (CDE,
PII). This is the setting architects most commonly forget.

## Cloud mapping

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Control-plane audit log | SIEM via syslog from LDAP/AD, jump hosts | Cloud Audit Logs (Admin Activity + Data Access) | CloudTrail | Activity Log + Entra Audit Log (Azure: TODO) |
| Network flow telemetry | NetFlow/IPFIX from routers (see N35, N54) | VPC Flow Logs | VPC Flow Logs | VNet flow logs (NSG flow logs retired 2025; Azure: TODO) |
| Threat detection service | SIEM + NDR + IDS signatures | Security Command Center (SCC) — Standard (free) + Premium | GuardDuty (per GB + per finding) | Defender for Cloud (Azure: TODO) |
| CSPM findings (misconfig) | Nessus / Qualys scans | SCC Standard findings + Security Health Analytics | AWS Security Hub (aggregates GuardDuty, Inspector, Config) | Defender for Cloud Secure Score (Azure: TODO) |
| Log aggregation / routing | Syslog server / SIEM ingestion | Cloud Logging + Log Router (sinks to BigQuery, GCS, Pub/Sub) | CloudWatch Logs + S3 + Firehose | Log Analytics Workspace (Azure: TODO) |
| Org-wide log aggregation | Central SIEM with agents | Aggregated log sink at org or folder level | CloudTrail org trail + S3 + GuardDuty delegated admin | (Azure: TODO) |
| Alerting / paging | PagerDuty from SIEM | Cloud Monitoring alerting policies on log metrics | CloudWatch Metric Filters → SNS → PagerDuty | (Azure: TODO) |
| SIEM integration | SIEM receives events | Chronicle SIEM (native); or sink → Pub/Sub → Splunk/Sentinel | Security Lake / Firehose → Splunk / Sentinel | Sentinel (Azure: TODO) |
| Log retention control | Tape/NAS policies | Log Bucket retention policy (lock-able, WORM) | S3 Object Lock (Governance / Compliance mode) | (Azure: TODO) |

## Do it (the exercise)

### Part A — Understand what's being logged [laptop / paper]

1. Look at this partial GCP Admin Activity log entry (you'd see it in Log Explorer
   or a SIEM):
   ```json
   {
     "protoPayload": {
       "methodName": "storage.buckets.setIamPolicy",
       "authenticationInfo": {
         "principalEmail": "deploy-sa@meridian-prod.iam.gserviceaccount.com"
       },
       "requestMetadata": {
         "callerIp": "203.0.113.55"
       },
       "resourceName": "projects/_/buckets/meridian-customer-docs"
     },
     "severity": "NOTICE",
     "timestamp": "2026-06-17T03:58:12Z"
   }
   ```
   Answer from memory:
   - What action was taken, and on which resource?
   - Why is `203.0.113.55` suspicious? (Hint: `10.100.0.0/14` is Meridian Bank's
     GCP range; `203.0.113.0/24` is TEST-NET-3 per RFC 5737 — use it as a stand-in
     for "unexpected external IP".)
   - Which SCC finding type would this likely trigger?

2. Draw the log pipeline on paper:
   - Source: Admin Activity log entry in the `meridian-prod` GCP project.
   - Goal: entry stored in a compliance-locked GCS archive AND a Pub/Sub topic
     that Meridian's Splunk ingests.
   - Identify the GCP constructs in between (Log Router → sink).

### Part B — Enable and verify SCC [needs cloud account]

> Use a **non-production GCP project** you own. Do not run against client
> accounts without explicit permission.

1. Enable Security Command Center:
   ```bash
   # List SCC findings in your project (SCC Standard is always-on at project level)
   gcloud scc findings list \
     --organization=ORG_ID \
     --filter="state=ACTIVE AND severity=HIGH" \
     --format="table(name,category,resourceName,severity,createTime)"
   ```
   Replace `ORG_ID` with your organization ID (visible in
   `gcloud organizations list`).

2. Confirm Cloud Audit Logs are enabled for Admin Activity (they are by default)
   and check Data Access settings:
   ```bash
   gcloud projects get-iam-policy YOUR_PROJECT_ID \
     --format=json | \
     python3 -c "
   import json,sys
   p=json.load(sys.stdin)
   for b in p.get('auditConfigs',[]):
       print(b)
   "
   ```
   If `auditConfigs` is empty, Data Access logging for GCS is not enabled.

3. Enable Data Access logs for GCS on a test project:
   ```bash
   # Write an IAM policy JSON that enables GCS data access logging
   # then apply with:
   gcloud projects set-iam-policy YOUR_PROJECT_ID policy.json
   ```
   The `auditConfigs` block to add:
   ```json
   {
     "auditConfigs": [{
       "service": "storage.googleapis.com",
       "auditLogConfigs": [
         {"logType": "DATA_READ"},
         {"logType": "DATA_WRITE"}
       ]
     }]
   }
   ```

4. Check for active GuardDuty findings in an AWS account:
   ```bash
   aws guardduty list-detectors --region ap-south-1
   # Returns detector-id if GuardDuty is enabled in this region
   aws guardduty list-findings \
     --detector-id DETECTOR_ID \
     --finding-criteria '{"Criterion":{"severity":{"Gte":7}}}' \
     --region ap-south-1
   ```
   A HIGH finding has severity ≥ 7.0.

### Part C — Retention check [laptop / paper]

   Map Meridian Bank's requirements to GCP constructs:
   - 3 months immediately searchable (Log Explorer): configure Log Bucket with
     30-day retention for dev, 90-day for production.
   - 12 months PCI-accessible: sink to GCS with 365-day lifecycle rule.
   - 2 years RBI minimum: GCS bucket with 730-day Object Holds or Bucket Lock.

   Question: what is the *cost difference* between keeping 2 years of Admin
   Activity logs vs Data Access logs for Meridian's prod project? (Use the log
   volume estimates in the worked example above.)

## Say it back (self-check)

1. Name three distinct log *sources* in GCP and what each captures. Which is
   off by default and why?
2. What is the difference between SCC Standard and SCC Premium? Which one
   runs ML-based anomaly detection?
3. A GuardDuty finding says `UnauthorizedAccess:IAMUser/MaliciousIPCaller.Custom`.
   What does that tell you, and what should the SOC do first?
4. Meridian Bank's auditor demands 2 years of log retention immediately accessible.
   What two GCP constructs do you use, and what compliance-hardening option prevents
   deletion?
5. Why would you enable VPC Flow Logs on only *some* subnets rather than every
   subnet in a large deployment?

## Talk to the IT/security head

**Ask:**

- "Which cloud audit log types are enabled today — Admin Activity only, or Data
  Access as well? For which services?"

  A good answer: "Admin Activity is on everywhere. We enable Data Access for GCS
  and BigQuery in prod where we hold customer data — we did a cost estimate and
  scoped it to sensitive services only."

  Red flag: "We have logging enabled" without knowing *which* types — Data Access
  is the one that captures exfiltration events and it is off by default.

- "Where do cloud logs go after they leave the provider's console? Is there an
  immutable copy the security team owns independently of the cloud project?"

  A good answer: "Logs are routed via an org-level sink to a centrally managed
  GCS bucket with Object Lock in Compliance mode. Even project admins can't delete
  them — only the security team's log-admin role can modify retention."

  Red flag: "They stay in Cloud Logging" — a compromised project admin can then
  delete or alter logs. Immutable archive, separated from the workload project,
  is the required pattern for FSI.

- "Is Security Command Center / GuardDuty enabled at the org/account level, or
  just per project? What's the alert routing — where do HIGH findings go?"

  A good answer: "SCC Premium is enabled at org level with delegated admin to
  the security project. HIGH findings go to a Pub/Sub topic → Splunk → PagerDuty
  with a 15-minute response SLA."

  Red flag: "It's enabled but we haven't set up alerting yet" — detection without
  response is theatre; findings pile up and the real signal gets buried.

- "How often are detection rules and suppression lists reviewed? Who owns that?"

  A good answer: naming the person/team (Detection Engineering or SecOps lead)
  and a cadence (e.g. monthly tuning review, alert-fatigue metric tracked).

  Red flag: no owner, no cadence — suppression lists drift and legitimate findings
  get silenced.

## Pitfalls & war stories

- **"We enabled SCC" is not a detection programme.** SCC Standard provides free
  misconfiguration findings; SCC Premium adds runtime threat detection. At a bank,
  you almost certainly need Premium (or GuardDuty) for the anomaly and threat-intel
  findings that matter most. Know which tier is active.

- **Data Access log cost shock.** Enabling Data Access logging on a large GCS
  bucket serving millions of API reads can generate 50–200 GB of logs per day.
  At ~$0.50/GiB ingested into Cloud Logging (2026 pricing; first 50 GiB per
  project per month free), that is roughly $25–$100/day for ingestion alone,
  *before* downstream SIEM ingestion and storage costs. Scope selectively to
  high-sensitivity buckets; document the decision.

- **Cross-project log gaps.** Org-level audit logs in GCP aggregate Admin Activity
  automatically, but VPC Flow Logs and Data Access logs must be explicitly enabled
  *per project*. New projects spun up by a developer won't have them unless the
  landing zone enforces it via an Org Policy or Terraform module.

- **GuardDuty disabled regions.** GuardDuty must be enabled in *every* AWS region
  you use. Northwind running ERP in ap-south-1 but forgetting to enable GuardDuty
  in us-east-1 (where the root account lives) leaves that region dark. Use AWS
  Organizations delegated admin to deploy it everywhere with one policy.

- **Alert fatigue buries the signal.** SCC and GuardDuty generate hundreds of
  findings in a fresh environment. Without severity-based routing and suppression
  of known-good resources, SOC analysts stop trusting the tool and disable it or
  ignore pages. A tuning sprint in the first 30 days is not optional.

- **Log-archive separation from workload accounts.** In FSI, the log archive must
  live in a separate cloud account/project owned by the security team, with the
  workload team having write-only access via the log sink. A compromised workload
  admin must not be able to clear their own tracks. This pattern is often missing
  in early cloud deployments.

- **RBI vs PCI retention mismatch.** PCI-DSS requires 12 months (3 immediately
  accessible). RBI directions commonly drive 2-year-plus retention for
  security-relevant logs (the precise obligation depends on the data/log type and
  the applicable RBI direction). A bank subject to both should typically provision
  for at least 2 years. Using a tiered approach — 90 days in the Cloud Logging hot
  tier, then sink to GCS for the remainder — is the standard cost-efficient
  architecture.

## Going deeper (optional)

- GCP Security Command Center documentation — finding types catalogue and
  SCC Standard vs Premium feature comparison:
  `cloud.google.com/security-command-center/docs`
- AWS GuardDuty finding types reference (authoritative):
  `docs.aws.amazon.com/guardduty/latest/ug/guardduty_finding-types-active.html`
- GCP Cloud Audit Logs overview — understanding Admin Activity vs Data Access
  vs System Event vs Policy Denied:
  `cloud.google.com/logging/docs/audit`
- PCI-DSS v4.0 Requirement 10 — log management and retention obligations.
- RBI Master Direction on IT Governance, Risk, Controls and Assurance Practices
  (Nov 2023, effective Apr 2024) — provisions bearing on IS audit and log
  retention.
- NIST SP 800-92 — Guide to computer security log management (foundational,
  cloud-agnostic). Revisit after S20 (SIEM and telemetry).
- Pairs with: S20 (logging and SIEM), S34 (CSPM/CWPP), S35 (cloud network
  security controls), N54 (VPC Flow Logs and packet mirroring).

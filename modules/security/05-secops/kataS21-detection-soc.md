# Kata S21 — Detection engineering, threat intel, SOAR, the SOC workflow

> **Track:** Security · **Module:** S5 Security operations · **Prereqs:** S20, S01, S03 · **Time:** ~35 min
> **Tags:** `security` `siem` `detection-engineering` `soar` `soc` `threat-intel` `incident-response` `fsi`

## Why it matters

A SIEM that collects logs but fires no alerts is a storage bill, not a security
control. A SOC that drowns in 10,000 alerts a day and closes 9,800 without
reading them is theater. The gap between "we have a SIEM" and "we detect attacks
reliably" is closed by **detection engineering** — the craft of turning threat
knowledge into precise, tuned rules. Architects who understand this can tell the
difference between a credible SOC posture and a compliance checkbox, ask the
right questions in a design review, and avoid building systems that generate
noise the SOC ignores. For Meridian Bank and Northwind FMCG, it is also the
difference between an RBI-compliant monitoring program and a finding.

## The mental model

### The detection pipeline: signal → rule → alert → case → response

Before naming any product, understand what has to happen for a real attack to
become a closed incident:

```
  RAW EVENTS                 DETECTION LAYER            SOC WORKFLOW
  ─────────────────          ───────────────            ──────────────────
  Firewall logs   ──┐        Correlation rule           Tier 1 triage
  Auth logs       ──┤──────► or ML model      ────────► (real or noise?)
  EDR telemetry   ──┤        fires ALERT                    │
  VPC Flow Logs   ──┤                                        ▼
  App logs        ──┘        Threat intel                Tier 2 analysis
                             enriches alert              (scope it)
                             (IP reputation,                 │
                              CVE context,                   ▼
                              MITRE ATT&CK)             Tier 3 / IR team
                                                        (contain & eradicate)
```

**Four concepts architects must hold together:**

**1. Detection engineering** — Writing and maintaining the rules, logic, or ML
models that convert raw log events into meaningful alerts. Not a one-time config;
it is an ongoing engineering discipline. Good rules are:

- **High-signal** — match real attack behavior, not coincidence
- **Low-noise** — fire rarely on benign activity (false positive rate matters)
- **Coverage-mapped** — traceable to a threat (MITRE ATT&CK tactic/technique)
- **Versioned and tested** — stored as code, tested against sample data

**2. Threat intelligence (TI)** — Structured knowledge about threat actors,
their techniques, and indicators of compromise (IoCs). TI enriches alerts and
drives detection priorities:

```
  Strategic TI   "nation-state groups target SWIFT infrastructure"
  Tactical TI    ATT&CK technique T1078 (Valid Accounts) is among the most common
                 initial-access vectors in financial-sector breaches (cf. Verizon DBIR)
  Operational TI "APT41 campaign active, using C2 on 198.51.100.0/24 this month"
  Technical IoC  specific IP, domain, file hash, URL pattern
```

IoCs decay fast (IPs rotate, domains are burned); techniques persist. Good
detection focuses on **TTPs** (Tactics, Techniques, Procedures) over raw IoCs.

**3. SOAR (Security Orchestration, Automation, and Response)** — A platform
that automates repetitive analyst tasks via **playbooks**: codified response
procedures triggered by alert types.

```
  Alert: "brute force on SSH port 22, source 203.0.113.47"
         │
         ▼  SOAR playbook fires automatically:
         ├─ Query TI feed: is 203.0.113.47 known malicious? → YES
         ├─ Look up VPC Flow Logs: other VMs hit from this IP? → 3 more
         ├─ Block IP in cloud firewall (automated)
         ├─ Create Jira/ServiceNow ticket with context
         └─ Page Tier 2 analyst if any connection succeeded
```

Without SOAR, every one of those steps is a human clicking through 4–6 tools.
At scale (Northwind's 3,000+ sites, or Meridian's 220 branches) manual response
cannot keep up with alert volume.

**4. The SOC tier model** — How analysts are organized and when humans are in
the loop:

```
  TIER 1 — Alert triage (often 24×7, can be managed/outsourced)
    Goal: determine real or false positive; classify severity
    SLA: acknowledge in 15 min (FSI typical); escalate real positives in 30 min

  TIER 2 — Investigation (business hours + on-call)
    Goal: scope the incident — what was accessed, from where, for how long?
    Tools: SIEM queries, packet captures, EDR timeline, AD logs

  TIER 3 / IR — Contain, eradicate, recover (senior + specialists)
    Goal: stop the bleeding, clean the environment, root-cause
    May call external IR firm (see S23)
```

### The MITRE ATT&CK framework — the detection map

ATT&CK (Adversarial Tactics, Techniques, and Common Knowledge) is the shared
vocabulary for attack behavior. It has 15 **tactics** (the *why*: initial
access, lateral movement, exfiltration…) and hundreds of **techniques** (the
*how*: T1078 Valid Accounts, T1021 Remote Services, T1486 Data Encrypted for
Impact / ransomware…).

Architects use it as a **coverage map**: for each ATT&CK tactic, do you have at
least one detection rule? Gaps are risk. Banks are audited on it (see S29).

```
  ATT&CK Tactic           Example detection rule at Meridian Bank
  ──────────────────────  ────────────────────────────────────────────────────
  Initial Access          Failed logins > 20/min from single IP → alert T1110
  Privilege Escalation    Service account granted Admin role outside change window
  Lateral Movement        Internal port-scan from workstation subnet (10.10.x → 10.10.x)
  Collection              Large file access on core-banking share by non-batch user
  Exfiltration            Outbound traffic > 100 MB from CDE subnet (10.10.20.0/24)
  Impact                  Shadow copy deletion on any host (ransomware precursor, T1490)
```

## Worked example

**Scenario:** a credential-stuffing attack against Meridian Bank's mobile
banking API hosted on GCP (VPC `10.100.0.0/14`), pivoting toward HQ-DC1
(`10.10.0.0/16`) via the Dedicated Interconnect (see N38).

### Step 1 — Signals generated

```
  Source                  Log line (representative, not verbatim)
  ─────────────────────── ──────────────────────────────────────────────────
  GCP Cloud Armor         POST /api/login blocked: 1,200 req/min, source
                          203.0.113.0/24 (TEST-NET, use documentation only)
  Cloud Load Balancer     HTTP 401 rate: 94% for /api/login over 10 min
  GCP Cloud Audit Logs    IAM: service account sa-mobile@meridian.iam... 
                          assumed by 203.0.113.47 at 02:14 UTC — ANOMALOUS
  VPC Flow Logs (GCP)     10.100.1.15:ephemeral → 10.10.20.5:8443 ACCEPT 
                          (cloud VM → CDE host, 34 MB in 4 min)
```

### Step 2 — SIEM correlation rule fires

The detection engineer wrote this rule (pseudocode in Splunk SPL style):

```spl
index=gcp_audit action=SetIamPolicy
  NOT src_ip IN (known_admin_ranges)
| where time_of_day < 06:00 OR time_of_day > 22:00
| stats count by src_ip, identity
| where count > 1
| eval severity="HIGH", mitre_technique="T1078"
| alert "Anomalous IAM change outside business hours"
```

Alert fires. SOAR playbook kicks off automatically.

### Step 3 — SOAR playbook executes

```
  Trigger: HIGH-severity IAM alert, source 203.0.113.47

  Automated steps (no human yet):
  1. Enrich: query TI feed → 203.0.113.47 flagged as credential-stuffing
             campaign infrastructure (last seen 48 h ago)
  2. Scope:  query VPC Flow Logs → same source IP connected to 3 GCP VMs
  3. Check:  did any 10.10.x host receive data from GCP in last 30 min? YES
             → 10.10.20.5 (CDE host!) received 34 MB from 10.100.1.15
  4. Action: revoke sa-mobile service account token (GCP IAM API call)
  5. Action: add Cloud Armor deny rule for 203.0.113.0/24
  6. Notify: create P1 incident ticket, page Tier 2 on-call analyst
             with all context pre-populated

  Elapsed time: ~90 seconds. Without SOAR: 20–30 minutes of manual steps.
```

### Step 4 — Tier 2 analysis

Analyst opens the ticket. Context already there (TI hit, flow logs, IAM
change). Analyst verifies: was 10.10.20.5 actually exfiltrating data, or just
receiving a legitimate batch? Checks core banking audit log — no scheduled batch
at 02:14. Escalates to Tier 3 / IR team. CDE host isolated.

**The architect's role:** you designed the VPC Flow Logs export to the SIEM
(see S20), the subnet boundaries that made the CDE-to-cloud path detectable, and
the IAM tagging that identified the anomalous service account. Detection only
worked because the *logging and network design* made the signals visible.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| SIEM | Splunk, IBM QRadar, Microsoft Sentinel (on-prem) | Chronicle SIEM (+ Chronicle Security Operations) | Amazon Security Lake + OpenSearch, or third-party (Splunk/Sentinel) | Microsoft Sentinel |
| Native log aggregation | Syslog, SNMP traps | Cloud Logging (formerly Stackdriver) | CloudTrail + CloudWatch Logs | Azure Monitor Logs |
| Threat intel enrichment | MISP, commercial TI feeds | Chronicle SIEM built-in; VirusTotal integration | Amazon GuardDuty (built-in TI) | Microsoft Defender TI |
| Alert correlation / detection | SIEM correlation rules, EDR | Chronicle detection rules (YARA-L 2.0) | GuardDuty findings + Security Hub | Sentinel analytics rules (KQL) |
| SOAR / automated response | Splunk SOAR (Phantom), Palo Alto XSOAR | Google Security Operations (Chronicle SOAR) | AWS Security Hub + EventBridge + Lambda | Microsoft Sentinel Playbooks (Logic Apps) |
| Threat detection service | IDS/IPS, NDR appliance | Security Command Center + Cloud IDS (N28) | Amazon GuardDuty | Microsoft Defender for Cloud |
| ATT&CK coverage mapping | Vectra, ExtraHop, manual | Chronicle: ATT&CK mapping in UI | Security Hub findings map to ATT&CK | Sentinel: ATT&CK mapping in rules |

> **Note:** Chronicle SIEM ingests GCP logs natively at no per-GB cost (a key
> reason FSI clients on GCP evaluate it first). AWS GuardDuty bundles TI
> enrichment and correlation into a managed service — less flexible than a full
> SIEM but faster to deploy. Both approaches require a human detection engineering
> program; the platform does not write good rules by itself.

## Do it (the exercise)

### Part A — Map a threat to a detection [laptop / paper]

1. Pick one ATT&CK technique relevant to banking: **T1110.003 — Password
   Spraying** (trying one common password against many accounts).

2. Write the detection logic in plain English:
   - Signal source: authentication logs (Windows Event ID 4625, or cloud IAM
     login failures)
   - Condition: same source IP, >10 distinct usernames, >5 failures/minute,
     within a 5-minute window
   - Exclude: known monitoring or test accounts
   - Severity: HIGH (external source), MEDIUM (internal — may be misconfigured app)
   - MITRE tag: T1110.003

3. Ask yourself: **what would make this rule fire falsely?**
   (Hint: a new employee portal that pre-populates usernames on login errors, or
   a load test. You must tune the exclusion list or baseline.)

### Part B — SOAR playbook sketch [laptop / paper]

For the alert above (T1110.003 — password spray detected), draft the automated
playbook steps:

```
  Trigger: T1110.003 alert, source IP = X, target accounts = list

  Step 1: Enrich X against TI feed — is it a known attacker?
  Step 2: Count how many accounts had successful logins from X in last 24h
  Step 3: IF any success → lock those accounts, page Tier 2 immediately
          IF no success → create LOW ticket, set 24h watchlist on X
  Step 4: Block X at the perimeter firewall for 1 hour (auto-expiry)
  Step 5: Notify [email protected] with summary
```

Write the "undo" action: what if X turns out to be a legitimate vendor's
automated system (a false positive)? The playbook must have a reversal step.

### Part C — Query VPC Flow Logs for exfiltration [needs cloud account]

On GCP, enable VPC Flow Logs on the mobile banking subnet
(`10.100.1.0/24`). Run a Log Analytics query to find large outbound transfers
from CDE-range destinations:

```sql
-- Cloud Logging / Log Analytics (GCP)
SELECT
  jsonPayload.connection.src_ip,
  jsonPayload.connection.dest_ip,
  SUM(CAST(jsonPayload.bytes_sent AS INT64)) AS total_bytes
FROM `PROJECT_ID.DATASET.compute_googleapis_com_vpc_flows_*`
WHERE
  jsonPayload.connection.dest_ip LIKE '10.10.20.%'
  AND TIMESTAMP_TRUNC(_PARTITIONTIME, DAY) = CURRENT_DATE()
GROUP BY 1, 2
HAVING total_bytes > 10000000   -- > 10 MB
ORDER BY total_bytes DESC;
```

Compare the result to your expected batch-job schedule. Anything outside the
window is an anomaly worth a detection rule.

## Say it back (self-check)

1. What is the difference between a SIEM **alert** and a **detection rule**? Who
   writes and maintains the rules?
2. Why do experienced detection engineers prefer TTPs over IoCs as the basis for
   detection logic?
3. Name three automated steps a SOAR playbook for a brute-force alert might take
   before a human analyst is involved.
4. A Tier 1 analyst receives 800 alerts per shift and escalates 5. Is that good
   or bad — and what question would you ask to find out?
5. Map the credential-stuffing scenario from the worked example to two ATT&CK
   tactics. Which one is hardest to detect, and why?

## Talk to the IT/security head

**Ask:**

- "How many detection rules does your SIEM have, and how many fired in the last
  30 days? What's your false-positive rate?"
  *What you're probing:* are rules maintained and tuned, or is the ruleset the
  vendor default that nobody has touched?
  *Good answer:* "We run ~120 custom rules, test them against historical data
  quarterly, and we target <5% false positives on HIGH-severity. The vendor
  defaults are disabled or tuned."
  *Red flag:* "We have 10,000 rules — everything the vendor ships." That is a
  false-alarm factory, and Tier 1 will stop reading alerts.

- "Do you have SOAR, and which response actions are fully automated vs. require
  human approval?"
  *Good answer:* a list of playbooks with named automation steps and explicit
  human gates (e.g., "we auto-block at the firewall but a human must approve
  account lockout for service accounts").
  *Red flag:* "We have SOAR but haven't built playbooks yet" — you've bought the
  platform, not the capability.

- "How do you track ATT&CK coverage? Where are your detection gaps?"
  *Good answer:* "We score ourselves quarterly with ATT&CK Navigator. We're
  weak on cloud-specific lateral movement (T1021.007 — Cloud Services) and have
  a gap on insider threat / collection techniques — those are on the roadmap."
  *Red flag:* blank stare or "we cover everything" — no security team covers
  everything; an honest team knows its gaps.

- "What is your mean time to detect (MTTD) and mean time to respond (MTTR) for
  a HIGH-severity alert? Are those numbers audited?"
  *Good answer:* concrete numbers (e.g., MTTD < 30 min, MTTR < 4 h for
  containment), measured via the ticketing system, and reported to the CISO.
  *Red flag:* "We respond really fast" without numbers. Without measurement,
  there is no SLA.

- "If our system is breached at 2 a.m. on a Sunday, who gets paged and what do
  they do first?"
  *Good answer:* named runbook, named on-call rotation, tested in a tabletop
  exercise (see S24). The Tier 1 pager number should exist and be tested.
  *Red flag:* "We'd figure it out" — or an SOC that is business-hours only for
  a 24×7 banking platform.

## Pitfalls & war stories

**"We have a SIEM" is not "we have detection."** Many FSI clients have Splunk or
QRadar installed, log data flowing in, and a dashboard. They do not have a
single engineer who wrote a detection rule in the last six months. The evidence
question is: show me the last five alerts that fired and what happened. If the
answer is blank or shrugged, the SIEM is a compliance checkbox.

**Alert fatigue kills the SOC.** At Meridian Bank's scale (220 branches, GCP
production workloads, HQ-DC1 with core banking), the naive SIEM configuration
generates tens of thousands of low-quality alerts per day. Tier 1 teams under
that load stop reading. Attackers who know this deliberately generate noise to
mask their real activity. The fix is detection engineering (tune aggressively
and fire only on high-confidence signals), not hiring more Tier 1 analysts.

**Threat intel without operationalization is just a subscription.** Many teams
buy a commercial TI feed, dump it into the SIEM as IP blocklists, and consider
the job done. IoC blocklists are the least valuable TI output — IPs rotate in
hours. The value is in understanding which ATT&CK techniques the threat actors
targeting your sector actually use, and building detection rules for those
techniques. Meridian Bank's FSI sector faces credential-stuffing and insider
threat far more than advanced APT.

**SOAR without playbooks is shelf-ware.** The orchestration platform takes 3–6
months to deploy and configure. Playbooks — the actual automated logic — take
another 6–18 months of iterative build. Vendors sell the platform; the
capability is the playbooks, and they require domain knowledge from your senior
analysts to write. Don't let a vendor demo of a 30-second automated response
hide that it took 12 months of engineering to build.

**The detection engineer role is scarce.** At banks under cost pressure, the
SIEM is run by the same team that manages endpoints and handles helpdesk
escalations. Detection engineering requires someone who can write code (Python,
SPL, KQL, YARA-L), understands attacker TTPs, and has time to iterate. If that
person doesn't exist, outsourcing to an MSSP (Managed Security Service Provider)
or using a detection-as-a-service vendor is a legitimate architectural choice —
but the architect should name it, not assume it's happening in the background.

**For Northwind:** with 3,000+ retail/field sites, the signal-to-noise ratio is
brutal. SD-WAN telemetry from branch CPEs, OT/IT separation events at plants,
and M&A-inherited networks with overlapping `10.50.0.0/16` ranges (see
`reference/running-example.md`) all look like anomalies on day one. Detection
rules must be tuned per-environment; a rule that fires on every new Eastfield
Foods host during integration will bury real alerts.

## Going deeper (optional)

- MITRE ATT&CK Framework — `attack.mitre.org` — the canonical technique
  library; use ATT&CK Navigator (GitHub: `mitre-attack/attack-navigator`) to
  plot coverage gaps.
- NIST SP 800-61r3 — *Incident Response Recommendations and Considerations for
  Cybersecurity Risk Management: A CSF 2.0 Community Profile* (2025) — the
  lifecycle that S23 builds on. (The older Rev 2, *Computer Security Incident
  Handling Guide*, 2012, is still widely cited.)
- OASIS STIX/TAXII (Structured Threat Information eXpression / Trusted Automated
  eXchange of Indicator Information) — the open standards for sharing TI between
  organizations and tools; supported by MISP.
- MISP (Malware Information Sharing Platform) — open-source TI platform,
  widely deployed in FSI sector sharing communities (e.g. FS-ISAC).
- Sigma rules — `github.com/SigmaHQ/sigma` — open-source detection rule format
  that compiles to Splunk SPL, Chronicle YARA-L, KQL, etc.; the Git-for-detection
  approach.
- Pairs with: S20 (logging & SIEM foundations), S23 (IR lifecycle), S24
  (ransomware and tabletop exercises), N28 (IDS/IPS/NDR — the network detection
  layer), N54 (flow logs and packet mirroring — the raw signals).

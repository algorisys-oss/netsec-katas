# Kata S23 — IR lifecycle (NIST): prepare, detect, contain, eradicate, recover

> **Track:** Security · **Module:** S6 Resilience & incident response · **Prereqs:** S01, S20, S21 · **Time:** ~40 min
> **Tags:** `incident-response` `security` `nist-csf` `siem` `soc` `fsi` `mental-model` `bcp-dr`

## Why it matters

When something goes wrong — ransomware propagating across Meridian Bank's DC, a
credential-stuffing campaign hammering the mobile login, a misconfigured firewall
that opened a path into the CDE — the CISO does not wing it. They run a process.
That process is the **IR lifecycle** defined in NIST SP 800-61 (rev. 2).

As an architect you will not run the incident, but you **will** be pulled in:
your design decisions (segmentation, logging, blast radius) determine how bad it
gets and how fast it can be recovered. The CISO's first question after containment
is often "why didn't we detect this sooner?" — and the answer is usually an
architecture gap. Know the lifecycle so you can design against each phase and
hold a credible conversation when it matters most.

## The mental model

NIST SP 800-61 Rev. 2 defines **four canonical phases**:

1. **Preparation**
2. **Detection & Analysis**
3. **Containment, Eradication & Recovery** (one phase in the standard)
4. **Post-Incident Activity**

Below we break phase 2 and 3 into their constituent *steps* (Detect, Analyze,
Contain, Eradicate, Recover) so each is easy to design against — but remember the
standard's count is **four**, not five or six. The expanded boxes are a teaching
device, not the canonical taxonomy.

(NIST CSF 2.0 uses Govern/Identify/Protect/Detect/Respond/Recover at the program
level — this kata focuses on the per-incident lifecycle inside Respond and Recover.)

```
  ┌────────────────────────────────────────────────────────────────┐
  │                   PREPARE (ongoing, not per-incident)          │
  │  IR plan · playbooks · team structure · tooling · exercises    │
  └────────────────────────────────┬───────────────────────────────┘
                                   │  an event occurs
                                   ▼
  ┌──────────────┐   alert   ┌──────────────┐   confirmed   ┌──────────────────┐
  │   DETECT &   │ ────────► │   ANALYZE    │ ─────────────►│     CONTAIN      │
  │   IDENTIFY   │           │ (is it real? │               │  (stop the bleed)│
  └──────────────┘           │  how bad?)   │               └────────┬─────────┘
                             └──────────────┘                        │
                                                                     ▼
  ┌──────────────┐  close     ┌──────────────┐  clean root  ┌──────────────────┐
  │  POST-INC.  │ ◄────────── │   RECOVER    │ ◄────────────│   ERADICATE      │
  │  ACTIVITY   │             │ (restore svc)│              │  (remove cause)  │
  └──────────────┘            └──────────────┘              └──────────────────┘
        │
        └──► lessons-learned feed back into PREPARE
```

### Phase by phase

**1. Prepare**
Everything that makes response possible before an incident starts. Done now so
you are not improvising at 2 a.m.

- IR plan (who does what, contact lists, escalation triggers)
- Playbooks per incident type (ransomware, credential compromise, data exfil,
  cloud-resource abuse)
- Tooling in place: SIEM, EDR, forensic jumpbox, out-of-band comms (a compromised
  corporate Slack is a liability during an active intrusion)
- Tabletop exercises — rehearse the playbook with the actual decision-makers
- Pre-authorized containment actions (isolating a VLAN, blocking a BGP prefix,
  revoking credentials) so responders don't wait for approvals at 2 a.m.

**2. Detect & Identify**
Finding the incident and confirming it is real.

- Sources: SIEM alerts (see S20), EDR telemetry, threat intel feeds, user
  reports, threat hunting, third-party notification (e.g. a bank card scheme
  flagging fraud patterns)
- Analyze: is this a true positive or false positive? What is the scope (which
  systems, which data, which time window)?
- Severity classification: P1/P2/P3 (or Critical/High/Medium) triggers different
  response teams and executive escalation thresholds
- Document everything from this moment — timestamps, who found it, what was
  observed; this is the start of your evidence chain (see S25 forensics)

**3. Contain**
Stop the bleeding without destroying evidence. Two modes:

```
  Short-term containment        Long-term containment
  ───────────────────────       ─────────────────────────────────────
  isolate the affected host     rebuild a parallel clean environment
  block the C2 IP at FW         keep original system for forensics
  revoke compromised creds      enforce additional segmentation
  rate-limit / null-route       bring in backup/DR path
```

Key tension: **speed vs evidence preservation**. Pulling a server's power is
fast but destroys volatile memory (active processes, network connections, encryption
keys) — always prefer network isolation over power-off where possible.

At Meridian Bank: isolating a VLAN containing `10.10.20.0/24` (the CDE) from
the rest of HQ-DC1 can be done in minutes if firewall rules are pre-authorized.
Without pre-authorization it needs a CAB approval — which is why preparation
matters (see N02 for the CAB dynamic).

**4. Eradicate**
Remove the cause: the malware, the backdoor, the compromised account, the
misconfiguration. This phase is only safe after containment.

- Remove malicious artifacts (malware, web shells, rogue scheduled tasks)
- Patch the exploited vulnerability
- Revoke and rotate all credentials that may have been exposed
- Scan remaining systems for indicators of compromise (IoC) before re-admitting
- Confirm with threat intel: is the attacker's tooling fully gone, or did they
  leave persistence?

**5. Recover**
Restore services from a known-good state.

- Restore from clean backups (verify integrity before restoring — a compromised
  backup is worse than no backup)
- Reconnect isolated systems only after eradication is confirmed
- Monitor intensely in the first 24–72 hours: attackers often re-enter if they
  have a second persistence mechanism you missed
- Communicate status to stakeholders, regulators if applicable. In India the flat
  clock is **CERT-In's**: its 2022 Directions (under §70B of the IT Act) require
  reporting specified cyber incidents within **6 hours** of becoming aware. **RBI's**
  expectation for supervised entities is tiered and stricter for the worst cases —
  commonly cited as ~2 hours where customer data / financial loss is involved and
  ~6 hours for other significant incidents — followed by a detailed forensic / RCA
  report later. Know which clock applies; for a scheduled commercial bank, both do.

**Post-incident activity (lessons learned)**
Within ~2 weeks: a blameless post-mortem documenting root cause, detection
timeline, what worked, what failed, and specific improvements to feed back into
Prepare. This is how the organization gets better — skip it and you will run the
same incident again.

### The architect's visibility into each phase

```
  Phase        What your design choices determine
  ─────────────────────────────────────────────────────────────────
  Prepare      Logging completeness (N54); segmentation blast radius (N27);
               backup architecture (S24); runbook access during outage
  Detect       Log coverage, SIEM ingestion, EDR deployment, network sensors (S20)
  Contain      Segmentation granularity; pre-authorized playbook actions;
               out-of-band management plane (separate from data plane)
  Eradicate    Immutable infrastructure (easier to repave than clean);
               secrets rotation automation (S11)
  Recover      RTO/RPO baked into the design (S24); clean backup availability
  Post-inc.    Audit log retention (how far back can you reconstruct the attack?)
```

## Worked example

**Scenario: credential-stuffing attack on Meridian Bank mobile login**

Timeline (condensed):

```
  Day 0  01:14  SIEM alert: login failure spike on mobile-auth service
                (10,000 failures in 5 min vs baseline 120/min)
                Source IPs: distributed, rotated — classic stuffing tool output
  Day 0  01:22  SOC analyst classifies P1; opens IR ticket, pages IR lead
  Day 0  01:35  DETECT complete: 47 accounts successfully logged in; session
                tokens issued; 3 accounts show immediate balance-check + transfer
                initiation → confirmed fraud in flight
  Day 0  01:40  CONTAIN (short-term):
                - Block the top 200 offending /24 source prefixes at the GCP
                  Cloud Armor WAF (not the firewall — WAF is the right layer here)
                - Force re-authentication on the 47 compromised sessions
                - Revoke and reissue affected session tokens (JWTs with 1h TTL
                  are a design win here — they expire fast anyway)
                - Freeze the 3 accounts with in-flight transfers (bank can do
                  this directly; no infra change needed)
  Day 0  02:10  ERADICATE:
                - Confirm no malware/backdoor involved — pure credential reuse
                - Check if attackers harvested data beyond account balance
                  (VPC Flow Logs from GCP: 10.100.x.x → mobile-auth service,
                   no unexpected lateral connections to core 10.10.0.0/16)
                - Initiate forced password reset for the 47 affected accounts
                - Rotate the rate-limiting config: tighten to 30 failures/min
                  per IP, add MFA step-up challenge on first login after failure
  Day 0  08:00  RECOVER:
                - Mobile service remained live throughout (containment was at
                  WAF layer, no service outage)
                - Notify RBI: credential stuffing event, 47 accounts temporarily
                  compromised, 3 fraudulent transfers attempted (2 reversed,
                  1 requires manual review); no PCI card data exposed
                - Notify affected customers per DPDP Act obligations
  Day 14        Post-incident: root cause = customers reusing passwords leaked
                in a third-party breach. Action items:
                  (a) Enforce MFA on login (S06 — was deferred, now P0)
                  (b) Integrate HaveIBeenPwned credential-check at login
                  (c) Lower WAF rate-limit threshold; add IP reputation scoring
                  (d) Review whether 47-account blast radius is acceptable —
                      drove discussion about adaptive authentication
```

**What architecture made this containable:**
- Cloud Armor WAF in front of mobile-auth: blocked IP prefixes in ~2 min, no
  firewall rule change needed (see N25, N42)
- Short JWT TTL (1 h): limited session-hijack window
- VPC Flow Logs (N54): confirmed no lateral movement to core banking segment in
  `10.10.0.0/16` — allowed ERADICATE to proceed with confidence
- Segmentation (N27): mobile-auth in GCP `10.100.x.x`, core banking in
  `10.10.0.0/16` over Cloud Interconnect — attacker who compromised an
  application-tier session could not reach the CDE directly

**What architecture hurt:**
- No MFA on login (S06 deferred) — meant stuffed credentials worked
- No adaptive auth / IP reputation feed — first signal was volume, not
  behavioural anomaly; earlier detection possible

## Cloud / vendor mapping (when applicable)

| IR Capability | On-prem | GCP | AWS | Azure |
|---------------|---------|-----|-----|-------|
| Log aggregation / SIEM | Splunk, QRadar, Sentinel on-prem | Chronicle SIEM (Google SecOps) | No first-party SIEM — Security Lake (OCSF data lake; ingests CloudTrail, VPC Flow Logs, Route 53, Security Hub findings), analyzed via Athena/OpenSearch/QuickSight or a third-party SIEM | Microsoft Sentinel |
| Threat detection | IDS/NDR (Snort, Darktrace) | Security Command Center, Event Threat Detection | GuardDuty | Microsoft Defender for Cloud |
| WAF block during incident | Firewall + proxy manual rule | Cloud Armor rule update (API / console) | AWS WAF update | Azure WAF (Front Door or App GW) |
| Network isolation (contain) | VLAN change, firewall rule | VPC Firewall Rule update; org-policy deny | NACL / Security Group change | NSG change |
| Credential revocation | AD password reset | Google Workspace suspend; GCP IAM key disable | AWS IAM: disable access key; Cognito: revoke token | Entra ID: sign-out all sessions |
| Forensic capture | SPAN/TAP + Wireshark | Packet Mirroring → internal passthrough NLB / collector instance group | VPC Traffic Mirroring → NLB | (Azure: TODO) |
| Playbook automation (SOAR) | Cortex XSOAR, Splunk SOAR | Chronicle SOAR (part of Google SecOps) | AWS Security Hub + EventBridge + Lambda | Microsoft Sentinel playbooks |
| IR runbook storage | Confluence/SharePoint on-prem | Cloud Storage or Docs (separate project) | S3 (separate account) | SharePoint / Azure Storage |

**Key cloud-specific notes:**

- **GCP:** Security Command Center (SCC) Premium aggregates findings from Event
  Threat Detection, Container Threat Detection, and third-party sources in one
  pane. SCC is your single alert console; Chronicle SIEM ingests the logs for
  hunting and timeline reconstruction.

- **AWS:** GuardDuty is the primary threat-detection control plane; Security Hub
  aggregates findings from GuardDuty, Inspector, Macie, and partner tools across
  accounts. During containment, NACLs (stateless, subnet-level) can block a
  source IP without touching Security Groups.

- **Both:** Cloud provider-native IR tooling works well for *cloud-originated*
  threats but does not see inside your on-prem segments. A hybrid IR capability
  needs log pipelines from on-prem devices into the cloud SIEM, or a unified
  on-prem SIEM with cloud log forwarding (see S20).

## Do it (the exercise)

### Part 1 — Map the phases to a scenario [laptop / paper]

Take the following Northwind FMCG scenario and write one concrete action per IR
phase:

> **Scenario:** At 14:30 on a Tuesday, a Northwind FMCG plant operator notices
> that the WMS (Warehouse Management System) at distribution center DC-07 is
> running extremely slowly. The IT helpdesk raises a ticket. Two hours later,
> an NDR alert fires showing anomalous east-west traffic from DC-07's
> `10.50.7.0/24` segment toward the Northwind HQ segment at `10.50.1.0/24`.
> (Recall from `reference/running-example.md` that both sit inside the
> `10.50.0.0/16` Northwind supernet, which overlaps with acquired Eastfield
> Foods — that address plan confusion is also in play.)

For each phase, write:
1. One action you would take
2. One architecture gap (in the current design) that makes the phase harder

### Part 2 — Severity classification drill [laptop / paper]

Rate each event P1 / P2 / P3 and justify:

a. SIEM alert: one EC2 instance in Northwind's AWS account is scanning ports
   within the VPC. No data exfiltration observed.

b. Meridian Bank core banking system unresponsive for 3 minutes. Cause unknown.
   Affects all 220 branches.

c. A developer's GCP service-account key was committed to a public GitHub repo
   6 weeks ago. The key has `roles/storage.admin` on the data lake project.

d. Antivirus alert on a single Northwind branch sales device; malware quarantined
   successfully; no network spread observed.

### Part 3 — Containment options comparison [laptop]

For scenario (c) above, list three containment actions in priority order.
For each, state what it stops and what it risks destroying (for forensics).

```bash
# Simulate what auditing a GCP service account key looks like
# (read-only, safe to run against any project you own)
# [needs cloud account]
gcloud iam service-accounts keys list \
  --iam-account=<SA_EMAIL> \
  --project=<PROJECT_ID> \
  --format="table(name.basename(),validAfterTime,validBeforeTime,keyType)"
```

### Part 4 — Tabletop question for your client [paper]

Draft three questions you would ask a Meridian Bank CISO to assess whether their
Prepare phase is actually ready. Write the answer a mature response sounds like,
and one red flag response.

## Say it back (self-check)

1. Name the four canonical NIST SP 800-61 Rev. 2 IR phases in order (note that
   Containment, Eradication & Recovery is a single phase) and state the primary
   goal of each in one sentence.
2. What is the key tension in the Contain phase, and why does it matter for
   forensics?
3. What are the Indian regulatory notification clocks after detecting a cyber
   incident — the flat 6-hour CERT-In requirement vs. RBI's tiered timeline — and
   why do they make the Detect phase time-critical?
4. Why should a compromised host be network-isolated rather than powered off?
5. What architecture decision determines whether you can contain an incident to a
   single VLAN vs. watching it spread east-west across the data center?
6. What feeds back from Post-Incident Activity into Prepare?

## Talk to the IT/security head

**Ask:**

- "Do you have a documented IR plan, and when was it last tested in a tabletop
  or live exercise?"
  *Good answer:* "Yes — we run a tabletop annually, red-team exercise every 18
  months. The plan was last updated [date] after [incident or drill]. RBI requires
  us to test it and provide evidence."
  *Red flag:* "We have a document, but I'm not sure when it was last used." Or:
  "We'd figure it out." These predict a chaotic, evidence-destroying response.

- "What pre-authorized containment actions does your team have — what can they do
  without a CAB approval at 2 a.m.?"
  *Good answer:* Names specific actions (isolate a VLAN, revoke creds, block a
  prefix at the WAF) with specific approval paths already documented.
  *Red flag:* Every containment action requires a change ticket and CAB approval.
  This means attackers have hours inside the network while paperwork is filed.

- "How far back can you reconstruct an attacker's activity using your current
  logs?"
  *Good answer:* "At least 12 months of audit-log history for CDE-scoped sources
  per PCI-DSS v4.0 Req 10.5.1, with the most recent 3 months immediately available
  for analysis. We've validated the pipeline — we know what's actually flowing in
  vs what we assume."
  *Red flag:* "We keep logs for 30 days" (fails PCI-DSS), or "I'm not sure what
  we're actually collecting" (a pipeline that exists on paper but has gaps in
  practice — extremely common).

- "If your primary SIEM goes down during an incident, what's your out-of-band
  communication and logging path?"
  *Good answer:* A dedicated out-of-band comms channel (separate email domain,
  encrypted messaging, phone bridge) and a secondary logging destination.
  *Red flag:* The SIEM, the comms channel, and the ticketing system all share the
  same SSO / corporate network — an attacker who compromises that kills your
  visibility and your response simultaneously.

- "After your last real incident or major drill, what did you change in your
  architecture?"
  *Good answer:* Cites specific changes — reduced blast radius, improved logging
  coverage, automated a containment playbook.
  *Red flag:* No lessons were ever acted on. The post-mortem report sits in a
  folder.

**Red flags to listen for overall:**
- No tabletop in >2 years (especially at a bank where RBI expects evidence)
- IR plan that hasn't been updated since the last major infrastructure change
  (moved to cloud, acquired a company, re-architected the CDE)
- "We'd call the vendor" — outsourcing the mental model, not just execution
- No separation between the management plane used for IR and the data plane that
  may be compromised

## Pitfalls & war stories

**Containment kills evidence.** A bank's response team once powered off 12 servers
the moment they detected ransomware — destroying the in-memory encryption keys
that would have identified the ransomware family and the attacker's decryption
service. Network isolation would have contained the spread without the loss.
Forensics starts the moment you know it's an incident.

**Pre-authorization gaps at the worst time.** A regulated FSI had a ransomware
outbreak that spread for four hours while responders waited for a CAB approval to
isolate the affected VLAN. The change was 10 seconds of CLI — the wait was process.
The IR plan must include pre-authorized actions for the most common containment
moves. Design this before the incident.

**The SIEM blind spot.** A real-world pattern: the cloud workloads are well-
instrumented, but on-prem switches and domain controllers feed no logs into the
SIEM. The attacker moves laterally through on-prem for weeks, pivots to cloud,
and the SIEM only sees the cloud segment — the lateral-movement path is invisible.
Architects who design for cloud observability but ignore on-prem create this gap.

**Backup integrity assumption.** Recovering from ransomware only works if the
backups are (a) air-gapped or immutable, and (b) the attacker hasn't been dormant
long enough to corrupt the backup window. A Northwind plant had 30 days of backup
retention; the attacker had been dormant for 45 days. All backups were encrypted
by the time the incident was detected. Design the retention window against your
expected dwell time.

**The overlap problem bites during response.** Northwind's address-plan collision
(`10.50.0.0/16` on two merged networks — see `reference/running-example.md` and
N11) meant that during a containment exercise, blocking `10.50.x.x` also blocked
legitimate traffic from the original Northwind segment. Know your address plan
before you need to contain in it.

**Regulatory clock starts at awareness, not at disclosure decision.** CERT-In's
6-hour notification window (and RBI's tighter ~2-hour expectation for incidents
involving customer-data compromise or financial loss) runs from the moment the
organization becomes *aware* of a cyber incident — not from when internal review
concludes it is reportable. Banks that spend hours in "is this really an incident?"
limbo miss the window. The IR plan must have a clear awareness-to-notification
trigger.

## Going deeper (optional)

- **NIST SP 800-61 rev. 2** — "Computer Security Incident Handling Guide" — the
  primary reference for the four-phase lifecycle. Free at nvlpubs.nist.gov.
- **NIST CSF 2.0** — specifically the Respond (RS) and Recover (RC) functions
  that sit above the per-incident lifecycle; cross-references SP 800-61. Revisit
  in S29 when mapping frameworks.
- **PCI-DSS v4.0, Requirement 12.10** — Incident response plan requirements for
  CDE-scoped organizations; also Requirement 10.5.1 for audit-log retention
  (≥12 months, most recent 3 months immediately available). (Requirement 10.7
  is a different control — detecting and responding to failures of critical
  security control systems, not retention.)
- **CERT-In Directions, 28 Apr 2022** (under §70B of the IT Act) — the flat
  **6-hour** reporting clock for specified cyber incidents, applicable to all
  covered Indian entities.
- **RBI Master Direction on IT Governance, Risk, Controls & Assurance, 2023** —
  cyber incident reporting for supervised entities; RBI's expectation is **tiered**
  (commonly cited as ~2 hours where customer data / financial loss is involved,
  ~6 hours for other significant incidents) with a follow-up forensic / RCA report.
  Do not conflate this with CERT-In's flat 6-hour rule.
- Pairs with: **S20** (logging/SIEM — what feeds Detect), **S21** (SOAR/detection
  engineering — what automates Contain), **S24** (ransomware/BCP/DR — Recover
  at scale), **S25** (forensics — evidence preservation during Contain).
- Cross-track: **N27** (segmentation — the blast-radius control that makes
  Contain work), **N54** (flow logs and packet mirroring — the telemetry that
  makes Detect possible), **N02** (CAB and change-control — why pre-authorization
  matters).

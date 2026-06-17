# Kata S02 — Who's who in security: CISO, SOC, GRC, red/blue/purple

> **Track:** Security · **Module:** S0 Security foundations · **Prereqs:** S01, N02 · **Time:** ~30 min
> **Tags:** `security` `who-is-who` `conversation` `soc` `compliance` `fsi` `fmcg` `mental-model`

## Why it matters

A proposal that lands on the wrong desk dies there. In a bank or large FMCG, "the
security team" is actually four or five distinct functions — each with different
KPIs, a different vocabulary, and a different veto. Pitching a data-encryption
change to the SOC manager, or a compliance requirement to the red team, signals
immediately that you don't know the room. Knowing who owns what, fears what, and
measures what is the difference between a design that gets approved in the first
review and one that cycles for months (see N02 for the network-side equivalent;
this kata is the security half).

## The mental model

Security org chart, from strategic to operational:

```
  BOARD / RISK COMMITTEE
       │  "Is our risk appetite respected? Are we compliant?"
       ▼
   CISO (Chief Information Security Officer)
       │  owns: risk posture, policy, control framework, the regulator relationship
       ├─── GRC  (Governance, Risk & Compliance)
       │         owns: frameworks, audits, policies, third-party risk, evidence
       ├─── AppSec / Product Security
       │         owns: SAST/DAST, secure SDLC, pen-testing the software you build
       ├─── SOC  (Security Operations Centre)
       │    ├── Blue team  — detection & response (24×7, SIEM, alerts)
       │    ├── Threat intel — knowing what attackers are doing before they hit you
       │    └── IR (Incident Response) — contain, eradicate, recover
       └─── Red team / Purple team
                 Red = attack simulations (ethical hackers)
                 Purple = red + blue collaborate to improve detection
```

**The key insight:** the CISO *decides* what risk to accept; GRC *proves* they
accepted it correctly; the SOC *detects* when a control fails; AppSec *prevents*
vulnerabilities from shipping; and the red team *tests* whether any of the above
is actually working. They are **checks on each other** — deliberately so. In a
PCI-DSS or RBI-audited bank, no single person can both implement a security control
and sign off that it works.

### Who owns / fears / measures what

| Role | Owns | Fears | Measures (KPIs) |
|------|------|-------|-----------------|
| **CISO** | Risk posture, security policy, control framework, regulator/auditor relationship | A breach becoming a headline; an audit finding that reveals policy was ignored; losing the board's trust | Risk-register reduction, audit findings count & age, % controls implemented, time-to-patch critical CVEs |
| **GRC** | Compliance evidence (PCI-DSS, RBI, ISO 27001), risk register, policy library, vendor/third-party risk | Evidence gaps the auditor finds; a control that exists on paper but not in practice; a new regulation with a short deadline | Audit finding count, days-to-closure, % policies reviewed annually, third-party assessments completed |
| **SOC / Blue team** | SIEM, alert triage, detection rules, threat intel, 24×7 monitoring, incident response | A breach they didn't detect; alert fatigue drowning the real signal; attackers with dwell time counted in months | Mean Time to Detect (MTTD), Mean Time to Respond (MTTR), alert volume vs. true positives, % endpoints covered |
| **AppSec** | Secure SDLC, SAST/DAST in pipelines, dependency scanning, code review | A critical vuln shipped to prod; a third-party dependency with a hidden backdoor; dev teams bypassing the scan gate | # critical vulns in prod, scan coverage %, remediation SLA compliance, SBOM completeness |
| **Red team** | Attack simulations, assumed-breach exercises, tabletop drills | Being given a target and finding nothing (suggests the scope was too narrow, not that the defense is perfect) | Time to objective (e.g. "domain admin in N hours"), detection rate by blue team, # control gaps found per exercise |
| **Purple team** | Joint red+blue improvement cycles | Findings from red that never become detection rules; silo between offense and defense | # new detection rules shipped per quarter, improvement in blue's MTTD after exercises |

### The CISO's vocabulary — the words that open doors

The CISO thinks in three registers: **risk** (likelihood × impact), **control**
(what prevents or detects), and **residual risk** (what's left after the control).
Frame every design in these terms:

```
  Feature language (loses CISOs):   "We want to use OAuth2 for the API."
  Risk language (wins CISOs):        "Removing shared API keys eliminates the
                                      shared-secret leakage/replay risk in the
                                      current design; residual risk is a compromised
                                      token, mitigated by short TTLs and revocation."
```

This pairs with S01 (CIA triad / risk framing) — revisit it now if needed.

## Worked example

Meridian Bank is deploying a new mobile-banking backend on GCP (the same system
from S01 and N02). A single design question — "how do we log API access?" —
touches every security function differently:

| Function | What they care about for API logging | What they'll ask you |
|----------|--------------------------------------|----------------------|
| **CISO** | Does it satisfy our control framework and RBI audit requirements? | "Which control in our framework does this satisfy? What's the residual risk if a log is missed?" |
| **GRC** | Is there a policy for log retention? Can we produce it in an audit? | "Logs retained for how long? Where? Who can delete them? Show me the evidence trail." |
| **SOC** | Are the logs ingested into the SIEM? Are detection rules written? | "Does the log format match our parser? Alert on 10 failed logins in 60 seconds?" |
| **AppSec** | Are API keys and tokens excluded from logs? No PII in plaintext? | "Did you scan the log output for credential leakage? Does it hit OWASP Logging Cheat Sheet?" |
| **Red team** | Can an attacker erase or forge logs? | "Is the log destination write-only from app servers? Separate IAM from the app role?" |

Same feature, five conversations, five vocabularies. The architect's value is
**sequencing** these so each function gets the question it can answer, and the
output of one feeds the next (e.g., GRC defines retention → SOC implements it →
red team verifies it can't be wiped).

For Northwind FMCG (cost-first, fewer specialists), the GRC function may be one
person doubling as the DPO, the SOC is likely a managed MSSP (Managed Security
Service Provider), and the red team is an annual external pen-test. The same roles
exist; the headcount behind each is smaller.

## Cloud / vendor mapping (when applicable)

| Security Function | On-prem equivalent | GCP | AWS | Azure |
|-------------------|--------------------|-----|-----|-------|
| SIEM (SOC data plane) | Splunk, IBM QRadar, ArcSight | Chronicle (Google Security Operations) | Amazon Security Lake + OpenSearch, or partner SIEM | Microsoft Sentinel |
| Threat detection (cloud posture) | Separate scanner/agent | Security Command Center (SCC) | Amazon GuardDuty | Microsoft Defender for Cloud |
| GRC evidence / audit log | Audit management tool (e.g. RSA Archer) | Cloud Audit Logs exported to BigQuery | AWS CloudTrail + AWS Audit Manager | Azure Monitor + Microsoft Purview Compliance |
| Vulnerability scanning (AppSec) | Qualys, Rapid7, Tenable | Artifact Registry / Container Analysis vulnerability scanning; Web Security Scanner (in Security Command Center) | Amazon Inspector; AWS Security Hub | Microsoft Defender for Cloud (DevOps security) |
| Red team simulation (cloud) | External pen-test firm | Google Cloud permission needed for authorized tests | AWS Penetration Testing Policy (self-service for common services) | Azure Penetration Testing Rules of Engagement |
| Incident response playbooks | Runbook binder; IR retainer | Chronicle SOAR (Siemplify-derived) | AWS Security Hub + Amazon Detective | Microsoft Sentinel SOAR |

> Note on GRC tools: the frameworks (PCI-DSS, RBI, ISO 27001) are the same
> regardless of cloud. GCP/AWS/Azure each publish compliance reports (FedRAMP,
> PCI-DSS Attestation of Compliance) that GRC teams use as evidence that the
> *platform* is compliant — but the customer's workloads on top still require
> separate attestation.

## Do it (the exercise)

**[laptop / paper]**

1. **Map the org.** Draw the security org chart for a client or a plausible FSI
   bank. Label each box with: one KPI they care about + one fear. If you can't
   fill a box, that is a relationship gap.

2. **Translate a feature into risk language.** Take any design decision (e.g.
   "use a managed database instead of self-hosted"). Write it once in feature
   language, then rewrite it as: threat eliminated + control introduced + residual
   risk remaining. Practice until it feels natural — this is the CISO's register.

3. **Identify who owns a real audit finding.** Pick any PCI-DSS requirement
   (e.g. Requirement 10 — logging and monitoring). List which security function
   at Meridian Bank *implements* it, which *proves* it for the auditor, and which
   *detects* if it fails at 3 a.m. These are three different people.

4. **[laptop]** Look up whether a tool you use appears on a GCP or AWS compliance
   report:
   ```
   https://cloud.google.com/security/compliance/offerings
   https://aws.amazon.com/compliance/programs/
   ```
   Find PCI-DSS. Note what "in scope" means vs. what you still have to prove.

## Say it back (self-check)

1. Name four security functions inside a CISO's org and the primary KPI each is
   judged on.
2. What is the difference between a blue team and a red team, and what does a
   purple team do?
3. Why can't the person who implements a security control also sign off that it
   works, in a PCI-DSS or RBI-regulated bank?
4. Restate this feature in risk language: "We're adding MFA to the admin console."
5. Which security function owns the relationship with the external auditor — and
   which owns the alert that fires when a control fails at 3 a.m.?

## Talk to the IT/security head

**Ask:**

- "Who is your CISO and do they report to the CIO or directly to the board?"
  *(a CISO who reports to the CIO can be overruled on cost; board-level reporting
  signals security is a first-class concern — and a design veto is real)*
- "Do you have an internal SOC, an MSSP, or a hybrid?" *(determines alert
  coverage, SLA, and what detection latency you can assume for your design)*
- "Which compliance frameworks are in scope — PCI-DSS, RBI, ISO 27001, SOC 2?"
  *(scope drives evidence requirements; your architecture choices are evidence)*
- "When did you last do a red-team exercise, and what was the most critical finding?"
  *(a good CISO answers directly; a deflection or "we can't share that" is fine,
  but "we've never done one" at a bank is a red flag)*
- "Is your GRC function integrated with change management, or do audits happen
  after the fact?" *(integrated = your design will be reviewed before go-live;
  after-the-fact = findings land six months later and require rework)*

**A good answer sounds like:** clear ownership per function, named tools and SLAs,
recent exercise results described at an appropriate level. The CISO or their
delegate can explain residual risk, not just list controls.

**Red flags:**
- "Security and IT are the same team here" — in a regulated bank, absence of
  segregation is itself an audit finding. Proceed with caution and budget for
  remediation.
- SOC tickets measured in days (MTTD > 24 h) for a PCI-scoped environment —
  that is a compliance gap, and your design's alerts will sit in that queue.
- GRC evidence produced by exporting a spreadsheet the week before the audit —
  controls may exist on paper but not in practice.
- No red-team exercises in the last 18 months — the detection rules have not been
  tested against a realistic adversary.

## Pitfalls & war stories

- **Pitching the SOC when GRC owns the decision.** A SOC manager can tell you
  their SIEM can ingest your logs. They cannot approve a new data-handling policy.
  That is GRC. Conflating the two adds weeks of re-routing.

- **"We're compliant, so we're secure."** PCI-DSS and ISO 27001 are a floor.
  Meridian Bank's GRC team may have every checkbox ticked while the SOC has a
  detection gap on east-west lateral movement. Compliance proves process;
  security proves outcome. These are different claims.

- **Assuming a large FMCG has a full security org.** At Northwind, the "CISO" may
  be the IT head wearing a second hat, GRC may be a single analyst, and the SOC
  is an MSSP alerting into a shared inbox. Design for the security coverage they
  *actually have*, not the org chart they aspire to.

- **Ignoring the red-team findings from last year.** Red-team reports at banks are
  retained and often reviewed by auditors. If your design reintroduces a path the
  red team found and flagged, you will be asked to explain why in the next audit.

- **Treating the CISO as a blocker rather than a co-designer.** A CISO who is
  brought in at the architecture phase can shape controls into the design cheaply.
  A CISO brought in at go-live will find the same gaps and block the launch.

## Going deeper (optional)

- NIST CSF 2.0 — maps to these functions: Govern (CISO/GRC), Identify/Protect
  (AppSec/GRC), Detect (SOC), Respond/Recover (IR). See S29 for a full framework
  map.
- PCI-DSS v4.0 — Requirement 12 sets out the information-security policy and
  roles that a GRC team must maintain; Requirement 10 drives SOC logging coverage.
- MITRE ATT&CK (https://attack.mitre.org/) — the adversary-behavior framework
  red and blue teams use to align attack simulations with detection coverage.
- Pairs with N02 (networking org chart, CAB, change-control) — the CISO's
  approval chain and the CAB are distinct but adjacent gates; your design must
  clear both.
- Sets up S03 (threat modeling) — once you know who owns what, threat models name
  *which function* is responsible for each control.

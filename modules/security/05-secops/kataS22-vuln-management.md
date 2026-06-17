# Kata S22 — Vulnerability management & patching at enterprise scale

> **Track:** Security · **Module:** S5 Security operations · **Prereqs:** S01, S20, S21 · **Time:** ~40 min
> **Tags:** `security` `vulnerability-management` `patching` `compliance` `fsi` `meridian-bank` `risk-management` `soc`

## Why it matters

Every unpatched vulnerability is a known debt with an unknown maturity date — the
attacker chooses when to call it in. Vulnerability management is the discipline
of continuously finding those debts, prioritising them by actual risk (not just
CVSS score), and eliminating them before attackers do. At Meridian Bank, the RBI
IT Framework and PCI-DSS both mandate periodic scanning, risk-ranked remediation
timelines, and evidence of patching for audit. At Northwind FMCG, the same
problem is harder: 3,000 retail/field endpoints, four OT plant-floor networks, and
dozens of acquired systems still running unpatched legacy software from the M&A
sprawl. Architects who understand this programme can challenge a design ("what's
the patch cycle for that OS image?"), translate between CISO and IT head language,
and avoid proposing systems that add unmanageable patching debt.

## The mental model

### The vulnerability lifecycle (first principles)

A vulnerability is a weakness. A patch is a supplier's fix. Between them sits a
window of exposure — the gap between when a weakness exists and when you close it.
The job is to shrink that window on the highest-risk assets first.

```
  ASSET EXISTS  ──►  VULN INTRODUCED  ──►  CVE PUBLISHED  ──►  EXPLOIT AVAILABLE
  (server born)       (flaw in code)         (public)              (PoC drops)
        │                                                               │
        └───────────────── EXPOSURE WINDOW ────────────────────────────┘
                   Your controls must detect + patch before this narrows too far.

  SCAN DETECTS  ──►  RISK-RANKED  ──►  PATCHED/MITIGATED  ──►  VERIFIED CLOSED
```

The key insight: **CVSS score ≠ your risk.** A CVSS 9.8 on a server that has no
network path to the internet and holds no regulated data may be lower priority than
a CVSS 6.5 on a public-facing authentication endpoint. Risk = CVSS severity ×
exploitability × your exposure × asset criticality (see S01).

### The four-phase programme

```
  1. DISCOVER         2. ASSESS           3. REMEDIATE        4. VERIFY
  ───────────────     ─────────────────   ─────────────────   ────────────────
  Asset inventory     Scan & fingerprint  Patch / upgrade     Re-scan to confirm
  CMDB coverage       CVE match           Virtual patch (WAF) Residual risk?
  Cloud + on-prem     Risk ranking        Accept (risk owner  Evidence for audit
  OT inventory        SLA assignment      signs off)
```

**Phase 1 — Discover:** you cannot patch what you do not know exists. The
canonical input is the CMDB (see glossary). Cloud assets are auto-discoverable
via APIs; on-prem requires agents or network-based discovery. Northwind's M&A
sprawl means "discovered" assets regularly surprise the security team.

**Phase 2 — Assess:** authenticated scanning (scanner logs in with service
credentials) finds far more than unauthenticated. CVEs are scored with CVSS
(Common Vulnerability Scoring System, published in NVD), but teams now add
EPSS (Exploit Prediction Scoring System) — the probability that a CVE will be
exploited in the wild (observed exploitation activity) in the next 30 days — to
separate theoretical risk from imminent threat. Note that EPSS predicts in-the-
wild exploitation, not the mere existence of PoC or weaponised code: many CVEs
with public exploit code still carry low EPSS scores.

**Phase 3 — Remediate:** four options in priority order:

```
  PATCH          Apply vendor fix. Best. Eliminates the vuln.
  MITIGATE       Remove the exposed feature, block the attack path (e.g.
                 disable the service, WAF rule, firewall block).
  VIRTUAL PATCH  WAF or IPS rule blocks exploitation without touching the
                 binary — buys time in change-frozen systems.
  ACCEPT         Risk owner formally accepts residual risk. Must be time-bound
                 and compensating controls documented. Signed by name, not role.
```

**Phase 4 — Verify:** rescan after remediation. Patches fail silently (package
installed, service not restarted; kernel updated, reboot pending). Verification
evidence is the audit artefact.

### SLA tiers (FSI standard)

Regulated environments assign SLA by severity:

```
  Severity      CVSS band   Typical FSI SLA    PCI-DSS Req 6.3.3 patch rule
  ─────────────────────────────────────────────────────────────────────────
  Critical      9.0–10.0    24–72 h (Crit)     Patch "critical" within 1 month
  High          7.0–8.9     30 days             Patch "high risk" as soon as
  Medium        4.0–6.9     60–90 days          possible (risk-ranked)
  Low           0.1–3.9     180 days / accept
```

RBI IT Framework (2023) additionally mandates VAPT (Vulnerability Assessment +
Penetration Testing) at least annually for critical systems, with findings tracked
to closure. PCI-DSS v4.0 Requirement 11.3 mandates internal vulnerability scans
(Req 11.3.1) and external ASV scans (Req 11.3.2) at least quarterly, plus after
any significant infrastructure change. Requirement 6.3 separately governs
identifying and remediating vulnerabilities — including installing critical and
high-severity security patches within one month of release (Req 6.3.3).

## Worked example

### Meridian Bank: a patch Tuesday in the CDE

Meridian's CDE subnet is `10.10.20.0/24` (HQ-DC1, see `reference/running-example.md`).
A Microsoft patch Tuesday drops `CVE-2024-XXXX` — a remote code execution vuln in
Windows Server with CVSS 9.8, EPSS 0.68 (68% probability of observed in-the-wild
exploitation within 30 days).

The flow through Meridian's programme:

```
  Tuesday 14:00  Vendor advisory published, CVE registered (NVD).
  Tuesday 16:00  Vulnerability scanner (Tenable/Qualys) pulls latest plugins.
  Wednesday 08:00 Authenticated scan of 10.10.20.0/24 → 12 CDE hosts affected.
  Wednesday 10:00 Risk ranking: CVSS 9.8 + EPSS 0.68 + internet-accessible
                  jump-server in scope → CRITICAL. SLA: 72 hours.
  Wednesday 12:00 Ticket opened, assigned to NetOps patch team. CAB emergency
                  change request raised (see N02 for CAB process).
  Thursday 18:00  Maintenance window: patch applied, service restarted.
  Thursday 20:00  Re-scan: all 12 hosts clear. Evidence exported (PDF scan
                  report) → stored in GRC tool for PCI audit.
  Thursday 20:30  Risk register updated. Ticket closed with artefact link.
```

Meanwhile, on the GCP VPC (`10.100.0.0/14`), Meridian uses OS Config patch jobs
to push the same Windows update to cloud-hosted jump servers — API-driven, no
maintenance window negotiation needed. Both results feed the same risk register.

### Northwind FMCG: the OT patching problem

Northwind's Plant 1 OT network runs a SCADA system on Windows Server 2012 R2 —
out of support since October 2023. CVSS 8.1 remote code execution. Options:

```
  PATCH?          No. Vendor-supported SCADA won't run on newer Windows.
  UPGRADE OS?     6-month vendor certification effort. Plant can't stop.
  VIRTUAL PATCH?  IPS rule at the OT/IT boundary blocks the exploit path.
                  IT head's preferred interim control.
  ACCEPT?         Risk owner (Plant Director + CISO) signs formal risk
                  acceptance. Compensating controls: network isolation,
                  IPS rule, no internet path, enhanced monitoring.
  PLAN:           OS/SCADA upgrade in next planned shutdown (Q3). Tracked
                  on risk register with target date.
```

This is the architect's OT reality: you cannot simply patch. The conversation with
the IT head is about compensating controls, isolation, and a credible remediation
roadmap — not "why haven't you patched yet?"

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Vulnerability scanner | Tenable Nessus / Qualys / Rapid7 agent on hosts | OS Config VM Manager; Security Command Center (SCC) has CVE findings | Amazon Inspector v2 (agent-based, EC2 + containers + Lambda) | (Azure: TODO) |
| Patch orchestration | WSUS (Windows), Ansible, SCCM, manual | OS Config patch jobs: patch policies applied to VMs by tag/label; `osconfig patch-jobs execute` | AWS Systems Manager Patch Manager; patch baselines + maintenance windows | (Azure: TODO) |
| Software inventory | CMDB (Infoblox/ServiceNow) | OS Config inventory (installed packages, Windows features) | Systems Manager Inventory; Resource Explorer | (Azure: TODO) |
| Risk posture dashboard | Vulnerability management platform (Qualys VM, Tenable.sc) | Security Command Center Premium: CVE findings linked to assets, risk scores | AWS Security Hub + Inspector findings, aggregated by account | (Azure: TODO) |
| Container image scanning | Trivy, Grype (CI pipeline) | Artifact Registry vulnerability scanning; GKE Security Posture | Amazon ECR image scanning (Basic: Clair; Enhanced: Inspector) | (Azure: TODO) |
| Virtual patching | WAF rule / IPS signature | Cloud Armor custom rule; Cloud IDS blocking | AWS WAF managed rule groups; Network Firewall IPS rules | (Azure: TODO) |
| Compliance evidence export | Scan report PDF, ticket extract | SCC findings export to Cloud Storage / BigQuery; Pub/Sub to SIEM | Security Hub findings → S3 export; EventBridge → SIEM | (Azure: TODO) |

**GCP-first notes:**
- `gcloud compute os-config patch-jobs execute --instance-filter-all \
  --patch-config-apt-type=DIST_UPGRADE` initiates a patch job across a fleet.
- OS Config reports can filter by tag (`env=production`) — critical for scoping
  patch jobs to CDE vs non-CDE assets.
- Security Command Center Premium surfaces CVE findings per resource and links
  them to Asset Inventory, giving a single-pane view of "which VM, which finding,
  what severity."
- Amazon Inspector v2 integrates with AWS Organizations so a security account
  sees findings across all member accounts — the right model for an enterprise
  with multiple workload accounts (see N49, N52).

## Do it (the exercise)

### Part A — Risk ranking (paper) [laptop / paper]

Take three CVEs from the NIST NVD (`https://nvd.nist.gov/`):

1. Pick a Critical (≥9.0) with a network attack vector.
2. Pick a High (7.0–8.9) with local attack vector only.
3. Pick a Medium (4.0–6.9) with exploit code publicly available (check EPSS at
   `https://www.first.org/epss/`).

For each, decide: if this were on a Meridian Bank CDE host (`10.10.20.0/24`),
what is the remediation priority and why? Produce a one-line risk statement:
`"[CVE-ID] on [asset]: CVSS [score] + EPSS [%] + [exposure context] → [priority]"`.

### Part B — Scan a local system [laptop]

Install `trivy` (open-source, Docker-required, DEFENSIVE use only — scan your own
systems):

```bash
# Install trivy (Debian/Ubuntu)
sudo apt-get install -y wget apt-transport-https gnupg lsb-release
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" \
  | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install -y trivy

# Scan the OS packages on your own laptop (output: table of CVEs)
trivy fs --scanners vuln /
```

Read the output:
- What's the highest CVSS finding? Is it fixed in a newer package version?
- How many Critical/High findings does your machine have right now?
- `trivy image python:3.11-slim` — compare a base container image to the host.
  Notice that a slim container often has fewer findings because it has fewer
  packages installed.

```bash
# Scan a container image (pull first — only scan what you own/control)
docker pull python:3.11-slim
trivy image python:3.11-slim
```

### Part C — Patch SLA exercise (paper)

Northwind's security team runs a quarterly scan and finds 200 findings:

```
  Critical  CVSS ≥9.0   8 findings   across 4 plant-network hosts (OT)
  High      7.0–8.9     42 findings  across corp-office endpoints
  Medium    4.0–6.9     110 findings across retail/field points (SD-WAN sites)
  Low       0.1–3.9     40 findings
```

1. Draft a 3-sentence briefing for the CISO: what's the risk priority order and why?
2. Which findings would you escalate to a risk-acceptance conversation immediately,
   and who signs the acceptance?
3. The IT head says "we can patch corp endpoints in 30 days but the plant hosts
   need 6 months." What compensating controls would you ask about?

## Say it back (self-check)

1. Why is a CVSS 9.8 not automatically your highest remediation priority?
   What two additional data points help rank risk more accurately?
2. Name the four remediation options in order of preference. When is formal
   risk acceptance appropriate, and what must it include?
3. What is a "virtual patch" and when would you use it instead of an OS patch?
4. State the PCI-DSS v4.0 scanning frequency requirement (which requirement
   number?) and the requirement governing the patch SLA for critical
   vulnerabilities.
5. Why is OT patching fundamentally different from IT patching, and what
   compensating controls substitute for a patch that cannot be applied?

## Talk to the IT/security head

**Ask:**
- "What is your asset inventory source, and does it cover cloud and OT as well
  as on-prem? How long until a new VM appears in the scanner scope?"
  *A good answer:* CMDB backed by an API-driven discovery feed; cloud assets
  appear within hours via tag-based auto-enrolment; OT inventory is maintained
  separately and scanned in a maintenance window.
  *Red flag:* "we scan what we know about" — unknown assets are the ones attackers
  find first.

- "How do you rank CVE priority — raw CVSS, or do you layer in EPSS and
  asset criticality?"
  *A good answer:* CVSS is the input; risk ranking multiplies by EPSS, exposure
  (internet-facing vs air-gapped), and asset criticality tier. The 20 highest-
  risk findings get attention regardless of count.
  *Red flag:* "we patch Critical first, then High, in order" — this treats a
  CVSS 9.8 on an isolated test box the same as a CVSS 7.1 on a public API server.

- "What is your patch SLA by severity, and what evidence do you provide for
  audit — particularly for PCI-DSS Req 11.3 (quarterly scan evidence), Req 6.3.3
  (patch timelines), and the RBI IT Framework?"
  *A good answer:* SLA table exists, is in the policy, and is enforced via the
  ticketing system with breach escalation. Scan reports and ticket closure
  artefacts are exported to the GRC tool automatically.
  *Red flag:* "we patch as fast as we can" — no enforceable SLA, no evidence trail,
  an audit finding at the next QSA review.

- "How are your OT/plant systems handled — do they fall under the same scan and
  patch programme, or are they treated separately?"
  *A good answer:* separate programme; OT assets are scanned from a dedicated
  passive scanner (no authenticated scanning that risks disrupting PLCs); findings
  route to a risk-acceptance process with compensating-control documentation.
  *Red flag:* "OT is the plant team's problem, not ours" — unclear ownership of
  a high-value, often-unpatched attack surface.

- "When did you last run a VAPT on critical systems, and how long did it take
  to close findings from the last one?"
  *A good answer:* annual cadence; last report findings tracked to a named risk
  owner with target dates; closure rate ≥80% within 90 days.
  *Red flag:* findings from the last VAPT are still open a year later with no
  target date — scanning is theater, remediation is the missing discipline.

## Pitfalls & war stories

- **Patching the visible, missing the shadow.** Banks have discovered CDE-adjacent
  hosts during a breach investigation that were never in the CMDB and therefore
  never scanned. Asset discovery must be continuous, not a one-time exercise.

- **CVSS paralysis.** A team that works through 10,000 medium findings before
  addressing a single exploit-in-the-wild high finding has inverted its risk
  priorities. EPSS + exposure context is the corrective.

- **Patching without testing in PCI environments.** PCI-DSS Req 6.3.3 requires
  patches to be installed but also that changes go through a tested change
  process. Emergency patching that bypasses the CAB is a compensating-control
  conversation, not a "just do it" instruction — the CAB bypass itself must be
  documented (see N02).

- **The reboot problem.** Linux `unattended-upgrades` installs the kernel patch;
  the running kernel is not updated until the machine reboots. Scanners re-run
  against the running kernel, see the old version, and report "still vulnerable."
  Verification scans must check for pending reboots, not just installed packages.

- **OT/IT boundary confusion at Northwind.** After an acquisition, Northwind
  discovered a plant-floor SCADA server at `10.50.0.50` (a host in the
  `10.50.0.0/16` overlapping range shared with Eastfield Foods, from N11) was
  reachable from the corporate office network because the
  OT/IT firewall rule was copied during the M&A integration and the source range
  was wrong. The compensating control for an unpatched OT host only works if the
  isolation is actually enforced — verify the firewall rules, not just the policy.

- **FSI change-control friction.** In banks, a standard patch may have a 2-week
  CAB cycle. For a CVSS 9.8 with EPSS 0.68, that window is dangerous. Mature FSI
  programmes have a pre-agreed emergency-change process — verify it exists before
  you need it.

## Going deeper (optional)

- NIST NVD — CVE database and CVSS v3.1 scoring guide: `https://nvd.nist.gov/`
- FIRST EPSS — Exploit Prediction Scoring System, updated daily:
  `https://www.first.org/epss/`
- PCI-DSS v4.0, Requirement 6 (develop and maintain secure systems and software):
  `https://www.pcisecuritystandards.org/`
- RBI IT Framework (Master Directions on IT Governance, 2023) — Annex 6 covers
  VAPT and patch management for scheduled commercial banks.
- CISA Known Exploited Vulnerabilities (KEV) catalogue — the most operationally
  relevant "patch these now" list, maintained by the US federal government:
  `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`
- Trivy documentation (open-source scanner): `https://aquasecurity.github.io/trivy/`
- Pairs with S20 (logging/SIEM — scan findings feed the SIEM), S21 (SOC workflow
  — vuln tickets and SLA breaches are SOC escalation triggers), and S23 (IR —
  an exploited unpatched vuln is the most common incident origin).

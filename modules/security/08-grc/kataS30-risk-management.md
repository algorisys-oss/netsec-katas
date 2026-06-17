# Kata S30 — Risk management: appetite, registers, treatment, residual risk

> **Track:** Security · **Module:** S8 Governance, risk & compliance · **Prereqs:** S01, S29 · **Time:** ~35 min
> **Tags:** `risk-management` `compliance` `nist-csf` `iso-27001` `audit` `fsi` `meridian-bank` `security`

## Why it matters

Every CISO you sit across from runs a **risk register** and reports against a
**risk appetite statement** signed off by the board. When you propose a design,
they are not evaluating it for technical elegance — they are asking where it lands
on that register and whether its residual risk stays within appetite. If you cannot
speak that language, your proposal stalls in the GRC review. Understand the four
steps of risk management (identify → assess → treat → monitor) and you can frame
any architecture decision in terms the CISO and board will approve — or at minimum,
understand *why* they won't.

This kata is especially critical at FSI clients (Meridian Bank) where regulators
(RBI, PCI-DSS, DPDP) require documented risk treatment and residual risk sign-off,
and at large FMCGs (Northwind) where an M&A integration creates a sudden surge of
new risk items that must be triaged quickly.

## The mental model

### 1. Risk appetite vs risk tolerance vs risk capacity

These three terms are distinct and often confused:

```
  RISK CAPACITY     the maximum loss the organization can survive before
  (ceiling)         it ceases to operate — set by capital, insurance, law

  RISK APPETITE     the amount of risk the board is *willing* to accept in
  (policy line)     pursuit of its strategy — a deliberate choice, signed off
                    annually; sits below capacity

  RISK TOLERANCE    the acceptable variance around appetite on a given risk
  (band)            type — "we accept up to 3 high findings open in the CDE
                    at any point, but not 4"

        Capacity   ──────────────────────────────────── (the cliff edge)
                             [UNSAFE ZONE]
        Appetite   - - - - - - - - - - - - - - - - - - (the board line)
        Tolerance  · · · · · · · · · · · · · · · · · · (the operating band)
                             [OPERATING ZONE]
```

A well-run security programme keeps residual risk *within tolerance*, escalates
when it drifts toward appetite, and never silently crosses the capacity line.

### 2. The risk lifecycle

```
  IDENTIFY      ASSESS           TREAT            MONITOR
  ────────      ──────           ─────            ───────
  What could    How bad, how     Accept /         Re-assess on
  go wrong?     likely?          Mitigate /       schedule; track
                                 Transfer /       KRIs; check
  Sources:      Inherent risk    Avoid            residual risk
  threat intel, = likelihood ×                    stays in band
  STRIDE,       impact           Residual risk =
  audit,                         what's left
  pentest,                       after treatment
  vendor vulns
```

The four treatment options (the "4 Ts") are worth memorising:

| Treatment | Meaning | When to use |
|-----------|---------|-------------|
| **Mitigate** | Add a control that reduces likelihood or impact | Most common — firewall rule, MFA, patch |
| **Transfer** | Shift financial exposure to a third party | Cyber insurance; outsourced hosting with SLA |
| **Accept** | Document and own the residual risk | Low-risk items below tolerance; cost of control > cost of risk |
| **Avoid** | Stop the activity creating the risk | Stop processing a data type; discontinue a service |

### 3. The risk register

The risk register is a living document (spreadsheet, GRC tool, or ITSM module)
where every known risk is tracked:

```
  ID   | Risk description          | Inherent   | Controls        | Residual   | Owner   | Review
       |                           | (L × I)    | in place        | (L × I)    |         | date
  ─────┼───────────────────────────┼────────────┼─────────────────┼────────────┼─────────┼────────
  R-14 | Unencrypted data in       | 4 × 5 = 20 | Network seg,    | 1 × 5 = 5  | CISO    | Q1-2027
       | legacy core-banking DB    | (Critical) | VLAN isolation  | (Low)      |         |
  R-27 | Third-party API key       | 3 × 4 = 12 | None yet        | 3 × 4 = 12 | CTO     | Q4-2026
       | stored in app config      | (High)     | (open finding)  | (High)     |         |
```

Likelihood (L) and Impact (I) are typically scored 1–5 (some shops use 1–3).
`Inherent risk` = risk before any controls. `Residual risk` = risk *after* all
current controls are applied. Residual risk is the number the CISO actually cares
about and reports to the board.

### 4. Risk vs compliance

Compliance (passing a PCI-DSS or ISO 27001 audit) is a **floor**, not a ceiling.
A system can be fully compliant and still carry unacceptable residual risk on a
dimension the standard does not cover. Architects who conflate the two get a nasty
surprise when the CISO red-flags a technically compliant design because it moves a
risk item above appetite.

```
  COMPLIANCE  ── satisfies a defined set of requirements at a point in time
  RISK POSTURE ── reflects the actual exposure level relative to threats today

  Compliant ≠ Secure. But: Non-compliant → audit finding → its own risk item.
```

This is why the frameworks from S29 (NIST CSF, ISO 27001) include a **risk
management** process as a foundational pillar, not an optional module.

## Worked example

Meridian Bank's GCP mobile-banking platform (see `reference/running-example.md`)
is going live. The risk team has triaged five items from the threat model (see S03):

```
  10.10.20.0/24  ← CDE (PCI scope, HQ-DC1)  ─── Cloud Interconnect ───  10.100.0.0/14 (GCP)
                                                                           ↑
                                                          mobile backend sits here
```

| ID  | Risk | L | I | Inherent | Treatment | Residual |
|-----|------|---|---|----------|-----------|---------|
| R-01 | Public internet path to mobile API has no WAF | 4 | 4 | 16 (High) | Mitigate: add GCP Cloud Armor WAF in front of HTTPS LB | 2 × 4 = 8 (Medium) |
| R-02 | Cloud IAM roles over-provisioned (broad `roles/editor` on prod project) | 3 | 5 | 15 (High) | Mitigate: scope to least-privilege custom roles per service | 1 × 5 = 5 (Low) |
| R-03 | Core-banking API key hard-coded in mobile backend config | 4 | 5 | 20 (Critical) | Avoid (stop hard-coding) + Mitigate: move to GCP Secret Manager | 1 × 5 = 5 (Low) |
| R-04 | No encryption in transit between GCP and HQ-DC1 interconnect | 3 | 5 | 15 (High) | Mitigate (owner: infra team): enable MACsec on Interconnect | 1 × 5 = 5 (Low) |
| R-05 | Core-banking DR site (DC2, 10.20.0.0/16) not in scope for cloud failover | 2 | 4 | 8 (Medium) | Accept: DR tested annually; board-signed risk acceptance on file | 2 × 4 = 8 (Medium / Accepted) |

Notice that R-05 ends at **residual risk = Accepted**. That is not a failure. It
is a documented, board-visible, reviewed decision. The risk item stays open on the
register, with an owner and a review date. That is what "accept" means: not
"ignore" but "consciously own."

Now the CISO can present to the board: "We launched with 3 residual Lows and 1
Medium/Accepted. Nothing remains above appetite."

**Risk appetite statement excerpt** (hypothetical Meridian Bank):

> *The Bank accepts no unmitigated Critical risk in PCI-CDE systems. High risks
> must be reduced to Medium or below within 90 days of identification. Medium
> risks require a documented owner and review date. The Board Risk Committee
> reviews the register quarterly.*

R-03 (Critical, now 5/Low after treatment) clears the appetite line.
R-02 (High, now 5/Low after treatment) also clears within the 90-day window.
R-05 (Medium/Accepted) is within appetite with board sign-off.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem / Traditional | GCP | AWS | Azure |
|---------|----------------------|-----|-----|-------|
| Risk register tool | Excel, Archer, ServiceNow GRC | Security Command Center (SCC) aggregates control findings (Security Health Analytics); Assured Workloads is a separate compliance-boundary control (enforces region, personnel, and encryption constraints for a workload); native GRC tools are third-party (Archer, ServiceNow) | AWS Security Hub aggregates control findings; native GRC via third-party | Azure Security Center / Defender for Cloud findings; (Azure: TODO) — native GRC tooling |
| Control evidence collection | Manual evidence gathering; audit screenshots | SCC Compliance dashboard exports evidence per control; asset inventory via Cloud Asset Inventory | AWS Security Hub standards reports (PCI-DSS, CIS); AWS Audit Manager automates evidence collection | Defender for Cloud regulatory compliance blade; (Azure: TODO) |
| Inherent risk identification | Threat models, VAPT reports, vendor CVEs | SCC vulnerability findings (SAST, web security scanner, container analysis) | AWS Inspector (EC2/ECR CVEs), Security Hub findings | Defender for Cloud recommendations; (Azure: TODO) |
| Residual risk tracking | Register updated manually each quarter | SCC findings have severity, a state (ACTIVE/INACTIVE) and a separate mute setting (MUTED/UNMUTED) with mute justification — auditable paper trail | Security Hub findings have workflow status (NEW/NOTIFIED/SUPPRESSED/RESOLVED) | (Azure: TODO) |
| Risk appetite enforcement | Board policy + manual gate | Org Policy constraints enforce hard technical controls (e.g. deny public IPs) that cannot drift | SCP (Service Control Policies) prevent actions that would violate appetite | (Azure: TODO) |

**Key nuance for architects:** cloud posture tools (SCC, Security Hub, Defender)
surface **control findings** — they tell you *what is wrong*. Converting those
findings into **risk items** (with likelihood, impact, owner, and treatment
decision) is a human GRC process, not an automated one. The cloud tool is the
input to the risk register, not the register itself.

## Do it (the exercise)

### Part 1: Map a real risk register [laptop / paper]

Take the five Meridian Bank risks (R-01 to R-05) and do the following:

1. For each row, verify the Inherent = L × I arithmetic.
2. Re-score the residual for R-01 independently. A WAF reduces likelihood from 4
   to 2 (it catches most automated attacks but not all). Impact stays at 4 (a
   successful breach still hits PCI scope). Is residual 8 within a typical FSI
   appetite for Medium? What would push it to Low?
3. Write a one-sentence **risk acceptance justification** for R-05 that a board
   member could sign. Include: the risk, the residual score, why treatment was not
   applied, and the review cadence.

### Part 2: Triage a new finding [laptop / paper]

Northwind FMCG acquires Eastfield Foods (see `reference/running-example.md`).
Eastfield's IT team discloses: "We have 3,000 Windows endpoints running EOL
Windows 10 (no ESU) across plant-floor laptops and POS devices."

4. Write a risk register entry for this finding:
   - Assign a risk ID, description, and owner
   - Score Likelihood and Impact independently (justify each score in one line)
   - Propose a treatment from the 4 Ts and describe the control
   - Estimate residual

5. Decide whether this risk would breach appetite if Northwind's board policy
   states: *"No unmitigated High or above risk on OT-adjacent systems."*

### Part 3: Cloud finding → risk item [needs cloud account]

6. In GCP Security Command Center (free tier available in any project):
   - Navigate to **Findings** → filter by **Severity: HIGH**
   - Pick one finding and write a risk register row for it (ID, description, L, I,
     inherent, proposed treatment, estimated residual)
   - Check whether SCC provides a "Mute" option — this is the cloud equivalent of
     risk acceptance; note what evidence it requires you to supply

## Say it back (self-check)

1. State the difference between risk appetite, risk tolerance, and risk capacity in
   one sentence each.
2. What is the difference between inherent risk and residual risk?
3. Name the 4 Ts of risk treatment and give a Meridian Bank example of each.
4. Why does "accept" on a risk item not mean "ignore"?
5. A system passes its PCI-DSS audit. Can it still carry unacceptable residual
   risk? Explain why.

## Talk to the IT/security head

**Ask:**

- "Do you have a formal risk appetite statement signed by the board? Can you
  share the thresholds for Critical/High/Medium?"
  *What a good answer sounds like:* A specific threshold statement (e.g. "Criticals
  must be remediated within 30 days, Highs within 90 days, Mediums tracked to next
  quarter") and confirmation it's board-approved and reviewed annually.
  *Red flag:* "We try to fix things as fast as we can" — no formal appetite means
  no defined escalation path and risk decisions are made ad hoc.

- "Which tool do you use for the risk register, and how often is it reviewed?"
  *What a good answer sounds like:* A named tool (Archer, ServiceNow GRC, or at
  minimum a controlled spreadsheet) with a quarterly review cadence and named owners
  per risk item.
  *Red flag:* "We have a spreadsheet somewhere" with no owner or review date —
  risk register hygiene is itself an audit finding under ISO 27001 clause 6.1.

- "What is the residual risk on this project's deployment into the CDE? Has that
  been reviewed against appetite?"
  *What a good answer sounds like:* The CISO names the specific risk items, their
  scores, the treatments applied, and whether board sign-off was obtained for any
  accepted Medium/High items.
  *Red flag:* Blank stare, or "the pen-test was clean" — pen-test results are a
  control finding, not a residual risk score.

- "If I propose a design change that opens a new attack surface, what is the process
  to get that risk assessed and accepted?"
  *What a good answer sounds like:* A named process — threat model or risk
  assessment, sign-off by CISO, escalation to board for anything above Medium.
  *Red flag:* No process, or "we'll just patch it if something happens" — reactive
  risk posture in an FSI context is a regulatory failure.

**Red flags to listen for:**
- "We're compliant, so we're fine" — conflates audit pass with risk management.
- No separation between risk owner (business) and risk assessor (GRC team) — same
  person assessing and accepting their own risk is a control failure.
- Risk items with no review date or no named owner — classic audit finding.
- "We accept everything below High" without board sign-off — appetite requires
  board-level mandate, not unilateral CISO decision.

## Pitfalls & war stories

**"Compliance covers it."** A mid-size Indian bank passed their annual RBI VAPT
and PCI-DSS audit with zero critical findings — then suffered a lateral movement
incident six weeks later. The attacker used an over-privileged service account
(scored Medium, accepted without treatment) to access core-banking APIs from a
compromised developer workstation. The Medium risk item had a board-accepted
residual. The incident response review found that the impact assumption (scored 3)
was understated — the actual blast radius was 5. Risk re-scored: 3 × 5 = 15 (High).
Had it been correctly scored, appetite would have mandated treatment.
**Lesson:** impact scoring is the hardest part and the most likely to be
politically softened. Architects who push back on low impact scores are doing the
right thing.

**The inherited risk problem at M&A.** When Northwind acquired Eastfield Foods,
the risk register inherited 47 open items from Eastfield's register — in a
different format, with no shared owner mapping. Northwind's GRC team spent three
months rationalizing the register rather than remediating risks. Two High items
fell through the gap and aged past 90 days, breaching Northwind's own appetite.
**Lesson:** M&A due diligence must include a risk register handover and risk
re-scoring against the acquirer's appetite, not just a compliance checklist.

**Risk acceptance without board sign-off.** A CISO at an FMCG accepted 12 Medium
risks unilaterally on a new ERP deployment, logging them with a personal "accepted"
notation. Six months later, a board audit found the items — and found no evidence
of board awareness. The board's own risk appetite statement required escalation for
any Medium risk touching customer PII. The CISO faced a governance finding.
**Lesson:** "accept" is a formal act. Check who has authority to accept at each
risk level. In FSI, that authority is rarely the CISO alone.

**Architect mistake: treating security controls as automatic risk reduction.**
Adding a WAF to R-01 is a treatment. But if the WAF is misconfigured (no rule set,
alerting off), the likelihood reduction is illusory — inherent risk and "residual
risk" are the same. GRC teams that do not verify control effectiveness are running
a paper risk programme. Architects should ask: "Is this control actually
operational, and how do you know?"

## Going deeper (optional)

- **ISO/IEC 27005:2022** — Information security risk management; the companion
  standard to ISO 27001 that specifies the risk assessment and treatment process in
  detail.
- **NIST SP 800-30 Rev.1** — Guide for Conducting Risk Assessments; the NIST
  equivalent, widely used in US financial and government contexts.
- **NIST SP 800-39** — Managing Information Security Risk at the organizational,
  mission, and information-system levels; introduces the three-tier risk model
  (Org → Mission/Business → System).
- **RBI IT Framework (2023)** — Requires documented risk appetite, quarterly board
  reporting of residual risks, and annual independent review for scheduled
  commercial banks in India; see S29 and N29 for the compliance context.
- **PCI-DSS v4.0 Requirement 12.3** — Risk management requirement that mandates a
  formal risk assessment process (not just controls); often overlooked by teams
  focused on technical requirements.
- **FAIR (Factor Analysis of Information Risk)** — A quantitative risk model that
  converts qualitative scores to expected dollar loss; used when the board wants
  financial risk framing rather than High/Medium/Low heat maps.
- Pairs with S01 (CIA/risk fundamentals), S03 (threat modeling as risk
  identification input), S29 (frameworks that require a risk management process),
  and S31 (third-party risk as a risk register category).

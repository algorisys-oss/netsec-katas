# Kata S39 — Talking compliance & risk with a CISO without overpromising

> **Track:** Security · **Module:** S10 Security conversation mastery · **Prereqs:** S01, S29, S30, N02 · **Time:** ~35 min
> **Tags:** `security` `compliance` `risk-management` `conversation` `fsi` `audit` `nist-csf` `pci-dss`

## Why it matters

A CISO at a bank or FMCG has one job: own the residual risk their organization
carries and make sure it doesn't materialize as a breach, an audit failure, or a
regulatory sanction. When an architect walks in and says "this design is secure,"
the CISO hears a red flag — because no design is *secure*; every design makes a
set of *risk trade-offs*. The architect who earns trust in that room is the one
who presents controls alongside their limitations, names what risk remains, and
refuses to promise outcomes they can't deliver. That is the skill this kata builds:
not a compliance checklist, but the language and posture that makes you a credible
partner rather than a liability.

## The mental model

**1. The CISO's mental ledger**

The CISO is holding two columns simultaneously:

```
  INHERENT RISK                    CONTROLS                  RESIDUAL RISK
  (what could go wrong             (what we have in          (what we live with
  with no controls)                place today)              after controls)

  External attacker                Firewall, WAF             Targeted APT
  Misconfigured cloud role         CSPM, least privilege     Zero-day cloud service
  Insider exfiltration             DLP, PAM, logging         Determined malicious admin
  Unpatched dependency             SCA, patching programme   Supply-chain gap
```

You are being asked to *move the residual column*, not to make the inherent
column disappear. Every honest conversation starts here.

**2. Compliance ≠ security, but compliance matters**

Compliance (PCI-DSS, RBI, ISO 27001, SOC 2) is a floor: the minimum set of
controls an organization must demonstrate to stay licensed and insured.
Passing a QSA audit does not mean you are safe; it means you have satisfied
a point-in-time snapshot of a defined control set. The CISO knows this, and
so do auditors. Your job is to explain *how your design satisfies specific
requirements*, not to assert that being compliant makes the system safe.

```
  COMPLIANCE                 SECURITY
  ───────────────────────────────────────────────────────
  Pass/fail against a        Continuous reduction of
  defined control set        residual risk

  Point-in-time evidence     Ongoing posture

  Auditor satisfies          Attacker does not read
  the standard               the standard

  Framework says "encrypt    Framework does not say which
  cardholder data at rest"   key management regime is safe
                             if your KMS is over-permissioned
```

The phrase that wins this conversation: *"This control satisfies [requirement]
— the residual risk after that control is [X], and here is how we detect and
respond to X."*

**3. Overpromising — what it looks like and why it kills trust**

Overpromising takes five forms, all of which a CISO will catch:

```
  FORM                      EXAMPLE                       WHY IT BACKFIRES
  ─────────────────────────────────────────────────────────────────────────
  Absolute claims           "This design is secure"       No design is
  Compliance conflation     "We're PCI-compliant so       Compliance ≠ resilience
                             we're fine"
  Missing residual risk     Listing only controls,        CISO fills the gap
                            not what they don't cover     with their own doubts
  Scope creep promises      "Yes, we can add MFA,         Scope ballooned,
                             DLP, and SIEM by Q3"         trust collapses at Q3
  Certainty about unknowns  "There are no other           Threat landscape moves;
                             attack vectors"              humility is required
```

The CISO has been burned by vendors and architects who overpromised. The fastest
way to earn credibility is to say the uncomfortable thing first: *"Here is where
this design still has risk and what the mitigation plan is."*

**4. How to structure a risk conversation**

Use this four-beat framework:

```
  1. SCOPE       What is in-scope: data types, systems, users, integrations.
                 What is explicitly out of scope.

  2. CONTROLS    Per-layer controls (see S01, defense in depth).
                 Which specific requirement each satisfies (cite the clause).

  3. RESIDUAL    What risk remains after those controls.
                 Likelihood qualitative: High / Med / Low.
                 Impact: what happens if the residual risk materialises.

  4. TREATMENT   Accept / Mitigate / Transfer / Avoid (risk treatment options).
                 If Mitigate: what further control, who owns it, by when.
```

This is the structure a CISO uses in their board report. Speaking it fluently
signals you have done their job alongside your own.

## Worked example

Meridian Bank (see `reference/running-example.md`) is deploying a new mobile
banking backend on GCP (`10.100.0.0/14`). It reads account balances from the
core banking system in HQ-DC1 (`10.10.0.0/16`) via a dedicated Cloud Interconnect
path. The CISO must approve the design before it goes to the CAB.

**The architect's brief before the CISO meeting:**

```
  SCOPE
  ─────
  In-scope:   Mobile API tier (GCP asia-south1), API Gateway, Cloud Spanner
              (account read cache), Interconnect path to HQ-DC1 core.
  In-scope:   Customer PII (name, account number) — not full card PAN.
  Out-of-scope: Core banking system itself (owned by IT head's team, separate
                project). Card PAN processing (CDE at HQ-DC1, Kata N29/S18).

  CONTROLS (mapped to PCI-DSS v4.0.1 Requirements where applicable)
  ───────────────────────────────────────────────────────────────
  Net seg     GCP Hierarchical Firewall Policy: default-deny on VPC ingress;
              only port 443 from Cloud Armor → API Gateway allowed.
              (This tier is OUT of CDE scope, so PCI Req 1.3.x — which governs
              the CDE boundary — does not apply; this is the segmentation
              control that KEEPS this tier out of scope. See N29/S18 for the
              CDE itself.)
  Req 2.2     Hardened GCP project via org policy: public IPs blocked on VMs,
              serial console disabled, uniform bucket-level access enforced.
  Crypto      TLS 1.2 minimum on all API endpoints (public-facing edge); mTLS
              on the Interconnect path into the core (see N21, S12).
              (PCI Req 4.2.1 governs strong crypto for PAN over OPEN, PUBLIC
              networks. No PAN traverses this tier, and the Interconnect is a
              PRIVATE link — so 4.2.1 is not the governing clause here. This
              encryption is org policy / defence-in-depth.)
  Req 7.2     Cloud IAM: least-privilege service accounts; no primitive roles
              (Owner/Editor) in prod; Workload Identity for GKE pods (S33).
  Req 10.2    GCP audit logs + Cloud Logging → centralised SIEM.
              Log retention: 12-month minimum (Req 10.5.1), 13 retained.
  Req 11.3    Automated CSPM scan nightly (Security Command Center Premium);
              critical findings = P1 alert, 24-hour remediation SLA.
  DPDP / RBI  All customer data remains in asia-south1 (Mumbai region);
              org policy constraints/gcp.resourceLocations enforced.

  RESIDUAL RISK
  ─────────────
  R1  Over-permissioned service account (HIGH inherent → MED residual after
      Workload Identity): if a pod is compromised, blast radius = that
      service account's scope. Monitoring: unusual API call pattern → SIEM alert.
  R2  Supply-chain dependency in API container (MED): malicious package in a
      container image. Mitigation: binary authorisation policy; only signed
      images from Artifact Registry admitted to GKE.
  R3  Insider read access to account data in SIEM logs (LOW): SOC analyst
      can see customer name + account number in log lines. Treatment: log
      masking for account numbers in pipeline; reviewed in S20 sprint.

  TREATMENT DECISIONS
  ───────────────────
  R1: Mitigate — Workload Identity in place; add VPC Service Controls perimeter
      around Cloud Spanner by end of sprint 4. Owner: platform-eng team.
  R2: Mitigate — binary authorisation already enforced. Add SCA scan to CI
      pipeline (SCA step, Kata S16). Owner: app team. By: next quarter.
  R3: Accept for now with compensating control (log masking). Owner: SecOps.
      Formal acceptance signed by CISO. Review date: 6 months.
```

Notice what is NOT in this brief:
- The words "secure," "safe," or "compliant" used as conclusions.
- Any promise to eliminate a risk the design cannot eliminate.
- Any claim about what the core banking system does or doesn't do.

**What the architect says when the CISO asks "What's the residual risk?":**

> "The highest residual risk is a compromised GKE pod using the attached service
> account to exfiltrate account read cache data from Spanner. We've scoped that
> service account to read-only on a single Spanner database, and we're adding a
> VPC Service Controls perimeter in sprint 4 which will block data from leaving
> even if the IAM is bypassed. After that control is in, I'd rate residual
> likelihood low, impact medium — the account read cache doesn't hold PAN and the
> data is already visible in the mobile app. I've asked SecOps to baseline API
> call rates so we can alert on anomalies."

That answer is credible because it: names the threat, names the control gap,
names the upcoming fix, scopes the impact honestly, and points to a detective
control even before the preventive fix lands.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Preventive guardrails | FW rule base + NAC | Org Policy + Hierarchical Firewall Policy | SCP (Service Control Policy) + NACL | (Azure: TODO) |
| Security posture scanning | Vulnerability scanner (Nessus, Qualys) | Security Command Center (Premium) | AWS Security Hub + GuardDuty | (Azure: TODO) |
| Risk register | GRC tool (Archer, MetricStream) | Risk register in GRC tool; SCC findings as input | Security Hub findings → GRC integration | (Azure: TODO) |
| Evidence for auditor | Control narratives + screenshots | SCC compliance reports; Cloud Audit Logs export | AWS Audit Manager; CloudTrail | (Azure: TODO) |
| Data residency enforcement | Physical cage + network segmentation | Org Policy `gcp.resourceLocations`; VPC SC perimeter | AWS Organizations SCP on regions; Macie | (Azure: TODO) |
| Log retention (PCI Req 10.5) | SIEM with NAS/WORM storage | Cloud Logging with locked log buckets (WORM) | CloudTrail + S3 Object Lock | (Azure: TODO) |

GCP Security Command Center Premium generates compliance-mapped findings reports
(PCI-DSS, CIS) directly, so an architect can pull an evidence package that maps
to the control set — useful for pre-audit preparation. AWS Security Hub provides
equivalent findings aggregation; choose a standards-based pack (PCI-DSS, AWS
Foundational Security Best Practices) at enrollment time.

## Do it (the exercise)

**Part A — Build a risk brief for one system [laptop / paper]**

1. Pick a system you know (real or fictional). Write the four-beat brief:
   scope → controls → residual risks → treatment decisions.
   - Name at least three controls.
   - Name at least two residual risks. For each: likelihood (H/M/L), impact
     statement, detective or compensating control.
   - Assign a treatment (Accept / Mitigate / Transfer / Avoid) and an owner.

2. Read your brief back and remove every use of "secure," "safe," or
   "compliant" as a conclusion. Replace each with a statement about the
   specific risk and the specific treatment.

**Part B — Map Meridian Bank controls to PCI-DSS v4.0.1 [laptop]**

PCI-DSS v4.0.1 is publicly available at pcisecuritystandards.org. Look up these
requirements and confirm whether the control in the worked example above is a
valid response — and, crucially, whether the requirement even APPLIES to this
out-of-scope tier. Note any gap or scoping error:

- Requirement 1.3.1 (restrict INBOUND traffic to the CDE to what is necessary)
  — note: 1.3.2 governs OUTBOUND traffic from the CDE. Is the mobile tier the
  CDE? If not, which clause actually applies?
- Requirement 4.2.1 (strong cryptography for PAN over open, public networks)
  — does any PAN traverse this tier? Is the Interconnect an open public network?
- Requirement 7.2.1 (least privilege on system components)
- Requirement 10.2.1 (audit log events)
- Requirement 10.5.1 (retain audit logs — minimum 12 months, last 3 immediately
  available)

**Part C — Practise the CISO conversation [paper / with a partner]**

Set a 10-minute timer. One person plays the CISO and asks these three questions;
the other answers without using the banned phrases:

1. "Is this design compliant with RBI guidelines?"
2. "What keeps you up at night about this architecture?"
3. "If we get breached through this system, what's the blast radius?"

After 10 minutes, swap. Notice: the discomfort of answering question 2 honestly
is the entire point. Practice makes it feel natural rather than dangerous.

## Say it back (self-check)

1. What is the difference between inherent risk, residual risk, and a control?
   Give one example of each from the Meridian Bank scenario.
2. Why does "this design is PCI-compliant" not end the CISO's concern?
3. State the four-beat risk conversation framework from memory.
4. List five forms of overpromising. Which is hardest to avoid under deadline
   pressure?
5. In the worked example, why is R3 (insider access to logs) treated as
   "Accept" rather than "Mitigate fully," and what makes that acceptable?

## Talk to the IT/security head

**Ask:**

- "What's on your risk register for this data type, and what's the current
  residual risk rating?"
  *Tells you the CISO's starting baseline; your design must move that number
  or the conversation goes nowhere.*

- "Which specific PCI-DSS / RBI requirements apply to this system, and who
  is your QSA / auditor? Are there any open findings from the last assessment?"
  *A good CISO names the requirement clause immediately. Open findings from the
  last audit tell you where the scar tissue is — design to heal those first.*

- "If our proposed controls fail simultaneously, what does the blast radius
  look like? And which detective control catches that fastest?"
  *Forces explicit discussion of residual risk and the detective layer. Most
  architects skip this question; asking it signals maturity.*

- "What's the risk acceptance process here — who signs for residual risk, and
  what's the review cadence?"
  *In FSI, risk acceptance is a formal, documented act with named owners.
  Knowing the process tells you who else to loop in and what the paper trail
  looks like for the auditor.*

- "Where do you draw the line between what you'll mitigate vs what you'll
  accept? Is there a risk appetite statement I should be designing to?"
  *The risk appetite statement (see S30) is the CISO's constitution. If one
  exists, every design decision should traceable to it. If it doesn't exist,
  that's a red flag about the organization's GRC maturity.*

**A good answer sounds like:** the CISO pulls up a specific risk register entry,
names the requirement clause by number, distinguishes inherent from residual,
knows who signed the last acceptance, and can tell you which control failed in
the last incident. They're calibrated — they won't call a low-likelihood risk
existential, and they won't dismiss a high-impact one.

**Red flags to listen for:**

- "We're compliant, so we're fine." — Compliance conflation; a mature CISO knows
  compliance is a floor. An organization with this mindset is a breach waiting
  for an auditor who asks the wrong question.
- Unable to name the specific requirements that apply. — Either the CISO
  isn't close enough to the technical controls, or the GRC process is broken.
- "We don't have a risk register / risk appetite statement." — Governance
  immaturity; your design will have no principled basis for risk acceptance
  decisions, which means they'll be made ad-hoc and reversed arbitrarily.
- Refuses to acknowledge any residual risk. — A CISO who claims zero residual
  risk is either uninformed or performing for management. Either is dangerous
  to a vendor or architect who echoes that claim — you'll own the gap.
- Signs risk acceptance but can't explain what was accepted. — The paperwork
  is theater, not governance.

## Pitfalls & war stories

**The "we're compliant" trap.** At a major Indian private bank, an architect
presented a cloud migration as "PCI-DSS compliant by design." The CISO approved
it. Eleven months later the QSA found the Cloud Spanner instance lacked CMEK
(customer-managed encryption keys) — a Requirement 3.5.1 gap that the architect
had overlooked because the GCP default encryption *sounded* sufficient. The word
"compliant" had closed down the conversation too early. The lesson: never let
compliance language substitute for walking the specific requirements.

**Residual risk left implicit.** A well-intentioned architect listed eight
controls in a design review and said nothing about what those controls didn't
cover. The CISO added six risk items to the risk register themselves — and
attributed all six to the architect's design. Having the architect surface
residual risk explicitly (as in the four-beat framework) would have let the
architect frame it, scope it, and propose mitigations. Silence transferred both
the identification and the blame.

**Scope promise creep under CISO pressure.** A CISO asked "can you add a SIEM
integration by go-live?" The architect said yes on the spot. The SIEM integration
took three months and delayed go-live. An honest answer: "Yes, I can scope that.
Give me 48 hours to confirm feasibility and calendar impact — I won't commit
timeline in this meeting." CISOs respect precision over reflexive yes.

**The PCI-DSS version trap.** Organizations often mix requirements from PCI-DSS
v3.2.1 and v4.0 in the same conversation. As of March 2024, v3.2.1 was retired;
v4.0.1 released 11 June 2024 with minor clarifications, and superseded v4.0 on
31 December 2024 (so v4.0.1 is the standard a present-day QSA assesses against;
clause numbers are identical between v4.0 and v4.0.1).
Requirements are not directly numbered between v3.2.1 and v4.x — always confirm
which version your QSA is assessing against. At Meridian Bank, the assessor uses
v4.0.1; cite those clause numbers.

**FMCG: "we're not a bank."** At Northwind, the instinct is cost pressure, not
compliance depth. But Northwind's payment terminals at ~3,000 retail points are
PCI-DSS in-scope for any card transaction. An architect who treats Northwind as
compliance-free will get a surprise from the acquiring bank's annual PCI
requirement. Map scope first, then map controls — never assume FMCG means
low-regulation.

**Conflating RBI and PCI-DSS.** Both apply to Meridian Bank but they are
different regimes. RBI IT Framework (2023 Master Directions) governs change
control, vendor access, VAPT cadence, and log retention for all systems. PCI-DSS
governs cardholder data environments specifically. A design can satisfy PCI-DSS
for the CDE and still fail RBI requirements on change-control documentation for
the surrounding infrastructure. Know which auditor is in the room.

## Going deeper (optional)

- PCI-DSS v4.0 Summary of Changes (pcisecuritystandards.org) — what changed from
  v3.2.1; notable for customized approach allowing compensating controls with
  a defined testing procedure.
- NIST SP 800-30 Rev 1 — Guide for Conducting Risk Assessments: the canonical
  methodology behind the four-beat framework above (threat source → threat event
  → likelihood → impact → risk determination → response).
- ISO 31000:2018 — Risk Management Guidelines: the vocabulary ("risk appetite,"
  "residual risk," "treatment") that CISO presentations to boards use; architects
  who speak it are immediately legible.
- Pairs with S29 (frameworks map), S30 (risk management), S38 (design-review
  playbook), and N29 (how compliance shapes the network). The full arc ends at
  S40 (capstone: defend Meridian Bank's design to a simulated CISO and auditor).

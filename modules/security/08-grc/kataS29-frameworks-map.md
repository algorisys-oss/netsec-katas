# Kata S29 — Frameworks map: NIST CSF, ISO 27001, SOC 2, CIS, PCI-DSS, RBI

> **Track:** Security · **Module:** S8 Governance, risk & compliance · **Prereqs:** S01, S28, N29 · **Time:** ~35 min
> **Tags:** `security` `compliance` `nist-csf` `iso-27001` `soc2` `pci-dss` `rbi` `cis`

## Why it matters

A CISO walks into a design review carrying four or five framework names. An IT
head at a bank mentions "RBI circular" and "PCI scope" in the same sentence. A
customer asks if you are "ISO 27001 certified" or "SOC 2 Type II compliant."
These frameworks are the shared language of regulated risk conversations — but they
*overlap, conflict, and complement* each other in ways that confuse even
experienced practitioners. An architect who can map a requirement ("encrypt data
at rest") to its framework source ("PCI-DSS v4.0 Req 3.4 / 3.5.1, also ISO 27001
A.8.24") can
hold the conversation without bluffing, spot duplication in audit prep, and
explain to an IT head why one framework does not substitute for another.

## The mental model

### The problem each framework solves

Before naming any framework, understand what question it answers:

```
  QUESTION                        FRAMEWORK THAT ANSWERS IT
  ─────────────────────────────────────────────────────────
  How do I organise my security   NIST CSF (a maturity/operating model)
  programme end to end?

  How do I prove I manage info    ISO 27001 (certifiable ISMS standard)
  security to a global standard?

  How do I assure my cloud        SOC 2 (auditor attestation for
  customers I handle their data   service organisations)
  safely?

  What specific hardening steps   CIS Controls / CIS Benchmarks
  should I take first?            (prioritised technical controls)

  How do I protect cardholder     PCI-DSS (mandated for card-scheme
  data and stay in the scheme?    participation)

  How do I satisfy the Indian     RBI IT Framework / RBI Cyber Security
  banking regulator?              Framework (mandatory for Indian banks)
```

Think of them as *operating at different altitudes*:

```
  HIGH (what you manage)      NIST CSF · ISO 27001
  ─────────────────────────────────────────────────
  MID (what you prove)        SOC 2
  ─────────────────────────────────────────────────
  LOW (what you configure)    CIS Controls / CIS Benchmarks
  ─────────────────────────────────────────────────
  MANDATORY (sector-specific) PCI-DSS · RBI
```

You implement the low layer, operate the mid layer, and report at the high layer.
Mandatory sector frameworks cut across all altitudes.

### Each framework in one paragraph

**NIST Cybersecurity Framework (CSF) 2.0** — A voluntary US framework (now
v2.0, 2024) organized into six *Functions*: Govern, Identify, Protect, Detect,
Respond, Recover. Each function contains *Categories* and *Subcategories*
(outcomes). CSF is not a checklist — it is an operating model for running a
security programme. Organisations use it for gap assessment, roadmap prioritisation,
and communication with boards. It maps to ISO 27001 controls so the two are
complementary, not competing.

**ISO/IEC 27001:2022** — An internationally certifiable standard for an
*Information Security Management System (ISMS)*. Annex A contains 93 controls
across 4 themes (Organisational, People, Physical, Technological). Certification
requires an independent audit by an accredited certification body. ISO 27001 tells
you *what system to build*; NIST CSF tells you *how to operate it*. Banks, cloud
providers, and outsourcers get certified to satisfy enterprise customers and
regulators worldwide.

**SOC 2 (Service Organisation Control 2)** — A US auditing standard (AICPA)
for *service organisations* (SaaS, cloud, BPO) that defines five *Trust Service
Criteria (TSC)*: Security, Availability, Processing Integrity, Confidentiality,
and Privacy. A SOC 2 Type I report is a point-in-time assessment; a Type II covers
controls operating over a period (typically 6–12 months) and is what enterprise
buyers require. SOC 2 is neither a certification nor a standard — it is an
*auditor attestation*. You do not "pass SOC 2"; you receive a report with an
opinion.

**CIS Controls v8 / CIS Benchmarks** — The Center for Internet Security publishes
18 CIS Controls (v8) organised into three *Implementation Groups (IGs)*: IG1
(basic hygiene, every org), IG2 (adds coverage for sensitive data), IG3 (full
controls for regulated/high-value targets). CIS Benchmarks are separate:
hardening configuration guides for specific platforms (e.g. CIS Benchmark for
Ubuntu 22.04, for AWS Foundations, for GCP). The Controls answer "do this";
the Benchmarks answer "configure it like this." Banks use the CIS AWS / GCP
Benchmarks to score their cloud landing zones.

**PCI-DSS v4.0** — A mandatory standard for any organisation that stores,
processes, or transmits cardholder data (PANs, CVVs, PINs) — enforced by card
schemes (Visa, Mastercard) via contracts, not law. 12 requirements span network
segmentation (Req 1), no vendor defaults (Req 2), data protection (Req 3–4),
access control (Req 7–8), monitoring (Req 10), and testing (Req 11). The *CDE*
(cardholder data environment) is the scope boundary — everything the architect
does to shrink the CDE reduces compliance cost. PCI-DSS v4.0 adds explicit
multi-factor authentication and TLS 1.2+ requirements that directly shape
network design. Covered with the network lens in N29.

**RBI IT Framework / RBI Cyber Security Framework** — India's Reserve Bank of
India publishes two key documents: the *Master Directions on IT Governance, Risk,
Controls and Assurance Practices (2023)* and the *Cyber Security Framework for
Banks (2016, updated iteratively)*. Together they mandate: network segmentation of
internet-facing vs core banking zones, annual VAPT, NTP synchronisation for audit
logs, role-based access control, incident reporting
to CERT-In within defined windows, and continuous monitoring. (Data-localization
expectations for Indian financial data flow from a separate RBI directive —
*Storage of Payment System Data*, 6 April 2018 — aimed at payment system
operators, not from the two governance/cyber-security documents above.) Unlike
PCI-DSS, RBI
requirements are Indian law for scheduled commercial banks — non-compliance invites
regulatory action, not just scheme delistment.

### How they relate (overlap and complement)

```
  PCI-DSS Req 10 (audit logging)
      │
      ├─ maps to ISO 27001 A.8.15 (logging)
      ├─ maps to NIST CSF DE.CM (continuous monitoring)
      ├─ maps to CIS Control 8 (audit log management)
      └─ overlaps RBI CSF Annex 1 baseline controls
         (log/SIEM) + Annex 2 (C-SOC continuous surveillance)

  ISO 27001 A.8.20 (network security)
      │
      ├─ maps to NIST CSF PR.IR (Technology Infrastructure
      │   Resilience, incl. network protection)
      ├─ maps to CIS Control 12 (network infrastructure management)
      ├─ overlaps PCI-DSS Req 1 (network segmentation)
      └─ overlaps RBI CSF Annex 1 baseline controls
         (network/security perimeter)
```

The practical takeaway: a well-run ISMS (ISO 27001) with CIS Benchmark hardening
satisfies a large fraction of PCI-DSS and RBI requirements. The gaps are the
*sector-specific* requirements (card-scheme rules, RBI circulars) that sit on top.

## Worked example

### Meridian Bank's compliance stack

Meridian Bank (see `reference/running-example.md`) is a scheduled commercial bank
in India that issues Visa/Mastercard credit cards. It therefore carries **all
five frameworks simultaneously**:

```
  FRAMEWORK       DRIVER                        SCOPE AT MERIDIAN
  ─────────────────────────────────────────────────────────────────
  RBI CSF         Legal mandate (RBI)           All IT systems
  PCI-DSS v4.0    Card-scheme contract           CDE: 10.10.20.0/24 in HQ-DC1
  ISO 27001:2022  Customer assurance / B2B       Whole org (ISMS scope)
  NIST CSF 2.0    Programme operating model      Security programme mgmt
  CIS Controls    Technical hygiene baseline     All servers + cloud (GCP/AWS)
  SOC 2 Type II   Third-party SaaS/fintech       New digital-channel GCP tenant
```

**A single control, seen through five lenses**

Scenario: the mobile-banking backend on GCP (`10.100.0.0/14`) must log every
admin action to a tamper-evident store.

| Framework | Relevant clause | Specific requirement |
|-----------|-----------------|----------------------|
| NIST CSF 2.0 | DE.CM-03 | Personnel activity and technology usage are monitored |
| ISO 27001:2022 | A.8.15 | Logs recording user activities, exceptions, faults shall be produced |
| PCI-DSS v4.0 | Req 10.2.1 | All individual user access to cardholder data logged |
| CIS Control 8 | 8.2, 8.5 | Collect audit logs; ensure logging is active on all assets |
| RBI CSF 2016 | Annex 1 (baseline controls) | Maintain audit logs / SIEM, protect them from tampering, and feed continuous surveillance (Annex 2, C-SOC) |
| SOC 2 | CC7.2 (Security TSC) | System events are monitored and anomalies identified |

One change (enable audit logging on GCP's `asia-south1` Cloud Logging for admin
activity) partially satisfies **all six** in a single stroke. This is the
efficiency an architect can surface: "we implement the control once and evidence
it against each framework's clause in our mapping document."

### Northwind's simpler stack

Northwind FMCG does not process card data in-house (it uses a PCI-compliant
payment gateway, outsourcing CDE scope). Its compliance stack is:

```
  ISO 27001         Customer and partner assurance
  NIST CSF          Internal programme model
  CIS Controls IG2  Reasonable hygiene for a mid-size manufacturer
```

No PCI-DSS scope, no RBI mandate. The architect's conversation with Northwind's
CISO is about *scope reduction* ("let the gateway own the CDE, keep Northwind
out of PCI scope") and *maturity improvement* ("move from CIS IG1 to IG2 for the
OT/IT boundary").

## Cloud / vendor mapping (when applicable)

Frameworks are framework-agnostic, but cloud providers publish evidence packages:

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Compliance evidence portal | Internal audit docs | [Compliance Reports Manager](https://cloud.google.com/security/compliance/compliance-reports-manager) | AWS Artifact | (Azure: TODO) |
| CIS Benchmark automated scoring | Manual or CIS-CAT tool | Security Command Center (CSPM) + CIS Benchmark policy | AWS Security Hub (CIS AWS Foundations) | (Azure: TODO) |
| PCI-DSS scoping tool | Network diagrams + QSA | GCP PCI-DSS Package in Compliance Reports Manager | AWS PCI DSS Package in Artifact | (Azure: TODO) |
| SOC 2 report (cloud provider's) | N/A — your audit | Google SOC 2 Type II (annual) | AWS SOC 2 Type II (annual) | (Azure: TODO) |
| NIST CSF mapping | Custom spreadsheet | Google Cloud — NIST CSF mapping guide | AWS NIST CSF quick start | (Azure: TODO) |
| ISO 27001 (cloud provider's cert) | Your ISMS cert | Google ISO 27001 cert (scope: all GCP regions) | AWS ISO 27001 cert (scope: all regions) | (Azure: TODO) |

**Key insight for architects:** cloud provider certifications cover the
*provider's* controls (physical infrastructure, hypervisor, managed services).
They do *not* cover your workloads. Under the shared-responsibility model (see
S32), you inherit the provider's compliance but must still demonstrate your own
controls (IAM config, encryption key management, app-layer logging) to a QSA or
ISO auditor. Showing an auditor "we run on GCP which is ISO 27001 certified" is
necessary but not sufficient.

## Do it (the exercise)

### Step 1 — Map a control requirement [laptop / paper]

Pick any one of these clauses and find its equivalent in two other frameworks:

- PCI-DSS v4.0 Req 8.3.6 (passwords ≥ 12 characters; changed at least every
  90 days when passwords are the sole authentication factor — not required where
  MFA or dynamic/risk-based continuous authentication is in place, per 8.3.9 / 8.6)
- ISO 27001:2022 A.8.20 (networks shall be managed, controlled and protected)
- CIS Control 5.4 (restrict administrator privileges)

Use the NIST CSF crosswalk spreadsheet (NIST provides this free at
`csrc.nist.gov/projects/cybersecurity-framework`) to map PCI-DSS or CIS Controls
to NIST CSF subcategories.

### Step 2 — Scope Meridian's PCI CDE [paper]

Using the IP plan from `reference/running-example.md`:

- CDE subnet: `10.10.20.0/24` in HQ-DC1
- Mobile backend: GCP `10.100.0.0/14`

Answer:
1. If the mobile backend passes a raw PAN to the CDE, does the GCP VPC fall
   within PCI scope?
2. If the mobile backend instead passes only a *token* (see S18), does the scope
   change?
3. What network control (see N29) is required between the mobile backend and the
   CDE regardless of whether tokenisation is used?

Expected answers:
1. Yes — any system that transmits cardholder data is in scope.
2. Yes, scope shrinks: the mobile backend only handles tokens, not PANs, so it
   can be descoped if it never touches a raw PAN.
3. A default-deny firewall at the CDE boundary (PCI-DSS Req 1.3), with only
   explicitly permitted flows allowed from `10.100.0.0/14` to `10.10.20.0/24`.

### Step 3 — Identify your client's framework stack [laptop / client-context]

For a client you work with (or a plausible scenario):

1. List every compliance framework that applies and its driver (law, contract,
   customer requirement, internal policy).
2. Identify the *most restrictive* requirement on any one control domain
   (e.g. access control, logging, encryption).
3. Flag any framework that is *unique* (adds requirements not covered by others).

This is the gap analysis an architect runs before a design review.

## Say it back (self-check)

1. NIST CSF 2.0 has six Functions — name them in order from governance through
   recovery.
2. What is the difference between a SOC 2 Type I and Type II report, and why do
   enterprise buyers require Type II?
3. A bank's cloud vendor claims "our platform is ISO 27001 certified." Does that
   mean the bank's workload on that platform is ISO 27001 compliant? Explain why.
4. What is the CDE, and how does tokenisation reduce the architect's PCI-DSS
   scope burden?
5. Name two RBI-specific requirements that have no direct equivalent in ISO 27001
   or NIST CSF.

## Talk to the IT/security head

**Ask:**

- "Which frameworks are legally or contractually mandatory for us, and which are
  voluntary?" *(separates must-have from nice-to-have; drives prioritisation)*

- "Do we have a controls-mapping document that links each framework clause to the
  actual control we operate? Who maintains it?" *(reveals GRC maturity; 'no' is
  a red flag when multiple frameworks are in play)*

- "What is the current CDE boundary? Has a QSA approved the segmentation
  architecture?" *(for PCI shops: undocumented scope is the #1 audit failure)*

- "What is our SOC 2 coverage — Security TSC only, or additional criteria? Is
  the last report available for review?" *(drives vendor due-diligence conversation)*

- "How do we handle a new RBI circular — who reads it, who translates it to
  control changes, and who validates implementation?" *(reveals whether GRC is
  a living process or a shelf document)*

**A good answer sounds like:** a named GRC function (or person at smaller orgs)
who owns a living controls-mapping spreadsheet or GRC tool (e.g. Vanta, Drata,
OneTrust, ServiceNow GRC); a known QSA relationship; and a described process for
ingesting new regulatory guidance.

**Red flags:**

- "We passed PCI last year, we're fine" — compliance is point-in-time; controls
  must operate continuously.
- "ISO 27001 covers everything" — ISO 27001 does not cover PCI card-scheme rules
  or RBI sector-specific mandates.
- Inability to name the CDE boundary or say who the QSA is.
- "The cloud is compliant so we are" — conflates provider certification with
  workload compliance under the shared-responsibility model.
- No controls-mapping document — means framework obligations are tracked in
  people's heads and will be lost at the next org change.

## Pitfalls & war stories

**The scope-creep CDE trap.** At a bank running a microservices platform on GCP,
the team added a logging sidecar that forwarded raw request bodies (containing
PANs) to a central log store outside the CDE subnet. Overnight, the log store and
its entire VPC came into PCI scope. The fix — tokenise before logging — was
architecturally simple but required a rewrite. The architect who asks "does any
system log or transit raw PANs?" before finalising the design avoids this.

**Treating SOC 2 as a security guarantee.** A SOC 2 Type II report with an
unqualified opinion means the auditor found that the *described* controls operated
effectively during the audit period. It does not mean the system has no
vulnerabilities — the scope of controls tested is defined by the service
organisation, not the auditor. Architects should read the SOC 2 report's scope
and description section, not just the opinion.

**Framework paralysis at FMCGs.** Northwind inherited three sets of ISO 27001
scope documents from acquired companies, none of which agreed on scope boundaries.
The GRC team spent months reconciling them instead of improving controls. The
lesson: harmonise scope before harmonising policies. A single ISMS scope
definition is a prerequisite for meaningful gap analysis.

**RBI misread as aspirational.** Indian architects sometimes treat RBI circulars
as guidelines ("we'll get to it"). They are legally binding directions — the RBI
IT Master Directions 2023 specifically state that failure to comply attracts
penalties under the Banking Regulation Act. Treat RBI requirements with the same
non-negotiability as PCI-DSS Req 1.

**Confusing CIS Benchmark compliance with CIS Controls compliance.** A system can
pass a CIS Benchmark for Ubuntu (hardening scan) while the organisation fails CIS
Control 1 (asset inventory). The Benchmark covers the host; the Controls cover the
programme. Both matter; neither substitutes for the other.

## Going deeper (optional)

- NIST CSF 2.0 full text and crosswalk spreadsheets:
  `https://www.nist.gov/cyberframework`
- ISO/IEC 27001:2022 — available from ISO; Annex A control list is widely
  summarised in free resources.
- PCI-DSS v4.0 — PCI Security Standards Council:
  `https://www.pcisecuritystandards.org/`
- CIS Controls v8 and CIS Benchmarks (free download):
  `https://www.cisecurity.org/`
- RBI Master Directions on IT Governance (2023):
  `https://rbi.org.in/` (search "Master Directions IT Governance 2023")
- RBI Cyber Security Framework for Banks (2016):
  `https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx?Id=10435`
- Pairs with: S01 (security mindset), N29 (PCI-DSS/RBI network lens), S18
  (tokenisation and CDE scoping), S30 (risk registers), S32 (shared-responsibility
  model in cloud).

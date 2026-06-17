# Kata S31 — Third-party / supply-chain risk & audits

> **Track:** Security · **Module:** S8 Governance, risk & compliance · **Prereqs:** S29, S30, S01 · **Time:** ~35 min
> **Tags:** `third-party-risk` `supply-chain` `audit` `compliance` `risk-management` `fsi` `security` `sbom`

## Why it matters

Every organisation is only as secure as its weakest vendor. When Meridian Bank
connects to a payment-processing gateway, a core-banking software vendor, or a
cloud-hosted AML platform, it inherits whatever risk that vendor carries. The
2020 SolarWinds supply-chain compromise and the 2023 MOVEit file-transfer
breach each impacted hundreds of financial institutions — not because those
banks wrote bad code, but because they trusted software and services built by
others. Regulators know this: RBI, PCI-DSS, and DPDP all impose explicit
third-party risk management (TPRM) obligations. As an architect, you specify
which external services, APIs, and libraries your design depends on — so you
*own* the question "how do we assure that dependency?" even if a GRC team writes
the questionnaire.

## The mental model

**1. The dependency chain**

Your system depends on vendors, who depend on their vendors — this is the
supply chain. Risk lives at every link, not just the one you directly contract:

```
  [Meridian Bank]
        │  contracts / integrates
        ▼
  [Payment Gateway (Vendor A)]
        │  depends on
        ▼
  [Cloud hosting (Vendor B)] ── [Open-source library (Vendor C)]
        │  depends on
        ▼
  [Hardware supplier (Vendor D)]
```

A compromise at any level propagates upward. The 2021 Log4Shell vulnerability
lived at the equivalent of "Vendor C" — a library embedded in hundreds of
enterprise products.

**2. Three categories of third-party risk**

```
  CATEGORY           EXAMPLES                       PRIMARY CONTROLS
  ─────────────────────────────────────────────────────────────────
  Vendor/service     SaaS, outsourced SOC,          TPRM questionnaire,
  risk               managed network provider        contract clauses, audits

  Software supply    Open-source libs, commercial   SCA, SBOM, code signing,
  chain risk         software, SDK dependencies     provenance checks

  Integration        API calls, file transfers,     mTLS, API keys, input
  risk               data sharing                   validation, scoping
```

**3. The TPRM (Third-Party Risk Management) lifecycle**

```
  ┌───────────────────────────────────────────────────────────┐
  │  1. DISCOVER       Inventory who and what you depend on   │
  │  2. ASSESS         Classify by risk tier; evaluate posture│
  │  3. CONTRACT       SLAs, right-to-audit, breach notice    │
  │  4. MONITOR        Continuous: questionnaires, alerts     │
  │  5. OFFBOARD       Revoke access, recover data on exit    │
  └───────────────────────────────────────────────────────────┘
```

Step 1 is almost always underperformed. Architects know their direct
integrations; no one has a complete list of the transitive library chain
embedded in every service. That gap is exactly what supply-chain attackers
exploit.

**4. Risk tiering**

Not every vendor is a Tier-1 risk. A tiering model saves audit effort:

```
  TIER 1 — Critical   Vendor can access or process regulated data,
                       or a failure causes Meridian Bank to be unable
                       to operate (core banking, HSM vendor, Swift)

  TIER 2 — High       Vendor hosts data but cannot directly transact;
                       failure is recoverable within RTO (cloud providers,
                       managed SIEM, DR-site colocation)

  Tier 3 — Standard   Vendor provides tooling, no data access;
                       failure is inconvenient (development SaaS, CRM)
```

Tier 1 vendors get on-site audits or evidence of ISO 27001 / SOC 2 Type II.
Tier 3 gets a self-assessment questionnaire. The boundary between tiers is
an architecture decision — your design directly affects it.

**5. Software supply-chain specifics**

```
  Open-source        SCA tool scans your dependency tree for known CVEs
  dependencies:      (e.g., OWASP Dependency-Check, Snyk, FOSSA)

  SBOM:              Software Bill of Materials — a machine-readable list of
                     every component + version; mandated for US federal
                     software (EO 14028, 2021); RBI's IT/outsourcing Master
                     Directions (2023) increasingly drive expectations for
                     assurance over critical banking software

  Code signing:      The build pipeline signs artefacts (container images,
                     JARs) with a private key so the deployment platform
                     can verify the artefact was not tampered with after build

  Dependency         Pin versions, lock hashes, scan on every pull request,
  hygiene:           do not pull untested packages from public registries
                     into production at deploy time
```

Pairs with S16 (secure SDLC / SCA / SBOM) and S14 (SAST/DAST in the
pipeline).

## Worked example

### Meridian Bank — payment-processing integration

Meridian Bank's card-payment flow depends on a third-party payment gateway
(call it "PayCo") reachable over the internet. The CDE lives at
`10.10.20.0/24` (HQ-DC1). PayCo's published API endpoint is
`api.payco.example` (a public hostname resolving to a public IP).

```
  HQ-DC1 CDE          API call (mTLS)           PayCo
  10.10.20.0/24  ──────────────────────────→  api.payco.example
        │
        │  PCI-DSS Req 12.8 requires:
        │   • Written agreement with PayCo
        │   • Annual review of PayCo's PCI compliance status
        │   • Monitoring of PayCo's compliance year-round
        │   • Breach notification clause (≤ 72 h to Meridian)
        └──────────────────────────────────────────────────────
```

What the architect controls:

| Design decision | Risk addressed |
|-----------------|----------------|
| mTLS to PayCo's API endpoint (see N21, S15) | Prevents MITM; PayCo can't be impersonated |
| Pin PayCo's certificate or CA, alert on changes | Detects certificate substitution / BGP hijack |
| Firewall rule: only the CDE subnet can reach `api.payco.example` port 443; block other egress | Limits blast radius; attacker on non-CDE host can't pivot to PayCo |
| Log every call to the PayCo API with response code | Audit trail; anomaly detection (sudden spike = fraud or compromise) |
| Document PayCo as Tier-1 vendor in risk register | Triggers annual audit, contract review, right-to-audit clause |

The SBOM concern also applies: any open-source SDK Meridian uses to call
PayCo's API inherits vulnerabilities from that library. The Java HTTP client
library or Node.js SDK must appear in Meridian's SBOM and be scanned by SCA
(Dependency-Check, Snyk) on every build.

### Northwind FMCG — logistics SaaS dependency

Northwind's 12 distribution centres use a cloud-hosted WMS (Warehouse
Management System) SaaS from a third party. The SaaS vendor has access to
order data and can initiate stock-movement transactions.

Northwind's risk exposure:
- WMS vendor suffers ransomware → all 12 DC operations stop (availability risk).
- WMS vendor is breached → Northwind's supplier and customer data leaks (confidentiality risk).
- WMS vendor is acquired → SLAs change; data leaves the country (data-residency risk).

Northwind classifies the WMS as Tier 1, requires SOC 2 Type II evidence
annually, and insists on a contractual right to audit. The integration uses an
API key (not admin credentials) scoped to the minimum operations needed — least
privilege at the API level (see S07).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| **Vendor inventory** | Spreadsheet / GRC tool (ServiceNow, Archer) | Security Command Center asset inventory + external data connectors | AWS Security Hub + Trusted Advisor; 3rd-party GRC tools | (Azure: TODO) |
| **SBOM generation** | OWASP Dependency-Check, Syft, Grype in CI/CD pipeline | Cloud Build + Artifact Registry vulnerability scanning | AWS Inspector (SBOMs from container images) + CodeArtifact | (Azure: TODO) |
| **Container image signing** | Cosign + Sigstore Rekor (in-house) | GCP Binary Authorization: policies allow only signed images from Artifact Registry to run on GKE | AWS Signer + ECR image scanning; container trust via OPA Gatekeeper | (Azure: TODO) |
| **API access scoping** | API gateway with per-client OAuth2 scopes | Apigee / API Gateway with OAuth2 + service account per integration | API Gateway + IAM resource-based policies + Secrets Manager | (Azure: TODO) |
| **Posture alerts on new 3P access** | SIEM rule: alert on new privileged service account creation | Security Command Center finding + IAM Recommender | GuardDuty + IAM Access Analyzer | (Azure: TODO) |
| **Right-to-audit evidence** | On-site audit; SOC 2 Type II report | Google's Transparency Report + compliance reports (ISO 27001, PCI-DSS attestation); Customer-submitted audit evidence via Compliance Reports Manager | AWS Artifact (Compliance reports portal) | (Azure: TODO) |

Note on cloud providers as third parties: GCP, AWS, and Azure are themselves
Tier-1 third parties. Your evidence of *their* controls is their compliance
reports (ISO 27001, SOC 2, PCI-DSS AoC) available in GCP Compliance Reports
Manager and AWS Artifact — not an on-site visit.

## Do it (the exercise)

**Part A — Vendor inventory [laptop / paper]**

1. Take a real or hypothetical system (or Meridian Bank's mobile-banking
   backend). List every external service, API, or library it depends on.
   Include transitive dependencies you know of (payment SDK, logging library,
   cloud provider). Classify each as Tier 1 / 2 / 3 using the model above.

2. For your Tier-1 vendor, write one paragraph of the contractual clause you
   would require:
   - SLA (availability %, RTO)
   - Breach notification (within how many hours?)
   - Right-to-audit (annual; on 30-day notice?)
   - Data-return/destruction on contract exit

**Part B — SBOM scan [laptop]**

If you have a project with a `package.json`, `pom.xml`, `requirements.txt`, or
`go.mod`, run:

```bash
# Install Syft (SBOM generator) — macOS/Linux
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

# Generate an SBOM in SPDX JSON format from the current directory
syft dir:. -o spdx-json > sbom.spdx.json

# Scan the SBOM for known CVEs with Grype
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin
grype sbom:sbom.spdx.json
```

Read the output: for each CVE listed, note severity and whether a fixed
version is available. This is what a security team's SCA gate blocks on in CI.

**Part C — API scope audit [laptop]**

Look at an API key or service account your team uses to call a third-party
service. Answer:

- What permissions does it have? Is it broader than the integration needs?
- Is it rotated on a schedule? Where is it stored? (Secret manager, `.env`
  file in git, hardcoded in code?)
- Who else has access to it?

Hardcoded credentials in git are a Tier-1 supply-chain finding in a PCI or
RBI audit. If you find one, remediate it immediately (rotate the key, clean
the git history with `git filter-repo`).

## Say it back (self-check)

1. Name the three categories of third-party risk and one concrete control for each.
2. What is a Tier-1 vendor, and what evidence do you require from them annually?
3. What is an SBOM and why does it matter to a security audit?
4. Why is a cloud provider itself a third party, and what is your primary evidence
   of their security controls?
5. A vendor you depend on is acquired and moves its servers to a different country.
   Which contracts clause and which design controls let you respond?

## Talk to the IT/security head

**Ask:**

- "Do we have a complete inventory of our Tier-1 and Tier-2 vendors, including
  who owns each relationship and when we last reviewed their controls?"
  *Surfaces whether TPRM is a real process or a spreadsheet from 2019.*

- "For our most critical software vendor, do we have their current SOC 2 Type II
  or ISO 27001 certificate, and does it cover the specific services we rely on?"
  *Scope matters — a vendor's cert may cover their US data centres but not the
  Indian subsidiary processing Meridian's data.*

- "What is our contractual breach-notification SLA with each Tier-1 vendor, and
  when did we last test that they could actually meet it?"
  *72 hours is GDPR's notification threshold (DPDP's is far longer — see S19);
  many vendor contracts say 'reasonable notice' — which is not a compliance
  answer.*

- "Do we generate an SBOM from our own builds, and do we scan it for CVEs in the
  CI/CD pipeline before we release?"
  *For architects proposing new services: if the answer is no, flag it as a
  risk register item.*

- "If this vendor went offline tonight, what is our fallback, and is it tested?"
  *Availability risk is often not thought through until a vendor has an outage.*

**A good answer sounds like:** a named GRC tool or process with a current
vendor list, tier classifications reviewed in the last 12 months, evidence
from Tier-1 vendors in hand, and contractual clauses with specific timelines.
For software supply chain: CI/CD gates that block on critical CVEs, images
signed and policy enforced in production.

**Red flags:**

- "We only audit vendors when the contract comes up for renewal" — annual or
  continuous monitoring is the regulatory expectation.
- No inventory beyond direct contracts (misses embedded library risk).
- SOC 2 report is Type I (a point-in-time snapshot) not Type II (operating
  effectiveness over 6–12 months) — a common substitution.
- Cloud provider treated as inherently trusted without reviewing their AoC or
  shared-responsibility boundaries (see S32 for cloud shared responsibility).
- Breach-notification clause says "reasonable time" rather than a specific
  number of hours.

## Pitfalls & war stories

**"We don't control the vendor's code."** True, but you control whether you
run it, what data you expose to it, and whether you have compensating controls
(network segmentation, read-only API scope, monitoring). Architects who
shrug at vendor security own the consequences when it fails.

**Scope creep in vendor certifications.** A vendor's ISO 27001 certificate
covers their HQ and primary UK data centre. You just learned they process your
Indian customer data from a newly acquired Chennai office. The certificate
doesn't cover Chennai. An auditor will ask.

**The transitive library trap.** Meridian Bank's Java payment SDK was version-
pinned to a library version with a critical CVE. No one noticed because the
SDK was "just a dependency" not owned by the security team. An SCA scan in CI
would have caught it before it reached production. After a vendor-disclosed
incident, remediating it in 3 hours under regulator scrutiny is considerably
worse than a 15-minute pipeline gate.

**Offboarding neglect (FSI-specific).** A former managed-security provider
retained a read-only API key for Meridian's SIEM for six months after the
contract ended. No one revoked it because no one had an offboarding checklist.
Offboarding is step 5 of TPRM for a reason.

**Northwind M&A scenario.** After acquiring Eastfield Foods (see
`reference/running-example.md` and N11), Northwind inherited Eastfield's
WMS vendor. Eastfield had no TPRM process. Northwind discovered — during their
next ISO 27001 surveillance audit — that Eastfield's WMS vendor had not renewed their SOC 2
in 18 months. The vendor was quietly dropped, causing a 6-week logistics
disruption while a replacement was onboarded. Inherit a company, inherit
their third-party risk.

## Going deeper (optional)

- **PCI-DSS v4.0 Requirement 12.8** — explicit third-party service provider
  (TPSP) obligations: written acknowledgement of PCI scope, annual compliance
  review, monitoring throughout the year.
- **RBI Master Directions on IT Governance, Risk, Controls and Assurance
  Practices (2023)** — the IT services management / outsourcing provisions
  cover third-party risk; mandate right-to-audit, country-of-data, and
  board-level oversight of critical vendor relationships.
- **NIST SP 800-161r1** — NIST Cybersecurity Supply Chain Risk Management
  Practices for Systems and Organizations; the framework reference for TPRM.
- **CISA SBOM resources** — `cisa.gov/sbom` collects the US government's
  evolving guidance on SBOM formats (SPDX, CycloneDX) and minimum elements.
- **Sigstore / Cosign** — open-source toolchain for keyless code signing and
  supply-chain artefact verification; used natively in GCP Binary Authorization.
- Pairs with S16 (software supply chain, SBOM in the pipeline), S14
  (SAST/DAST), S30 (risk registers and treatment), and S32 (cloud
  shared-responsibility, cloud providers as third parties).

# Kata S14 — Secure SDLC: SAST, DAST, SCA, threat modeling in the pipeline

> **Track:** Security · **Module:** S3 Application & API security · **Prereqs:** S01, S03, S13 · **Time:** ~40 min
> **Tags:** `secure-sdlc` `sast` `dast` `sca` `supply-chain` `sbom` `security` `fsi`

## Why it matters

A vulnerability found in production costs roughly 30× more to fix than one caught
during design, and in a bank the ratio is higher still — a post-deploy hotfix in a
PCI-scoped system triggers change-control, regression testing, CISO sign-off, and
potentially a notification to the regulator. Yet most architects treat security as a
gate at the end of the release cycle, which is exactly when it creates maximum
friction and minimum coverage. The Secure SDLC moves security left — into code
review, CI pipeline, and design — so risk is eliminated at the cheapest possible
point. When the CISO says "we need DevSecOps," this kata is the technical substance
behind that phrase.

## The mental model

**The four tools and where they live in the pipeline:**

```
PHASE       ACTIVITY          TOOL                WHAT IT FINDS
─────────────────────────────────────────────────────────────────
Design      Threat modeling   STRIDE               logic flaws, missing
            (see S03)         (informed by         controls, trust boundary
                              MITRE ATT&CK)        gaps — before code is written
─────────────────────────────────────────────────────────────────
Code / PR   Static analysis   SAST                 insecure code patterns:
                                                    SQLi, hard-coded secrets,
                                                    unsafe deserialization,
                                                    path traversal — in the diff
─────────────────────────────────────────────────────────────────
Build       Dependency scan   SCA                  known CVEs in third-party
                                                    libraries (npm, Maven, pip…)
                                                    and license policy violations
─────────────────────────────────────────────────────────────────
Test / QA   Dynamic analysis  DAST                 runtime flaws: injection,
                                                    broken auth, insecure headers
                                                    — the app must be running
─────────────────────────────────────────────────────────────────
Release     Secret scanning   secrets detector     API keys, PATs, passwords
            SBOM generation   CycloneDX/SPDX       committed to source control
─────────────────────────────────────────────────────────────────
Production  IAST / RASP*      runtime agent        flaws visible only under real
            (*optional)                            traffic patterns
```

**First principles — why each tool is necessary but not sufficient:**

```
  SAST alone  ─── misses runtime issues (auth bypass, race conditions)
  DAST alone  ─── misses code-level bugs the app doesn't expose via HTTP
  SCA alone   ─── misses your own bad code entirely
  All three   ─── still misses design-level logic flaws → need threat modeling
```

The toolchain forms a **defence-in-depth** (see S01) stack for the development
process. No single tool covers the attack surface. The order matters: catching a
CVE in a dependency at build time is better than catching it in production via an
incident.

**Severity triage — not all findings are equal:**

CVSS (Common Vulnerability Scoring System) scores findings 0–10:

```
  Critical  9.0–10.0   fix before merge (block the PR)
  High      7.0–8.9    fix in this sprint
  Medium    4.0–6.9    track and schedule
  Low       0.1–3.9    backlog; fix at next refactor
  Info      0.0        hygiene, review at will
```

In an FSI context: any Critical or High touching the CDE is treated as if it were
Critical regardless of score — the compliance risk multiplier applies.

**SBOM — the bill of materials analogy:**

A Software Bill of Materials (SBOM) is the machine-readable inventory of every
component in a release: your code + all direct and transitive dependencies + their
versions + their licenses. Think of it as the component manifest a car manufacturer
files. In regulated industries it is increasingly mandatory (US Executive Order
14028, RBI's emerging supply-chain guidance) because an attacker who knows what
libraries you ship can search the CVE database for you.

## Worked example

Meridian Bank's mobile banking backend — a Spring Boot (Java) API running in GCP
on Cloud Run, reading balances from the core system at `10.10.0.0/16` (HQ-DC1)
via a private interconnect.

**Sprint 34: new "pay-anyone" transfer endpoint**

```
Developer pushes a branch:  feature/pay-anyone-v2
```

The pipeline executes in this order:

```
Step 1 — Secret scanning (pre-commit hook + CI)
  Tool: truffleHog / git-secrets
  Finds: developer accidentally committed a GCP service-account key JSON
         in a test fixture.  → PR blocked immediately.

Step 2 — SAST (CI, on every PR diff)
  Tool: Semgrep (OSS rule set, Java/Spring)
  Finds: the transfer amount is concatenated into a JDBC query string:
         String sql = "SELECT * FROM accounts WHERE id='" + accountId + "'";
         ↑ classic SQL injection (OWASP A03:2021)
  Severity: Critical  → PR blocked.

Step 3 — SCA (build step, runs after compile)
  Tool: OWASP Dependency-Check (Maven plugin)
  Finds: commons-collections 3.2.1  →  CVE-2015-7501  (~9.8, Red Hat/GHSA Critical)
         spring-core 5.3.25          →  CVE-2023-20861 (CVSS ~6.5 NVD, SpEL DoS,
                                          score varies by feed, fixed in 5.3.26)
  Action: commons-collections flagged Critical → must upgrade before deploy.
          spring-core flagged Medium → scheduled for next sprint.

Step 4 — DAST (QA/staging environment, not production)
  Tool: OWASP ZAP in API-scan mode, fed the OpenAPI spec.
  Target: https://mobile-staging.meridian.internal/api/v2/transfers
  Finds: Missing "Content-Security-Policy" header → Low (informational in API)
         Transfer endpoint returns stack trace on 500 → Medium
         No rate limiting on POST /transfers → High (see S15 for API controls)
  Stack trace exposes: Java version, Spring Boot 3.x, internal package paths.
  Action: suppress stack traces in error handler; add CSP; track rate limiting.

Step 5 — SBOM generation (release step)
  Tool: CycloneDX Maven Plugin  →  produces meridian-mobile-backend-34.cdx.json
  Artefact stored in: Artifact Registry (GCP) alongside the container image.
  Used by: security team to audit licenses (GPL contamination risk),
           ops team to triage future CVEs without re-scanning the code.
```

After fixes, the pipeline green-lights the PR. The CISO's dashboard shows:
- 0 open Critical/High in the release candidate.
- SBOM filed, license policy clean (no GPL in production JAR).
- Threat model reviewed (S03) at story-kickoff — design-level SQL injection risk
  was already caught at design; the SAST finding was a developer lapse, not a
  design gap.

**Numbers to remember:**

| Fact | Value |
|------|-------|
| Cost to fix a bug: in design | ~$80 |
| Cost to fix a bug: in production (FSI, change control) | ~$7,500+ |
| Commons-collections CVE-2015-7501 CVSS | ~9.8 (score varies by feed) |
| OWASP ZAP default active-scan threads | 5 (configurable) |
| SBOM formats (main) | CycloneDX (JSON/XML), SPDX |

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Secret scanning | git-secrets pre-commit hook; Vault | Cloud Build + Secret Manager; Security Command Center secret findings | CodeGuru Detector (secrets); CodeCommit + AWS Secrets Manager | (Azure: TODO) |
| SAST in CI | Semgrep, SonarQube, Checkmarx | Cloud Build steps running Semgrep / SonarQube CE | CodeGuru Reviewer (Java, Python); or Semgrep in CodePipeline | (Azure: TODO) |
| SCA / dependency scanning | OWASP Dependency-Check, Snyk, Black Duck | Artifact Registry Vulnerability Scanning (Container Analysis API); Snyk GCP integration | Amazon Inspector (ECR image scanning); AWS CodeGuru + Snyk | (Azure: TODO) |
| DAST | OWASP ZAP, Burp Suite Enterprise | Cloud Build step + ZAP; no GCP-native DAST (use OWASP ZAP) | No AWS-native DAST; use OWASP ZAP or PortSwigger in CodePipeline | (Azure: TODO) |
| SBOM generation | CycloneDX / SPDX tooling (Maven, npm, Syft) | Artifact Registry stores SBOMs; GCP Cloud Build generates via plugin | Amazon Inspector SBOM export; AWS Signer for provenance | (Azure: TODO) |
| Policy enforcement / build gates | SonarQube Quality Gates; custom scripts | Cloud Build approval gates; Binary Authorization for container images | AWS CodePipeline approval actions; ECR image signing (Notation) | (Azure: TODO) |
| Runtime protection (RASP) | Contrast Security, Sqreen | Runs as Cloud Run / GKE sidecar/agent | Runs on ECS/EKS container | (Azure: TODO) |

**GCP-specific: Binary Authorization**
GCP Binary Authorization enforces a policy that only container images signed by
a trusted Cloud KMS key (or Attestor) can be deployed to GKE or Cloud Run. This
closes the supply-chain gap between a passed CI pipeline and what actually runs.
AWS equivalent: ECR image signing with AWS Signer + Notation.

## Do it (the exercise)

**Part 1 — SAST, hands-on** [laptop]

1. Install Semgrep (open-source, no account needed):
   ```bash
   pip install semgrep          # or: brew install semgrep
   semgrep --version
   ```

2. Create a deliberately vulnerable Java snippet to scan:
   ```bash
   mkdir -p /tmp/vuln-demo/src && cat > /tmp/vuln-demo/src/Transfer.java << 'EOF'
   import java.sql.*;
   public class Transfer {
       public void execute(Connection conn, String accountId) throws SQLException {
           // BUG: SQL injection — do not ship this
           String sql = "SELECT balance FROM accounts WHERE id='" + accountId + "'";
           Statement stmt = conn.createStatement();
           ResultSet rs = stmt.executeQuery(sql);
       }
       private static final String SECRET = "ghp_aBcD1234EFGH5678ijkl";  // BUG: hardcoded secret
   }
   EOF
   ```

3. Run SAST:
   ```bash
   semgrep --config "p/java" /tmp/vuln-demo/src/Transfer.java
   ```
   You should see findings for SQL concatenation (sqli) and the hardcoded secret
   (or a similar token pattern). Note the rule ID and severity Semgrep reports.

**Part 2 — SCA, hands-on** [laptop]

4. Create a minimal Maven POM referencing a known-vulnerable dependency:
   ```bash
   cat > /tmp/vuln-demo/pom.xml << 'EOF'
   <project xmlns="http://maven.apache.org/POM/4.0.0"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
            http://maven.apache.org/xsd/maven-4.0.0.xsd">
     <modelVersion>4.0.0</modelVersion>
     <groupId>com.meridian</groupId>
     <artifactId>mobile-backend</artifactId>
     <version>1.0-SNAPSHOT</version>
     <dependencies>
       <dependency>
         <groupId>commons-collections</groupId>
         <artifactId>commons-collections</artifactId>
         <version>3.2.1</version>   <!-- CVE-2015-7501, CVSS ~9.8 (score varies by feed) -->
       </dependency>
     </dependencies>
   </project>
   EOF
   ```

5. Run OWASP Dependency-Check (requires Java, ~200 MB NVD download on first run):
   ```bash
   # Download the CLI if not installed:
   # https://github.com/jeremylong/DependencyCheck/releases
   dependency-check.sh --project meridian-mobile --scan /tmp/vuln-demo \
     --format HTML --out /tmp/vuln-demo/dc-report
   # Open /tmp/vuln-demo/dc-report/dependency-check-report.html
   ```
   Alternatively use Snyk CLI (free tier):
   ```bash
   npm install -g snyk
   snyk test --file=/tmp/vuln-demo/pom.xml   # Snyk infers Maven from pom.xml
   ```
   Confirm: commons-collections 3.2.1 flagged as Critical / CVE-2015-7501.

**Part 3 — DAST, against a safe target** [laptop]

6. Install OWASP ZAP (desktop or CLI: https://www.zaproxy.org/download/):
   ```bash
   # ZAP docker image (quickest on most laptops):
   docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
     -t https://juice-shop.herokuapp.com -I
   # juice-shop is OWASP's intentionally vulnerable demo app — safe to scan
   ```
   Note the findings categories (Missing headers, XSS, etc.) and their risk level.
   Do NOT run an active scan against any system you do not own.

**Part 4 — Pipeline design exercise** [paper/whiteboard]

7. For Meridian Bank's mobile backend, draw the CI/CD pipeline stages (code push
   → PR → build → test → deploy) and mark at which stage each tool fires:
   - Secret scanner
   - SAST
   - SCA
   - DAST
   - SBOM generation
   - Binary Authorization (GCP) policy check
   
   Mark which findings **block the pipeline** (Critical/High) vs **log and track**
   (Medium/Low). This is the policy conversation you will have with the CISO.

## Say it back (self-check)

1. Name the four main tools in a Secure SDLC pipeline, and for each: what type
   of flaw does it find, and at which stage does it run?
2. Why is SAST not enough on its own, and what does DAST catch that SAST misses?
3. What is an SBOM, and why does a bank's CISO care about it?
4. At what CVSS threshold would you block a PR in a PCI-scoped system, and what
   would you do with Medium findings?
5. What is Binary Authorization (or ECR image signing) and what supply-chain risk
   does it close?

## Talk to the IT/security head

**Ask:**
- "At which stage does your CI/CD pipeline run security scanning — and which
  findings actually block a build?" *(reveals whether scanning is cosmetic or
  enforced; no blocking policy = theatre)*
- "Do you have an SCA tool that scans transitive dependencies, not just direct
  ones?" *(transitive = indirect dependencies; 60–80% of CVEs hide there)*
- "Are you generating SBOMs per release, and where are they stored so we can
  triage a future CVE against your inventory?"
- "What is your mean time to patch a Critical CVE in production, and how does that
  compare to your SLA with the regulator?" *(RBI expects documented patch timelines
  and evidence; 'we patch when we get to it' is a finding)*
- "Has your pipeline been validated end-to-end — i.e. can a developer bypass the
  scanning by pushing directly to main or creating a release from a branch that
  never hit CI?"

**A good answer sounds like:** "SAST and SCA run on every PR and block the merge on
Critical/High. DAST runs nightly against staging. SBOMs are generated at release and
stored alongside the container image in Artifact Registry. Our SLA for Critical CVEs
is 7 days; we report exceptions to the risk register."

**Red flags to listen for:**
- "We scan but it's advisory." → scanning with no enforcement is noise management,
  not risk reduction.
- "We scan direct dependencies." → transitive CVEs (like log4shell) hide in indirect
  pulls and are the ones that made headlines.
- "We do a pen test every quarter." → annual/quarterly DAST does not substitute for
  continuous pipeline scanning; it finds what was already there for months.
- "The pipeline can be bypassed for urgent releases." → emergency bypass paths are
  the paths attackers and insider threats use.

## Pitfalls & war stories

**"We have SonarQube" ≠ secure pipeline.** SonarQube defaults focus on code quality
(complexity, duplication). Security rule sets must be explicitly enabled. At many
banks the tool is installed, dashboards are green, and SQLi rule sets are off.

**Transitive dependency blindspot.** When log4shell (CVE-2021-44228, CVSS 10.0)
dropped in December 2021, teams that only scanned their `pom.xml` direct dependencies
missed it — log4j-core was pulled in as a transitive dependency of Elasticsearch and
Kafka. An SCA tool must resolve the full dependency tree.

**DAST against production.** An enthusiastic developer points ZAP's active scanner
at the live banking API instead of staging. ZAP fires thousands of requests per
second including SQL injection and path traversal probes. The WAF (see S13) triggers
a DDoS-style block; the CISO gets a 2 a.m. page. The rule: DAST runs only against
staging/test environments with a dedicated test dataset — never production.

**Secret sprawl in Northwind.** Post-M&A, Northwind inherited three codebases
from Eastfield Foods. Secret scanning on the consolidated repo found 47 hardcoded API
keys (AWS access keys, ERP passwords) committed years earlier. Several were still
valid. The cost of rotating them after discovery was 10× what it would have been with
a pre-commit hook in place from the start. Lesson: add secret scanning retroactively
to legacy repos on day one of M&A integration.

**SBOM ≠ compliance paperwork.** A Meridian Bank supplier delivered a signed SBOM
with their software package. Six months later, OpenSSL CVE-2022-3786 dropped. The
security team cross-referenced the SBOM inventory, identified exactly which supplier
package was affected, and issued a targeted patch request in hours rather than
asking every vendor to self-certify over three weeks.

**Binary Authorization bypass.** Meridian's platform team enforced Binary
Authorization on GKE — only images signed by the release pipeline key could run. A
developer discovered they could push a Docker image to a personal public registry and
reference it via an `imagePullPolicy: Always` override in a namespace that lacked the
policy. Lesson: enforce Binary Authorization at the organisation/folder scope via a
GCP Organization Policy constraint requiring Binary Authorization, applied at the
folder/organization scope, and audit namespace-level policy exceptions weekly.

## Going deeper (optional)

- **OWASP SAMM** (Software Assurance Maturity Model) — the maturity framework for
  measuring and improving a secure SDLC programme; useful when the CISO asks "where
  do we sit?"  https://owaspsamm.org
- **NIST SP 800-218** — Secure Software Development Framework (SSDF); the US NIST
  guidance that underpins US EO 14028 and is increasingly referenced in FSI audit
  frameworks.
- **OWASP Dependency-Check** docs — https://jeremylong.github.io/DependencyCheck/
- **Semgrep registry** — public rule library: https://semgrep.dev/r
- **CycloneDX SBOM standard** — https://cyclonedx.org/specification/overview/
- **SPDX SBOM standard** (Linux Foundation) — https://spdx.dev/specifications/
- **GCP Binary Authorization** — https://cloud.google.com/binary-authorization/docs
- **AWS ECR image scanning** — https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html
- Pairs with **S03** (threat modeling), **S13** (OWASP Top 10 for architects),
  **S15** (API security), **S16** (supply chain & SBOM in depth).

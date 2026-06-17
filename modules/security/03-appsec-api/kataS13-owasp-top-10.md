# Kata S13 — OWASP Top 10 for architects

> **Track:** Security · **Module:** S3 Application & API security · **Prereqs:** S01, S03, S04 · **Time:** ~40 min
> **Tags:** `owasp` `security` `l7-application` `api-security` `waf` `first-principles` `fsi` `meridian-bank`

## Why it matters

The OWASP Top 10 is the shorthand a CISO or security engineer will use to ask
"did your architects think about injection?" or "is there broken access control
in that API?" If you can only recite the list, you add nothing. If you can map
each risk to an architectural decision — where in the design the control lives,
what happens when it's absent, and how it surfaces in a bank's threat model —
you become the person who connects the development team to the security review.
Meridian Bank's mobile-banking platform and its regulated API surface make the
stakes concrete: one OWASP Top 10 gap in a PCI-scoped service is a finding
that stops a production release.

## The mental model

OWASP (Open Worldwide Application Security Project) publishes its Top 10 list of
the most critical web application security risks. The 2021 edition (the current
standard) is the one you will be quoted in design reviews and audit reports.

**First principle: the attacker's entry points**

A web application receives user-controlled input at three surfaces:

```
  User/Browser
      │
      │  HTTP request: URL params, headers, body, cookies, file uploads
      ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  Application (L7)                                                   │
  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
  │  │  Auth layer │  │  Business   │  │  Data layer │                │
  │  │  (login,    │  │  logic      │  │  (DB, queue,│                │
  │  │   tokens)   │  │             │  │   file store│                │
  │  └─────────────┘  └─────────────┘  └─────────────┘                │
  └─────────────────────────────────────────────────────────────────────┘
      │
      │  Backend calls: SQL, OS shell, LDAP, XML parsers, APIs, logs
      ▼
  Databases / services / OS
```

Every OWASP risk maps to either:
1. **Input the application trusts that it shouldn't** (injection family), or
2. **Decisions the application makes wrong** (broken access, mis-config, logging
   gaps), or
3. **Components the application inherits and doesn't verify** (supply chain).

**The 2021 OWASP Top 10** — architect's lens:

```
  A01  Broken Access Control        ← most common; who can read/modify what?
  A02  Cryptographic Failures       ← data in transit and at rest; see S09, S12
  A03  Injection                    ← SQL, OS, LDAP, code; trust-no-input
  A04  Insecure Design              ← threat modeling missed something; see S03
  A05  Security Misconfiguration    ← defaults left on; missing headers; open ports
  A06  Vulnerable & Outdated Components  ← unpatched libs; see S16
  A07  Identification & Authentication Failures  ← see S04–S06
  A08  Software & Data Integrity Failures  ← CI/CD, update pipelines; see S16
  A09  Security Logging & Monitoring Failures  ← can you detect and respond?
  A10  Server-Side Request Forgery (SSRF)  ← cloud metadata APIs at risk
```

**Where each control lives in the architecture:**

The architect's job is to know which layer (code, config, infrastructure) a
control belongs to — because that determines which team owns it and whether it
survives a deployment.

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  PERIMETER CONTROLS (platform / infra team owns)                     │
  │  WAF rules → A03 (injection), A05 (malformed requests)               │
  │  DDoS / rate limiting → exhaustion attacks                           │
  │  TLS policy → A02 (crypto failures)                                  │
  ├──────────────────────────────────────────────────────────────────────┤
  │  APPLICATION CONTROLS (dev team owns)                                 │
  │  Parameterised queries → A03                                         │
  │  AuthN / session management → A07                                    │
  │  Authorisation checks per resource → A01                             │
  │  Input validation / output encoding → A03, A05                      │
  │  Dependency scanning → A06, A08                                      │
  ├──────────────────────────────────────────────────────────────────────┤
  │  DESIGN CONTROLS (architect owns)                                     │
  │  Threat model surfaces A04, A01, A10 gaps before code is written     │
  │  No SSRF path to cloud metadata endpoint → A10                       │
  │  Secure defaults in IaC (no open buckets, no debug endpoints) → A05  │
  │  Log pipeline feeds SIEM → A09                                       │
  └──────────────────────────────────────────────────────────────────────┘
```

### The three risks architects most often introduce (or miss)

**A01 — Broken Access Control** is the #1 risk. It is rarely a code bug in
isolation — it is a design gap: the architect did not define an authorisation
model, so each developer checked permissions differently (or forgot to).
In a bank, an unauthenticated or horizontal-privilege-escalation path to
account data is a reportable breach under RBI guidelines.

**A10 — SSRF (Server-Side Request Forgery)** is especially critical in cloud
environments. An SSRF flaw lets an attacker make the application server issue
HTTP requests on their behalf — to internal services, to cloud metadata
endpoints (`http://169.254.169.254/`), or to a private VPC address. On GCP
the metadata server at `http://metadata.google.internal/` returns instance
service-account tokens with a single curl. On AWS the IMDSv1 endpoint at
`http://169.254.169.254/latest/meta-data/iam/security-credentials/` does the
same. An application that fetches a URL supplied by the user — a thumbnail
fetcher, a webhook tester, a PDF renderer — is an SSRF candidate.

**A05 — Security Misconfiguration** is the architect's domain at the
infrastructure layer: cloud buckets left public, API error responses leaking
stack traces, default admin credentials, debug ports exposed, security headers
absent, unnecessary services enabled. These are IaC and deployment-pipeline
problems, not just developer problems.

## Worked example

**Meridian Bank's mobile-banking API** runs in GCP (`10.100.0.0/14`, see
`reference/running-example.md`) and communicates with the core banking system
at HQ-DC1 (`10.10.0.0/16`). The cardholder data environment (CDE) subnet is
`10.10.20.0/24`. Walk the Top 10 against this design:

```
  Internet
     │  HTTPS (443)
     ▼
  Cloud Armor (WAF)          ←── A03: managed rule set blocks SQLi/XSS
     │
  GCP External HTTPS LB      ←── A02: TLS 1.2 minimum policy enforced
     │
  API Gateway                ←── A07: JWT validation, rate limiting
     │
  Mobile backend (GCP VMs)   ←── A01: per-resource authz checked here?
     │                                 A10: does it fetch external URLs?
  Cloud Interconnect          
     │
  HQ-DC1 (10.10.0.0/16)
  Core banking (CDE: 10.10.20.0/24)
```

**Specific risks in this design:**

| Risk | Where it bites Meridian | Architectural control |
|------|------------------------|----------------------|
| A01 Broken Access Control | Customer A can read Customer B's account via API if the backend checks only authentication, not resource-level authorisation | Enforce object-level checks in the backend service; audit-log every access to account data |
| A02 Cryptographic Failures | Account data returned over HTTP (no TLS) in a legacy internal API, or sensitive fields stored in logs | TLS 1.2+ on every hop; PCI-DSS Req 4 mandates strong cryptography for cardholder data transmitted over open, public networks |
| A03 Injection | Transaction search endpoint builds SQL from a query parameter: `WHERE ref LIKE '%{userInput}%'` | Parameterised queries; WAF managed rules as a second layer (not a substitute) |
| A05 Misconfiguration | GCP Cloud Storage bucket storing statement PDFs has `allUsers: objectViewer` (public read) | Org Policy `constraints/storage.publicAccessPrevention` blocks this at GCP organisation level |
| A07 Auth Failures | Session tokens with 30-day expiry and no rotation on privilege change | Short-lived JWT (≤15 min); refresh flow; invalidate on password reset; see S04–S06 |
| A09 Logging Failures | Authentication failures not sent to SIEM; no alert on 10 failed OTPs in 60 s | Every auth event → Cloud Logging → SIEM; structured log fields for correlation |
| A10 SSRF | Statement PDF generator fetches logo from a URL the user supplies; attacker supplies `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token` | Validate and allowlist URL destinations; use IMDSv2-equivalent (GCP requires `Metadata-Flavor: Google` header — add this to egress controls); block `169.254.0.0/16` at the VPC level |

**The SSRF / cloud metadata risk in detail:**

GCP metadata server requires a specific header (`Metadata-Flavor: Google`) to
return sensitive data, which mitigates basic SSRF. AWS IMDSv1 (the older
version) required no such header — any HTTP GET to
`http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>`
returned credentials. AWS introduced IMDSv2, which requires a PUT request to
obtain a session token first (a single-hop request that an SSRF through the
application cannot easily replicate). Architects must enforce IMDSv2-only on
all EC2 instances in Meridian Bank's AWS environment.

GCP metadata protection:
```
# Require the Metadata-Flavor: Google header — the SSRF attacker's request won't
# carry it, but your legitimate application code does.
# Note: 169.254.169.254 is link-local; VPC firewall rules don't reliably block it.
# Restrict metadata access with an OS-level firewall rule / egress proxy if needed.
```

AWS — enforce IMDSv2 only (no instance should accept IMDSv1):
```bash
# [needs cloud account] Check IMDSv2 enforcement on an EC2 instance
aws ec2 describe-instances \
  --query 'Reservations[].Instances[].{Id:InstanceId,HttpTokens:MetadataOptions.HttpTokens}'
# HttpTokens: "required" = IMDSv2 only (correct)
# HttpTokens: "optional" = IMDSv1 still enabled (risk)
```

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| WAF managed rules (OWASP CRS) | F5 ASM / ModSecurity with OWASP CRS | Cloud Armor — managed protection rules include OWASP Top 10 rule groups | AWS WAF with AWS Managed Rules for OWASP Top 10 | (Azure: TODO) Azure WAF with OWASP CRS 3.2 on Application Gateway or Front Door |
| Prevent public storage exposure (A05) | Firewall / ACL on storage system | Org Policy `constraints/storage.publicAccessPrevention` | S3 Block Public Access at account or bucket level | (Azure: TODO) Azure Defender for Storage |
| SSRF — block metadata endpoint | Host firewall rule on 169.254.169.254 | Require the `Metadata-Flavor: Google` header; 169.254.169.254 is link-local, so VPC firewall rules don't reliably block it — use an OS firewall rule / egress proxy | Enforce IMDSv2 (`HttpTokens: required`) and set a low metadata hop limit; NACLs/SGs **cannot** block IMDS (link-local) — use a host/container firewall rule to restrict it | (Azure: TODO) |
| Secret / config management (A05) | CyberArk / HashiCorp Vault | Secret Manager; no secrets in env vars or IaC | AWS Secrets Manager / Parameter Store; no secrets in AMIs | (Azure: TODO) Key Vault |
| Dependency scanning (A06) | WhiteSource / Black Duck on-prem | Cloud Build with Artifact Analysis (OSV-based); Assured OSS | Amazon Inspector; CodeGuru Security | (Azure: TODO) |
| Auth / session management (A07) | LDAP + Kerberos; session cookies | Cloud Identity / Firebase Auth; Identity Platform | Amazon Cognito; IAM for service-to-service | (Azure: TODO) Entra ID |
| Centralised logging for A09 | SIEM (Splunk / QRadar) with syslog | Cloud Logging → Chronicle SIEM | CloudWatch Logs → GuardDuty → Security Hub | (Azure: TODO) |

## Do it (the exercise)

### Part 1 — classify the risk [laptop / paper]

Take a fictional API endpoint:

```
GET /api/accounts/{accountId}/transactions?from=2024-01-01&format=pdf
Authorization: Bearer <token>
```

For each OWASP risk A01–A10, write one sentence: "This endpoint is/is not
exposed to this risk because…" For at least three risks, state the specific
architectural control that mitigates it.

### Part 2 — inspect your WAF's managed rules [laptop]

If you have access to any WAF or a local ModSecurity installation, check which
OWASP CRS rule groups are enabled. For a quick public example:

```bash
# Use curl to send a classic SQLi probe to a test target (httpbin.org is
# a safe, public echo service — it will just echo back your request):
curl -s "https://httpbin.org/get?q=' OR 1=1 --" | python3 -m json.tool
# httpbin returns it unmodified — shows the raw input.
# A WAF in front would have blocked/stripped it.
# This illustrates what a WAF is protecting against.
```

### Part 3 — SSRF probe (safe, own environment only) [laptop]

```bash
# Simulate what an SSRF attacker tries from an application server.
# This is ONLY safe to run from a machine you own and control.
# On a local VM (not cloud), check if the metadata IP responds:
curl -m 2 http://169.254.169.254/ 2>&1 || echo "No metadata service (expected on bare metal/local VM)"
```

On a cloud VM where you have legitimate access, verify IMDSv2 enforcement
(AWS) or that the `Metadata-Flavor` header requirement is working (GCP):

```bash
# AWS — IMDSv2: first get a token (one-hop — SSRF cannot do this)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
# Then use the token
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id
```

```bash
# GCP — metadata requires the header; without it, you get a 403
curl -s "http://metadata.google.internal/computeMetadata/v1/instance/id" \
  -H "Metadata-Flavor: Google"
# Without the header:
curl -s "http://metadata.google.internal/computeMetadata/v1/instance/id"
# → 403 Forbidden — "Missing Metadata-Flavor:Google header."; confirms partial SSRF mitigation
```

### Part 4 — design review checklist [paper]

Review a system you know (or Meridian Bank's mobile backend) and check each:

- [ ] A01: Is there a documented authorisation model? Is it checked per resource?
- [ ] A02: Is TLS enforced on every API hop, including internal ones?
- [ ] A03: Are any SQL/LDAP/OS queries built by string concatenation with user input?
- [ ] A05: Are any storage buckets, API error pages, or debug endpoints publicly readable?
- [ ] A07: What is the session/token lifetime? Is it revocable?
- [ ] A09: Do auth failures generate alerts? Is there a SIEM?
- [ ] A10: Does any service fetch a URL that originates from user input?

## Say it back (self-check)

1. Name the OWASP Top 10 A01–A10 categories from memory. Which one is ranked #1 and why?
2. What is the difference between A01 (broken access control) and A07 (authentication failures)? Give a one-line example of each.
3. Explain SSRF to a non-technical colleague. Why is it especially dangerous in a cloud environment?
4. A WAF blocks injection patterns at the perimeter. Why is that still not enough — what must the application also do?
5. Which OWASP categories are primarily an architect's responsibility vs a developer's responsibility? Where is the line?

## Talk to the IT/security head

**Ask:**
- "Which OWASP Top 10 categories did the last pentest or VAPT surface in
  production?" *(A CISO who can name specific findings with ticket numbers has
  a live programme. One who says "nothing came up" likely hasn't tested.)*
- "Is there an authorisation model documented for this service — who can access
  what resource, defined before coding started?" *(Missing authz model = A01
  waiting to happen. In regulated FSI, this is required by RBI IT Framework
  Annex for API security.)*
- "Are IMDSv2 enforcement and metadata endpoint egress blocks applied to all
  cloud instances?" *(SSRF to the metadata service is one of the most common
  cloud-specific breach paths. This should have a yes or a remediation ticket.)*
- "Is the WAF using managed OWASP rules, or are they all custom?" *(Managed
  rules with auto-updates are safer than stale custom rules. Custom-only means
  someone wrote rules to cover threats they knew about in the past.)*
- "Which logs from this service reach the SIEM, and what alert fires on 10
  failed logins in a minute?" *(No concrete answer = A09 gap. In a bank,
  authentication anomalies must trigger within minutes, not days.)*

**A good answer sounds like:** specific findings from recent VAPT, a named
authorisation matrix or policy document, cloud config hardening verified by
CSPM tooling, and a SIEM alert ID for authentication brute-force.

**Red flags:**
- "Our developers are trained on OWASP, so it's covered." Training is not a
  control. Ask for the test results.
- "The WAF handles injection." A WAF is a layer, not a substitute for
  parameterised queries — an obfuscated injection can bypass most WAF rules.
- "We don't have SSRF because we don't fetch user-supplied URLs." Check: does
  the app fetch *anything* based on user input, even indirectly (a report
  template URL, a payment redirect, a webhook endpoint)?
- No authorisation model documented before development. This is the single
  biggest predictor of A01 findings in FSI design reviews.

## Pitfalls & war stories

**The WAF-as-silver-bullet trap.** A bank project team once signed off on a
penetration test finding "WAF deployed — SQL injection mitigated." Six months
later a direct API call (bypassing the WAF path by using an internal service
account) hit an unparameterised query. The WAF only covered the public-facing
endpoint; the internal API was not in scope and had no WAF. Every access path —
including service-to-service calls within the VPC — needs the same app-level
control.

**A01 as an afterthought.** An architect designs the authentication flow in
detail (OAuth2, OIDC, MFA — see S04–S06) and leaves "access control" as a
single checkbox. The developers implement it per-endpoint, inconsistently.
Result: customer A can retrieve customer B's statements by changing the
`accountId` in the URL. In PCI-DSS terms this is a Requirement 7 failure; in
RBI terms it is a reportable data breach. The fix requires a horizontal
authorisation policy (does the authenticated user *own* this resource?), not
just vertical (is the user an admin?).

**SSRF in a PDF/report generator.** A popular pattern: the backend generates
PDF reports from HTML templates, with a headless browser or a rendering service
fetching the content. If the template URL or any embedded image URL is
user-controlled, you have SSRF. Northwind's finance team had a similar
vulnerability in an on-prem BI tool that accepted a "logo URL" in report
config — reaching internal RFC 1918 addresses (`10.50.0.0/16`) with full HTTP
access.

**A05 in IaC.** Terraform and CloudFormation templates created during a
hackathon or proof of concept reach production with debug flags enabled,
overly permissive IAM bindings, and public storage buckets. In GCP, Org Policy
constraints enforced at the organisation level catch some of this before
deployment; in AWS, SCP guardrails on the OU and AWS Config rules provide the
same backstop. But neither catches everything — CSPM scanning (see S34) in the
CI/CD pipeline is the architect's control.

**A09 — the logging gap that costs dearly.** In regulated FSI environments,
RBI guidelines require audit log retention of at least one year for security
logs (longer for transaction records under PMLA), and logs must be immutable. A common mistake: application logs go to the same storage
that the application can write to — an attacker who compromises the app can
delete evidence. Logs must be streamed to an immutable sink (write-once storage,
separate SIEM account) immediately, not batched.

## Going deeper (optional)

- OWASP Top 10 2021 (authoritative list and description):
  https://owasp.org/Top10/
- OWASP Testing Guide v4.2 — the methodology behind the list:
  https://owasp.org/www-project-web-security-testing-guide/
- OWASP ASVS (Application Security Verification Standard) — the level-by-level
  checklist architects use to set security requirements:
  https://owasp.org/www-project-application-security-verification-standard/
- AWS IMDSv2 documentation: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
- GCP metadata server best practices: https://cloud.google.com/compute/docs/metadata/overview
- SSRF Prevention Cheat Sheet (OWASP): https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- Pairs with N25 (WAF and CDN at the application front door) and S14 (Secure
  SDLC: SAST, DAST, SCA in the pipeline). Revisit A09 in full when you reach
  S20 (SIEM and logging).

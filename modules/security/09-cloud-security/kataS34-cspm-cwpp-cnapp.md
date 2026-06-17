# Kata S34 — CSPM / CWPP / CNAPP: posture management explained

> **Track:** Security · **Module:** S9 Cloud security posture · **Prereqs:** S01, S32, S33, N42 · **Time:** ~35 min
> **Tags:** `cspm` `cwpp` `cnapp` `cloud` `security` `shared-responsibility` `security-command-center` `guardduty`

## Why it matters

Misconfiguration — not sophisticated exploits — is the leading cause of cloud
breaches. A storage bucket left world-readable, a firewall rule open to
`0.0.0.0/0` on port 22, a service account with Owner-level permissions: these
misconfigurations are invisible to a traditional perimeter firewall and invisible
to your monitoring team unless something is specifically watching the *control
plane* of the cloud, not just the data plane. CSPM, CWPP, and CNAPP are the
three categories of tooling that fill that gap. You will encounter these acronyms
in every cloud security procurement conversation, every CISO review, and every
regulatory gap assessment. Getting them straight lets you ask the right questions
rather than nodding at vendor slides.

## The mental model

Start with the problem, not the acronym.

### The three problems cloud creates

```
  PROBLEM 1: WHO CONFIGURED WHAT?
  ─────────────────────────────────────────────────────────────────────
  On-prem: a network engineer configures the firewall; it stays that way.
  Cloud:   any developer with IAM rights can open a security group at 3 a.m.
           A misconfiguration is one API call away and is invisible until
           something bad happens — or until you continuously scan.

  PROBLEM 2: WHAT IS RUNNING INSIDE THE VM / CONTAINER?
  ─────────────────────────────────────────────────────────────────────
  On-prem: the IT team images and patches every server; inventory is known.
  Cloud:   teams spin up workloads in minutes. Are they patched? Are they
           running vulnerable packages? Has malware executed inside one?
           The perimeter firewall cannot see inside the workload.

  PROBLEM 3: DO THE PIECES ADD UP TO A COHERENT SECURITY POSTURE?
  ─────────────────────────────────────────────────────────────────────
  Neither scan alone tells you: "can an external attacker reach a
  vulnerable, over-permissioned workload in three hops?" Only a tool that
  joins configuration + identity + workload risk can answer that question.
```

### The three acronym categories

```
  CSPM — Cloud Security Posture Management
  ─────────────────────────────────────────────────────────────────────
  Continuously scans the cloud control plane (APIs, configurations) and
  compares against a baseline (CIS Benchmarks, PCI-DSS, custom policy).
  Answers: "Is anything misconfigured?"

  Scope: resource config, firewall rules, storage ACLs, encryption
         settings, logging gaps, IAM policy drift (see S33).

  CWPP — Cloud Workload Protection Platform
  ─────────────────────────────────────────────────────────────────────
  Monitors what is running inside workloads (VMs, containers, serverless).
  Answers: "Is this workload vulnerable, compromised, or behaving oddly?"

  Scope: vulnerability scanning (OS packages, libs), runtime threat
         detection (suspicious processes, unusual syscalls), malware
         scanning, container image scanning.

  CNAPP — Cloud-Native Application Protection Platform
  ─────────────────────────────────────────────────────────────────────
  Gartner's 2021 term for a unified platform that combines CSPM + CWPP +
  CIEM (Cloud Infrastructure Entitlement Management) and often pipeline /
  IaC scanning into a single risk graph.
  Answers: "Where is my highest-risk attack path end-to-end?"

  CIEM is the piece that manages over-permissioned cloud identities
  (human and service accounts) — the entitlement-sprawl problem from S33.
```

### How they layer

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    CNAPP (unified risk graph)                   │
  │  joins control-plane misconfiguration + workload risk + IAM     │
  │                                                                 │
  │  ┌──────────────────────┐  ┌──────────────────────────────────┐│
  │  │ CSPM                 │  │ CWPP                             ││
  │  │ • storage ACLs       │  │ • CVE scanning (OS, pkgs)        ││
  │  │ • firewall open ports│  │ • runtime behavior (procs, net)  ││
  │  │ • encryption off     │  │ • container image scanning       ││
  │  │ • logging gaps       │  │ • malware detection              ││
  │  │ • CIS / PCI controls │  │ • serverless function risk       ││
  │  └──────────────────────┘  └──────────────────────────────────┘│
  │                                                                 │
  │  + CIEM: identity & entitlement analysis (pairs with S33)      │
  │  + IaC / pipeline scanning (shifts left into the SDLC)         │
  └─────────────────────────────────────────────────────────────────┘
```

**The key insight:** CSPM can tell you a storage bucket is public. CWPP can
tell you a VM is unpatched. Only CNAPP-style correlation tells you *both are
true and the VM has a path to that bucket* — promoting the combination to a
critical priority, not just a handful of individually medium findings.

### On-prem equivalents

| What CSPM/CWPP/CNAPP do in cloud | The nearest on-prem practice |
|-----------------------------------|------------------------------|
| CSPM: scan config against policy  | Firewall rule review + CIS hardening audits + change-control log review |
| CWPP: scan workload runtime risk  | Vulnerability scanning (Nessus/Qualys), AV/EDR on servers |
| CNAPP: unified attack-path risk   | No direct equivalent — the control-plane API and the workload share no single ledger on-prem; CNAPP exists *because* cloud merged them |

The reason CNAPP is cloud-native: on-prem, the configuration of a server and
its vulnerability state live in separate systems (CMDB vs scanner). In cloud,
both are reachable via the same set of APIs — which is why a single platform
can correlate them into an attack path.

## Worked example

Meridian Bank runs its mobile banking backend in GCP (`10.100.0.0/14`; see
`reference/running-example.md`) and some analytics workloads in AWS
(`10.104.0.0/14`). The CISO has asked: "give me confidence we have no
critical-exposure misconfigurations in production."

**CSPM scan result (GCP Security Command Center):**

```
  Finding: HIGH  — Storage bucket 'meridian-audit-logs-raw' has uniform
                   bucket-level access disabled AND is publicly readable.
  Resource: projects/meridian-prod/buckets/meridian-audit-logs-raw
  Compliance: PCI-DSS Req 10.5.2 v3.2.1 / 10.3.2 v4.0 (protect audit logs
              from unauthorized modification)
  Remediation: enable uniform bucket-level access; remove allUsers binding.

  Finding: HIGH  — VPC firewall rule 'allow-ssh-all' in project meridian-prod
                   allows TCP/22 from 0.0.0.0/0 to all instances.
  Recommendation: restrict source to the jump-host subnet (10.10.0.0/16)
                  or use IAP TCP forwarding (no public IP needed at all).

  Finding: MEDIUM — Cloud SQL instance 'core-analytics-db' has backups
                    disabled and no authorized network restriction.
```

Two HIGH findings together in CSPM constitute a risk the CISO must remediate
before the next PCI audit. Neither requires a sophisticated attacker: the
bucket is open to a browser; the SSH rule is open to any scanner on the
internet.

**CWPP scan result (AWS Inspector on Meridian analytics instances):**

```
  Instance: i-0a1b2c3d4e5f (10.104.12.45 — Meridian analytics VPC)
  Finding: MEDIUM (in isolation) — CVE-2021-44228 (Log4Shell) detected in
           /opt/analytics/lib/log4j-core-2.14.1.jar
  CVSS 3.1 base score 10.0 (Critical), network-reachable, no auth required.
  Scored MEDIUM here because Inspector sees the instance in a private subnet
  with no inbound path it can prove — the score rises sharply once CNAPP adds
  the reachability + IAM context below.
  Remediation: update log4j-core to >= 2.17.1 or remove component.
```

Without CWPP, this instance looks fine from the network perimeter — it is in
a private subnet with security groups limiting access. The vulnerability is
inside the application stack, invisible to a firewall rule review.

**CNAPP correlation (both findings together):**

A CNAPP would join three findings that each look MEDIUM in isolation: the
Meridian analytics instance is unpatched (Log4Shell), its security group exposes
port 8443 to `0.0.0.0/0`, and it has an IAM role bound to it with `s3:GetObject`
on the analytics bucket. The attack path:

```
  Internet → exploits Log4Shell on i-0a1b2c3d4e5f (port 8443 open to 0.0.0.0/0
  in its security group) → runs inside the VM with the attached IAM role →
  reads (or exfiltrates) s3://meridian-analytics-raw/ via the role's policy.
```

Three findings — each scored MEDIUM when triaged on its own — combine into a
CRITICAL attack path. Without CNAPP-style correlation, a team triaging findings
individually might schedule all three for next month's sprint. With correlation,
the chain is promoted to CRITICAL and becomes an emergency.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| **CSPM** (config scanning) | Manual CIS audits, firewall reviews, Nessus config scan | Security Command Center (Standard/Premium) — Asset Inventory + Findings | AWS Security Hub + Config Rules + Trusted Advisor | Microsoft Defender for Cloud |
| **CWPP** (workload protection) | EDR (CrowdStrike/Defender), Nessus on-prem scanning | Security Command Center Premium (Container Threat Detection, VM Threat Detection) + Artifact Analysis | Amazon Inspector v2 + GuardDuty (runtime for EKS/EC2) | Defender for Servers / Defender for Containers |
| **CNAPP** (unified platform) | No single on-prem equivalent | Security Command Center Enterprise (Mandiant-powered, risk graph) | AWS lacks a native CNAPP; third-party (Wiz, Orca, Prisma) used on top of Security Hub + Inspector | Defender for Cloud (Defender CSPM plan adds attack-path analysis) |
| **CIEM** (entitlement mgmt) | AD/PAM + manual reviews | Security Command Center (IAM recommender, service account auditing) | IAM Access Analyzer + Permission Boundaries | Entra ID PIM / Permissions Management |
| **IaC scanning** (shift left) | Not applicable on-prem | Cloud Build + Security Command Center, or third-party (Checkov, tfsec) | CodePipeline + third-party | Azure DevOps + DevOps security (in Defender for Cloud) |
| **Compliance framework mapping** | Manual gap assessment | SCC compliance dashboards (PCI-DSS, ISO 27001, CIS GCP) | Security Hub Security Standards (CIS, PCI-DSS, NIST 800-53) | Defender Regulatory Compliance dashboard |

**GCP specifics:** Security Command Center (SCC) has three tiers:
- *Standard* (free): asset inventory, basic findings.
- *Premium*: full CSPM + CWPP (Container/VM Threat Detection), compliance dashboards, Event Threat Detection (log-based).
- *Enterprise*: adds Mandiant Threat Intelligence, attack path simulation (CNAPP-grade risk graph), and CIEM.

**AWS specifics:** AWS assembles CSPM + CWPP from separate services:
- *Security Hub*: aggregates findings from GuardDuty, Inspector, Macie, Config — acts as the CSPM dashboard.
- *Amazon Inspector v2*: continuous vulnerability scanning of EC2, Lambda, ECR images (replaces old Inspector which was manual).
- *GuardDuty*: threat detection from CloudTrail, DNS, VPC Flow Logs, EKS audit logs — the runtime/CWPP detection layer.
- *Macie*: data classification (S3 sensitive-data discovery) — overlaps with CSPM for data risk.

Most enterprises on AWS add a third-party CNAPP (Wiz, Orca, or Palo Alto Prisma Cloud) for the attack-path correlation layer that AWS's native tools do not provide in a single pane.

## Do it (the exercise)

**[laptop] — Explore Security Command Center concepts without a paid account:**

1. Review the CIS Google Cloud Foundation Benchmark v2.0 (free, download at
   `https://www.cisecurity.org/benchmark/google_cloud_computing_platform`).
   Pick any five controls in Section 4 (Virtual Machines) and for each write:
   - What misconfiguration it detects
   - Which CIA property it protects
   - Whether CSPM or CWPP covers it

2. Read through the AWS Foundational Security Best Practices standard controls
   at `https://docs.aws.amazon.com/securityhub/latest/userguide/fsbp-standard.html`.
   Find three controls that relate to Meridian Bank's use case (FSI, PCI scope)
   and note the AWS service that would generate each finding.

**[needs cloud account] — Enable and query Security Command Center (GCP):**

3. In a GCP project (free tier is sufficient), enable Security Command Center
   Standard from the console (`Security → Security Command Center → Enable`).
   After 24 hours, view the Findings tab and:
   ```
   # List open HIGH findings via gcloud CLI:
   gcloud scc findings list \
     --organization=YOUR_ORG_ID \
     --filter="state=ACTIVE AND severity=HIGH" \
     --format="table(name,category,resourceName,createTime)"
   ```
   Pick one finding and trace it: what resource? what exact misconfiguration?
   what remediation does SCC recommend?

**[needs cloud account] — Enable AWS Security Hub (AWS):**

4. In an AWS account, enable Security Hub from the console
   (`Security Hub → Go to Security Hub → Enable`). Also enable the
   CIS AWS Foundations Benchmark standard. After a few minutes:
   ```bash
   # List all FAILED controls in Security Hub:
   aws securityhub get-findings \
     --filters '{"ComplianceStatus":[{"Value":"FAILED","Comparison":"EQUALS"}],
                 "SeverityLabel":[{"Value":"HIGH","Comparison":"EQUALS"},
                                  {"Value":"CRITICAL","Comparison":"EQUALS"}]}' \
     --query 'Findings[*].[Title,Severity.Label,Resources[0].Id]' \
     --output table
   ```
   Identify whether each finding is CSPM (config) or CWPP (workload) in nature.

**[laptop] — Attack-path thinking:**

5. Using a system you know (cloud or otherwise), draw the following on paper:
   - The five most exposed resources (internet-reachable, high-value data, etc.)
   - For each: which CSPM finding would expose it? Which CWPP finding would
     indicate a compromised workload?
   - Now chain two of them: is there an attack path from one to the other?
     What IAM binding or network path enables that hop?

## Say it back (self-check)

1. Explain CSPM and CWPP in one sentence each — without using the word "cloud."
2. Why can CSPM tell you a bucket is public but not that it matters? What else
   is needed to establish that it matters?
3. What is CNAPP and what Gartner gap does it fill compared to running CSPM
   and CWPP as separate tools?
4. In GCP, which tier of Security Command Center gives you CWPP (runtime
   workload threat detection)?
5. In AWS, name the service that continuously scans EC2 instance OS packages and
   ECR container images for CVEs.

## Talk to the IT/security head

**Ask:**

- "Do you have continuous posture scanning against a named compliance framework —
  PCI-DSS, CIS, or your own baseline — and how are findings triaged?"

  *A good answer sounds like:* "Yes — Security Command Center Premium / Security
  Hub on the CIS benchmark; findings above HIGH go to a Jira queue and must be
  remediated within 30 days per our SLA. Our SCC score is currently 87%."

  *Red flag:* "We have it enabled but nobody looks at the dashboard" — CSPM only
  works if findings create work. A tool with no process is theater.

- "Can you show me an attack-path simulation — what's the worst end-to-end
  exposure path from the internet to a regulated data store right now?"

  *A good answer sounds like:* "SCC Enterprise shows three paths; the highest
  is rated CRITICAL. We're remediating the IAM binding that enables the middle
  hop this sprint."

  *Red flag:* inability to answer — this means they have CSPM point-in-time
  findings but no correlation, so they cannot prioritize. A PCI auditor will
  ask the same question.

- "Does your CWPP cover container images before they reach production, or only
  at runtime?"

  *A good answer sounds like:* "We scan images in the CI pipeline (Artifact
  Registry / ECR) and block deployments above a CVSS threshold. Runtime
  detection is on for all EKS node groups."

  *Red flag:* runtime-only coverage. An unpatched image that passes at deploy
  time is never flagged until something exploits it — by which point breach
  dwell time has already started. For FSI workloads, shift-left image scanning
  is an RBI and PCI expectation.

- "Are your CSPM findings feeding your SIEM and your change-management process?"

  *A good answer sounds like:* "SCC findings flow into Chronicle / Security Hub
  findings flow into Splunk, with rules for HIGH/CRITICAL creating P2 incidents
  in ServiceNow within 15 minutes."

  *Red flag:* CSPM findings sit in a portal no one has reviewed in weeks. This
  is the most common state in practice and the CISO's nightmare when an auditor
  asks for evidence of continuous monitoring.

**Red flags to listen for at a Meridian Bank-style FSI client:**

- "We do a quarterly posture scan" — PCI-DSS Req 6.3 (vulnerability management)
  and Req 12.3 (risk assessment) both expect *continuous* monitoring, not
  quarterly snapshots.
- "We enabled it when we launched; it's probably fine" — CSPM posture degrades
  every time a developer makes a configuration change. It must be continuously
  evaluated.
- "Our CWPP only covers VMs, not containers" — if the bank runs GKE/EKS
  workloads, that is an uncovered attack surface the CISO may not know exists.

## Pitfalls & war stories

**Finding overload:** CSPM tools surface hundreds of findings on first run.
Teams disable alerting because the volume is unmanageable — then have no
posture management at all. The fix: start with severity=CRITICAL + HIGH,
map findings to a compliance standard, and agree a SLA for each severity tier
*before* enabling alerts. At Meridian Bank, the practice of triaging against
PCI-DSS scope first cuts the actionable list by 70%.

**CSPM without remediation workflow:** Enabling Security Command Center or
Security Hub without integrating it into a ticketing system (Jira, ServiceNow)
creates a posture dashboard that no one owns. At FSI clients, every HIGH
finding needs a named owner and a due date — otherwise the score improves only
at audit time, which auditors are trained to notice.

**CWPP agent sprawl:** Legacy on-prem agents (Qualys, Tenable) are often
force-fitted onto cloud VMs. They work, but they miss container workloads,
serverless functions, and managed services entirely — leaving most of a modern
cloud estate unscanned. Cloud-native CWPP (Inspector v2, SCC Premium) covers
all compute types from a single enablement step, with no agent for managed
services.

**Confusing CSPM score with security posture:** A 95% compliance score in
Security Hub's CIS standard means 95% of controls pass. The 5% that fail may
include the one critical path from internet to cardholder data. Posture score
is a useful trend metric; attack-path analysis (CNAPP) is the risk metric.

**Northwind FMCG pattern:** At Northwind's scale (3,000 sites, multiple acquired
cloud accounts), CSPM must run at the AWS Organizations / GCP Organization level,
not per-account. A per-account CSPM approach misses cross-account attack paths
and cannot enforce baseline controls on newly-created accounts. AWS Security Hub
with Organizations delegated admin and GCP SCC at org level are the correct
deployment patterns.

## Going deeper (optional)

- Gartner "Innovation Insight for CNAPP" (2021) — the paper that coined the term
  and defined the market; useful to read before any vendor briefing.
- CIS Google Cloud Foundation Benchmark v2.0:
  `https://www.cisecurity.org/benchmark/google_cloud_computing_platform`
- CIS Amazon Web Services Foundations Benchmark v2.0:
  `https://www.cisecurity.org/benchmark/amazon_web_services`
- GCP Security Command Center documentation:
  `https://cloud.google.com/security-command-center/docs/concepts-security-command-center-overview`
- AWS Security Hub documentation:
  `https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html`
- Amazon Inspector v2 (continuous ECR + EC2 + Lambda scanning):
  `https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html`
- Pairs with S33 (cloud IAM over-permissioning), S32 (shared responsibility
  model), S36 (cloud logging and detection), and N42 (cloud firewall rules).
- CVE-2021-44228 (Log4Shell) NIST entry:
  `https://nvd.nist.gov/vuln/detail/CVE-2021-44228`

# Kata S32 — Security in the cloud shared-responsibility model

> **Track:** Security · **Module:** S8 Governance, risk & compliance · **Prereqs:** S01, S29, S30, N39 · **Time:** ~35 min
> **Tags:** `shared-responsibility` `cloud` `gcp` `aws` `compliance` `risk-management` `fsi` `mental-model`

## Why it matters

Every cloud vendor publishes a shared-responsibility matrix, and every bank or
FMCG CISO has been burned by assuming a control was covered that wasn't. The
model defines who is responsible for what security outcome between the cloud
provider and the customer — and the exact split depends on the service model (IaaS
vs PaaS vs SaaS). If you can't draw this boundary clearly, you will either
over-invest in controls you don't need to build or, far more commonly, skip
controls you thought the vendor owned. Either way you fail the next audit. The
architect's job is to know which side of the line each requirement falls on and
prove it in writing to the CISO and the regulator.

## The mental model

### The principle: security *of* the cloud vs security *in* the cloud

The cloud provider always owns **security of the cloud**: the physical
datacentre, the hypervisor, the global network backbone, the hardware, and the
foundational platform services.

The customer always owns **security in the cloud**: what they put there, how
they configure it, who they grant access to, and whether they've encrypted it.

Everything in between depends on the service model:

```
SERVICE MODEL      Provider owns                  Customer owns
─────────────────────────────────────────────────────────────────
IaaS (VMs)         Physical, hypervisor,          OS, patches, apps,
                   network fabric                 firewall config, IAM,
                                                  encryption keys, data

PaaS (managed      All of IaaS plus               App code, config,
DB, GKE, etc.)     runtime + OS patches           IAM, data, keys

SaaS (GMail,       All of IaaS + PaaS plus        User access, data
Salesforce, etc.)  the application itself         classification, SSO/MFA
```

A single enterprise workload often spans all three simultaneously: a VM (IaaS)
calling a managed Cloud SQL database (PaaS), fronted by a SaaS CDN — three
different responsibility boundaries in one request path.

### Visualising the stack

```
  ─────────────────────────────────────────────
  RESPONSIBILITY         IaaS   PaaS   SaaS
  ─────────────────────────────────────────────
  Data                    C      C      C       ← always yours
  Identities & access     C      C      C       ← always yours
  App code                C      C      P       SaaS: provider's
  Runtime / middleware     C      P      P
  OS / patches             C      P      P
  Virtualisation           P      P      P
  Physical servers         P      P      P
  Physical network         P      P      P
  Physical datacentre      P      P      P
  ─────────────────────────────────────────────
  P = Provider  ·  C = Customer
```

### The three liability gaps architects miss

1. **Configuration gap.** The provider secures the *service*; you secure your
   *configuration of it*. A misconfigured S3 bucket or Cloud Storage bucket that
   leaks customer data is 100 % the customer's problem — the provider's
   encryption of the underlying disks is irrelevant.

2. **Encryption-key gap.** The provider may encrypt your data at rest by default,
   but if they hold the key, they can theoretically decrypt it. In regulated FSI,
   Customer-Managed Encryption Keys (CMEK) or Bring Your Own Key (BYOK) move key
   custody to the customer (see S12). The CISO at Meridian Bank will ask who
   holds the key; the correct answer is "we do."

3. **Patch / OS gap.** On IaaS VMs the provider patches the *hypervisor*, not
   the guest OS. Meridian Bank's core banking integration VMs on GCP Compute
   Engine still need a managed patching process — VM Manager (OS Patch
   Management) is available, but the bank must operate it; the provider does not
   patch the guest OS for you.

### Regulatory translation

Regulators — RBI, PCI-DSS, GDPR, DPDP — don't care about the provider's
responsibility; they hold the *licensed entity* accountable. A PCI-DSS audit on
Meridian Bank's card tokenization service (hosted on GCP Cloud Run, a PaaS)
requires the bank to demonstrate controls it owns: IAM least-privilege, audit
logging, encryption keys, network segmentation, and incident response. The
Google PCI-DSS Attestation of Compliance (AOC) only covers the layer Google
owns; Meridian must produce its own overlapping evidence.

PCI-DSS v4.0 Requirement 12.8 explicitly requires a documented, maintained list
of all cloud/third-party providers, a written agreement covering each party's
scope, and annual review of what each provider delivers — this is the
shared-responsibility matrix as a compliance artefact.

## Worked example

Meridian Bank runs the following on GCP:

```
  ┌──────────────────────────────────────────────────────────────┐
  │ Meridian Bank on GCP                                         │
  │                                                              │
  │  [Cloud Armor + GLB]  ← managed service: Google runs engine │
  │         │                                                    │
  │  [Cloud Run service]  ← PaaS: bank owns code + config       │
  │  (mobile API layer)     GCP owns runtime + OS               │
  │         │                                                    │
  │  [Cloud SQL, postgres] ← PaaS: bank owns data + keys        │
  │  10.100.0.0/14 VPC      GCP owns DB engine + OS patches     │
  │         │                                                    │
  │  [VPN / Interconnect] ← bank owns on-prem side (N36, N38)   │
  │         │                                                    │
  │  [HQ-DC1 core banking, 10.10.0.0/16] ← fully on-prem       │
  └──────────────────────────────────────────────────────────────┘
```

Walk the responsibility split layer by layer:

| Component | Service model | Provider owns | Meridian owns |
|-----------|---------------|---------------|---------------|
| Cloud Armor WAF rules | Managed service | DDoS / signature engine | Rule set, rate limits, allow/deny policy |
| Cloud Run container | PaaS | OS, runtime, scaling | Container image, code, env vars, IAM, secrets |
| Cloud SQL Postgres | PaaS | DB engine, OS, backups | Schema, users, CMEK key, network access (authorized networks / PSC), audit logging enablement |
| Cloud Storage (audit logs) | PaaS | Durability, encryption-at-rest (default key) | Bucket ACL, CMEK, retention lock, VPC SC boundary |
| GCP VPC `10.100.0.0/14` | IaaS-adjacent | Routing fabric | Firewall rules, subnet layout, logging (see N42) |
| Interconnect link | Physical layer | Physical cable, port | BGP session, MACsec, traffic selectors |
| HQ-DC1 servers | On-prem | Nothing | Everything |

**Key idea to recall:** PCI DSS v4.0 has 12 principal requirements that expand
to 300+ individual controls. GCP publishes a PCI-DSS Shared Responsibility
matrix on the Google Cloud Trust Center mapping each control to the responsible
party. For GCP PaaS services, Google covers a substantial portion of the
infrastructure-layer controls (physical, hypervisor, host OS), but Meridian
must still implement and evidence the application-, identity-, key-, and
config-layer controls — and prove that inheritance in its own audit.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Shared-responsibility document | N/A (you own everything) | Google Cloud Shared Responsibility Guide + service-specific PCI/SOC AOCs on Cloud Trust Center | AWS Shared Responsibility Model whitepaper + Artifact portal (SOC/PCI reports) | Microsoft Azure Shared Responsibility overview + Service Trust Portal |
| Compliance evidence artefacts | Internal audit evidence | Google Cloud Compliance Manager, Security Command Center posture reports | AWS Audit Manager, AWS Security Hub, Artifact | (Azure: TODO) |
| Customer-managed keys | On-prem HSM / Vault | Cloud KMS + CMEK per service; BYOK via Cloud External Key Manager (EKM) | AWS KMS + SSE-KMS per service; BYOK via External Key Store (XKS) | (Azure: TODO) |
| Posture / misconfiguration scanning | Manual / vulnerability scanner | Security Command Center (SCC) — Standard + Premium tiers | AWS Security Hub + Config rules + Trusted Advisor | (Azure: TODO) |
| Data residency enforcement | Physical separation | Org Policy: `gcp.resourceLocations` constraint restricts resource creation by region | AWS Service Control Policies (SCP) + `aws:RequestedRegion` condition | (Azure: TODO) |
| Incident response demarcation | Internal SOC | GCP support SLA + Customer Care; breach notification via Google; customer SOC runs Detection / Analysis / Containment on their own workloads | AWS Support + GuardDuty findings; customer owns IR playbooks | (Azure: TODO) |
| Third-party audit reports (SOC 2, PCI) | Your own audit | Cloud Trust Center — downloadable under NDA or public | AWS Artifact — downloadable (NDA for some) | (Azure: TODO) |

### The SLA ≠ security guarantee distinction

Cloud SLAs cover **availability** (e.g. Cloud SQL Enterprise Plus 99.99 %
availability SLA).
They do not guarantee **confidentiality** or **integrity** of your data if you
misconfigure access. Never use SLA figures in a security discussion as if they
represent a security commitment.

## Do it (the exercise)

### Part 1 — draw the boundary [laptop / paper]

Take the Meridian Bank GCP architecture above. For each component, write:

1. The service model (IaaS / PaaS / SaaS).
2. One security control the *provider* delivers automatically.
3. One security control that is *solely the customer's* responsibility.

Check your answers against the worked example table.

### Part 2 — read the primary source [laptop]

GCP:
```
# Open the Cloud Trust Center in a browser (no account needed):
https://cloud.google.com/security/compliance
# Download the GCP PCI DSS Shared Responsibility Guide (PDF).
# Find the section on Cloud SQL. List three controls marked "Customer."
```

AWS:
```
# Open the AWS Shared Responsibility Model page:
https://aws.amazon.com/compliance/shared-responsibility-model/
# Compare the IaaS (EC2) vs PaaS (RDS) split.
# Note which tier the OS-patching row sits in for each.
```

### Part 3 — compliance gap analysis [paper]

Pick one PCI-DSS Requirement (e.g. Req 8: Identify users, authenticate access).
Write two columns:

| What GCP's AOC covers for Cloud Run | What Meridian must implement itself |
|-------------------------------------|--------------------------------------|
| (find it in the shared-resp guide)  | (IAM, service accounts, MFA, etc.)  |

This is exactly the artefact an auditor will ask for. Practice producing it
now so you can guide the client's team.

### Part 4 — key custody check [needs cloud account]

```bash
# On a GCP project (free tier is sufficient):
gcloud services enable cloudkms.googleapis.com

# Create a key ring and key:
gcloud kms keyrings create meridian-test \
  --location=asia-south1

gcloud kms keys create db-key \
  --keyring=meridian-test \
  --location=asia-south1 \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time=$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)

# List the key — note the key VERSION, not the material itself.
# Google never exposes the raw key material; you control rotation and access.
gcloud kms keys describe db-key \
  --keyring=meridian-test \
  --location=asia-south1
```

Confirm: the key material stays inside GCP HSMs in `asia-south1` (Mumbai).
Who can use the key is controlled by IAM; who *holds* the key material is GCP
unless you integrate an External Key Manager (BYOK).

## Say it back (self-check)

1. Complete the sentence: "The cloud provider is responsible for security *of*
   the cloud; the customer is responsible for security ________."
2. Name the three gaps — configuration, encryption-key, patch/OS — and give one
   example of a real incident caused by each.
3. For a PaaS managed database (Cloud SQL / RDS), which side owns: OS patching?
   data encryption keys? database user permissions? backup retention?
4. Why does a GCP or AWS PCI AOC not remove the need for the bank to produce its
   own compliance evidence?
5. A CISO says "but GCP is ISO 27001 certified — we're covered." Where is this
   reasoning wrong, and how would you correct it without being condescending?

## Talk to the IT/security head

**Ask:**

- "Do you have a documented shared-responsibility matrix for each cloud service
  you use?" *(If no, this is the first deliverable. The PCI audit will demand
  it — Req 12.8.)*
- "For each managed service in scope — RDS, Cloud SQL, GKE — who owns the
  encryption keys, and where are they stored?" *(Reveals whether CMEK/BYOK is
  in place or whether the provider holds the keys by default.)*
- "When your cloud provider detects a breach on their infrastructure, what is
  their notification SLA to you, and what do you do in parallel?" *(Most
  providers commit to notify, but 'notify' and 'contain' are different things;
  the customer IR playbook must run concurrently — see S23.)*
- "Are your cloud service configuration checks automated, or are they manual
  review before each change?" *(An unautomated posture check is not a control —
  it's a hope. Expect CSPM tooling as the answer; see S34.)*
- "Have you ever run a tabletop where the 'outage' was caused by a cloud
  provider change that removed a control you depended on?" *(Many FSI shops
  haven't. Providers do change defaults — e.g. disabling legacy TLS — and the
  customer discovers it at 3 a.m.)*

**A good answer sounds like:** the IT/security head can point to a spreadsheet
or GRC tool entry listing each cloud service with columns for provider
controls, customer controls, and the evidence artefact; they know who holds
the encryption keys and have tested the key-rotation procedure; and they have
a cloud-specific IR runbook that does not depend on the provider acting first.

**Red flags:**
- "We're on GCP / AWS — they handle security." (No provider claims this.)
- Cannot distinguish IaaS from PaaS responsibility lines.
- Assumes the provider's ISO / SOC 2 / PCI AOC covers the bank's own audit.
- No CMEK or BYOK for regulated data in PaaS services.
- IAM on cloud services has not been reviewed since initial deployment.
- No automated posture check (CSPM) — the configuration gap is invisible.

## Pitfalls & war stories

**The misconfigured storage bucket.** Cloud storage misconfiguration (public-read
ACL on a bucket, or AllUsers granted storage viewer) is the most common cloud
data breach pattern. The storage service's underlying encryption is perfect;
the access control was the customer's responsibility and was wrong. This catches
out teams who conflate "encrypted" with "secure."

**Inherited ISO certificate over-reliance.** Meridian Bank's external auditor
saw "GCP is ISO 27001 certified" and ticked a box. The ISO certification covers
Google's data centres and platform; Meridian's configuration of IAM, network
rules, and key management is out of scope. An ISO certificate in the provider's
name does not transfer to the tenant. This appears in PCI-DSS Req 12.8.5
specifically to prevent it.

**The SaaS HR platform that holds PII.** Northwind adopted a SaaS HR platform
for its 3,000 field staff. The vendor handles the application and the OS.
Northwind still owns the user provisioning and deprovisioning process — a
leaver's account left active for three months was the vector for data
exfiltration. Under DPDP Act 2023, Northwind (not the SaaS vendor) is the data
fiduciary and bears regulatory liability.

**Provider incident ≠ customer notification.** A GCP zone outage affecting
`asia-south1` will show on the Cloud Status page. A *security incident* on GCP
infrastructure follows a different, non-public notification process with much
longer timelines. Relying on status-page monitoring as your security incident
detection (rather than your own SIEM and VPC Flow Logs) is a category error.

**CMEK key deletion.** One enterprise deleted a CMEK Cloud KMS key to "clean up"
a project, before realising it was still the encryption key for a live Cloud SQL
instance and a Cloud Storage bucket of 18 months of audit logs. The data was
permanently inaccessible. Key lifecycle (creation, rotation, destruction) is
entirely a customer-owned process; the provider will not stop you deleting a key
that is still in use.

## Going deeper (optional)

- GCP Cloud Trust Center: `https://cloud.google.com/security/compliance` — primary
  source for all GCP compliance artefacts; always check here before citing a
  provider control.
- AWS Shared Responsibility Model: `https://aws.amazon.com/compliance/shared-responsibility-model/`
- PCI-DSS v4.0 Requirement 12.8 — third-party/cloud service-provider agreements
  and responsibility matrices; read the full requirement text.
- NIST SP 800-145 — the NIST definition of cloud computing; the Service Models
  section defines the three service models precisely (referenced by regulators).
- ENISA Cloud Security Guide for SMEs — concise regulator-facing language for
  shared responsibility in EU-regulated contexts.
- CSA Cloud Controls Matrix (CCM v4) — a control framework that maps each control
  to the party responsible under IaaS/PaaS/SaaS; widely referenced in FSI GRC.
- Pairs with S12 (CMEK/BYOK), S29 (frameworks map), S30 (risk management),
  S34 (CSPM/posture scanning), and S23 (incident response). Cross-references
  N39 (VPC mental model) for the network-layer scope of cloud responsibility.

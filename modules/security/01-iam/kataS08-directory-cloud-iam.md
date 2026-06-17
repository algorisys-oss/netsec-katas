# Kata S08 — Directory services & cloud IAM (Entra ID / AWS IAM / GCP IAM)

> **Track:** Security · **Module:** S1 Identity & Access Management · **Prereqs:** S04, S05, S07 · **Time:** ~40 min
> **Tags:** `security` `iam` `directory-services` `least-privilege` `cloud-iam` `federation` `fsi` `meridian-bank`

## Why it matters

Every cloud privilege escalation, every lateral move after a phishing hit, and
every audit finding about "over-permissioned service accounts" traces back to one
thing: nobody mapped the on-prem concept of a *directory* to the equivalent cloud
construct before they started assigning access. When the IT head says "we use
Active Directory for everything," and the cloud team quietly creates IAM roles
with broad permissions, the result is two identity planes that don't talk to each
other — a control gap an attacker will exploit and an auditor will find.

Understanding how the on-prem directory (Active Directory / Entra ID) federates
into cloud IAM, and how each cloud's permission model differs, is what lets you
design a single, auditable identity plane instead of two invisible ones.

## The mental model

### What a directory service actually does

Before vendor names: a **directory service** is a database that answers the
question "who is this person, what groups do they belong to, and what policies
apply to them?" It stores **identity** (username, password hash, attributes) and
**group membership** that other systems trust to make access decisions.

```
  Directory service (the authoritative "book of people")
  ┌────────────────────────────────────────────────────┐
  │  User: priya@meridian.example                      │
  │  Attributes: dept=Payments, location=HQ            │
  │  Groups: payments-ops, pci-scope-users             │
  │  Auth methods: password + MFA enforced             │
  └────────────────────────────────────────────────────┘
        │ LDAP query / Kerberos ticket / SAML assertion
        ▼
  Relying system: Windows server / cloud console / VPN concentrator
  → "Is priya in the payments-ops group?" → Yes → grant access
```

On-prem, that system is **Active Directory (AD)** — Microsoft's implementation of
LDAP + Kerberos + DNS, running on Domain Controllers (DCs). Its cloud extension is
**Microsoft Entra ID** (formerly Azure AD): the same identity store with SAML,
OIDC, and SCIM connectors added so cloud services can consume it.

### Identity vs access: a critical distinction

The directory answers **who you are** (authentication, authn). The cloud IAM
system answers **what you may do** (authorization, authz). These are two separate
planes that must be connected deliberately:

```
  On-prem directory                    Cloud IAM
  ┌──────────────────┐    federate     ┌───────────────────────┐
  │ Active Directory │ ─────────────▶  │ GCP: Workforce        │
  │ (or Entra ID)    │  SAML / OIDC   │    Identity Pool       │
  │                  │                │ AWS: IAM Identity      │
  │ Entra ID         │ ─────────────▶ │    Center (SSO)        │
  │ (cloud IdP)      │                │ Azure: native          │
  └──────────────────┘                └───────────────────────┘
        authn                               authz
   (proves identity)             (maps identity → permissions)
```

Without federation the result is **shadow identities**: every cloud account has
local users with passwords that the on-prem security team cannot see, rotate, or
disable when someone leaves. This is the #1 audit finding in cloud migrations.

### GCP IAM fundamentals

GCP's permission model has three primitives:

```
  PRINCIPAL  ─── has ──▶  ROLE  ─── contains ──▶  PERMISSIONS
  (who)                   (what can be done)       (individual API verbs)

  Principals: user account · service account · group · domain · allUsers
  Roles: Basic (Owner/Editor/Viewer) · Predefined · Custom
```

Permissions are individual API verbs: `storage.objects.get`,
`compute.instances.start`. You never assign permissions directly — you assign
**roles** (bundles of permissions) to principals.

**Resource hierarchy** — where policies are attached matters:

```
  Organization (meridian.example)
       │  ← Org-level policy: applies everywhere
       ▼
     Folder  (e.g. "production")
       │  ← Folder policy: all projects under it
       ▼
    Project  (e.g. "meridian-payments-prod")
       │  ← Project policy: just this project
       ▼
   Resource  (e.g. a Cloud Storage bucket)
              ← Resource policy: adds access for just this resource
                (additive — cannot revoke inherited grants)
```

Policy **inheritance**: a binding at a higher level is additive to lower levels.
You cannot revoke a permission granted by a parent policy at the child — a common
mistake that makes "narrow access" policies broader than intended.

### AWS IAM fundamentals

AWS separates **identity** (IAM users, roles, groups) from **resource policy**
(S3 bucket policies, KMS key policies). The two must be evaluated together:

```
  IDENTITY-BASED POLICY (attached to user/role)
    "Role payments-lambda may: s3:GetObject on *"

  RESOURCE-BASED POLICY (attached to the resource)
    "s3:GetObject allowed if principal is role payments-lambda"

  Effective permission = identity policy  ∩  resource policy
     (both must allow; either explicit DENY wins)
```

AWS also has **SCPs** (Service Control Policies, see glossary) at the
Organizations level — hard limits that cap what any identity in an OU can do,
regardless of what IAM says. This is AWS's equivalent of GCP's Org Policy
constraints.

```
  AWS Organizations
       │
       OU: production
       │  SCP: Deny s3:DeleteBucket on * (hard guardrail)
       ▼
    Account: meridian-payments-prod
       IAM role: payments-lambda
         Identity policy: Allow s3:GetObject, s3:PutObject
         Effective: GetObject + PutObject allowed; DeleteBucket denied by SCP
```

### Entra ID (Azure AD) as the hub IdP

At Meridian Bank, on-prem identities live in **Active Directory Domain Services
(AD DS)** running on DCs in HQ-DC1. **Entra ID Connect** (formerly Azure AD
Connect) synchronises those identities to Entra ID (cloud). Both GCP and AWS
support federation with Entra ID as the IdP, so Meridian staff use one login:

```
  HQ-DC1 AD DS ──── Entra ID Connect (sync) ──▶  Entra ID (cloud IdP)
                                                     │
                               SAML / OIDC ──────────┤
                                                     ├──▶  GCP Workforce Pool
                                                     ├──▶  AWS IAM Identity Center
                                                     └──▶  Azure (native)
```

The result: Priya logs in once with her AD credentials + MFA. Entra ID issues an
assertion. GCP or AWS trusts that assertion and maps her Entra group
`payments-ops` to the cloud role `roles/bigquery.dataViewer` on the payments
project (see the worked example below for the exact binding). No
separate cloud password. No shadow account. When Priya leaves, IT disables her AD
account and access everywhere is cut within minutes (see JML — joiner-mover-leaver,
S07).

## Worked example

**Meridian Bank — payments service on GCP with federated identity**

Meridian runs a payments batch service in GCP project `meridian-payments-prod`
in VPC `10.100.0.0/14` (the GCP range from `reference/running-example.md`).
Requirements: least-privilege, federated identity, service account for the
workload, human access via Entra ID.

**Step 1 — Federate Entra ID into GCP Workforce Identity Pool**

```
# GCP CLI — create a Workforce Pool for Meridian's Entra ID tenant
gcloud iam workforce-pools create meridian-entra \
  --organization=ORGANIZATION_ID \
  --location=global \
  --description="Meridian Bank Entra ID federation"

# Add the Entra ID OIDC provider
gcloud iam workforce-pools providers create-oidc meridian-entra-oidc \
  --workforce-pool=meridian-entra \
  --location=global \
  --issuer-uri="https://login.microsoftonline.com/TENANT_ID/v2.0" \
  --client-id="YOUR_APP_CLIENT_ID" \
  --attribute-mapping="google.subject=assertion.sub,google.groups=assertion.groups" \
  --attribute-condition="'payments-ops' in google.groups"
```

**Step 2 — Bind the Entra group to a GCP predefined role (least privilege)**

```
# Grant the Entra group 'payments-ops' the BigQuery Data Viewer role
# on the specific dataset — not on the project
gcloud projects add-iam-policy-binding meridian-payments-prod \
  --member="principalSet://iam.googleapis.com/locations/global/workforcePools/meridian-entra/group/payments-ops" \
  --role="roles/bigquery.dataViewer"
```

Not `roles/bigquery.admin`. Not `roles/editor`. The single read-only role the job
requires. PCI-DSS Req 7.1 demands this.

**Step 3 — Service account for the workload (non-human identity)**

The payments batch job runs as a **service account** — a non-human identity scoped
to the workload:

```
gcloud iam service-accounts create payments-batch-sa \
  --display-name="Payments batch job SA" \
  --project=meridian-payments-prod

# Grant only what the job needs: read from GCS, write to BigQuery
gcloud projects add-iam-policy-binding meridian-payments-prod \
  --member="serviceAccount:payments-batch-sa@meridian-payments-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"

gcloud projects add-iam-policy-binding meridian-payments-prod \
  --member="serviceAccount:payments-batch-sa@meridian-payments-prod.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"
```

No service account key file is exported. The VM running the job is assigned the
SA and credentials are fetched from the metadata server at runtime (Workload
Identity). See S07 (PAM) and S33 (cloud IAM deep-dive) for key hygiene.

**Equivalent on AWS — same Meridian Bank scenario**

```
# IAM Identity Center: map Entra ID group → AWS permission set
# (done in the console or via AWS CDK/Terraform)
#
# Permission set: meridian-payments-readonly
#   Managed policy: arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
#   Inline: Deny s3:* on * Condition: not in ap-south-1 bucket (data residency)
#
# Assignment: Entra group payments-ops → permission set → account 123456789012
```

For the workload (Lambda or EC2), an **IAM role** with a trust policy — not a
long-lived access key:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

Attach the permission policy separately (S3 read + DynamoDB write for the
specific table ARN). The Lambda assumes the role at runtime; no credential stored.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Directory / IdP | Active Directory DS | Cloud Identity or Workspace | IAM Identity Center (built-in IdP) | Entra ID (native) |
| External IdP federation | AD FS / SAML broker | Workforce Identity Pool | IAM Identity Center + external IdP | Entra ID External Identities |
| Human login to console | AD login (cached) | Workforce Pool assertion → console SSO | IAM Identity Center portal | Entra ID SSO |
| Non-human workload identity | AD service account / gMSA | Service Account + Workload Identity | IAM Role (trust policy to service) | Managed Identity (system or user) |
| Permission grouping | AD security group → GPO | Role (predefined or custom) | IAM Policy (managed or inline) | RBAC Role Definition |
| Permission scope | OU / GPO scope | Org → Folder → Project → Resource | Organization → OU → Account → Resource | Management Group → Subscription → Resource Group → Resource |
| Hard guardrails (preventive) | GPO / AD policies | Org Policy constraints | SCP (Service Control Policy) | Azure Policy (deny effect) |
| Audit log of access | Windows Security Event Log | Cloud Audit Logs (Admin Activity + Data Access) | CloudTrail | Entra ID audit log + Azure Monitor |
| Sync on-prem ↔ cloud IdP | — | Google Cloud Directory Sync (GCDS) | AD Connector / managed AD | Entra ID Connect |
| Condition-based access | AD group + RADIUS policy | IAM Conditions (resource tags, time, IP) | IAM Condition keys (aws:RequestedRegion etc.) | Entra ID Conditional Access |

## Do it (the exercise)

**Part A — Examine a GCP IAM policy** [needs cloud account]

1. In your GCP project, run:
   ```bash
   gcloud projects get-iam-policy YOUR_PROJECT --format=json | \
     python3 -c "import json,sys; p=json.load(sys.stdin); \
     [print(b['role'], ':', b['members']) for b in p['bindings']]"
   ```
   For each binding, identify: is this a user, group, service account, or
   `allUsers`? Is the role predefined or basic? Is the scope too broad?

2. List all service accounts and flag any with exported keys:
   ```bash
   gcloud iam service-accounts list --project=YOUR_PROJECT
   gcloud iam service-accounts keys list \
     --iam-account=SA_EMAIL --project=YOUR_PROJECT
   ```
   Any `USER_MANAGED` key type is a finding — it means a long-lived secret exists
   somewhere. Ask where it's stored.

**Part B — Audit an AWS account** [needs cloud account]

1. Generate a credential report (shows last-used dates for all IAM users):
   ```bash
   aws iam generate-credential-report
   aws iam get-credential-report --output text --query Content \
     | base64 -d | cut -d, -f1,4,5,9,10,11
   ```
   Look for: `password_last_used` > 90 days → stale user. Access keys with
   `access_key_1_last_used_date` never used → delete them.

2. Check for users with `AdministratorAccess` directly attached:
   ```bash
   aws iam list-users --query 'Users[].UserName' --output text | \
     tr '\t' '\n' | while read u; do
       aws iam list-attached-user-policies --user-name "$u" \
         --query "AttachedPolicies[?PolicyName=='AdministratorAccess'].PolicyName" \
         --output text | grep -q AdministratorAccess && echo "ADMIN USER: $u"
     done
   ```

**Part C — Pen and paper** [laptop]

Draw the identity flow for Priya (Meridian Bank, payments-ops team) accessing the
GCP BigQuery console:

1. She opens `console.cloud.google.com`. Where does the browser go first?
2. Entra ID authenticates her with MFA. What does it issue?
3. GCP's Workforce Pool receives what token? What claim maps her to what role?
4. She requests `SELECT * FROM payments_dataset.transactions`. What permission is
   checked? Who granted it?

Answer from memory. Cross-check with the worked example above.

## Say it back (self-check)

1. What is a directory service, and why can't you replace it with a list of cloud
   IAM users?
2. In GCP, if an Org-level binding grants a principal `roles/editor`, can a
   project-level policy remove that? Why?
3. What is an IAM role trust policy in AWS, and what problem does it solve that
   long-lived access keys cannot?
4. What is Workforce Identity Federation in GCP and why does it matter for a bank
   that already has Active Directory?
5. What is the difference between an Org Policy constraint (GCP) and an IAM
   binding? Which one is stronger?

## Talk to the IT/security head

**Ask:**
- "How are on-prem identities getting into the cloud today — are they federated
  from AD/Entra, or are there local cloud users?"
  *Good answer:* "We federate via Entra ID Connect; no one has a separate cloud
  password; JML flows through the directory." *Red flag:* "We created individual
  IAM users in each account" — shadow identities, no central off-boarding.

- "Show me one service account or IAM role used by a workload. Does it have a
  key file, or does it use Workload Identity / IAM role assumption?"
  *Good answer:* "No key files; the VM/Lambda assumes the role at runtime; we
  audit SA keys weekly." *Red flag:* a CSV of exported key files somewhere in
  Git or S3 — a breach waiting to happen.

- "What is the most permissive role that any non-human identity holds in
  production, and why?"
  *Good answer:* names a specific predefined role for a specific service and
  explains the business reason. *Red flag:* "Some service accounts have Owner
  because it was easier to debug."

- "If an employee leaves today, how long before their cloud access is revoked?"
  *Good answer:* "AD account disable propagates to Entra ID, sessions time out
  within the token lifetime (1 hour), and refresh tokens are revoked — effective
  in under an hour." *Red flag:* "We submit a ticket to the cloud team" — that's
  a manual process with no SLA and a JML gap.

- "Do you have SCPs (AWS) or Org Policy constraints (GCP) in place to prevent
  public storage buckets and unencrypted resources in production?"
  *Good answer:* yes, with specific constraint names and evidence from the last
  audit. *Red flag:* "We rely on people not doing that."

**Red flags to listen for overall:**
- Primitive roles (Owner/Editor) in production.
- Service account keys stored in code repos or CI/CD secrets.
- No MFA enforced on cloud console access.
- Cloud identity and on-prem directory managed by different teams with no
  reconciliation process — this is the silent source of zombie accounts.

## Pitfalls & war stories

**The "just give them Editor for now" trap.** A development team needs to move
fast, so someone assigns `roles/editor` on the project. Six months later that
binding is still there, the developer left the company, and an attacker with a
phished token has editor rights on everything in the project. At Meridian Bank,
`roles/editor` on `meridian-payments-prod` includes BigQuery data write, Cloud
SQL control, and GCS access — an instant PCI-DSS finding.

**Service account key sprawl.** A cloud engineer exports a service account JSON
key to get a pipeline working. It goes into a Git repo (private, they thought).
The repo is later made public for a demo. This is one of the most common FSI cloud
incidents on record. GCP Workload Identity and AWS IAM role assumption exist
precisely to eliminate this pattern — but they require upfront effort teams under
delivery pressure skip.

**Federation without group mapping.** A bank federates Entra ID into GCP
Workforce Identity but maps all federated users to `roles/viewer` at the org
level "to start." Now everyone, including contractors and offshore teams, can
enumerate all project resources. Group-to-role mapping must be designed before
federation goes live, not after.

**The Northwind M&A scenario.** After acquiring Eastfield Foods (the IP overlap
problem from N11), Northwind's IT team grants Eastfield staff AWS IAM users
directly in Northwind's master account "temporarily." Temporary becomes permanent.
The Eastfield IAM users have no Entra ID federation, no MFA enforcement, and are
outside the JML process. An Eastfield employee who left still has an active access
key six months later. This is the M&A IAM equivalent of the IP overlap problem —
and it's found at almost every post-M&A cloud audit.

**IAM policy inheritance surprises.** In GCP, granting `roles/storage.admin` at
the project level gives admin rights on every bucket in the project — including
the one holding audit logs. Least-privilege at the resource level (individual
bucket policies) is harder to manage but necessary for PCI-scope data. The CISO
finds this in the first posture scan; the engineer who created it is confused
because "it's only project-level."

## Going deeper (optional)

- GCP Workforce Identity Federation documentation — official setup and claim
  mapping guide.
  `https://cloud.google.com/iam/docs/workforce-identity-federation`
- AWS IAM Identity Center documentation — integrating external IdPs and
  permission sets.
  `https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html`
- NIST SP 800-63 — Digital Identity Guidelines: the authoritative reference on
  identity assurance levels (IAL), authenticator assurance levels (AAL), and
  federation assurance levels (FAL).
- Pairs with: S04 (AuthN vs AuthZ foundations), S05 (SSO & federation protocols),
  S07 (RBAC/ABAC, PAM, JML), S33 (cloud IAM deep-dive and over-permissioned role
  analysis). Cross-track: N39 (VPC model — the network context cloud IAM controls
  access within), N29 (PCI-DSS network segmentation that IAM policy must match).

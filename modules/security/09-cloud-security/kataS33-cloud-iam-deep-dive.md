# Kata S33 — Cloud IAM deep dive & the over-permissioned-role problem

> **Track:** Security · **Module:** S9 Cloud security posture · **Prereqs:** S01, S07, S08, S32 · **Time:** ~40 min
> **Tags:** `iam` `cloud-iam` `least-privilege` `rbac` `security` `cloud` `gcp` `aws`

## Why it matters

Cloud IAM is the single most common root cause of cloud security incidents — not
misconfigured firewalls, not unpatched software. When a developer gets
`roles/editor` on a GCP project "just to move quickly," or a Lambda function
inherits an `AdministratorAccess` policy "as a placeholder," any exploit of that
workload hands the attacker the keys to the kingdom. At Meridian Bank, where an
over-permissioned cloud identity could reach core-banking APIs or PCI-scoped
storage, the CISO treats IAM hygiene as an audit finding, not a developer
preference. The architect's role is to translate that risk into concrete design
decisions before the system is built, not after the audit.

## The mental model

**First: what IAM actually solves**

On-prem, access was controlled by network topology: only machines on the CDE
VLAN could reach the database. A flat VLAN meant flat access. In cloud, network
is insufficient because compute, storage, queues, secrets, and APIs are all
software services reachable from anywhere within the VPC — and often from the
internet. IAM is the **mandatory second gate** that enforces *who can call what
API on what resource*, orthogonal to networking.

```
 On-prem mental model              Cloud mental model
 ───────────────────────           ──────────────────────────────────────
 reach the host → you're in        reach the API endpoint → still blocked
                                   unless IAM allows the caller's identity
```

**The IAM triad: Principal, Permission, Resource**

Every cloud IAM decision is:

```
  WHO     (principal)  can do   WHAT       (permission)  on   WHICH  (resource)
  ───────────────────────────────────────────────────────────────────────────────
  a Service Account    →        storage.objects.get      →    a GCS bucket
  an IAM Role (AWS)   →        s3:GetObject             →    a specific S3 bucket
  a user or group     →        bigquery.tables.query    →    a dataset
```

In GCP, permissions are **always granted via roles** (collections of
permissions). In AWS, permissions are granted via **policies** (JSON documents
attached to identities or resources).

**GCP IAM hierarchy — where you bind a role matters enormously:**

```
  Organization
    └── Folder (Business Unit)
          └── Project  ← most common binding point
                └── Resource (e.g. individual GCS bucket, BigQuery dataset)
```

A binding at a higher level is **inherited downward**. Granting
`roles/editor` at the Organization level gives edit rights to every project,
every bucket, every Cloud SQL instance in the org. This is the over-permissioned
anti-pattern.

**AWS IAM: identity-based vs resource-based policies**

```
  Identity policy   → attached to a User, Group, or Role; says what the
                       identity may do
  Resource policy   → attached to the resource (S3 bucket, KMS key, SQS queue);
                       says who may access this resource
  Both must allow   → for cross-account access both must contain an explicit
                       Allow; any explicit Deny in either overrides
```

**The six over-permissioned-role patterns architects encounter:**

```
  1. Primitive roles (GCP)      roles/editor, roles/owner at project scope
  2. Wildcards (AWS)            Action: "*", Resource: "*" in a policy
  3. Service accounts as users  a human logs in with a service account key
  4. Key file export            a service account key .json lives in a repo
  5. Instance metadata abuse    a VM's attached service account is too powerful
  6. Cross-account trust gaps   an IAM role trust policy is overly permissive
```

**Least privilege, concretely:**

A Cloud Run service that reads from one GCS bucket needs exactly:
- `roles/run.invoker` — for whoever calls it
- A custom role or `roles/storage.objectViewer` bound to **that one bucket** only

It does not need `roles/storage.admin`, `roles/editor`, or any project-level
binding.

**Workload Identity — the right pattern for service-to-service:**

GCP's Workload Identity Federation and AWS IAM Roles for Service Accounts
(IRSA, for EKS) both allow a workload to impersonate a cloud IAM identity
using a **short-lived token derived from its pod/container identity** — no long-
lived key files needed. This eliminates the "key file in a repo" class of
incident.

```
  ┌──────────────┐  pod identity token   ┌──────────────────┐  short-lived
  │  GKE pod     │ ─────────────────────▶│  GCP STS / IAM   │  access token
  │ (k8s SA)     │                       │  (Workload Id.)  │ ──────────────▶
  └──────────────┘                       └──────────────────┘  calls GCS API
  No key file ever leaves the cluster.
```

## Worked example

**Scenario: Meridian Bank's mobile-banking backend on GCP**

The mobile API runs in a GKE cluster in the GCP project `meridian-mobile-prod`
(`10.100.0.0/14` range, see `reference/running-example.md`). It needs to:

1. Read a customer profile from a Cloud Spanner database in the same project.
2. Write audit events to a Cloud Storage bucket `meridian-audit-logs`.
3. Call a Secret Manager secret `core-banking-api-key`.

**Bad (what the dev team originally set up):**

```
  GKE node pool's default service account:
    roles/editor  (project-level)
  ──→ has write access to ALL buckets, Spanner instances, secrets, and
      Compute instances in the project and any inherited folders
```

This is audit finding #1 every CSPM tool will raise. One pod exploit = full
project compromise.

**Good (least-privilege remediation):**

```
  1. Disable project default service account auto-grant of editor
     (org policy: iam.automaticIamGrantsForDefaultServiceAccounts = false)

  2. Create a dedicated Kubernetes service account: ksa-mobile-api

  3. Bind it to a GCP service account: gsa-mobile-api@meridian-mobile-prod.iam.gserviceaccount.com
     via Workload Identity Federation — no key file

  4. Grant precise permissions:
     - roles/spanner.databaseReader  bound at the specific database resource
                                         (Spanner supports fine-grained IAM at
                                          the database level — bind there, not
                                          at the project)
     - roles/storage.objectCreator   on  gs://meridian-audit-logs  (bucket-level)
     - roles/secretmanager.secretAccessor
                                     on  projects/.../secrets/core-banking-api-key
```

Blast radius of a compromised pod: one Spanner database, one GCS bucket (write
only), one secret. Not the entire project.

**AWS equivalent at Northwind FMCG (AWS primary):**

Northwind's ERP API runs in EKS in account `northwind-erp-prod`. The same
principle applies with IRSA:

```yaml
# Pod annotation — no IAM key file
annotations:
  eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/northwind-erp-api
```

The IAM role trust policy trusts only the EKS OIDC provider for that cluster.
The permission policy grants only the S3 `GetObject` and `PutObject` on the
specific bucket `arn:aws:s3:::northwind-erp-data/*` — not `s3:*` on `*`.

**Checking for over-permissioned roles [needs cloud account]:**

```bash
# GCP: list all bindings at project level
gcloud projects get-iam-policy meridian-mobile-prod --format=json \
  | jq '.bindings[] | select(.role | test("roles/(editor|owner)"))'

# AWS: find policies with wildcard actions (requires aws CLI + access)
aws iam list-policies --scope Local --query 'Policies[*].Arn' --output text \
  | xargs -I{} aws iam get-policy-version \
      --policy-arn {} \
      --version-id $(aws iam get-policy --policy-arn {} \
                      --query 'Policy.DefaultVersionId' --output text) \
      --query 'PolicyVersion.Document' \
  2>/dev/null | grep '"Action": "\*"'
```

**IAM Recommender (GCP) — the automated path to least privilege:**

GCP IAM Recommender analyses 90 days of Cloud Audit Log data and surfaces roles
where the principal never used most of the granted permissions:

```
  Recommendation: Replace roles/editor for gsa-mobile-api with:
    roles/spanner.databaseReader
    roles/storage.objectCreator (on bucket meridian-audit-logs)
    roles/secretmanager.secretAccessor (on secret core-banking-api-key)
  Estimated permission reduction: 94 %
```

AWS equivalent: AWS IAM Access Analyzer + IAM Last Accessed data feeds the
same conclusion manually.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Identity entity | AD user / service account | GCP principal (user, group, service account, Workload Identity pool) | IAM User / Role / Identity Center identity | Entra ID user / managed identity / service principal |
| Permission set | AD group membership, ACL | IAM Role (curated set of permissions) | IAM Policy (JSON, attached to identity or resource) | Azure Role (RBAC) / policy definition |
| Where binding lives | OU or object ACL | Resource hierarchy (org / folder / project / resource) | Account, OU (Organizations SCP), or resource policy | Management group / subscription / resource group / resource |
| Deny rules | ACL deny ACE | IAM deny policies (org-level; newer) | SCP deny (Organizations); explicit Deny in policy | Azure deny assignment |
| Service workload identity | Managed service account | Service Account + Workload Identity Federation | IAM Role for EC2/Lambda/EKS (IRSA) | Managed Identity (system or user assigned) |
| Keyless auth for workloads | Kerberos / certificates | Workload Identity Federation (OIDC/SAML token → short-lived SA token) | IRSA / EC2 instance metadata (IMDSv2) | Managed Identity token endpoint |
| Primitive / overly broad roles | Domain Admin | `roles/owner`, `roles/editor`, `roles/viewer` at project/org | `AdministratorAccess` managed policy; `Action: "*"` inline | Owner / Contributor built-in role at subscription |
| Automated least-privilege tool | - | IAM Recommender (90-day log analysis) | IAM Access Analyzer + Last Accessed | (Azure: TODO) |
| Guardrail above IAM | Group Policy | Org Policy (preventive constraints) | SCP (Service Control Policy) | Azure Policy |
| Cross-account / cross-project access | AD trust | Resource-level IAM binding for external principal | IAM role with trust policy (sts:AssumeRole) | Azure Lighthouse / cross-tenant |

## Do it (the exercise)

**Step 1 — Find the worst offenders [laptop / paper]**

Take any cloud account you have access to (even a personal GCP free-tier or
AWS free-tier account). List all principals and their roles/policies. Circle
any that match the six anti-patterns listed in the mental model.

**Step 2 — Read an IAM policy by hand [laptop]**

Paste this AWS IAM policy fragment and name every permission it grants,
then say what the blast radius would be if this role were compromised:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:ListSecrets"
      ],
      "Resource": "*"
    }
  ]
}
```

Answer: full control of every S3 bucket + read any secret in Secrets Manager.
Correct to specific bucket ARNs and specific secret ARNs.

**Step 3 — Simulate a permission check [needs cloud account]**

GCP: use the Policy Troubleshooter to ask "can `gsa-mobile-api` delete objects
from bucket `meridian-audit-logs`?" — then check whether your remediated
binding prevents it. (The Policy Troubleshooter evaluates the *current* effective
access; the Policy Simulator, which tests *proposed* policy changes, is driven
from the Console/API rather than a `gcloud` verb.)

```bash
# GCP Policy Troubleshooter (gcloud CLI) — RESOURCE is a positional
# full resource name
gcloud policy-troubleshoot iam \
  //storage.googleapis.com/projects/_/buckets/meridian-audit-logs \
  --principal-email=gsa-mobile-api@meridian-mobile-prod.iam.gserviceaccount.com \
  --permission=storage.objects.delete
```

Expected result after remediation: access is `NOT_GRANTED` — the role grants
only `storage.objectCreator`, not `storage.objectAdmin` (which includes
`storage.objects.delete`).

AWS equivalent: `aws iam simulate-principal-policy`

**Step 4 — Write a least-privilege IAM policy [laptop / paper]**

For a GCP Cloud Function that: (a) reads a single Pub/Sub subscription, (b)
writes to BigQuery dataset `meridian_events`, write the minimum IAM bindings.
Do not use any primitive role. Verify each role name is real in the GCP IAM
roles reference before writing it down.

Answer to check yourself:
- `roles/pubsub.subscriber` bound to the specific subscription
- `roles/bigquery.dataEditor` bound to the specific dataset (not the project)
- The Cloud Function's service account has no other bindings.

## Say it back (self-check)

1. What are the six over-permissioned-role patterns, and which one is most
   common in GCP projects that started as development environments?

2. What is the difference between an IAM role binding at project level vs at
   resource level in GCP? Give a concrete example of why it matters.

3. Why is a service account key file (.json) a worse credential than Workload
   Identity, and what attack does Workload Identity eliminate?

4. In AWS, if an identity policy allows `s3:GetObject` on a bucket, but the
   bucket resource policy has no statement for that identity, does the access
   succeed? (Hint: for same-account access, yes — an identity-based policy Allow
   is sufficient on its own; a matching resource policy is not required, absent
   an explicit Deny. A resource policy only becomes mandatory for cross-account
   access.)

5. What is IAM Recommender and what data source does it use to generate its
   suggestions?

## Talk to the IT/security head

**Ask:**

- "What org-level guardrails prevent any project team from granting
  `roles/editor` or `roles/owner` at the org or folder level?" *(Tests whether
  Org Policy / SCP is in place above IAM.)*

- "How do your GKE or EKS workloads authenticate to cloud APIs — service
  account key files or Workload Identity?" *(Key files in repos is a critical
  finding; WI/IRSA is the expected answer.)*

- "When did you last run IAM Recommender or Access Analyzer across all
  accounts, and what was the highest-severity finding?" *(Reveals whether
  least-privilege is aspirational or enforced.)*

- "If a developer leaves tomorrow, is there an automated process to remove
  their IAM bindings across all projects and accounts?" *(Joiner-mover-leaver
  hygiene; pairs with S07.)*

- "For PCI-scoped services, are service accounts scoped to the CDE project
  only, and is cross-project access via resource-level bindings audited?" *(RBI
  and PCI-DSS both require this kind of isolation.)*

**A good answer sounds like:** "We enforce least privilege with a combination of
Org Policy constraints (no broad primitive roles at folder or org scope), CSPM
posture scoring, and quarterly IAM Recommender sweeps. All production workloads
use Workload Identity — no key files. IAM changes go through our IaC pipeline
and are reviewed before apply."

**Red flags:**

- "Developers get editor on their projects by default" — guaranteed over-
  permissioning at scale.
- "We have service account key files, but they're in a secure location" — the
  location is not the risk; the existence of a long-lived exportable credential is.
- "We'll tighten IAM after go-live" — by go-live, the over-permissioned
  bindings become load-bearing and are never removed.
- The CISO can't say what guardrail exists above IAM (Org Policy / SCP) — it
  means IAM mistakes by project teams are unchecked.

## Pitfalls & war stories

**The "placeholder" role that became permanent.** A Meridian Bank integration
team was given `roles/editor` on the cloud project "just for the first sprint."
Three months later the project was in production, the binding was never removed,
and the annual pen-test found a pod escape that led directly to the Spanner
database holding account data — because the node service account was still
`roles/editor`. The fix took two weeks of regression testing.

**Service account key in a private repo that got made public.** A developer at
Northwind pushed a `.json` key file to a "private" GitHub repo. The repo was
briefly set public for a collaboration, then set back. Attackers scraped GitHub
for key files continuously; the key was found and used to access Northwind's
ERP data in S3. The key file had `s3:*` on `*`. Workload Identity has zero key
files to leak.

**The `*` wildcard that nobody noticed.** AWS inline policies written under time
pressure often start with `Action: "*"` to "make it work" and are never
narrowed. At scale, a single compromised Lambda can exfiltrate data from every
S3 bucket in the account. IAM Access Analyzer does not surface this unless you
actively run it; CSPM tools (see S34) do.

**Cross-account trust policy too broad.** An AWS role trust policy that says
`"AWS": "arn:aws:iam::PARTNER_ACCOUNT:root"` trusts *any identity in the
partner account*, not just the agreed service role. If the partner's account is
compromised, the attacker inherits the trust. Always scope to the specific
partner IAM role ARN, not the account root.

**PCI-DSS and IAM audit evidence.** PCI-DSS Requirement 7 (least privilege) and
Requirement 8 (user identification and authentication) both require evidence of
quarterly access reviews. In cloud, "quarterly reviews" means automated IAM
Recommender sweeps and CSPM posture snapshots exported to audit storage — not a
spreadsheet screenshot.

## Going deeper (optional)

- GCP IAM documentation: [cloud.google.com/iam/docs/overview](https://cloud.google.com/iam/docs/overview)
- GCP IAM Recommender: [cloud.google.com/iam/docs/recommender-overview](https://cloud.google.com/iam/docs/recommender-overview)
- GCP Workload Identity Federation: [cloud.google.com/iam/docs/workload-identity-federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- AWS IAM best practices: [docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- AWS IAM Access Analyzer: [docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html](https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html)
- IRSA (IAM Roles for Service Accounts in EKS): [docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)
- NIST SP 800-207 (Zero Trust Architecture) §2.3 — IAM as a core Zero Trust plane.
- PCI-DSS v4.0 Requirements 7 & 8 — least privilege and identity requirements.
- Pairs with S07 (RBAC vs ABAC; least privilege; PAM) and S34 (CSPM/CWPP/CNAPP).

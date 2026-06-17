# Kata S37 — Encryption & key management in cloud (Cloud KMS / AWS KMS / Key Vault)

> **Track:** Security · **Module:** S9 Cloud security posture · **Prereqs:** S09, S11, S12, S33 · **Time:** ~40 min
> **Tags:** `security` `kms` `key-management` `encryption-at-rest` `cmek` `byok` `hsm` `cloud`

## Why it matters

Every cloud service stores data somewhere. By default most services encrypt it — but
with keys the cloud provider fully controls. For Meridian Bank, that is not enough:
PCI-DSS Requirement 3.5 mandates that cryptographic key management is documented and
controlled, RBI guidelines require that encryption keys for regulated data remain under
the bank's custody, and auditors will ask who can decrypt the cardholder database if
the provider is compelled by a foreign court. The answer "we trust Google/AWS" fails
that test. Cloud KMS is how a bank keeps the key in its own hands while still running
in the cloud — and understanding it is the difference between a cloud design that
passes a CISO review and one that gets sent back with a critical finding.

## The mental model

### The problem: who holds the key?

When a cloud storage service encrypts your data, the encryption is real but there are
two separable questions:

```
  WHO GENERATES    the data-encryption key (DEK)?
  WHO HOLDS        the key-encryption key (KEK) that wraps the DEK?
```

By default both answers are "the cloud provider." That is **provider-managed
encryption**: convenient, zero-friction, genuinely encrypted — but the provider can
always decrypt on behalf of law enforcement or a compelled disclosure.

**Envelope encryption** is the pattern every cloud KMS builds on:

```
  plaintext data
       │
       ▼
  [ DEK (AES-256, random per object) ] ──── encrypts ──► ciphertext (stored)
       │
       ▼ (DEK is itself encrypted by...)
  [ KEK — lives in KMS, never exported ]   (stored alongside ciphertext as wrapped DEK)

  To read: KMS unwraps DEK → DEK decrypts ciphertext → plaintext.
  If the KEK is deleted or the caller lacks IAM permission → data is permanently inaccessible.
```

The elegance: DEKs are small (~32 bytes) and can be rotated per object without
re-encrypting every byte of data — you only re-wrap the DEK with the new KEK. This is
called **re-wrapping**.

### Three custody models

```
  Model             Who holds / supplies KEK                       Cloud term
  ─────────────────────────────────────────────────────────────────────────────
  Provider-managed  Cloud provider (opaque)                        default / GMEK (Google)
  Customer-managed  Customer, via cloud KMS service                CMEK
  Customer-imported Customer generates key material, imports it    BYOK (import)
                    into the cloud KMS
  Customer-supplied Customer passes raw key per API call;          CSEK (GCP)
                    provider never stores it
  Externally held   Key stays in customer HSM, never in cloud      EKM / HYOK / XKS
```

The IT head and CISO usually want **CMEK** (Customer-Managed Encryption Keys): the key
lives in the cloud's KMS but access is controlled by the customer's IAM policy. The
cloud provider never sees plaintext keys — cryptographic operations execute inside the
KMS boundary without the key material leaving it. Note the assurance level depends on
the protection level you choose: default software-protected CMEK keys are FIPS 140-2
Level 1; only HSM-protection-level keys (GCP `PROTECTION_LEVEL HSM` / Cloud HSM) run
inside a FIPS 140-2 Level 3 Hardware Security Module. CMEK by itself does not imply an
L3 HSM — you must explicitly select the HSM protection level.

**BYOK** (Bring Your Own Key) goes further: the customer generates key material in
their own on-prem HSM (e.g. a Thales Luna or nShield), wraps it under the cloud KMS
transfer key, and imports it. The cloud never generated the master key. This satisfies
the strictest auditors who want verifiable key genesis outside the provider.

**HYOK** (Hold Your Own Key) — sometimes called External Key Manager (EKM) — is
rarer: the key never enters the cloud at all. Every encrypt/decrypt call phones out to
the customer's own HSM. Data is inaccessible if the customer's HSM is offline. Very
high assurance, very high operational burden; Meridian Bank's most sensitive data
vaults might justify it.

```
  Assurance ladder (↑ control, ↑ complexity):

  Provider-managed ──► CMEK ──► BYOK (imported) ──► HYOK/EKM (external)
         easy                                              painful
```

### Key lifecycle: the states a key passes through

```
  PENDING_CREATION → ENABLED → DISABLED ──► SCHEDULED_DESTROY → DESTROYED
                        │
                        └──► KEY VERSION ROTATION (new version primary)
                             old versions: can still decrypt; cannot encrypt
```

**Rotation** creates a new key version; the old version is kept enabled until all data
encrypted by it is re-wrapped or rotated. Deletion is irreversible — if data encrypted
by a key version is destroyed along with the key, recovery is impossible. This is why
deletion has a mandatory delay window: GCP Cloud KMS schedules destruction after a
configurable duration (default 30 days, up to 120 days); AWS KMS uses a pending
deletion window of 7–30 days (`schedule-key-deletion --pending-window-in-days`).

## Worked example

Meridian Bank's GCP deployment (primary cloud, `10.100.0.0/14`) stores three classes
of data in Cloud Storage and BigQuery:

| Data class | Example | CMEK requirement | Rotation period (cryptoperiod) |
|---|---|---|---|
| Cardholder data (CDE) | PAN records in BigQuery | Yes, CMEK mandatory | 1 year (bank-defined cryptoperiod) |
| Customer PII | KYC documents in GCS | Yes, CMEK | 1 year |
| Application logs | Cloud Logging export bucket | Provider-managed OK | n/a |

The rotation periods above are *the bank's own cryptoperiods*, not PCI-prescribed
figures. PCI-DSS v4.0 (Req 3.6.1 / 3.7.4) requires keys to be rotated at the end of a
cryptoperiod the entity defines per industry best practice (see NIST SP 800-57). There
is no PCI-mandated 90-day key-rotation interval — the 90-day figure is the legacy
password-change rule, not a key cryptoperiod. Meridian Bank picks an annual cryptoperiod
for the CDE key in its key-management policy and rotates at the end of it.

The bank creates a dedicated key ring for each environment:

```
  GCP Project: meridian-prod-data
  Key ring: meridian-prod-keyring  (region: asia-south1 — data residency)
    Key: bigquery-cde-key          (AES-256-GCM, 1-year auto-rotation per key-mgmt policy)
    Key: gcs-pii-key               (AES-256-GCM, 1-year auto-rotation)

  GCP Project: meridian-prod-app (a service project)
    BigQuery Dataset: card_transactions
      → Encrypted with: meridian-prod-keyring/bigquery-cde-key
```

The service account that runs BigQuery jobs is granted:
```
  roles/cloudkms.cryptoKeyEncrypterDecrypter
  on: meridian-prod-keyring/bigquery-cde-key
```

The security team's admin account is granted:
```
  roles/cloudkms.admin
  on: meridian-prod-keyring   (can disable/schedule destroy; cannot decrypt data directly)
```

Notice: these are **separate roles** on **separate projects**. The BigQuery workload
can encrypt/decrypt but cannot rotate or delete keys. The security admin can manage
the key lifecycle but cannot directly decrypt the dataset. This is segregation of
duties in the key plane — mirroring the network/security split the bank already lives
by (see N02).

### Checking a key's IAM policy [needs cloud account]

```bash
gcloud kms keys get-iam-policy bigquery-cde-key \
  --keyring=meridian-prod-keyring \
  --location=asia-south1 \
  --project=meridian-prod-data
```

Expected output shows bindings; absence of `allUsers` or `allAuthenticatedUsers` is
mandatory — any such binding is a critical finding.

### Envelope encryption: tracing one BigQuery write

```
  1. BigQuery generates a random DEK (32 bytes, AES-256).
  2. BigQuery calls Cloud KMS: CryptoKey.Encrypt(DEK) using bigquery-cde-key.
  3. Cloud KMS HSM wraps DEK → returns wrapped-DEK (ciphertext of DEK).
  4. BigQuery stores: { row data encrypted with DEK } + { wrapped-DEK }.
  5. Cloud KMS is now NOT needed to store data — only to read it.

  Read path:
  6. BigQuery calls Cloud KMS: CryptoKey.Decrypt(wrapped-DEK).
  7. Cloud KMS HSM unwraps → returns DEK in memory.
  8. BigQuery decrypts row data in compute memory.
  9. DEK is discarded — never stored in plaintext.
```

The cloud KMS logs **every Encrypt and Decrypt call** to Cloud Audit Logs. For the CDE
key, the bank configures a log sink to a locked, separate GCP project — auditors get
proof of every access without touching production.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---|---|---|---|---|
| Key management service | Hardware HSM (Thales, nShield) | Cloud KMS | AWS KMS | (Azure: TODO) |
| HSM-backed keys (FIPS 140-2/140-3 L3) | On-prem HSM | Cloud HSM (within Cloud KMS) | Default AWS KMS (multi-tenant HSMs); CloudHSM / `--origin AWS_CLOUDHSM` for single-tenant dedicated HSM | (Azure: TODO) |
| Customer-managed keys for storage | Customer runs/integrates HSM | CMEK on GCS, BigQuery, Spanner, etc. | SSE-KMS on S3, EBS, RDS, etc. | (Azure: TODO) |
| Bring Your Own Key (import) | Key generated in on-prem HSM | Import job (wrapped under Google wrapping key) | Import key material (wrapped under RSA wrapping key) | (Azure: TODO) |
| Hold Your Own Key / External KMS | Key never leaves premises | Cloud EKM (External Key Manager) | XKS — External Key Store (KMS external key store) | (Azure: TODO) |
| Key grouping | Key hierarchy on HSM | Key ring → CryptoKey → CryptoKeyVersion | No rings; KMS key → key material version | (Azure: TODO) |
| Key rotation | Manual or HSM-scheduled | Auto-rotation period per key (CryptoKey) | Automatic rotation with configurable period (90–2560 days, since late 2024) or manual on-demand rotation | (Azure: TODO) |
| Access control for keys | HSM admin + ACLs | IAM on key ring / key / project | KMS key policy + IAM (resource-based + identity-based) | (Azure: TODO) |
| Secrets storage (passwords, API keys) | CyberArk, HashiCorp Vault | Secret Manager | AWS Secrets Manager | (Azure: TODO) |
| Envelope encryption primitives | DEK wrapped by HSM KEK | Cloud KMS Encrypt / Decrypt API | GenerateDataKey / Decrypt API (Envelope Encryption helper in SDK) | (Azure: TODO) |
| Audit log for key operations | HSM audit log | Cloud Audit Logs (DATA_READ/WRITE events on cloudkms.googleapis.com) | CloudTrail (kms.amazonaws.com events) | (Azure: TODO) |

**GCP detail:** A Cloud KMS key never leaves the HSM boundary for ENCRYPT/DECRYPT
operations. The key material is not exportable by default; `--purpose ENCRYPT_DECRYPT`
keys with `PROTECTION_LEVEL HSM` enforce this. The key ring region controls where the
HSM operation executes — critical for data-residency compliance (asia-south1 = Mumbai).

**AWS detail:** AWS KMS keys are regional. A KMS key in ap-south-1 cannot be used by
a service in us-east-1 (without replication). Multi-region keys exist but are an
explicit design choice, not a default. All default AWS KMS keys are generated and
held in AWS multi-tenant HSMs validated to FIPS 140-2 / 140-3 Security Level 3 —
AWS KMS never stores key material in software. For PCI workloads needing a
single-tenant dedicated HSM (and key exportability), `aws kms create-key` with
`--origin AWS_CLOUDHSM --custom-key-store-id <id>` backs the key with a CloudHSM
custom key store (which requires a pre-existing CloudHSM cluster with ≥2 active
HSMs). Without that, the key uses the default multi-tenant KMS HSMs — still
hardware-backed and FIPS L3, just shared rather than dedicated.

## Do it (the exercise)

### Part 1 — reason about key control [laptop / paper]

1. For Meridian Bank's AWS secondary cloud (`10.104.0.0/14`): the bank runs an RDS
   instance holding anonymised analytics data in `ap-south-1`. Decide: provider-managed,
   CMEK, or BYOK? Write one sentence of justification citing a specific constraint.
2. Northwind FMCG keeps no regulated data in cloud; their AWS primary holds ERP export
   files in S3. Should they use CMEK? Write the cost/benefit for a cost-focused FMCG IT
   head.
3. Draw (on paper) the envelope encryption flow for a Cloud Storage write. Label: DEK,
   KEK, Cloud KMS API call, ciphertext stored, wrapped DEK stored.

### Part 2 — inspect an AWS KMS key policy [needs cloud account]

```bash
# Create a test KMS key (ap-south-1; default multi-tenant HSM-backed, free-tier eligible)
aws kms create-key \
  --description "kata-s37-test" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT \
  --region ap-south-1

# Note the KeyId returned. Then inspect its policy:
aws kms get-key-policy \
  --key-id <KeyId> \
  --policy-name default \
  --region ap-south-1
```

Look for the default root account statement (`"Principal": {"AWS": "arn:aws:iam::ACCOUNT:root"}`).
This means IAM policies in the account govern access — the key is not self-contained.

```bash
# Enable automatic rotation (1 year):
aws kms enable-key-rotation --key-id <KeyId> --region ap-south-1

# Verify:
aws kms get-key-rotation-status --key-id <KeyId> --region ap-south-1
# → "KeyRotationEnabled": true

# Clean up — schedule deletion (min 7 days):
aws kms schedule-key-deletion --key-id <KeyId> --pending-window-in-days 7 --region ap-south-1
```

### Part 3 — audit log exercise [laptop / paper]

Read the following Cloud Audit Log entry for a KMS Decrypt call and answer the
questions below:

```json
{
  "protoPayload": {
    "serviceName": "cloudkms.googleapis.com",
    "methodName": "Decrypt",
    "authenticationInfo": {
      "principalEmail": "bq-pipeline@meridian-prod-app.iam.gserviceaccount.com"
    },
    "resourceName": "projects/meridian-prod-data/locations/asia-south1/keyRings/meridian-prod-keyring/cryptoKeys/bigquery-cde-key"
  },
  "timestamp": "2026-06-17T02:31:47Z"
}
```

Questions:
1. Which service account performed the Decrypt?  
2. Which project owns the key vs. which project's SA made the call — what does the
   separation tell you?
3. A Decrypt at 02:31 UTC is approximately 08:01 IST. Is this expected for a batch
   pipeline? What rule would you add to a SIEM to alert on unexpected hours?

## Say it back (self-check)

1. In envelope encryption, what is the DEK and what is the KEK? Which one is stored,
   and in what form?
2. What is the practical security difference between provider-managed encryption,
   CMEK, and BYOK? When does each model satisfy a PCI auditor?
3. Why does deleting a KMS key version have a mandatory delay window?
4. In GCP Cloud KMS, what prevents the platform team (who holds `cloudkms.admin`)
   from reading the CDE data directly?
5. Why does the region of a Cloud KMS key ring matter for data-residency compliance?

## Talk to the IT/security head

**Ask:**
- "Which of your cloud data stores are encrypted with CMEK today, and which are still
  on provider-managed keys?"
  *A good answer lists specific services (BigQuery, S3 buckets, RDS) and shows a
  policy or IaC config that enforces CMEK; vagueness here is a gap.*
- "What is your key rotation policy and how is compliance with it audited?"
  *Good answer: a defined rotation period per data class, automated rotation enabled in
  KMS, and a CloudTrail/Cloud Audit log query that can prove keys rotated on schedule.*
- "If a cloud provider received a lawful access order for your CDE data, what stops
  them from decrypting it?"
  *Good answer: CMEK at minimum (provider needs your key permission); BYOK or HYOK for
  the most sensitive assets. A CISO who can't answer this has a residual risk they
  haven't quantified.*
- "Where is your key custody documented and who are the key custodians named in that
  document?"
  *PCI-DSS Req 3.7 key-management requirements include dual control and split knowledge
  for manual cleartext key operations (v4.0 Req 3.7.4 / 3.7.5; the 3.6.x sub-reqs in
  v3.2.1). If nobody can name the custodians, the control is theoretical.*
- "What happens to your data if you lose access to the KMS key — do you have a key
  escrow or backup plan?"
  *Good answer: key material backed up in a second secure location (on-prem HSM or
  a second region); tested restore; an RTO for key recovery. No plan = data-loss risk.*

**Red flags:**
- "Everything is encrypted" without being able to say *who holds the key*.
- CMEK configured but no audit log monitoring on KMS Decrypt calls — you have the
  key but no detective control.
- Key rotation enabled but rotation period set to "never," or no defined cryptoperiod
  at all — PCI requires the CDE key be rotated at the end of a cryptoperiod the bank
  documents (e.g. annual), so an undefined or effectively-infinite period is a finding.
- A single IAM identity with both `cloudkms.admin` and `roles/bigquery.dataViewer` —
  segregation of duties is broken.
- No documented key custodians — PCI finding waiting to happen.

## Pitfalls & war stories

**"We enabled CMEK" ≠ "we have key control."**  
CMEK configured means your IAM policy governs key access. If the IAM policy has
overly permissive bindings — `allAuthenticatedUsers`, a poorly scoped service account,
or an admin group that includes vendor staff — the CMEK label is cosmetic. The CISO
needs to see the binding, not just the feature flag.

**Deleting a key to "destroy data" is permanent — and may not destroy it.**  
If a backup of the ciphertext exists (e.g. a GCS object version, a Bigtable backup)
after the key is destroyed, that ciphertext is unrecoverable but also unforgettable.
Regulators sometimes want both assurance: that plaintext is unreadable (key deleted)
*and* that ciphertext is removed from backups. Coordinate the two.

**Key rings in the wrong region.**  
Meridian Bank's key ring must be in `asia-south1`. A key ring in `us-central1` means
every KMS API call for data in India crosses to the US — violating RBI data-residency.
IaC (Terraform) should enforce `location = "asia-south1"` via a policy check (see S33
for Org Policy `gcp.resourceLocations`).

**AWS KMS key policies and IAM: both doors must be locked.**  
In AWS, a KMS key policy that grants `"Principal": {"AWS": "*"}` (anyone) the
`kms:Decrypt` action makes the key globally accessible regardless of IAM. And
conversely, a permissive key policy alone is not enough — IAM must also allow the
call. Both control planes must be reviewed. Forgetting the key policy is a common
audit finding.

**BYOK complexity underestimated at Northwind.**  
A large FMCG that imports its own key material gains custody but must now operate an
on-prem HSM for key generation, the import process, and key material backup. For
Northwind, with cost as the primary constraint and no regulated data, BYOK adds
operational cost for minimal compliance benefit. CMEK is usually the right stop on
the assurance ladder for non-regulated cloud workloads.

**KMS API throttling breaks production.**  
Every encrypt/decrypt call consumes KMS API quota. A poorly designed application that
calls KMS for every database row read (instead of caching the DEK in memory for the
session lifetime) can hit rate limits and trigger outages. The pattern is: call KMS
once per session to unwrap the DEK, then use the in-memory DEK for all operations in
that session.

## Going deeper (optional)

- NIST SP 800-57 Part 1 Rev 5 — *Recommendation for Key Management* — the canonical
  reference for key generation, distribution, storage, and destruction.
- PCI-DSS v4.0 Requirements 3.5–3.7 — cryptographic key management obligations for
  the CDE.
- GCP Cloud KMS documentation: `cloud.google.com/kms/docs` — especially the
  "Envelope encryption" and "Key versions" pages.
- AWS Key Management Service Developer Guide — "AWS KMS key policies" and "Importing
  key material."
- FIPS 140-2 / 140-3 — the US federal standard that defines HSM assurance levels;
  Level 3 (tamper-resistant) is what cloud KMS HSM offerings claim.
- Pairs with S09 (crypto primitives), S11 (key management & secrets concepts), S12
  (encryption at rest vs in transit vs in use), and S33 (Cloud IAM — who can call
  the KMS API).
- Revisit alongside N42 (cloud firewalls) — VPC Service Controls can wrap Cloud KMS
  to ensure KMS API calls only come from approved VPCs, adding a network-layer guard
  around the key plane.

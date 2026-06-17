# Kata S11 — Key management & secrets: KMS, HSM, Vault, envelope encryption

> **Track:** Security · **Module:** S2 Cryptography, PKI & key management · **Prereqs:** S09, S10 · **Time:** ~35 min
> **Tags:** `key-management` `kms` `hsm` `vault` `envelope-encryption` `cmek` `byok` `security`

## Why it matters

Encryption is only as strong as the discipline around the keys. Meridian Bank's
CISO can mandate "encrypt everything" — but if the database key lives in the
application config file, an attacker who reads that file decrypts the data. Key
management is the discipline that prevents this: **where** keys are generated,
**where** they live, **who** (and what code) can use them, and **how** they rotate.
This comes up in every cloud architecture review, every PCI-DSS or RBI audit, and
every conversation about CMEK, BYOK, or "bring your own HSM." Getting the mental
model right lets you challenge a design before the auditor does. (PCI-DSS
references in this kata use v4.0 numbering.)

## The mental model

### The core problem: keys are secrets too

Encrypting data with a key solves one problem — now you have two problems: protect
the data **and** protect the key. The answer is a hierarchy of keys, so each layer
only exposes the minimum:

```
  Your Data (plaintext)
        │  encrypted by
        ▼
  Data Encryption Key (DEK)   ← randomly generated per-object/per-record
        │  encrypted ("wrapped") by
        ▼
  Key Encryption Key (KEK)    ← stored in a KMS or HSM; never leaves it
        │  optionally wrapped by
        ▼
  Root of Trust / Master Key  ← lives inside the HSM hardware; never exported
```

This three-layer structure is **envelope encryption**. Only the wrapped DEK travels
with the ciphertext. The KEK stays inside a hardened boundary. To decrypt, the
application sends the wrapped DEK to the KMS, which unwraps it and returns the
plaintext DEK — the KEK itself never leaves the service.

### The three building blocks

**KMS (Key Management Service)** — Software-managed key storage backed by HSMs
under the hood. You call an API to encrypt, decrypt, or wrap/unwrap. The key
material never leaves the KMS boundary. Examples: GCP Cloud KMS, AWS KMS,
Azure Key Vault (key vault mode). Use for most workloads.

**HSM (Hardware Security Module)** — A physical (or cloud-hosted virtual) device
with a certified tamper-resistant boundary (FIPS 140-2 Level 2 or Level 3). The
master keys literally cannot be extracted — even the vendor cannot read them.
Compliance mandates (PCI-DSS Req 3.6/3.7, RBI) often require an HSM for key
derivation. Examples: on-prem: Thales Luna, Utimaco; cloud: GCP Cloud HSM
(backed by Cloud KMS), AWS CloudHSM, Azure Dedicated HSM.

**Secrets manager / Vault** — A general-purpose secret store: database passwords,
API keys, TLS certs, tokens — anything that is a secret but is not a crypto key
used for bulk encryption. Examples: HashiCorp Vault, GCP Secret Manager, AWS
Secrets Manager, Azure Key Vault (secret vault mode). Vault adds dynamic secrets
(short-lived, rotated on demand), fine-grained policies, and audit logs.

### CMEK vs BYOK vs dedicated HSM

| Model | Who controls the KEK | Where it lives | What you can do |
|-------|----------------------|----------------|-----------------|
| **Provider-managed key** | Cloud provider | Provider KMS | Nothing extra; audit via provider logs |
| **CMEK** (Customer-Managed Encryption Key) | You | Provider KMS (your key, their hardware) | Rotate, disable, destroy — killing the key renders data unreadable |
| **BYOK** (Bring Your Own Key) | You | Generated on-prem, imported to provider KMS | Key provenance is yours; import is one-way (provider can use, can't export) |
| **Dedicated / single-tenant HSM** (no standard acronym; AWS CloudHSM, Azure Dedicated HSM) | You | Your dedicated HSM cluster | Full hardware custody; you manage the HSM cluster; highest compliance bar |

The escalating control comes with escalating operational burden. Most workloads
stop at CMEK. PCI-DSS Req 3.6/3.7 and RBI for sensitive payment keys often push
to a dedicated (single-tenant) HSM.

### Key lifecycle

```
  GENERATE  →  ACTIVATE  →  USE  →  DEACTIVATE  →  DESTROY
                                          │
                                    (archive period:
                                     decrypt old data,
                                     then purge)
```

Key rotation = generating a new key version and re-encrypting the DEK (not the
data itself — you re-wrap the DEK with the new KEK version). The old version is
retained in DEACTIVATE state to decrypt previously encrypted data until all
objects have been re-encrypted.

### Why architects care about key access policy

A KMS key is useless without an access policy controlling who (identity) and what
(service account, app role) can call `encrypt`, `decrypt`, or `setIamPolicy`.
Overly broad key policies are the most common finding in FSI cloud audits — the
equivalent of leaving the safe unlocked while encrypting the documents.

## Worked example

Meridian Bank stores cardholder data (PAN, CVV) in a Cloud Spanner database in
GCP (`10.100.0.0/14` range, `asia-south1` for data residency — see
`reference/running-example.md`). The design must satisfy PCI-DSS Req 3.5
(render PAN unreadable, e.g. 3.5.1) and Req 3.6/3.7 (manage and protect the
keys used to protect stored cardholder data).

```
  Meridian Bank — PCI CDE encryption architecture (GCP)

  ┌──────────────────────────────────────────────────────────────────────┐
  │  Cloud Spanner (asia-south1)                                         │
  │  Row: PAN=<ciphertext>, DEK=<wrapped-DEK>, key_version=3            │
  └────────────────────────────┬─────────────────────────────────────────┘
                               │  wrapped DEK travels with row
                               ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  GCP Cloud KMS  (asia-south1, HSM-backed key ring: "meridian-pci")  │
  │                                                                       │
  │  Key: meridian-pci/pci-dek-wrapping-key  (AES-256, CMEK)            │
  │    version 1: DESTROYED  (purged after re-encryption sweep)          │
  │    version 2: DEACTIVATED  (retained 90 days for old ciphertext)     │
  │    version 3: ACTIVE  ◄─── current KEK                               │
  │                                                                       │
  │  IAM:  roles/cloudkms.cryptoKeyEncrypterDecrypter                    │
  │   → spanner-backend@meridian-pci.iam.gserviceaccount.com (only)     │
  └──────────────────────────────────────────────────────────────────────┘
                               │  only the service account may call decrypt
                               ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Payment-processing app (Cloud Run, VPC-connected)                   │
  │  - Calls KMS API: projects/.../cryptoKeyVersions/3:decrypt           │
  │  - Receives plaintext DEK in-memory (never written to disk)          │
  │  - Decrypts PAN in memory, processes, discards DEK                   │
  └──────────────────────────────────────────────────────────────────────┘
```

The wrapped DEK (`~64 bytes`) lives in the Spanner row. The actual card number
stays unreadable to any path that cannot call the KMS API. An attacker who steals
a Spanner backup gets encrypted rows plus wrapped DEKs — useless without KMS
access, which requires the service account credential **and** passing GCP IAM.

**Rotation schedule:** Meridian's security team sets a 90-day automatic rotation
on `pci-dek-wrapping-key` in Cloud KMS. A Cloud Scheduler job re-wraps all
existing DEKs with version N+1 over a maintenance window. Version N moves to
DEACTIVATED; version N-2 (now >180 days old) is DESTROYED.

**Secrets management alongside KMS:** Database connection strings, payment
processor API keys, and SMTP credentials for alerts are stored in **GCP Secret
Manager**, not in Cloud KMS. Secret Manager gives:

```
  gcloud secrets create db-password \
    --replication-policy=user-managed \
    --locations=asia-south1

  gcloud secrets versions add db-password \
    --data-file=<(echo -n "s3cr3t!")

  # Application fetches at startup (not baked into image):
  gcloud secrets versions access latest --secret=db-password
```

Access is scoped to `roles/secretmanager.secretAccessor` on the Cloud Run
service account. The secret never appears in environment variables of the
container image or in VCS.

**Northwind FMCG contrast:** Northwind (`10.50.0.0/16`) uses AWS as its primary
cloud. Its ERP database password rotation problem is common in FMCG M&A scenarios:
acquired "Eastfield Foods" hardcoded the RDS password in a `.env` file checked
into Git. The fix pattern — AWS Secrets Manager with automatic rotation via Lambda
— is the AWS equivalent of Secret Manager above.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Key Management Service | Manual (scripts, spreadsheets, or vendor KMS) | Cloud KMS | AWS KMS | Azure Key Vault (keys) |
| HSM-backed keys | Thales Luna, Utimaco, nCipher | Cloud HSM (via Cloud KMS, HSM key ring) | AWS CloudHSM | Azure Dedicated HSM |
| Customer-managed keys (CMEK) | Admin generates & distributes | CMEK on Cloud Storage, Spanner, BigQuery, etc. | Customer Managed CMK on EBS, S3, RDS | Customer-managed keys via Azure Key Vault |
| BYOK (import own key material) | n/a (you own everything) | Key import into Cloud KMS (`ImportJob`) | Key import into AWS KMS | BYOK via Key Vault `key import` |
| Secrets / credentials store | CyberArk, Vault, config files (bad) | Secret Manager | AWS Secrets Manager | Azure Key Vault (secrets) |
| Dynamic / short-lived secrets | HashiCorp Vault (database secrets engine) | Workload Identity + short-lived tokens | IAM role + STS; Secrets Manager rotation | Azure Managed Identity + Key Vault |
| Envelope encryption default | None (manual) | All Cloud KMS–integrated services use envelope encryption natively | AWS KMS envelope encryption (GenerateDataKey) | Azure key wrapping in Key Vault |
| Audit log | Manual or HSM audit journal | Cloud KMS data-access logs in Cloud Audit Logs | AWS CloudTrail (KMS API calls) | Azure Monitor / Key Vault audit logs |
| Key rotation | Manual or scheduled script | Automatic rotation (configurable period); re-wrap is app responsibility | Automatic rotation (configurable; AWS re-encrypts for native integrations) | (Azure: TODO) |
| FIPS 140-2 Level 3 boundary | Physical HSM appliance | Cloud HSM key rings | AWS CloudHSM (Level 3); KMS uses Level 2 | Azure Dedicated HSM (Level 3); Key Vault uses Level 2 |

## Do it (the exercise)

### Part 1 — Envelope encryption on a laptop [laptop]

Understand the DEK/KEK model with OpenSSL (no cloud account needed):

```bash
# 1. Generate a random DEK (simulates what an app does per record)
openssl rand -hex 32 > dek.bin
cat dek.bin   # 64 hex chars = a 256-bit key rendered as hex text

# 2. Generate a KEK (simulates the master key inside a KMS)
openssl rand -hex 32 > kek.bin

# 3. "Wrap" the DEK with the KEK (AES-256-CBC for illustration; real KMS uses AES-GCM or RSA-OAEP)
openssl enc -aes-256-cbc -pbkdf2 -in dek.bin -out dek.wrapped \
  -pass file:kek.bin
ls -lh dek.bin dek.wrapped   # wrapped DEK is slightly larger

# 4. Encrypt a secret with the DEK
echo "4532015112830366" > plaintext-pan.txt   # fake PAN
openssl enc -aes-256-cbc -pbkdf2 -in plaintext-pan.txt \
  -out pan.enc -pass file:dek.bin

# 5. Delete the plaintext DEK — only the wrapped version survives
rm dek.bin plaintext-pan.txt

# 6. Recover: unwrap DEK first, then decrypt
openssl enc -d -aes-256-cbc -pbkdf2 -in dek.wrapped \
  -out dek-recovered.bin -pass file:kek.bin
openssl enc -d -aes-256-cbc -pbkdf2 -in pan.enc \
  -out pan-decrypted.txt -pass file:dek-recovered.bin
cat pan-decrypted.txt   # original PAN should appear

# Clean up
rm kek.bin dek.wrapped dek-recovered.bin pan.enc pan-decrypted.txt
```

Observe: `pan.enc` + `dek.wrapped` are useless without `kek.bin`. In a real
system, `kek.bin` never leaves the KMS boundary.

### Part 2 — KMS key policy inspection [needs cloud account]

**GCP:**
```bash
# Create an HSM-backed key ring and key in a specific region
gcloud kms keyrings create kata-s11-test \
  --location=asia-south1

gcloud kms keys create test-kek \
  --keyring=kata-s11-test \
  --location=asia-south1 \
  --purpose=encryption \
  --protection-level=hsm   # HSM-backed; omit for SOFTWARE

# Check who has access (the key IAM policy)
gcloud kms keys get-iam-policy test-kek \
  --keyring=kata-s11-test \
  --location=asia-south1

# Rotate: create a new key version
gcloud kms keys versions create \
  --key=test-kek \
  --keyring=kata-s11-test \
  --location=asia-south1

# List versions and their states
gcloud kms keys versions list \
  --key=test-kek \
  --keyring=kata-s11-test \
  --location=asia-south1

# Clean up (disable then destroy — cannot delete immediately)
gcloud kms keys versions destroy 1 \
  --key=test-kek \
  --keyring=kata-s11-test \
  --location=asia-south1
```

**AWS:**
```bash
# Create a customer-managed key
aws kms create-key \
  --description "kata-s11-test" \
  --key-usage ENCRYPT_DECRYPT \
  --origin AWS_KMS \
  --region ap-south-1

# Retrieve the key policy (replace KEY_ID)
aws kms get-key-policy \
  --key-id <KEY_ID> \
  --policy-name default \
  --region ap-south-1

# Enable automatic rotation (annual by default)
aws kms enable-key-rotation --key-id <KEY_ID> --region ap-south-1

# Schedule deletion (minimum 7-day waiting period)
aws kms schedule-key-deletion \
  --key-id <KEY_ID> \
  --pending-window-in-days 7 \
  --region ap-south-1
```

### Part 3 — Secrets anti-pattern hunt [laptop]

On any personal or test project codebase:
```bash
# Look for secrets baked into code or config (common bad patterns)
grep -rE '(password|secret|api_key|token)\s*=\s*["\x27][^"\x27]{6,}' . \
  --include='*.py' --include='*.js' --include='*.yaml' \
  --include='*.env' --include='*.conf' -l

# Look for committed .env files
git log --all --full-history -- '*.env' | head -20

# Check if any .env files are tracked
git ls-files '*.env'
```

In a real FSI engagement this grep output is a finding on day one of a security
review. The fix is Secret Manager / Secrets Manager + never-commit policy enforced
via `.gitignore` and a pre-commit hook.

## Say it back (self-check)

1. Describe envelope encryption: what is a DEK, what is a KEK, and which one
   travels with the ciphertext?
2. What is the difference between a KMS and an HSM? When does a compliance
   requirement push you from KMS to HSM?
3. Distinguish CMEK, BYOK, and a dedicated (single-tenant) HSM in one sentence
   each. Which offers the highest operational custody of key material?
4. Why is "disable the key" a meaningful security response to a breach, without
   deleting the key immediately?
5. What is a secrets manager (e.g. Secret Manager, Secrets Manager, Vault) for,
   and why is it distinct from a KMS?

## Talk to the IT/security head

**Ask:**

- "For your most sensitive data (cardholder data, account balances), who controls
  the KEK — is it provider-managed, CMEK, BYOK, or a dedicated (single-tenant) HSM?"
  *A good answer:* names the KMS service, the key ring and rotation schedule, and
  says which team has `setIamPolicy` rights on the key.
  *Red flag:* "the cloud provider manages it" for PCI-scoped data — the bank then
  cannot prove to an auditor that they can revoke access.

- "What is the key rotation schedule, and is rotation automatic or manual? Who
  owns the re-encryption sweep after rotation?"
  *A good answer:* 90-day or annual rotation, automated in the KMS, with a tested
  re-wrap job for existing ciphertext.
  *Red flag:* "we rotate when we remember" or rotation that only generates a new
  key version without re-wrapping old DEKs (old data stays protected by an
  aging key).

- "Where do application secrets (DB passwords, API keys) live? Are any secrets
  in environment variables, config files, or source control?"
  *A good answer:* all secrets in Secret Manager / Secrets Manager / Vault,
  fetched at runtime via the service's own identity; no secrets in code or CI/CD
  env vars.
  *Red flag:* "we use Kubernetes secrets" without explaining that base64 ≠
  encryption; or any mention of `.env` files in the repo.

- "If a service account that has KMS decrypt permission is compromised, what is
  your response time to revoke that access, and how do you ensure the key cannot
  be used again?"
  *A good answer:* under 1 hour SLA; remove IAM binding immediately, review audit
  logs for decrypt calls in the preceding window; optionally disable key version.
  *Red flag:* no runbook, or "we'd rotate the key" without understanding that
  previously issued decrypt calls in-flight are not retroactively blocked.

- "Has a FIPS 140-2 Level 3 HSM been mandated by your compliance team? If so,
  which service provides it and who manages the HSM cluster?"
  *A good answer:* states the mandate and names the service (Cloud HSM, CloudHSM,
  or a physical appliance on-prem); knows who holds the HSM admin credentials.
  *Red flag:* "yes, we use Cloud KMS" — Cloud KMS with an HSM key ring is
  FIPS 140-2 Level 3; Cloud KMS with a SOFTWARE key ring is FIPS 140-2 Level 1
  (the BoringCrypto software module). This distinction matters to an auditor.

## Pitfalls & war stories

- **Key in the same bucket as the data.** Storing an AES key in the same Cloud
  Storage bucket as the encrypted blobs it protects is equivalent to hiding your
  house key under the doormat. A common finding at FMCG companies without a
  dedicated security team.

- **"We encrypt with CMEK" but anyone can setIamPolicy.** CMEK is meaningful only
  if the key's IAM policy is locked down. If any developer can call
  `setIamPolicy` on the key, an insider can grant themselves decrypt access.
  Meridian Bank's control: `setIamPolicy` on PCI keys requires both the security
  team's service account and a separate approver (four-eyes via IAM Conditions or
  an external approval workflow).

- **Rotation without re-encryption.** Rotating a KMS key generates a new version,
  but old ciphertext is still wrapped with version N-1. If version N-1 is
  immediately destroyed, old data becomes permanently inaccessible. Rotation and
  re-encryption are two separate, sequenced steps.

- **Secret sprawl in Kubernetes.** Kubernetes Secrets are base64-encoded — not
  encrypted — by default in etcd. FSI engineers who migrate from VMs to K8s
  sometimes assume "Kubernetes Secret" means the same as "Secret Manager secret."
  It does not. Solution: etcd encryption at rest + use External Secrets Operator
  to sync from Secret Manager/Vault.

- **HSM custody theater.** A bank that deploys an HSM but stores the HSM admin
  PIN in a shared spreadsheet has the cost without the security. The RBI IT
  Framework (2023) explicitly requires dual-control and split-knowledge for
  HSM key custodians.

- **BYOK without a key import ceremony.** Importing your own key material requires
  generating it on a FIPS-validated source (another HSM) and importing via an
  asymmetric wrapping key from the target KMS. Generating the key on a developer
  laptop and importing it defeats the purpose — the key existed in an insecure
  environment.

## Going deeper (optional)

- NIST SP 800-57 Part 1 Rev 5 — *Recommendation for Key Management* — the
  authoritative guide to key lifecycle, algorithm selection, and key lengths.
- PCI-DSS v4.0, Requirements 3.5–3.7 — render PAN unreadable (3.5) and the
  cryptographic key-management lifecycle (3.6, 3.7) for stored cardholder data.
- RFC 5652 (CMS, Cryptographic Message Syntax) — the standard wire format
  for key transport and wrapped content.
- FIPS 140-2 / FIPS 140-3 — the US government hardware security module
  validation standard; Level 2 vs Level 3 distinction matters for FSI audits.
- GCP: [Cloud KMS key management docs](https://cloud.google.com/kms/docs/key-management-service)
  and [Secret Manager best practices](https://cloud.google.com/secret-manager/docs/best-practices).
- AWS: [AWS KMS developer guide](https://docs.aws.amazon.com/kms/latest/developerguide/),
  [AWS Secrets Manager rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html).
- HashiCorp Vault: [Vault secrets engines](https://developer.hashicorp.com/vault/docs/secrets)
  — teaches the dynamic-secrets model useful for Northwind's M&A integration.
- Pairs with S09 (crypto primitives, AES, key lengths), S10 (PKI and
  certificate lifecycle), and S12 (encryption at rest vs in transit). Also
  cross-references N21 (TLS, where the private key for the TLS cert is itself
  a secret that must be managed).

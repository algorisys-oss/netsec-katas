# Kata S12 — Encryption at rest vs in transit vs in use; CMEK/BYOK

> **Track:** Security · **Module:** S2 Cryptography, PKI & key management · **Prereqs:** S09, S10, S11 · **Time:** ~35 min
> **Tags:** `encryption-at-rest` `encryption-in-transit` `cmek` `byok` `key-management` `kms` `security` `fsi`

## Why it matters

"We encrypt everything" is the answer architects hear most often — and it tells
you almost nothing. The question that matters is **where** the data is when it's
encrypted, **who controls the keys**, and **what the encryption actually protects
against**. Data can be protected in transit and exposed at rest; encrypted at rest
and readable in memory by any process. Meridian Bank's RBI/PCI-DSS auditors and
CISOs ask these questions in precisely this language. If you can't locate a data
flow in one of the three states, you can't challenge whether a control is
sufficient or missing.

## The mental model

### The three states of data

Data always exists in one of three states. Each requires a different control:

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  STATE           WHERE                   CONTROLLED BY          │
  ├─────────────────────────────────────────────────────────────────┤
  │  AT REST         disk / object store /   storage-layer          │
  │                  database / backup tape  encryption (AES-256)   │
  ├─────────────────────────────────────────────────────────────────┤
  │  IN TRANSIT      network wire / TLS      TLS 1.2/1.3, IPsec,   │
  │                  session / VPN tunnel    MACsec on the link     │
  ├─────────────────────────────────────────────────────────────────┤
  │  IN USE          RAM / CPU registers /   confidential computing,│
  │                  application memory      TEE, memory encryption  │
  └─────────────────────────────────────────────────────────────────┘
```

The critical insight: **each state requires an independent control**. TLS protects
data in transit but the moment the packet is decrypted at the load balancer,
that data is "in use" — in cleartext in memory. When the load balancer writes a
log to disk, it's now "at rest" — TLS offered zero protection there.

### Encryption at rest

The threat: an attacker (or rogue administrator) gets physical access to a disk,
a backup tape, or a cloud storage bucket. Encryption at rest means the raw bytes
on that medium are ciphertext — unreadable without the key.

How it works in practice:

```
  Object/block storage
  ┌──────────────────────────────────────────────────────┐
  │  App writes plaintext                                │
  │       │                                              │
  │       ▼                                              │
  │  Storage engine encrypts with DEK (per-object)      │
  │       │                                              │
  │       ▼  DEK is wrapped by KEK (in KMS)             │
  │  Ciphertext + wrapped-DEK stored together on disk   │
  └──────────────────────────────────────────────────────┘
  Read path: storage engine asks KMS to unwrap DEK →
  decrypts ciphertext → returns plaintext to app.
```

The **envelope encryption** structure from S11 is exactly what all cloud
providers implement under every "encryption at rest" checkbox.

Default cloud behavior: every provider encrypts all storage at rest by default,
using provider-controlled keys — **Google-managed encryption keys** (GCP's
"default encryption") / **AWS owned (or AWS managed) keys** (the default behind,
e.g., S3 SSE-S3). The cloud provider controls and rotates the KEK. This satisfies
basic compliance but is NOT sufficient for PCI-DSS CDE data or RBI-classified
sensitive data — it offers no separation between the cloud provider's access and
your data. (In this kata we use "provider-managed keys" as the shorthand for all
of these; **GMK/AMK are our shorthand, not official vendor acronyms.**)

### Encryption in transit

The threat: network eavesdropping, on-path interception (a rogue ISP, a
compromised router, a malicious insider on the DC fabric).

Control: TLS 1.2/1.3 for application traffic; IPsec for site-to-site VPN and
cloud interconnect tunnels; MACsec (IEEE 802.1AE) for link-layer encryption on
dedicated interconnect circuits.

Key architectural questions (the ones auditors ask):

1. **Where does TLS terminate?** At the CDN edge? The load balancer? Inside the
   pod/container? Data is in cleartext from the termination point onwards.
2. **Is the segment between the LB and the backend encrypted?** Many "TLS"
   designs terminate at the LB and send plaintext to backends on the internal
   network — that internal segment is unprotected.
3. **What cipher suites are permitted?** TLS 1.0/1.1 and weak ciphers (RC4,
   3DES, export suites) are explicitly prohibited by PCI-DSS Req 4.2.1.

```
  Client → [TLS] → CDN / LB → [???] → App server → [???] → Database

  Option A (common, wrong for FSI):
    TLS terminates at LB → plaintext on internal network → plaintext to DB.

  Option B (TLS re-encryption, correct for PCI CDE):
    TLS at edge → re-TLS to backend → re-TLS to DB.
    Each segment independently encrypted; plaintext only inside the process.
```

### Encryption in use

The threat: an attacker who has compromised a running process, hypervisor, or
the cloud provider's staff has access to RAM — where data must be decrypted to
be processed.

Encrypting data at rest and in transit does NOT protect it here. This is the
hardest state to address at scale. The emerging approaches:

- **Confidential computing**: CPU-level Trusted Execution Environments (TEEs)
  that encrypt memory and protect it even from the hypervisor. GCP Confidential
  VMs (AMD SEV), AWS Nitro Enclaves, Azure Confidential VMs.
- **Application-level field encryption**: encrypt individual fields (e.g. a
  card PAN) before they reach the database — the app only decrypts the specific
  field it needs, not the whole record.
- **Tokenization**: replace the sensitive value with a non-sensitive token
  (taught in S18) so downstream systems never hold plaintext at all.

For most FSI workloads today, encryption in use is addressed by **minimizing
time-in-memory** (process only what's needed, discard immediately), **strict
process isolation**, and **comprehensive memory-access logging** — not full
hardware encryption. Confidential computing is entering pilot stage at leading
banks.

### CMEK and BYOK: who controls the key?

This is the conversation that separates "we encrypt everything" from a real
security posture.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  KEY CONTROL MODEL    Keys managed by   Revocation power         │
  ├──────────────────────────────────────────────────────────────────┤
  │  Provider-managed     Cloud provider    Provider (not you)       │
  │  (GMK/AMK shorthand)                                            │
  │  CMEK                 You, in cloud KMS You (disable key = no    │
  │                       (but key material  access for anyone,      │
  │                       generated there)   incl. cloud provider)   │
  │  BYOK                 You, on-prem HSM  You (key never entered   │
  │                       or external KMS   cloud's key storage)     │
  │  HYOK / Cloud Ext Key You, external     You, with cloud only     │
  │  Manager (CEKM)       key manager       wrapping, not holding    │
  └──────────────────────────────────────────────────────────────────┘
```

**CMEK (Customer-Managed Encryption Keys):** You create a key in the cloud
provider's KMS (GCP Cloud KMS, AWS KMS). You configure cloud services to use
that key to wrap their DEKs. You can rotate or disable the key — disabling it
makes all data encrypted under it inaccessible, including to cloud provider
support staff. Key material was generated inside the cloud provider's HSM fleet.

**BYOK (Bring Your Own Key):** You generate key material outside the cloud
(typically on an on-prem HSM or Thales/Entrust appliance). You import the key
material into the cloud KMS. The key material entered the cloud boundary, but
you controlled its genesis. "Bring" means generation lineage is yours.

**HYOK / External Key Manager (EKM):** The most stringent. Key material never
enters the cloud. The cloud service calls out to your external key manager for
every encrypt/decrypt operation. If your key manager is unreachable, data is
inaccessible. GCP calls this Cloud External Key Manager (Cloud EKM); AWS calls
it AWS KMS XKS (External Key Store).

**The FSI implication:** RBI directives and most bank security policies require
that for Sensitive Personal Information and CDE data, the bank retains key
control — meaning the cloud provider cannot decrypt the data unilaterally. CMEK
at minimum; BYOK or EKM for the most sensitive data categories.

## Worked example

Meridian Bank's card-payment authorization flow touches all three states. Follow
the data:

```
  CARDHOLDER at branch terminal
        │  PAN entered on PIN pad
        │
        │  [IN TRANSIT]  TLS 1.3 from PIN pad → payment gateway
        │                IPsec tunnel: branch → HQ-DC1 (10.10.0.0/16)
        │
        ▼
  PAYMENT GATEWAY (HQ-DC1, 10.10.20.10)
        │  Receives TLS, decrypts → PAN briefly [IN USE] in gateway RAM
        │  Tokenizes PAN → PAN-Token stored
        │
        │  [IN TRANSIT]  TLS 1.3: gateway → authorization service
        │                (10.10.20.0/24, PCI CDE segment — see N27, N29)
        │
        ▼
  AUTHORIZATION SERVICE (10.10.20.50)
        │  [IN USE] PAN-Token checked against vault
        │  Auth response generated
        │
        │  [IN TRANSIT] TLS 1.3 over Cloud Interconnect: HQ-DC1 →
        │               Meridian's GCP project (transaction store)
        │
        ▼
  TRANSACTION STORE (GCP — Cloud SQL / BigQuery in asia-south1)
        │  [AT REST] Transaction log written to GCP-managed storage
        │            Key: CMEK in GCP Cloud KMS (Meridian's key ring)
        │            DEK per record, wrapped by CMEK KEK
        │
        ▼  [IN TRANSIT] TLS 1.3 auth result → gateway → terminal
  TERMINAL: approved / declined
```

(Note the placement: CMEK in Cloud KMS protects data held by a **GCP** service,
so the CMEK-encrypted transaction store lives in GCP. The on-prem auth service's
own DB volume — if it kept one — would be protected by the on-prem HSM, per the
rationale table below, not by Cloud KMS.)

Key control choices for each data store:

| Data store | Sensitivity | Key model | Rationale |
|------------|-------------|-----------|-----------|
| Transaction logs (CDE) | PCI scope | CMEK (GCP Cloud KMS) | Bank controls revocation; auditor can verify |
| Analytics warehouse (GCP BigQuery) | Aggregated, not CDE | Default Google-managed keys | Acceptable; no raw PAN |
| Backup tapes (off-site) | Archived CDE | BYOK — Thales HSM | Physical media leaving premises; bank generated key |
| Core banking DB (HQ-DC1) | Critical | On-prem HSM (Thales) | On-prem system; full bank ownership |

Northwind contrast — a manufacturing plant's ERP bill-of-materials: sensitive
commercially but not PCI-regulated. AWS default managed keys (AWS owned/managed,
no extra config) are acceptable; CMEK adds cost and operational overhead without commensurate risk
reduction. The architect's job is to calibrate, not to mandate maximum controls
everywhere.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Default at-rest encryption | Volume/disk encryption (BitLocker, LUKS) | Google-managed encryption keys (default encryption), enabled by default on all storage | AWS owned / AWS managed keys, enabled by default (e.g. S3 SSE-S3) | Microsoft-managed keys, enabled by default |
| Customer-managed key (CMEK) | Customer KMS / HSM for disk volumes | Cloud KMS key ring + key; configured per service (GCS, BigQuery, CloudSQL) | AWS KMS CMK (Customer Managed Key); configured per service (S3, RDS, EBS) | Azure Key Vault (key vault) with customer-managed key; per service opt-in |
| Bring Your Own Key (BYOK) | Generated on-prem HSM, imported | Import key material into Cloud KMS key version | Import key material into AWS KMS (BYOK) | Import key material into Azure Key Vault |
| External / HYOK key manager | On-prem HSM, cloud calls out | Cloud External Key Manager (Cloud EKM) — GCP calls your external KMS | AWS KMS External Key Store (XKS) — AWS calls your external KMS | Azure Key Vault HSM + Managed HSM; HYOK via Azure Dedicated HSM (Azure: TODO — HYOK exact GA status) |
| TLS in transit | F5 / hardware LB, terminate + re-encrypt | Cloud Load Balancer SSL policy; TLS re-encryption to backend via `HTTPS` backend protocol | ALB/NLB SSL policy; TLS to targets via target group protocol = HTTPS | Azure Application Gateway / Front Door; backend HTTPS setting |
| TLS minimum version enforcement | LB SSL profile / cipher list | SSL policy (`gcloud compute ssl-policies`): min TLS version 1.2 via RESTRICTED/MODERN or CUSTOM profile (Cloud Armor is the WAF/DDoS product, not TLS-version config) | ALB security policy: ELBSecurityPolicy-TLS13-1-2-2021-06 | Azure App Gateway SSL policy; min version configurable |
| Encryption in use / confidential compute | Thales / IBM DataShield on physical | Confidential VMs (N2D with AMD SEV); Confidential GKE nodes | AWS Nitro Enclaves (EC2 C7a etc.); restricted APIs | Confidential VMs: DCasv5/ECasv5 (AMD SEV-SNP) or DCesv5/ECesv5 (Intel TDX). (DCsv3 = Intel SGX application enclaves, not full-VM confidential compute) |
| Key rotation | Manual or HSM-scheduled | Cloud KMS automatic rotation (schedule configurable per key); old versions retained for decrypt | AWS KMS automatic rotation with configurable period (90–2560 days, default 365) plus on-demand rotation; imported (BYOK) key material rotation now supported; previous key versions retained | Azure Key Vault key rotation policy; manual or Policy-driven |

## Do it (the exercise)

### Part 1 — Map the states [laptop / paper]

Take any 3-tier web app you know (or invent one): browser → API server → DB.

1. Draw each hop and label the data state: in transit, in use, at rest, in use,
   in transit, at rest.
2. For each "in transit" segment: what protocol protects it? Where does it
   terminate? What is the data state immediately after termination?
3. For each "at rest" segment: who generates the encryption key? Where is it stored?
   Who can call the KMS to decrypt it — and under what conditions?
4. Identify the longest window where data is "in use" (unencrypted in RAM). What
   isolates that process?

### Part 2 — Inspect TLS termination [laptop]

Confirm TLS 1.2 minimum on a real endpoint:

```bash
# Check what TLS version and cipher an endpoint negotiates (requires openssl 1.1+)
openssl s_client -connect api.meridianbank.example:443 \
  -tls1 -brief 2>&1 | head -5
# Should return: no peer certificate available / handshake failure
# (TLS 1.0 refused — good)
#
# CAVEAT (OpenSSL 3.x — e.g. 3.0.13 on this machine): the *client's* default
# security level (SECLEVEL) disables TLS 1.0 outright, so this often fails with
# "no protocols available" BEFORE any handshake reaches the server. A local
# failure is therefore NOT proof that the server refuses TLS 1.0. To actually
# offer TLS 1.0 on the wire and test the server's policy, lower the level:
#   openssl s_client -connect api.meridianbank.example:443 \
#     -tls1 -cipher 'DEFAULT@SECLEVEL=0' -brief 2>&1 | head -5
# If the server is correctly configured this then fails on the *server's*
# refusal, which is the result you want to demonstrate.

openssl s_client -connect api.meridianbank.example:443 \
  -tls1_2 -brief 2>&1 | head -5
# Should complete: Protocol TLSv1.2 (or 1.3 if that's what it offered)

# See negotiated cipher:
openssl s_client -connect api.meridianbank.example:443 </dev/null 2>/dev/null \
  | grep "Cipher is"
```

Use `example.com` as a safe public target if no internal endpoint is available.

### Part 3 — CMEK in GCP [needs cloud account]

```bash
# Create a key ring and key (free to create; charged for API calls at ~$0.03/10k ops)
gcloud kms keyrings create meridian-cde-keyring \
  --location=asia-south1

gcloud kms keys create card-data-key \
  --location=asia-south1 \
  --keyring=meridian-cde-keyring \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time=$(date -u -d "+90 days" +%Y-%m-%dT%H:%M:%SZ)

# Encrypt a test value:
echo -n "4111111111111111" | \
  gcloud kms encrypt \
    --location=asia-south1 \
    --keyring=meridian-cde-keyring \
    --key=card-data-key \
    --plaintext-file=- \
    --ciphertext-file=- | base64

# Disable the key (simulates revoking cloud provider access):
gcloud kms keys versions disable 1 \
  --location=asia-south1 \
  --keyring=meridian-cde-keyring \
  --key=card-data-key
# Now attempt to decrypt — it will fail with PERMISSION_DENIED.
# Re-enable when done:
gcloud kms keys versions enable 1 \
  --location=asia-south1 \
  --keyring=meridian-cde-keyring \
  --key=card-data-key
```

Observe: the key ring and key are resources in **your** project — Cloud KMS cannot
use them without your IAM grant. Compare this to GMK: you have no such lever.

## Say it back (self-check)

1. Name the three states of data. For each, name the primary threat and the
   primary control.
2. In a design where TLS terminates at the CDN, where is cardholder data "in use"
   and what does the CDN→backend segment need to be encrypted by?
3. Distinguish CMEK, BYOK, and HYOK/EKM. Which model ensures key material never
   entered the cloud provider's HSM boundary?
4. Why does disabling a CMEK key make data inaccessible to the cloud provider's
   support staff, not just to your own application?
5. Meridian Bank's auditor asks: "Can your cloud provider read cardholder data
   without your knowledge?" What key management model lets you answer "no"?

## Talk to the IT/security head

**Ask:**

- "For each data store holding regulated data — what's the key model? GMK, CMEK,
  or BYOK? Who controls rotation and revocation?"

  *Good answer:* names the specific cloud KMS key ring or on-prem HSM; can
  describe who holds the IAM binding that allows decryption. Red flag: "the cloud
  encrypts it for us" with no further detail — that's GMK, and the bank has no
  key control.

- "Where does TLS terminate for traffic entering the CDE? Is the segment from the
  LB to the backend also encrypted?"

  *Good answer:* terminal-point named (e.g. "ALB in the private subnet"), backend
  protocol explicitly set to HTTPS, cipher policy version cited.
  Red flag: "yes, we use HTTPS everywhere" with no ability to state where
  termination happens or what the backend protocol is.

- "If the cloud provider's support team needed to respond to a legal order to read
  our customer data, could they without our keys?"

  *Good answer:* if CMEK/BYOK is in place, the answer is no — they'd need your
  key and your IAM grant. If GMK: technically yes. A security-literate CISO
  will have thought about this; one who hasn't is a risk flag.

- "Is encryption in use addressed anywhere in your CDE — confidential compute, field
  encryption, or tokenization — or do you accept that plaintext is in RAM?"

  *Good answer:* tokenization at point of entry (see S18); PAN not present in
  app memory beyond gateway; confidential VMs in evaluation for next cycle.
  Red flag: blank look — it means the attack surface is unmodeled.

**Red flags to listen for:**

- "We're compliant, we encrypt at rest" — compliance is a floor; this alone
  doesn't address in-transit or in-use gaps.
- Inability to say who can call the KMS to decrypt production data — unbounded
  decrypt access is an insider-threat risk that RBI auditors flag.
- No key rotation schedule — PCI-DSS Req 3.7.4 mandates cryptoperiod limits;
  absence means keys may be in use for years, violating policy and compounding
  breach impact.

## Pitfalls & war stories

- **"TLS everywhere" with plaintext backends.** The most common FSI finding: TLS
  terminates at the load balancer, backend traffic is plaintext on the "trusted"
  internal segment. A compromised internal host can read all traffic. The fix is
  TLS re-encryption to each backend service (see S11 for cert chain impact).

- **GMK mistaken for CMEK.** A bank team presenting to the CISO says "we use
  KMS encryption on all our S3 buckets." True — but it's AWS-managed keys. The
  CISO asks if the bank can revoke the cloud provider's access; silence follows.
  Always qualify: "managed by whom?"

- **BYOK theater.** The bank generates a key on-prem, imports it into AWS KMS,
  and claims "BYOK — we control our key." But the imported key material now lives
  inside AWS's HSM boundary. Importing key material to a cloud KMS is BYOK in
  origin only; for true separation, Cloud EKM / XKS is required.

- **Key rotation paralysis.** A bank sets up CMEK but never rotates because
  "rotation might break the application." Unrotated keys compound breach impact —
  every record ever written is exposed if the key leaks. Cloud KMS rotation
  adds a new key version for new encryptions while keeping old versions for
  decryption; it is designed to be transparent to applications.

- **Northwind plant backups unencrypted.** FMCG plants often back up OT historian
  data to removable drives. Cost pressure means no HSM on the plant floor. The
  pragmatic answer: software-based encryption (LUKS or VeraCrypt) with keys
  managed centrally in AWS KMS — good enough for commercially sensitive but
  non-regulated data. Don't force an HSM budget the plant manager doesn't have.

## Going deeper (optional)

- NIST SP 800-57 Part 1 (Rev 5) — Recommendation for Key Management: defines
  cryptoperiods, algorithm lifetimes, and key state transitions.
- PCI-DSS v4.0 Requirements 3 (protect stored account data) and 4 (protect
  cardholder data in transit) — the exact wording auditors use.
- NIST SP 800-111 — Storage Encryption Technologies for End User Devices.
- GCP Cloud KMS documentation — key versions, rotation, and Cloud EKM:
  cloud.google.com/kms/docs
- AWS KMS Developer Guide — CMK types, BYOK import, XKS:
  docs.aws.amazon.com/kms/latest/developerguide
- IEEE 802.1AE (MACsec) — link-layer encryption standard; relevant when
  dedicated interconnect (N38) must satisfy in-transit requirements at the
  physical/link layer.
- Pairs with: S09 (crypto primitives), S10 (PKI), S11 (KMS/HSM/envelope
  encryption), S18 (tokenization as the "in use" control for PAN), N21 (TLS
  handshake and termination), N29 (PCI-DSS/RBI compliance shaping the design).

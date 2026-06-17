# Kata S18 — Tokenization & masking (PCI cardholder data in practice)

> **Track:** Security · **Module:** S4 Data security & privacy · **Prereqs:** S17, N29 · **Time:** ~35 min
> **Tags:** `security` `tokenization` `masking` `pci-dss` `data-classification` `encryption-at-rest` `fsi` `meridian-bank`

## Why it matters

PAN (primary account number) — the 16-digit card number — is the single most
regulated piece of data a bank handles. Every system that *touches* a raw PAN
is in scope for PCI-DSS: it needs segmentation, access controls, quarterly scans,
annual penetration tests, and an auditor to sign off. Tokenization is the
architectural move that **shrinks the PCI scope surface**. Instead of every
downstream system handling the real card number, they handle a surrogate token
that is useless to an attacker. As an architect you need to make the
tokenization/masking design call early, because changing it later means touching
every data store, API contract, and log line in the estate.

## The mental model

**The problem:** a card number arrives at a merchant or bank. It must travel
through acquiring systems, fraud detection, core banking, analytics, and
customer-service UIs. Each hop is a PCI-scope expansion.

```
[Card terminal]
     │  PAN: 4111 1111 1111 1111
     │  CVV: 123   (never store this — ever)
     ▼
[Point of entry / acquirer gateway]
     │  ← this is the ONLY place the real PAN should live
     │
     ├── Tokenization vault ──────────────────────────┐
     │   PAN ──hash-based mapping──► TOKEN             │
     │         e.g. 9876-XXXX-XXXX-4321               │
     ▼                                                 │
[Downstream: fraud engine]   uses TOKEN ←─────────────┘
[Downstream: analytics]       uses TOKEN
[Downstream: customer-service UI]  shows ****1111 (masking)
```

**Three different controls — know when each applies:**

```
 MASKING       Display-only redaction. The real value is stored somewhere;
               you just hide digits before showing a human.
               4111 1111 1111 1111  →  **** **** **** 1111
               PCI-DSS v4.0 Req 3.4.1: PAN masked when displayed; first 6 /
               last 4 is the maximum that may be shown (need-to-know only).

 TRUNCATION    Permanent deletion of digits before storage.
               Store only the last 4: "1111". Irreversible — can never
               reconstruct the PAN. Smaller scope but useless for authorization.

 TOKENIZATION  Replace the real PAN with a surrogate token at the first touch
               point. Token has no mathematical relationship to the PAN.
               Downstream systems use the token; only the vault can detokenize.
               If the token database leaks, the attacker has random surrogates.
               This is the control that *removes systems from PCI scope*.
```

**How a token vault works (first principles):**

A token vault is a database with one table and two operations:

```
  Table:  token_map
  ┌──────────────────────────────────────────────────────┐
  │  token (surrogate)    │  encrypted_PAN               │
  │  9876543210001111     │  AES-256 ciphertext of PAN   │
  └──────────────────────────────────────────────────────┘

  Tokenize(PAN):
    1. Generate a random token (or use format-preserving encryption — see below).
    2. Encrypt PAN with AES-256-GCM under a key held in an HSM.
    3. Store (token, encrypted_PAN) in the vault.
    4. Return token to caller. Caller never sees PAN again.

  Detokenize(token):
    1. Vault receives the token.
    2. Looks up encrypted_PAN.
    3. Decrypts PAN using HSM key.
    4. Returns PAN over an authenticated, TLS-encrypted channel.
    — Only authorized callers (card authorization system) may call Detokenize.
```

The vault itself *is* in PCI scope, but it is small, isolated, and audited.
Everything else that only holds tokens is *out of scope* — that is the ROI.

**Format-Preserving Encryption (FPE) / Format-Preserving Tokenization:**

Some systems (legacy, fixed-schema DBs) cannot change the column width. FPE
algorithms (e.g. FF1 or FF3-1, NIST SP 800-38G) produce a ciphertext that
looks like a valid PAN: 16 digits, correct Luhn checksum. Systems need no
schema change. Trade-off: FPE outputs are deterministic for a given key+tweak,
so they require careful key management. PCI Council guidance (2019 FAQ) says
FPE tokens that pass Luhn are still considered tokenization, not encryption,
provided key management is robust.

**CVV/CVC:** never stored, never tokenized — period. PCI-DSS v4.0 Requirement
3.3.1 bans retaining sensitive authentication data (full magnetic-stripe data,
CVV/CVC, and PIN/PIN block) after authorization, even encrypted. Architecture implication: scrub these fields
before anything is written to any log or queue.

## Worked example

**Meridian Bank** runs card acquiring and core banking at HQ-DC1
(`10.10.0.0/16`). The CDE sits in `10.10.20.0/24` (see `reference/running-example.md`).
They are building a new fraud analytics platform in GCP (`10.100.0.0/14`).
Without tokenization, the analytics platform must be in PCI scope: segmented
from `10.10.20.0/24`, quarterly scanned, annually pen-tested.

**With tokenization, the data flow looks like this:**

```
[Acquirer gateway — HQ-DC1, 10.10.20.5]
  ├── Receives PAN from card terminal
  ├── Calls token vault (10.10.20.10, same CDE subnet)
  │     Vault returns token: TOK-8823-4917-6600-1111
  └── Passes TOKEN (not PAN) to all downstream systems

[Fraud analytics — GCP, 10.100.1.0/24]
  ├── Receives TOK-8823-4917-6600-1111
  ├── Trains ML models on tokens, amounts, merchant codes
  └── Never holds PAN — OUT OF PCI SCOPE

[Customer service UI — corp office, 10.40.0.0/16]
  ├── Queries token-linked record
  └── Displays: **** **** **** 1111 (masking at render time)
      — The display layer does not even hold the token; a view layer masks it.
```

**Scope delta:**

| System | Without tokenization | With tokenization |
|--------|---------------------|-------------------|
| Acquirer gateway + token vault | In scope | In scope (vault) |
| Fraud analytics platform (GCP) | In scope | Out of scope |
| Core banking general ledger | In scope | Out of scope |
| Customer service UI | In scope | Out of scope |
| Analytics data lake | In scope | Out of scope |

The bank reduced its PCI audit surface from 6+ systems to 1 isolated vault,
cutting compliance cost substantially.

**What the token vault is NOT:**

```
  Encryption at rest of PAN in a general DB
  ─────────────────────────────────────────
  Storage: encrypted_PAN column in main DB
  Problem: the DB is still in PCI scope
           — anyone who can query the DB (and the key) has the PAN.
           Tokenization removes the PAN from the DB entirely.
```

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Token vault (hosted) | Protegrity, Voltage (MicroFocus) appliance or software | Cloud DLP / Sensitive Data Protection (crypto-based tokenization / pseudonymization) | AWS Payment Cryptography (tokenization APIs) | (Azure: TODO) |
| Vault key storage | Luna HSM / Thales HSM | Cloud KMS + Cloud HSM | AWS CloudHSM / AWS KMS | (Azure: TODO) |
| PCI-validated DLP/masking | Symantec DLP, Imperva | Cloud DLP (de-identification) | Macie + Lambda custom masking | (Azure: TODO) |
| FPE algorithm support | Voltage SecureData (FF1/FF3-1) | Cloud DLP (format-preserving) | AWS Payment Cryptography (TR-31 key blocks) | (Azure: TODO) |
| Audit log for detokenization | SIEM / syslog from vault | Cloud Audit Logs + Chronicle | CloudTrail + Security Lake | (Azure: TODO) |

**GCP detail:** Cloud DLP (now Sensitive Data Protection) and its
`content:deidentify` API support pseudonymization,
format-preserving encryption (FF1 surrogate tokens), and masking (character
replacement). The plaintext never leaves your GCP project boundary; Cloud DLP
applies the operation inside Google's infrastructure. Use Cloud KMS to hold
the wrapping key so you control it (CMEK pattern — see S12).

**AWS detail:** AWS Payment Cryptography (launched 2023) is a PCI-PIN-certified
service providing tokenization primitives, format-preserving encryption (ANSI
TR-31 key blocks), and card-data encryption natively, removing the need for an
on-prem HSM for many payment workloads. Pair with AWS Secrets Manager for token
metadata and CloudTrail for detokenization audit.

## Do it (the exercise)

**Part 1 — Design the scope boundary [laptop / paper]**

1. Draw Meridian Bank's card data flow from terminal to analytics:
   - Label each system with its IP range from `reference/running-example.md`.
   - Mark which systems touch the raw PAN **before** tokenization.
   - Mark which systems touch the PAN **after** you add a token vault.
   - Count how many systems move out of PCI scope.

2. Write the single sentence that justifies tokenization to the CISO:
   "Without tokenization, N systems are in PCI scope; with it, only M are."

**Part 2 — Observe masking and hashing in action [laptop]**

Simulate what a vault does:

```bash
# Generate a random token (equivalent of what a vault issues)
python3 -c "import secrets; print('TOK-' + secrets.token_hex(8).upper())"

# Hash a PAN (to show hashing is NOT tokenization — hashes leak patterns)
echo -n "4111111111111111" | sha256sum
# Note: a 16-digit PAN has only ~10^16 possibilities — brute-forceable.
# This is why PCI-DSS requires salted hashing or tokenization, not plain hashing.

# Show the Luhn check on a test PAN (luhn algorithm — public knowledge)
python3 - <<'EOF'
def luhn_check(n):
    digits = [int(d) for d in str(n)]
    odd = digits[-1::-2]
    even = [sum(divmod(d*2, 10)) for d in digits[-2::-2]]
    return (sum(odd) + sum(even)) % 10 == 0

print(luhn_check(4111111111111111))  # True — valid test PAN
print(luhn_check(4111111111111112))  # False — invalid
EOF
```

**Part 3 — Observe GCP Cloud DLP masking [needs cloud account]**

There is no `gcloud` subcommand for ad-hoc text de-identification. Cloud DLP /
Sensitive Data Protection de-identifies content via the REST API
`projects.content.deidentify` (a `POST` to `content:deidentify`) or a client
library. The call below masks all but the last 4 digits with `*`
(`numberToMask: 12`, `reverseOrder: true`):

```bash
PROJECT_ID="meridian-fraud-analytics"

curl -s -X POST \
  "https://dlp.googleapis.com/v2/projects/${PROJECT_ID}/locations/global/content:deidentify" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "item": { "value": "Card: 4111111111111111, amount: 500" },
    "deidentifyConfig": {
      "infoTypeTransformations": {
        "transformations": [{
          "infoTypes": [{ "name": "CREDIT_CARD_NUMBER" }],
          "primitiveTransformation": {
            "characterMaskConfig": {
              "maskingCharacter": "*",
              "numberToMask": 12,
              "reverseOrder": true
            }
          }
        }]
      }
    },
    "inspectConfig": {
      "infoTypes": [{ "name": "CREDIT_CARD_NUMBER" }]
    }
  }'
# Response item.value should read: "Card: ************1111, amount: 500"
```

## Say it back (self-check)

1. What is the difference between masking, truncation, and tokenization?
   Which one removes a system from PCI scope, and why?
2. What two operations does a token vault expose? Which one must be tightly
   access-controlled and fully audited?
3. Why can you never store a CVV — even encrypted — after a transaction is
   authorized? Which PCI-DSS requirement says this?
4. What is Format-Preserving Encryption and when would you choose it over
   a random token?
5. A fraud analytics team says "we need the card number to build our ML
   model." What is the correct architectural response?

## Talk to the IT/security head

**Ask:**

- "Where in our card processing pipeline does tokenization happen — at the
  acquirer gateway, or further downstream?"
  *(Good answer: at the first touch point. If the PAN enters a message bus,
  a queue, or a DB before tokenization, each of those is in PCI scope.)*

- "Which systems today are in PCI scope, and have you mapped that to the
  token vault boundary? What's the scope delta?"
  *(Good answer: a named list of systems with a clear 'before/after'
  comparison. Red flag: vague, or 'we're still figuring that out'.)*

- "Who can call Detokenize, under what conditions, and is every call logged
  to a tamper-evident audit trail?"
  *(Good answer: named service accounts only; logs shipped to SIEM; alerts
  on bulk detokenization. Red flag: 'it's an internal service, anyone with
  DB access'.)*

- "Has the tokenization solution been validated by a PCI Qualified Security
  Assessor (QSA) as a scope-reduction control?"
  *(Good answer: yes, with a formal scoping decision document. Some
  implementation approaches — e.g. in-house homegrown hashing — don't
  qualify. The QSA must agree.)*

- "How are CVV / full magnetic-stripe data handled in logs, queues, and
  error payloads? Do you scrub before write or after?"
  *(Good answer: scrubbing happens in the serializer before anything is
  written to any persistent store. Red flag: 'we assume devs don't log it'.)*

**Red flags to listen for:**

- "We encrypt the PAN at rest in the application DB" — encryption at rest
  is not the same as tokenization; the DB is still in scope.
- Inability to name which systems are in/out of PCI scope.
- Detokenization available to any authenticated user of the internal API.
- No audit log or alert for bulk detokenization (a mass exfiltration indicator).
- CVV fields present in application logs "just for debugging."

## Pitfalls & war stories

**"We hash the PAN — that's the same as tokenizing it."**
It is not. A SHA-256 hash of a 16-digit PAN is deterministic and the
input space is small (~10^16). An attacker who steals the hash column can
rainbow-table-attack it in hours on a GPU cluster. PCI-DSS v4.0
Requirement 3.5.1 requires keyed cryptographic hashing (HMAC) or
tokenization — not plain hashing.

**Tokenizing too late in the pipeline.**
A common pattern: the PAN enters an event bus (Kafka, Pub/Sub) before the
tokenization service runs. The Kafka topic is now in PCI scope. Tokenize at
the point of entry — the API endpoint or acquirer gateway — before anything
is serialized.

**Tokenization scope limited to one system, but PAN leaks to logs.**
The application was tokenized, but stack traces, debug logs, and error
responses still contain the raw PAN. An architect must mandate a PAN
scrubbing layer in the logging pipeline and verify it. At Meridian Bank,
the security team runs a DLP scan over all CloudWatch / Cloud Logging
streams for PAN patterns (e.g. Visa: `\b4[0-9]{3}([\s-]?[0-9]{4}){3}\b`,
which matches `4111111111111111` and `4111 1111 1111 1111`).

**Forgetting that tokenization is not encryption at rest.**
Both controls may be needed. The token vault itself must encrypt the PAN
it stores, using a key held in an HSM. The token vault is in PCI scope;
the systems holding only tokens are not. Two separate controls, both
required inside the vault boundary.

**Northwind FMCG parallel:** Northwind runs a loyalty card program. If
they store card PANs from co-branded payment cards in their CRM, they are
in PCI scope. Tokenizing at the payment processor boundary means Northwind's
CRM holds only tokens; the CRM stays out of scope. This matters enormously
at Northwind's scale: 3,000 retail points, each with a local DB or cache.

## Going deeper (optional)

- PCI-DSS v4.0, Requirement 3: protect stored account data — esp. 3.3.1
  (no retention of sensitive authentication data after authorization),
  3.4.1 (mask PAN when displayed), and 3.5.1 (render PAN unreadable: keyed
  hashing / truncation / tokenization). Official PCI Security Standards
  Council docs.
- NIST SP 800-38G: Recommendation for Block Cipher Modes of Operation —
  Methods for Format-Preserving Encryption (FF1, FF3-1 specification).
- PCI SSC Information Supplement: *Tokenization Product Security Guidelines*
  (2015, still the canonical QSA reference for what qualifies as tokenization).
- PCI SSC *FAQ on Tokenization* (2019) — addresses FPE / format-preserving
  token validity and what a QSA must verify.
- Pairs with S12 (encryption at rest, CMEK/BYOK, envelope encryption) and
  N29 (PCI-DSS network segmentation requirements, CDE design).
- See S17 for data classification — tokenization decisions follow from
  classification (what is "restricted / regulated" data?).

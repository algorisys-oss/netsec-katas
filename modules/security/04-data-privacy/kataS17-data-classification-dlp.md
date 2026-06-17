# Kata S17 — Data classification & handling; DLP

> **Track:** Security · **Module:** S4 Data security & privacy · **Prereqs:** S01, S12, N29 · **Time:** ~35 min
> **Tags:** `security` `data-classification` `dlp` `masking` `pci-dss` `compliance` `fsi` `meridian-bank`

## Why it matters

"We encrypt everything" is not a data security strategy — it is a way to avoid
classification. The grade of a control must match the sensitivity of the data it
protects, and you cannot match them without classifying what you hold. At Meridian
Bank the stakes are concrete: PCI-DSS Req 12.5.2 mandates documented confirmation of
scope — where account data is stored, processed and transmitted — and Req 3.2.1 limits
what stored account data you may keep; the RBI Master Direction on IT Governance requires
a documented information/data classification policy. In practice,
architects make classification decisions every time they choose a storage tier, a
pipeline destination, or a logging level. Wrong calls either under-protect regulated
data (audit finding) or over-protect everything equally (cost spiral, DLP noise).
Pairs with S12 (encryption) and S18 (tokenization and masking).

## The mental model

**Classification tiers** standard across FSI and FMCG:

```
  TIER         EXAMPLES                          MINIMUM HANDLING
  ────────────────────────────────────────────────────────────────
  Public       marketing copy, press releases    no special controls
  Internal     org charts, internal wikis        access-controlled, encrypted at rest
  Confidential employee PII, M&A plans           need-to-know, logged, encrypted
  Restricted   card PANs, auth secrets, keys     CDE/vault isolation, MFA, DLP + audit
```

"Restricted" maps directly to PCI-DSS scope; "Confidential" PII maps to GDPR /
DPDP. The tier drives the *cost* of a breach, which drives the *investment* in
controls — and that logic is what you present to the CISO.

**Sensitive data types the architect must recognise:**

| Data element | Regulation | How identified |
|---|---|---|
| Card PAN (16 digits) | PCI-DSS Req 3 | regex + Luhn checksum |
| SAD (CVV, full track) | PCI-DSS Req 3.3 | never stored post-auth |
| Aadhaar / national ID | DPDP | 12-digit pattern |
| EU/IN personal data | GDPR / DPDP | name + identifier combo |
| API keys, secrets | all frameworks | must never appear in logs |

**Where DLP operates — three planes:**

```
  AT REST    Scan object stores / databases for misplaced sensitive content.
             Action: alert, quarantine, enforce perimeter.

  IN MOTION  Inspect outbound flows: email, proxy egress, API responses.
             Action: block or redact. Needs a forward proxy/SWG (see N23).

  IN USE     Endpoint agent: block paste to personal apps, USB exfiltration.
```

Before writing any DLP policy you need a **data map** — what data exists, where
it lives, who owns it, what tier it is. This is a regulatory artefact in FSI
(PCI Req 12.5.2 scope/data-flow documentation; RBI Master Direction on IT Governance
data classification policy), not a nice-to-have. DLP without a data map is guesswork.

## Worked example

Meridian Bank's analytics project in GCP (`10.100.0.0/14`) holds three buckets:

```
  GCS bucket               Labeled tier    DLP finding
  ─────────────────────────────────────────────────────────
  mb-analytics-export/     Internal        CREDIT_CARD_NUMBER found — !!
  mb-mobile-uploads/       Internal        INDIA_AADHAAR_INDIVIDUAL found
  mb-marketing-assets/     Public          clean
```

Root cause: the ETL pipeline exported raw transaction rows from HQ-DC1 CDE
(`10.10.20.0/24`) to BigQuery and then GCS — including the PAN column. No
tokenization or masking was applied (see S18 for the fix).

**Why DLP needs the Luhn check:** a 16-digit regex alone fires on order IDs,
loyalty numbers, phone numbers. The Luhn algorithm validates PANs and cuts false
positives by ~90 %:

```
  All valid card PANs satisfy: sum of digits (alternating-position doubling) ≡ 0 mod 10.

  Test PAN 4539578763621486  (published test number — not a live card):
  python3 -c "
  n='4539578763621486'; d=[int(c) for c in n]
  t=sum(d[-1::-2])+sum(v*2-9 if v*2>9 else v*2 for v in d[-2::-2])
  print('Luhn valid:', t%10==0)"
  → Luhn valid: True
```

DLP engines layer: **regex → Luhn → context scoring** (proximity to "card", "PAN",
"CVV") to reach a `likelihood` rating (VERY_LIKELY → POSSIBLE).

**Response to the finding:**

1. Revoke cross-project access on `mb-analytics-export/` immediately.
2. Tokenize at the ETL source so PANs never leave the CDE (see S18).
3. Apply BigQuery column-level policy tags — PAN column masked for non-CDE accounts.
4. Add a VPC Service Controls perimeter so only CDE service accounts can write
   Restricted data to GCS.
5. Produce DLP scan report + access-log diff as PCI QSA evidence.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---|---|---|---|---|
| DLP scanning (at rest) | Symantec DLP, Forcepoint | Sensitive Data Protection | Amazon Macie | (Azure: TODO — Purview DLP) |
| Classification labels | Manual policy / tool labels | SDP info-types; Dataplex tags | Macie + custom identifiers | (Azure: TODO — Purview labels) |
| Column-level data access | DB GRANT / views | BigQuery column policy tags | Lake Formation column perms | (Azure: TODO) |
| Storage access perimeter | VLAN / firewall zone | VPC Service Controls | S3 Bucket Policy + SCPs | (Azure: TODO) |
| Data catalog | Manual CMDB | Dataplex | AWS Glue + Macie | (Azure: TODO — Purview catalog) |

GCP Sensitive Data Protection returns findings with `likelihood` and byte offsets
for targeted redaction. AWS Macie continuously scans S3, raises typed findings
(e.g. `SensitiveData:S3Object/Financial`), and integrates with EventBridge for
automated quarantine workflows.

## Do it (the exercise)

**Part A — Classify a system [laptop / paper]**

1. Pick Meridian Bank's mobile platform or a system you know. List five data
   elements. Assign each a tier. Justify each in one line citing a regulation or
   consequence.
2. For each Restricted element: name its storage location, who has read access,
   whether that access is logged. Gaps here are your risk surface.

**Part B — Luhn check [laptop]**

```bash
python3 -c "
n='4539578763621486'   # published test PAN — not a real card
d=[int(c) for c in n]
t=sum(d[-1::-2])+sum(v*2-9 if v*2>9 else v*2 for v in d[-2::-2])
print('Luhn valid:', t%10==0)
"
```

Change one digit. Observe it fails. Now run the same check against a random
16-digit number to see why regex alone generates too many hits.

**Part C — Check a GCS bucket's access posture [needs cloud account]**

```bash
gsutil uniformbucketlevelaccess get gs://YOUR_BUCKET
gsutil iam get gs://YOUR_BUCKET | grep -E "allUsers|allAuthenticatedUsers"
```

A Restricted bucket must have no public bindings and uniform access enabled.
Any deviation is a critical finding — log it and escalate.

## Say it back (self-check)

1. Name the four tiers and give one real data element for each at Meridian Bank.
2. What three planes does DLP operate on, and what is the typical action on each?
3. Why is the Luhn check important for DLP accuracy?
4. If a PAN appears in a cloud analytics bucket, what are the first two actions?
5. What is a data map and which regulation makes it mandatory for an Indian bank?

## Talk to the IT/security head

**Ask:**

- "Do you have a current data inventory — what you hold, where it lives, who owns
  it?" *(No inventory = DLP is guesswork; also a PCI Req 12.5.2 scope-documentation gap.)*
- "How do you detect a Restricted element drifting into a log, a debug dump, or a
  backup?" *(Probes for active scanning vs a passive paper policy.)*
- "When a DLP alert fires, who decides real vs false positive, and what is the
  SLA?" *(Reveals whether the control has teeth.)*
- "Does your analytics pipeline de-identify data before it crosses the CDE
  boundary?" *(A very common source of PCI scope expansion — see N29 and S18.)*
- "Do you store the full PAN post-authorisation, or only BIN + last four?" *(PCI
  Req 3.3: SAD must not be stored after auth; PANs must be masked on display.)*

**A good answer sounds like:** the CISO can name the tiers, point to a data map
reviewed in the last 12 months, describe DLP coverage across at-rest and egress
planes, name the data owner for each regulated element, and distinguish tokenization
from masking.

**Red flags:** "we encrypt everything" as classification substitute; no data map or
one last updated for an audit three years ago; DLP alerts suppressed because of
false-positive volume (control inert); analytics reading raw PANs from the CDE;
secrets appearing in log files "for debugging."

## Pitfalls & war stories

**The analytics pipeline that ate the CDE.** A bank exported raw transaction rows
— including the PAN column — to BigQuery labeled Internal. The PCI QSA found it in
a routine scan: scope expansion, three months of remediation, re-audit of every
system with BigQuery access. Fix: tokenize at the ETL source (S18) or apply
column-level policy tags in BigQuery so the PAN column is masked for non-CDE
accounts.

**Classification without enforcement is theatre.** An FMCG produced a policy and a
spreadsheet, deployed no tooling, then suffered a leak from a SharePoint folder
labeled Confidential that was world-readable. Classification is step one; access
controls and DLP are steps two and three. Without enforcement, classification creates
a false sense of security and an audit artefact that can be used against you.

## Going deeper (optional)

- PCI-DSS v4.0 Req 3 (protect stored account data, incl. 3.2.1 on what may be
  retained) and Req 12.5.2 (documented confirmation of scope: where account data is
  stored, processed and transmitted). pcisecuritystandards.org.
- NIST SP 800-60 Vol. II — maps data types to impact levels; the closest thing
  to a universal classification taxonomy.
- RBI Master Direction on IT Governance, Risk, Controls and Assurance Practices
  (Nov 2023, effective 1 Apr 2024) — requires a documented information/data
  classification policy for Indian scheduled commercial banks.
- DPDP Act 2023 (India) §4–8 — personal data definitions and consent; see S19.
- GCP Sensitive Data Protection: https://cloud.google.com/sensitive-data-protection/docs
- AWS Macie: https://docs.aws.amazon.com/macie/latest/user/what-is-macie.html

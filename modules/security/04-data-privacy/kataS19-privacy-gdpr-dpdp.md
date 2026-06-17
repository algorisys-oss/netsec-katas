# Kata S19 — Privacy & regulation: GDPR / DPDP / data residency

> **Track:** Security · **Module:** S4 Data security & privacy · **Prereqs:** S17, S18, N29 · **Time:** ~35 min
> **Tags:** `security` `gdpr` `dpdp` `data-residency` `compliance` `fsi` `cloud` `data-classification`

## Why it matters

Privacy law is no longer a legal team concern you hand off after architecture
review. GDPR (EU, 2018), India's DPDP Act (2023), and the RBI data-residency
mandate all impose **hard architectural constraints**: where data is stored,
how long it's kept, who can see it, and what must happen in the 72 hours after
a breach. An architect who ignores them will pick the wrong cloud region, miss
a contractual obligation, or hand a future auditor a finding. At Meridian Bank
— regulated by RBI, potentially serving EU customers — every architecture
decision about customer data has a compliance dimension that can block a
deployment or trigger a fine.

## The mental model

**Start with the problem, not the regulation.** All three frameworks exist
because individuals cannot see or control what happens to their data once they
hand it to an institution. The law essentially codifies four questions:

```
  1. WHY are you collecting this?          Purpose limitation
  2. DO you have the right to?             Lawful basis / consent
  3. WHERE does it go and how long?        Storage limitation + residency
  4. WHAT if something goes wrong?         Breach notification + remediation
```

Every compliance obligation maps back to one of these four.

**GDPR, DPDP, and RBI side-by-side:**

```
                  GDPR (EU)           DPDP Act (India, 2023)   RBI Data Residency
  ─────────────────────────────────────────────────────────────────────────────────
  Scope         personal data of      digital personal data     financial data of
                EU residents          of individuals in India   Indian residents

  Legal basis   6 bases (consent,     consent + legitimate       mandate, no waiver
                legitimate interest,  uses (law/state)           — just comply
                contract, law…)

  Residency     unrestricted — but    transfer allowed to ALL    Sensitive payment
                adequacy decisions +  countries EXCEPT a govt    data must stay in
                SCCs for transfer     negative list (s.16);      India (no mirror)
                to non-adequate       no list notified yet 2026
                                      → broadly permitted

  Breach notice 72 h to DPA;          without delay to DPDP     RBI + CERT-In
                "undue delay" to      Board, detailed report     within 6 h (CERT-In
                data subjects         within 72 h (Rules 2025);  cyber rules)
                                      user notice without delay

  Right to      erase on request      erase on withdrawal        limited — audit
  erasure       (with caveats)        of consent                 log retention wins

  Max fine      €20 M or 4% global   ₹250 Cr (~$30 M) per       regulatory action
                turnover              class of breach            + banking licence
```

The most common architect mistake: treating **data residency** as a single
toggle. It isn't. Each regulation defines *which data* must stay where, and the
definitions don't align:

```
  RBI (India):  "Payment system data" — the full end-to-end transaction
                must be stored only in India. Mirror abroad allowed for
                RTGS/NEFT but not payment data proper.

  DPDP (India): "Personal data" of individuals in India. Cross-border
                transfer is permitted to ALL countries EXCEPT those the
                Central Government notifies on a negative list (s.16). No
                such list exists as of 2026 → transfers broadly permitted.
                NOTE: this is the opposite of GDPR's adequacy/whitelist
                model. The real hard constraint for payment data is the
                RBI sectoral residency rule below, NOT a DPDP whitelist.

  GDPR (EU):    No blanket residency requirement, BUT transferring data to
                non-adequate countries (incl. India) requires a mechanism:
                Standard Contractual Clauses (SCCs), adequacy decision,
                or Binding Corporate Rules (BCRs).
```

The practical design implication: **region selection is a compliance decision,
not a performance decision.** Lock it down before you architect anything else.

**The data flow model architects must draw:**

```
  Source of          Nature of         Who has        Where stored
  personal data      data              access         (primary/mirror)
  ─────────────────────────────────────────────────────────────────
  EU resident's      GDPR-protected    Only in-scope  EU region or
  transaction        personal data     roles via IAM  adequate country

  Indian customer's  DPDP + RBI        Least-         India only
  bank details       regulated         privilege      (no mirror offshore)

  Indian customer's  Payment system    PCI CDE +      India — full stop
  card data          + DPDP + RBI      restricted     (RBI mandate)
```

This matrix — data category × location × access × retention — is the artifact
a CISO and DPO will want to see before signing off on a cloud design.

**Purpose limitation in practice:** if you collected a customer's mobile number
to send OTPs, you cannot use it to send marketing. The data-classification work
(see S17) must capture *purpose* alongside sensitivity, or the privacy controls
are incomplete.

**Retention and the right to erasure:** both GDPR and DPDP grant users the
right to ask for deletion. But RBI mandates 5–7 years of transaction audit
logs. The architect must design a system where PII (name, contact) can be
separated and erased while the transaction record (amount, timestamp, account
hash) is retained — a **pseudonymisation** pattern (see S17, S18).

## Worked example

Meridian Bank is launching a mobile-banking app for Indian customers. The
engineering team proposes using GCP with the primary region `asia-south1`
(Mumbai) and a DR replica in `us-central1` (Iowa). The CISO calls it out
immediately. Walk through why:

```
  DATA INVOLVED:
  - Customer name, DOB, tax PAN (Permanent Account No.) ← DPDP personal data
  - Account balance, transaction history                ← RBI financial data
  - Card PAN (Primary Account No.), CVV                 ← RBI payment data + PCI CDE

  PROPOSED: primary asia-south1, DR us-central1 (Iowa)
  PROBLEM:
    RBI mandate → card/payment data MUST stay in India.
                  Replicating to us-central1 violates this. This — not
                  DPDP — is the binding residency constraint here.
    DPDP →       no government negative list bars the US (2026), so DPDP
                 alone would PERMIT the transfer (s.16). It is RBI + PCI
                 that block it. (DPDP is not a whitelist regime.)
    PCI-DSS →    CDE replica crosses international border → scope expansion.

  FIX:
    Primary:   asia-south1  (Mumbai)      ← OK
    DR:        asia-south2  (Delhi)       ← India, satisfies RBI (the
                                            binding rule); DPDP imposes no
                                            India-only requirement
    No card/payment data to us-central1 — ever.
    If EU customers are onboarded later → separate europe-west1 (Belgium)
    or europe-west4 (Netherlands) for their data, with SCCs documented.
```

Now look at Meridian's `10.10.20.0/24` CDE subnet (see N29, running-example.md).
Any service in GCP that handles payment data must:

1. Store it in a Cloud Storage bucket with **CMEK** (see S12) locked to a Cloud
   KMS key in `asia-south1` — the key never leaves India.
2. Be tagged `data-residency: india-only` in resource labels so an Org Policy
   constraint (`gcp.resourceLocations`) can block provisioning outside allowed
   regions.
3. Have a **Data Loss Prevention (DLP)** scan on inbound data streams to detect
   card PANs (Primary Account Numbers), tax PANs (Permanent Account Numbers),
   or Aadhaar numbers reaching unintended storage (see S17).
4. Log every access to the SIEM with a retention of 7 years (RBI) and a
   right-to-erasure workflow that pseudonymises PII while keeping transaction
   records.

**Breach scenario:** at 14:00 a DLP alert fires — 50,000 customer records were
written to a misconfigured Cloud Storage bucket with public access. The clock
starts:

```
  T+0 h    Detect (DLP alert + GCS audit log)
  T+0      DPDP Board: intimate "without delay" (DPDP Rules 2025)
  T+0      Affected data principals: notify "without delay" (DPDP Rules 2025)
  T+6 h    Report to CERT-In (Indian cyber incident rule)
  T+72 h   DPDP Board: detailed report due (DPDP Rules 2025)
  T+72 h   GDPR DPA notification IF any EU-resident data was involved
```

The architect's job: ensure the SIEM has the right logs and the IR runbook has
these timers baked in *before* the breach, not after.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Data residency enforcement | Physical DC location; DBA blocks replication | Org Policy `gcp.resourceLocations`; regional bucket/instance policies | SCP with `aws:RequestedRegion` condition (or Control Tower region-deny guardrail); S3 bucket policy `aws:RequestedRegion` | Azure Policy `allowedLocations`; (Azure: TODO confirm naming) |
| Encryption at rest with customer key | HSM-backed TDE (DB); LUKS (disk) | Cloud KMS CMEK; key stays in specified region | AWS KMS with key policy + CMK; key per-region | Azure Key Vault + BYOK; (Azure: TODO) |
| Personal data discovery | DLP appliance / manual tagging | Cloud DLP API (inspect + de-identify jobs) | Amazon Macie (S3 focus); Sensitive Data Discovery | Microsoft Purview (Azure: TODO) |
| Cross-border transfer mechanism | Legal agreement + contract with outsourcer | SCCs documented in data-processing agreement; no GCP-native enforcement — governance layer | Data residency controls in AWS Artifact; SCCs = legal/contractual, not AWS-enforced | (Azure: TODO) |
| Breach notification workflow | Documented IR runbook | Cloud Audit Logs + Security Command Center; Security Health Analytics alert | CloudTrail + GuardDuty finding → SNS → IR runbook | Defender for Cloud + Microsoft Sentinel; (Azure: TODO) |
| Right-to-erasure / pseudonymisation | Application logic + DB procedure | Cloud DLP de-identify transforms (pseudonymise, tokenise, hash) applied at ingest | Macie + custom Lambda for selective deletion / pseudonymisation | (Azure: TODO) |

**Region reference for FSI/India architects:**

```
  asia-south1   GCP Mumbai      ← primary for India-regulated data
  asia-south2   GCP Delhi       ← DR within India
  ap-south-1    AWS Mumbai      ← AWS India equivalent
  ap-south-2    AWS Hyderabad   ← AWS India DR option
```

Both `asia-south1` and `ap-south-1` are in India and satisfy RBI data residency.
GCP's `asia-south2` (Delhi) and AWS's `ap-south-2` (Hyderabad) provide a
within-India DR site for high-availability requirements.

## Do it (the exercise)

**Step 1 — Data residency mapping [laptop / paper]**

Draw a table with four columns: data category, regulation that applies,
permitted storage locations, and what happens if it leaves. Fill it for
Meridian Bank's mobile app. Start with:

- Card PAN (cardholder data)
- Customer name + mobile number
- Transaction amount + timestamp
- A customer's complaint text referencing a dispute

When you've filled the table, identify which cells conflict (hint: an EU
customer's card PAN hits three regulations at once).

**Step 2 — Region selection exercise [paper]**

Meridian Bank wants to onboard:
(a) Indian retail customers — mobile and web banking.
(b) Indian HNI customers with investments in a UK fund (UK entity).
(c) NRI customers in the UAE.

For each, state: (i) the primary cloud region, (ii) the permitted DR region,
(iii) which regulation governs the cross-border question, and (iv) what
contractual mechanism (if any) is needed. Check your answer against the table
in "The mental model" above.

**Step 3 — Org Policy guard-rail [needs cloud account, GCP]**

In a GCP project create a test bucket, then apply an Org Policy to enforce
data residency. (This requires Organisation-level access; observe if your
project already has one applied):

Use the current `gcloud org-policies` (v2) command family. The older
`gcloud resource-manager org-policies` commands still work but call the
legacy v1 API with a different JSON shape — don't carry that pattern into a
real org.

```bash
# List existing org policies on a project (v2)
gcloud org-policies list \
  --project=YOUR_PROJECT_ID

# Inspect the locations constraint if set (v2)
gcloud org-policies describe \
  gcp.resourceLocations \
  --project=YOUR_PROJECT_ID
```

If you have Org Admin rights, set a constraint (test environment only). The
v2 policy uses the `spec.rules[].values` shape (the legacy v1 equivalent was
`listPolicy.allowedValues`):

```bash
# Restrict new resources to India regions (v2)
gcloud org-policies set-policy /dev/stdin <<EOF
name: projects/YOUR_PROJECT_ID/policies/gcp.resourceLocations
spec:
  rules:
  - values:
      allowedValues:
      - in:asia-south1-locations
      - in:asia-south2-locations
EOF
```

Now try to create a bucket in `us-central1` — it should be blocked. This is
the enforcement layer that makes your data-residency policy architectural
rather than depending on humans remembering.

**Step 4 — Breach-notification drill [laptop / paper]**

Given the Cloud Storage misconfiguration scenario from the worked example,
draft the first 72-hour notification timeline:
- What information must be in the CERT-In report at T+6h?
- What facts are you likely still missing at T+6h, and how do you note that?
- Who inside Meridian (by role, not name) authors the T+0 DPDP-Board
  intimation, the T+6h CERT-In report, and the T+72h DPDP-Board detailed
  report?

## Say it back (self-check)

1. Name the three privacy/residency frameworks that apply to Meridian Bank
   and state the primary obligation each imposes on a cloud architect.
2. Why does adding a DR region in `us-central1` violate RBI rules? What is
   the correct DR choice for Indian customer payment data?
3. What are GDPR's 72-hour breach clock and DPDP's breach-notification
   timeline (Rules 2025: notify the Board without delay, detailed report
   within 72 hours) — and why must an architect know both?
4. A customer invokes their right to erasure for their profile. The legal
   team says RBI requires 7 years of transaction logs. How do you satisfy
   both simultaneously?
5. What GCP mechanism enforces data residency at the *infrastructure* level
   (i.e., prevents even an admin from creating resources in the wrong region)?

## Talk to the IT/security head

**Ask:**

- "Where is your data-residency boundary documented — and is it enforced by
  policy or by process?"
  *Good answer:* Org Policy / SCP constraints in cloud; physical location
  policy for on-prem; the DPO has signed off on it.
  *Red flag:* "we know it's in India" with no enforcement mechanism — that's
  trust, not control.

- "Which data categories are in scope for DPDP versus just RBI, and do you
  treat them the same?"
  *Good answer:* Yes, they distinguish them — RBI payment data has strict
  residency (no mirror outside India). DPDP imposes no India-only rule: it
  permits transfer anywhere except a government negative list (s.16), none
  notified as of 2026 — so RBI, not DPDP, is the binding residency constraint.
  *Red flag:* "same thing" — they are not; conflating them risks either
  over-restricting or under-protecting.

- "What's your breach notification runbook, and who owns the 6-hour
  CERT-In report?"
  *Good answer:* Named CISO or DPO, documented template, tabletop-tested,
  SIEM alert triggers the runbook.
  *Red flag:* "we'll figure it out when it happens" — that's a fine waiting to
  materialize, and regulators ask for evidence of a pre-breach plan.

- "Has a DPA or DPO reviewed your cloud architecture for cross-border
  data flows, including vendor sub-processors?"
  *Good answer:* DPO/legal has mapped data flows; sub-processors (e.g., a
  cloud analytics vendor processing Indian customer data) have DPAs with SCCs
  where needed.
  *Red flag:* "our vendors are GDPR-certified" — a vendor's own certification
  doesn't cover your flows; you need a data-processing agreement (DPA) and
  a transfer mechanism.

- "How long do you retain PII, and can you selectively erase it while
  keeping the transaction audit trail?"
  *Good answer:* PII is pseudonymised at T+X days (policy-defined); transaction
  records kept 7 years per RBI; the mapping table that links token to person is
  held in a separate, access-controlled store.
  *Red flag:* "we keep everything forever" — a GDPR/DPDP storage-limitation
  violation, and also a breach-blast-radius problem.

## Pitfalls & war stories

**The DR-region surprise.** An architect proposes Mumbai primary + Iowa DR to
match an existing global DR pattern. It fails the RBI audit. The bank's CISO
finds out six months into build. Project restarts to use Delhi as the DR region.
Lesson: treat region selection as a Day 0 architectural decision, locked before
infrastructure-as-code is written.

**"GDPR-compliant cloud" doesn't mean your use of it is compliant.** Cloud
providers publish Data Processing Agreements and offer region selection — but
they don't control where *you* route your data or which services you call. A
Lambda function that calls a logging SaaS in Germany with Indian customer card
PAN (Primary Account Number) data is still an RBI/PCI residency problem even
if your primary region is Mumbai. (DPDP itself would permit the EU transfer —
Germany isn't on any government negative list — but RBI and PCI do not.)

**Consent for one purpose ≠ consent for another.** A FMCG (Northwind) collects
mobile numbers from retail partners for delivery OTPs. The marketing team pipes
the same list into a campaign tool. DPDP treats this as a new, separate
processing purpose requiring fresh consent. The architect who built the data
pipeline without a purpose-limitation control enabled the violation.

**Right to erasure vs audit retention — handled too late.** A bank builds a
customer profile store with PII. Two years later, the first erasure requests
arrive. The database has no concept of pseudonymisation — name, mobile, and
transaction amounts are in the same row. Now you're doing emergency schema
surgery on production. Design the pseudonymisation boundary (see S17, S18)
at table-design time, not after go-live.

**The sub-processor blindspot.** A data analytics vendor is given read access
to GCS buckets containing Indian customer transaction data for ML model
training. The vendor runs on AWS `us-east-1`. The data owner says "we have a
DPA with them." But: (a) RBI payment/transaction data physically moved to the
US, violating residency, (b) the DPA lacks documented sub-processor controls,
(c) no GDPR transfer mechanism (SCCs) for any EU-resident data in scope. The
RBI residency breach is the headline finding (DPDP alone would permit the US
transfer — no negative list). Discovered by an external auditor.

## Going deeper (optional)

- **GDPR full text:** Regulation (EU) 2016/679 — Articles 5 (principles),
  13–14 (transparency), 17 (erasure), 33–34 (breach notification), 44–49
  (transfers) are the architect-critical articles.
- **DPDP Act 2023 (India):** Digital Personal Data Protection Act 2023 —
  Sections 4 (grounds for processing), 8 (obligations of data fiduciary),
  16 (cross-border transfer — negative-list model), 8(6) (breach
  notification) are the most design-relevant. Pair with the **DPDP Rules
  2025** (notified Nov 2025) for the breach-reporting timeline: intimate the
  Board without delay, detailed report within 72 hours.
- **RBI data localization:** RBI circular "Storage of Payment System Data"
  (April 2018) — the primary directive. One page, but frequently misread.
- **NIST Privacy Framework 1.0** — the US complement to NIST CSF for privacy
  engineering; cross-maps to GDPR obligations.
- **Cloud DLP documentation** — GCP: `cloud.google.com/dlp`; AWS Macie:
  `docs.aws.amazon.com/macie`.
- Pairs with **S17** (data classification), **S18** (tokenisation/masking),
  **N29** (how compliance shapes the network), and **S29** (frameworks map).

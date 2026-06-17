# Kata S24 — Ransomware, BCP/DR, backups, tabletop exercises

> **Track:** Security · **Module:** S6 Resilience & incident response · **Prereqs:** S01, S23 · **Time:** ~40 min
> **Tags:** `security` `ransomware` `bcp-dr` `backups` `incident-response` `fsi` `high-availability` `blast-radius`

## Why it matters

Ransomware is the most likely event that will require your organization to invoke
its Business Continuity Plan (BCP) and Disaster Recovery (DR) procedures at full
scale. A CISO presenting to the board after an attack will be asked: "Could we have
prevented the encryption? How long did we take to recover? What was the business
impact?" The architect's role is to ensure the *design* answers those questions
before the attack — immutable backups, network isolation, tested runbooks, and a
recovery time that falls inside the business's tolerance. Banks and large FMCGs
operate on near-zero tolerance for extended downtime; a ransomware design review
that skips the backup strategy and BCP/DR linkage is incomplete.

## The mental model

**Ransomware in three stages** (understand these to interrupt them):

```
  Stage 1 — Initial access
  ┌─────────────────────────────────────────────────────────────┐
  │  Phishing email / exposed RDP / VPN credential stuffing /  │
  │  unpatched remote-access VPN appliance (see N37, N36)      │
  └──────────────────────────┬──────────────────────────────────┘
                             │ foothold on one host
  Stage 2 — Lateral movement & dwell
  ┌──────────────────────────▼──────────────────────────────────┐
  │  Attacker moves east-west (see N27), escalates privileges,  │
  │  discovers backup servers, exfiltrates data before locking  │
  │  (double-extortion: "pay or we publish")                    │
  │  Typical dwell time: 11–21 days in FSI environments        │
  └──────────────────────────┬──────────────────────────────────┘
                             │ trigger: encryption payload deployed
  Stage 3 — Encryption & ransom demand
  ┌──────────────────────────▼──────────────────────────────────┐
  │  Files/DBs encrypted, backups potentially deleted, ransom   │
  │  note left; business impact begins; BCP/DR must activate   │
  └─────────────────────────────────────────────────────────────┘
```

**The architect's levers at each stage:**

| Stage | Control category | Examples |
|-------|-----------------|---------|
| 1 — Initial access | Reduce attack surface | MFA everywhere (S06), patch edge devices, no exposed RDP, ZTNA instead of VPN (S26) |
| 2 — Lateral movement | Blast-radius limiting | Segmentation (N27), least-privilege IAM (S07), EDR, NDR flow alerts |
| 2 — Backup discovery | Backup protection | Isolated backup network, immutable storage, separate credentials |
| 3 — Recovery | BCP/DR | RTO/RPO targets, tested restore, runbooks, communication plan |

**BCP vs DR — the distinction matters in regulated shops:**

```
  BCP (Business Continuity Plan)
  ├─ The business keeps operating despite an incident
  ├─ Covers people, process, and technology (not just IT)
  └─ "What do we do when X happens?" — written in plain language

  DR (Disaster Recovery)
  ├─ The IT subset of BCP — systems, data, and infrastructure
  ├─ Governed by RTO and RPO
  └─ "How do we bring the systems back?" — runbooks, playbooks, test schedules

  RTO — Recovery Time Objective   "how long can the business be down?"
  RPO — Recovery Point Objective  "how much data can we afford to lose?"
```

For Meridian Bank, RBI and PCI-DSS mandates mean RTO for core banking
is typically < 4 hours and RPO < 15 minutes. Missing those figures in a
ransomware event is a regulatory breach, not just a business inconvenience.

**Backup architecture — the 3-2-1-1 rule:**

```
  3 copies of data
  ├─ 2 on different media / storage types
  ├─ 1 offsite (geographically separate)
  └─ 1 air-gapped or immutable (cannot be deleted or encrypted by ransomware)

  "Immutable" means object lock / WORM: even a compromised admin cannot
  delete the backup within its retention window.
```

**Tabletop exercises** — simulated, discussion-based run-throughs of an incident
scenario (no systems are touched). They test the *process and people*, not the
technology. A technical disaster-recovery test (actually restoring from backup)
is a separate, complementary exercise.

## Worked example

Meridian Bank discovers ransomware on a Monday morning. Three scenarios — one with
good architecture, two with common gaps:

### Scenario A — the architect did the job (good outcome)

```
  Mon 06:00  EDR alert: unusual encryption process on 10.10.0.45 (HQ-DC1)
  Mon 06:05  SOC isolates the host (firewall rule drop, no east-west reach to CDE)
             CDE subnet 10.10.20.0/24 is behind a dedicated firewall segment (N27)
  Mon 06:15  IR team confirms ransomware, activates BCP runbook
  Mon 06:30  Recovery team confirms last immutable backup: Sun 23:45 → RPO ~6h 15m
             Backup in Object Lock / WORM storage, separate credentials, offsite
  Mon 09:00  Core banking restored on DC2 (10.20.0.0/16) from backup
             RTO = 3h — within the 4h target
  Mon 10:00  Branches (10.30.0.0/16) fail-over via SD-WAN to DC2 automatically
  Mon 11:00  Root cause: unpatched remote-access VPN appliance (N37). 8-day dwell.
             Exfiltration detected by NDR before encryption; CISO notifies RBI.
```

### Scenario B — flat network, backup on the domain (bad outcome)

```
  Mon 06:00  Ransomware triggers on 10.10.0.45
             No segmentation: ransomware spreads east-west to all of 10.10.0.0/16
             Backup server is on 10.10.0.200 — same flat network → encrypted too
  Mon 06:30  IT discovers 90% of servers encrypted, including the backup server
  Mon 07:00  Only copy is tape offsite — 72-hour restore process begins
  Mon 07:01  RBI notified (mandatory: within 6 hours of detection)
  Mon 07:30  Ransom demand received — board escalation
```

### Scenario C — immutable backup but untested restore (common gap)

```
  Backups exist in immutable storage — but the last *tested* restore was 14 months
  ago. On recovery day, the DBA discovers the backup encryption key is rotated
  and stored in a KMS that is also in the encrypted estate. Restore fails.
  Lesson: RTO/RPO targets are meaningless if the recovery process isn't tested.
```

### Tabletop exercise excerpt (Meridian Bank, 2-hour session)

```
  Scenario inject: "It is 2 a.m. Tuesday. Core banking is unavailable.
  We've found a ransom note on the database server."

  Facilitator questions:
  Q1: Who has authority to invoke BCP? Is that person reachable at 2 a.m.?
  Q2: Who calls RBI — and within what time limit?
  Q3: Which systems do we bring up first? In what order? Who decides?
  Q4: Is the last good backup verified clean — or could it contain the malware?
  Q5: If we can't pay staff because payroll is encrypted, what happens?

  Expected gaps that surface:
  - Backup verification process isn't documented
  - BCP owner's personal mobile isn't in the runbook
  - RBI notification owner is the CISO (on holiday)
  - No defined "clean" snapshot criteria
```

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Immutable backup | Tape/WORM appliance (Quantum, Dell) | Cloud Storage bucket retention policy + Bucket Lock (or per-object Object Retention Lock, Locked mode) | S3 Object Lock (Compliance or Governance mode) | Azure Blob immutability policies (Azure: TODO) |
| Backup isolation | Separate VLAN + credentials | Separate project + VPC; no peering to production | Separate account (AWS Organizations); bucket policy denies production role | (Azure: TODO) |
| Snapshot / backup schedule | Veeam, Commvault, NetBackup | Cloud Backup (Backup and DR service) | AWS Backup | Azure Backup |
| Cross-region backup copy | Tape vault offsite | Multi-region replication in Cloud Storage | S3 Cross-Region Replication; AWS Backup cross-region | (Azure: TODO) |
| DR failover target | Cold/warm/hot standby DC2 | Second GCP region (e.g. asia-south1 Mumbai → asia-south2 Delhi) | Second AWS region; Route 53 failover routing | (Azure: TODO) |
| Ransomware detection | EDR + NDR | Security Command Center + Chronicle SIEM | GuardDuty + Security Hub | Microsoft Defender for Cloud |
| Network isolation (containment) | Emergency VLAN reassignment / ACL | Remove/modify VPC firewall rule; isolate tag | Revoke Security Group rules; quarantine SG | (Azure: TODO) |
| Key management during recovery | HSM / hardware key store | Cloud KMS with separate key admin project | AWS KMS with backup key admin role in separate account | (Azure: TODO) |

**GCP-specific note:** GCP offers two distinct immutability mechanisms — don't
conflate them. (1) A *bucket retention policy* sets a minimum retention period for
every object in the bucket; applying *Bucket Lock* makes that policy permanent and
irreversible. (2) *Object Retention Lock* sets retention per object, in either
`Unlocked` or `Locked` mode (note: `Locked` is the gcloud/Console term — `COMPLIANCE`
and `GOVERNANCE` are the S3/XML-API names, not GCP's). For backups, set the bucket
retention policy before storing data and lock it via Bucket Lock; once locked, not
even a Project Owner can delete objects before the retention period expires — which
is precisely the property needed against a compromised admin.

**AWS-specific note:** S3 Object Lock in Compliance mode behaves identically.
The backup bucket should live in a separate AWS account with a Service Control
Policy (SCP) that prevents the production account's IAM roles from accessing it.

## Do it (the exercise)

### Part 1 — Map your (or a client's) RTO/RPO requirements [paper]

1. Pick a critical system (or use Meridian Bank's core banking system).
2. Fill in:
   ```
   System: ___________________
   RTO target:  ___ hours  (business tolerance for downtime)
   RPO target:  ___ minutes/hours  (business tolerance for data loss)
   Regulatory floor: ___  (RBI < 4h RTO? PCI-DSS audit requirement?)
   ```
3. Identify the *current* backup frequency and last tested restore date.
   If those two numbers violate your RPO/RTO: you've found the gap.

### Part 2 — Check backup isolation [paper / laptop]

For an existing backup design, answer:
- Are backup server credentials separate from domain admin? (`y/n`)
- Is the backup storage network reachable from the production compute network? (`y/n` — should be `n`)
- Is at least one backup copy in immutable / Object Lock storage? (`y/n`)
- When was the last full restore test, end-to-end? (`___ date`)
- Is the backup encryption key stored *inside* the estate being backed up? (`y/n` — should be `n`)

### Part 3 — Run a 30-minute tabletop on your team [paper]

Use this scenario:

```
Scenario: It is 3 a.m. The monitoring system shows that 80% of file servers in
HQ-DC1 (10.10.0.0/16) are offline. A colleague receives a ransom note
by email. Your CISO is travelling internationally.

Q1. Who invokes the BCP? Name the person and their backup.
Q2. What is the first technical action — and who is authorised to take it?
Q3. When do you contact regulators (RBI / PCI QSA)?  How?
Q4. How do you determine whether your backups are clean (pre-infection)?
Q5. What is your public statement, and who approves it?
```

Record the answers. Note any question that generates disagreement or silence —
those are the gaps to fix before the real event.

### Part 4 — Verify immutable backup on a free-tier cloud [needs cloud account]

On GCP:
```bash
# Create a bucket with a 7-day retention policy
gcloud storage buckets create gs://meridian-backup-test-$(date +%s) \
  --location=asia-south1 \
  --uniform-bucket-level-access

# Set a 7-day retention policy (makes objects locked after creation)
gcloud storage buckets update gs://<bucket-name> \
  --retention-period=7d

# Upload a test file
echo "backup-test" | gcloud storage cp - gs://<bucket-name>/test-object.txt

# Attempt to delete within retention window — this should FAIL
gcloud storage rm gs://<bucket-name>/test-object.txt
# Expected: ERROR - Object is under retention policy
```

On AWS:
```bash
# Create a bucket with Object Lock enabled (must be set at creation time)
aws s3api create-bucket \
  --bucket meridian-backup-test-$(date +%s) \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1 \
  --object-lock-enabled-for-bucket

# Create a real file to upload (Object Lock auto-enables versioning)
echo "backup-test" > test-object.txt

# Put object with Compliance mode lock for 7 days
aws s3api put-object \
  --bucket <bucket-name> \
  --key test-object.txt \
  --body test-object.txt \
  --object-lock-mode COMPLIANCE \
  --object-lock-retain-until-date $(date -d '+7 days' --iso-8601=seconds)

# A plain delete does NOT remove the locked data — it only adds a delete marker
# and SUCCEEDS. The locked version is untouched. (This often surprises people.)
aws s3api delete-object --bucket <bucket-name> --key test-object.txt
# Expected: succeeds, returns a DeleteMarker (the object version is still protected)

# Find the locked version id, then try to permanently delete that version
aws s3api list-object-versions --bucket <bucket-name> --prefix test-object.txt

# Attempt to delete the specific locked version — THIS is what should FAIL
aws s3api delete-object \
  --bucket <bucket-name> \
  --key test-object.txt \
  --version-id <version-id>
# Expected: An error occurred (AccessDenied) — COMPLIANCE lock blocks version delete
```

## Say it back (self-check)

1. Name the three stages of a ransomware attack and one architectural control
   that interrupts each.
2. Define RTO and RPO. For Meridian Bank's core banking, what are the
   regulatory-driven targets, and who sets them?
3. What is the 3-2-1-1 backup rule, and what does the second "1" add that
   3-2-1 alone does not?
4. Why must backup credentials and backup storage be in a separate administrative
   domain from the production environment?
5. What is a tabletop exercise, and how does it differ from a DR recovery test?

## Talk to the IT/security head

**Ask:**

- "When were our backups last tested by actually restoring to a clean environment
  — not just verifying the backup job completed?"
  *Good answer:* "Last quarter, we restored the core banking database to the DR
  environment in DC2, timed it at 2h 45m, and confirmed data integrity with
  checksums. We have a calendar entry for next quarter."
  *Red flag:* "The backup jobs are green every night." (Job success ≠ restore
  success. Ask when they last *ran the restore*.)

- "Where are our backup encryption keys stored, and could ransomware on our
  production systems reach and delete them?"
  *Good answer:* "Keys are in a hardware HSM in DC2, separate admin credentials,
  not joined to the production Active Directory domain."
  *Red flag:* "In AWS KMS in the same account" or "on the backup server itself."

- "Is our backup storage immutable — i.e., can a compromised domain admin delete
  our latest backup?"
  *Good answer:* "S3 Object Lock in Compliance mode; until the retention period
  expires, no one — not even the root user — can shorten or remove retention or
  delete the object version. We also keep it in a separate account with MFA on
  root as defence-in-depth, though that is not what protects the Compliance-mode
  lock."
  *Red flag:* "We have Veeam immutability checked" (software immutability in the
  same domain as the attacker is not genuine immutability).

- "Who has authority to invoke BCP at 2 a.m. on a Sunday, and what is the call
  tree if they are unreachable?"
  *Good answer:* Named person, named backup, documented out-of-band contact (not
  email, which may itself be in the encrypted estate), tested within 6 months.
  *Red flag:* "The CISO handles that" with no backup — a single point of failure
  in your human recovery chain.

- "What is our regulatory notification timeline for a ransomware event — who
  notifies RBI, by when, and using what channel?"
  *Good answer:* "RBI's Cyber Security Framework (DBS.CO/CSITE, 2016) requires
  reporting a cyber incident within 2–6 hours of detection, and CERT-In's 2022
  Directions impose a parallel 6-hour rule. We have a pre-drafted template; the CISO and
  their deputy are both authorized senders. We tested the process in last year's
  drill."
  *Red flag:* Uncertainty about the timeline, or "legal handles that" with no one
  in IT who knows the process.

**Red flags to listen for (beyond the above):**

- RTO/RPO targets exist on paper but have never been validated by a timed test.
- Backup server joined to the same Active Directory as production.
- "We've never had an incident" as evidence the controls work.
- No documented clean-snapshot policy (how far back do you go to find a
  pre-infection backup?).
- DR environment is consistently "borrowed" for dev/test and not available
  for actual failover.

## Pitfalls & war stories

**"Our backups ran successfully."** Backup job success means the backup agent
ran and wrote bytes somewhere. It does not mean you can restore in time. Many
FSI teams discover this under fire — the backup media is fine, but the restore
process has never been timed and takes 3× the RTO.

**Domain-joined backup servers.** At Meridian Bank equivalents worldwide, the most
common ransomware failure mode: backup software credentials are in Active Directory,
attackers compromise AD, delete backups, then encrypt everything. Fix: separate
backup administrative domain, separate credentials, network isolation — ideally
on a VLAN with no route from the production compute network (pairs with N15, N27).

**Double-extortion and the "don't pay" debate.** Modern ransomware groups exfiltrate
data *before* encrypting (Stage 2). Even a perfect restore does not resolve the
data-leak risk. The CISO's posture at Meridian Bank: assume exfiltration occurred,
notify regulators regardless of whether you pay, activate data-breach response
alongside DR. Paying ransom does not guarantee decryption keys and may violate
sanctions regulations if the group is a designated entity.

**The Northwind FMCG failure mode.** Northwind's plants run OT systems
(manufacturing control) and IT systems on networks that are supposed to be
separated (see running-example.md). In practice, a ransomware event that starts
in IT often crosses the porous OT/IT boundary via shared file servers. The result:
plant downtime that a purely IT-focused BCP never accounted for. Northwind's
DCs (distribution centers) at 12 locations each have local WMS (warehouse
management systems) — if central systems are down, does the site have a manual
fallback? The BCP must answer this, not just the IT recovery runbook.

**Untested KMS keys on restore day.** If your backup set is encrypted and the
KMS key is version-rotated, you must retain old key versions for the retention
period of the backup. A common misconfiguration: auto-rotation deletes old key
versions, making older backups undecryptable. Test restore from the oldest backup
in your retention window, not just the most recent.

**Tabletop ≠ DR test.** Regulators (RBI, PCI auditors) want evidence of both.
A tabletop confirms the *people and process*. A DR test confirms the *technology
and timing*. Running only one of the two leaves half the risk untested.

## Going deeper (optional)

- NIST SP 800-61 Rev 2 — Computer Security Incident Handling Guide; the lifecycle
  that S23 covers; ransomware fits in the "containment, eradication, recovery" phase.
- NIST SP 800-34 Rev 1 — Contingency Planning Guide for Federal Information Systems
  (BCP/DR methodology, RTO/RPO documentation).
- CISA Ransomware Guide (updated 2023) — stopransomware.gov; joint advisory with
  FBI; the closest thing to an official playbook.
- RBI Cyber Security Framework (DBS.CO/CSITE/BC.11/33.01.001/2015-16, 2016) — the
  source of the bank cyber-incident reporting timeline (2–6 hours). See also
  CERT-In Directions (2022) for the parallel 6-hour reporting rule.
- AWS Security Blog: "Building a ransomware resilient backup and recovery strategy"
  — covers S3 Object Lock and separate account patterns.
- GCP documentation: "Retention policy and Bucket Lock" and "Object Retention Lock"
  for Cloud Storage — the bucket-level vs per-object distinction, and the
  `Unlocked` / `Locked` modes.
- Pairs with: S01 (CIA — availability is what ransomware attacks), S23 (IR
  lifecycle), N27 (segmentation limits lateral movement), N15 (VLANs for backup
  isolation), S07 (least-privilege IAM limits blast radius).

# Kata S25 — Forensics basics & chain of custody

> **Track:** Security · **Module:** S6 Resilience & incident response · **Prereqs:** S23, S24 · **Time:** ~35 min
> **Tags:** `forensics` `incident-response` `security` `compliance` `audit` `fsi` `meridian-bank`

## Why it matters

When Meridian Bank suffers a breach, the CISO's first call after containment is
not to fix everything — it is to *preserve evidence intact* so the bank can
prove in a regulator audit, a legal proceeding, or an insurance claim exactly
what happened, when, and to whom. If evidence is corrupted — by rebooting a
compromised server, overwriting disk blocks, or forgetting to timestamp a log
export — forensic value is destroyed and the bank may lose its legal position
entirely. Architects who design systems that are forensically hostile (no
immutable logs, no clock sync, overwriting storage, no chain of custody) hand
attackers their best defense. This kata gives you the mental model to ask the
right preservation questions before an incident happens.

## The mental model

### Digital forensics: what it is and isn't

Digital forensics is **the disciplined collection, preservation, and analysis of
digital evidence** in a way that maintains its legal and investigative
integrity. It is not the same as security monitoring (ongoing) or penetration
testing (offensive). It is the *reconstruction of what happened*, done after the
fact, to a standard that can be cross-examined.

Three core questions forensics must answer:

```
  1. What data existed / was modified / was exfiltrated?
  2. When did each event occur (timeline)?
  3. Who or what caused it (attribution)?
```

### The chain of custody

The **chain of custody** is the documented, unbroken record of who handled
evidence, when, and what they did with it. Break it and a court or regulator
may exclude the evidence entirely.

```
  Evidence collected
       │
       ▼
  ┌─────────────────────────────────────────────────────────┐
  │  CHAIN OF CUSTODY RECORD                                │
  │                                                         │
  │  Item: disk image of server MBANK-PROD-DB01             │
  │  Collected by: J. Patel (IR lead)   2026-06-17 03:42Z  │
  │  Transferred to: Forensics lab      2026-06-17 07:15Z   │
  │  Hash (SHA-256): a3f1...b9c2   ← verified at each step │
  │  Storage: locked evidence bag #EV-0042                  │
  │  Access log: [name, date, reason, in/out]               │
  └─────────────────────────────────────────────────────────┘
       │
       ▼
  Forensic copy (bit-for-bit image) — NEVER work on originals
       │
       ├─► Analysis copy 1 (analyst A)
       └─► Analysis copy 2 (analyst B, cross-check)
```

The **original never changes** after collection. All analysis is done on
verified copies. Every person who touches evidence is recorded.

### The order of volatility

Not all evidence lasts equally long. Collect in order, fastest-disappearing first
(NIST SP 800-86 principle):

```
  MOST VOLATILE                                    LEAST VOLATILE
  ─────────────────────────────────────────────────────────────►
  CPU registers   RAM       Swap/page   Network state   Disk   Logs
  & cache         (seconds  file        (ARP, TCP        (days  (days–
  (lost on        to hours) (minutes)   connections,     to     years if
  reboot)                               routes)          months) rotated)
```

**The single most common mistake:** rebooting a compromised server first to
"clean it up." That instantly destroys RAM (running processes, encryption keys,
network state) — all the highest-value evidence.

### Hashing as evidence integrity

A cryptographic hash (SHA-256) of the original disk image is computed
immediately on collection and re-verified at every transfer. If the hash
matches, the copy is bit-for-bit identical to the original. If it doesn't,
evidence integrity is broken — whether by accident or tampering.

```
  $ sha256sum /dev/sda > mbank-prod-db01.sha256
  $ sha256sum disk-image.dd > disk-image.sha256
  # Verify image matches original
  $ sha256sum -c mbank-prod-db01.sha256
```

### The four phases of forensic work (NIST SP 800-86)

```
  1. IDENTIFY     What potential evidence exists? Which systems? Which logs?
                  (see asset inventory, see S23 for scope)

  2. PRESERVE     Acquire without altering. Hash. Chain of custody.
                  Legal hold notices. Log preservation orders.

  3. ANALYZE      Timeline reconstruction, artifact examination (process lists,
                  registry, logs, network captures, file carving).

  4. REPORT       Defensible, reproducible findings. Expert-witness ready.
```

### Legal hold

A **legal hold** (also litigation hold) is a documented instruction to stop
normal data retention and deletion processes for specified data because it may
be evidence. In regulated FSI environments, legal must issue the hold and IT
must acknowledge it — this is a process chain the architect's storage/backup
system must be able to honour within hours.

## Worked example

**Scenario:** Meridian Bank's HQ-DC1 monitoring (see N54, S20) raises an
alert on 2026-06-17 at 02:51 UTC. Traffic is leaving `10.10.20.0/24` (CDE)
toward `10.10.0.0/16` (general DC) at an unusual volume — potential lateral
movement from the cardholder data environment (PCI scope, see N29).

The IR team (S23) contains the suspect host `10.10.20.45` by isolating it at
the firewall. Now forensics begins.

**Step 1 — Identify evidence sources (order of volatility)**

```
  Source                    Location                 Volatility
  ─────────────────────────────────────────────────────────────
  Running processes         10.10.20.45 RAM          minutes
  Active network conns      10.10.20.45 / firewall   minutes
  VPC flow logs / firewall  GCP/on-prem SIEM         hours (if not purged)
  OS auth logs              /var/log/auth.log         days (syslog rotation)
  Application logs          App servers               days
  Disk image                10.10.20.45 sda           days–weeks
  Cloud audit logs          GCP Cloud Audit Logs      400d Admin Activity / 30d default Data Access
  SIEM / Splunk events      S20                       per retention policy
```

**Step 2 — Preserve RAM before shutdown**  
The IR lead uses a live-response tool (e.g. LiME kernel module on Linux) to
dump RAM from the running host to a network share, *before* any reboot or
shutdown:

```bash
# On the isolated host (10.10.20.45) — run as root
# LiME (Linux Memory Extractor) dumps physical memory to file
insmod lime-$(uname -r).ko "path=/mnt/evidence/mbank-prod-db01-ram.lime format=lime"
sha256sum /mnt/evidence/mbank-prod-db01-ram.lime >> /mnt/evidence/chain-of-custody.log
```

**Step 3 — Capture live network state before isolation is complete**

```bash
# Capture active TCP/UDP connections (volatile)
ss -antup >> /mnt/evidence/network-state.txt
# Capture ARP table (who was the host talking to at L2)
ip neigh >> /mnt/evidence/arp-table.txt
# Capture routing table
ip route >> /mnt/evidence/routes.txt
# Timestamp everything
date -u >> /mnt/evidence/capture-timestamps.txt
```

**Step 4 — Disk image**  
After RAM capture, create a bit-for-bit forensic image. Never work on the
original disk:

```bash
# Acquire image from block device to evidence share
dc3dd if=/dev/sda hash=sha256 of=/mnt/evidence/mbank-prod-db01.dd \
  hof=/mnt/evidence/mbank-prod-db01.sha256 \
  log=/mnt/evidence/mbank-prod-db01-acquisition.log
# dc3dd defaults to MD5 — hash=sha256 selects SHA-256, hof= verifies the output
# file and logs sector-by-sector; use ddrescue for failing disks
```

**Step 5 — Log preservation order**  
The IR lead emails (with timestamp and ticket reference IR-2026-0617-001) the
following teams simultaneously:

- SIEM/Splunk team: freeze log index; do not expire logs from 2026-06-01 onward
- GCP platform team: export Cloud Audit Logs and VPC Flow Logs (N54) for
  project `meridian-production` covering the 30 days prior to the incident
- Storage team: place legal hold on backup tapes covering `10.10.20.0/24` hosts

**Step 6 — Chain of custody form (filled contemporaneously)**

```
  EVIDENCE ITEM:  Disk image — mbank-prod-db01.dd
  SHA-256:        a3f1c24e...b9c2 (see mbank-prod-db01.sha256)
  Collected by:   J. Patel (IR lead)         2026-06-17 03:42 UTC
  Witness:        R. Singh (Security team)   2026-06-17 03:42 UTC
  Transfer to:    Forensic workstation EV-WS01  07:15 UTC
  Transferred by: J. Patel                   verified SHA-256 match
  Storage:        Evidence cabinet EC-14, key held by security manager
  Subsequent access: [name / date / reason / in-out / hash check]
```

**Cloud audit log retrieval (GCP):**

```bash
# [needs cloud account] — pull Cloud Audit Log entries for the suspect project
gcloud logging read \
  'resource.type="gce_instance" AND
   logName="projects/meridian-production/logs/cloudaudit.googleapis.com%2Factivity"
   AND timestamp>="2026-06-01T00:00:00Z"' \
  --project=meridian-production \
  --format=json \
  > /mnt/evidence/gcp-audit-logs-meridian-production.json
sha256sum /mnt/evidence/gcp-audit-logs-meridian-production.json \
  >> /mnt/evidence/chain-of-custody.log
```

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Immutable audit log | Syslog shipped to SIEM | Cloud Audit Logs (Admin Activity: 400 days; Data Access: configurable) | CloudTrail (90 days event history; S3 bucket for long-term) | Azure Activity Log / Microsoft Sentinel (Azure: TODO) |
| Network flow evidence | NetFlow/IPFIX from routers (N35) | VPC Flow Logs — subnet or NIC level, export to Cloud Storage/BigQuery | VPC Flow Logs — per-ENI, export to S3 or CloudWatch | NSG Flow Logs (Azure: TODO) |
| Packet capture | SPAN port / network TAP | Packet Mirroring (to IDS VM or PCAP bucket) | Traffic Mirroring (per ENI, to NLB or target) | (Azure: TODO) |
| Cloud evidence preservation | Legal hold on tape | Log bucket lock (Object Retention / retention policy) + Log sink to separate project | S3 Object Lock (WORM) on CloudTrail bucket | (Azure: TODO) |
| Incident containment | ACL/firewall block | Firewall rule or org policy deny; quarantine network tag | Security Group revoke-all / NACL deny; VPC isolation | (Azure: TODO) |
| Forensic disk image | dd / dc3dd on physical disk | Persistent disk snapshot (immutable) — `gcloud compute disks snapshot` | EBS snapshot — `aws ec2 create-snapshot` | (Azure: TODO) |
| Clock authority (evidence timestamps) | NTP server (on-prem stratum-1) | All GCP services sync to Google's NTP (RFC 5905); logs carry µs-precision UTC | AWS CloudTrail logs are UTC; EC2 uses Amazon Time Sync Service | (Azure: TODO) |

**GCP disk snapshot as forensic image:**

```bash
# [needs cloud account]
gcloud compute disks snapshot mbank-prod-db01 \
  --snapshot-names mbank-forensic-2026-0617 \
  --zone asia-south1-a \
  --project meridian-production
# Snapshot is immutable at creation time and can be cloned to a forensic project
```

**AWS EBS snapshot:**

```bash
# [needs cloud account]
aws ec2 create-snapshot \
  --volume-id vol-0abc123 \
  --description "Forensic IR-2026-0617 mbank-prod-db01" \
  --region ap-south-1
```

## Do it (the exercise)

### Part A — Chain of custody paperwork [laptop]

1. Create a local directory `~/forensics-lab/IR-2026-001/` for simulated
   evidence files.

2. Create a "disk image" placeholder and hash it:
   ```bash
   # Simulate creating an evidence file
   dd if=/dev/urandom of=~/forensics-lab/IR-2026-001/simulated-disk.dd bs=1M count=10
   sha256sum ~/forensics-lab/IR-2026-001/simulated-disk.dd \
     > ~/forensics-lab/IR-2026-001/simulated-disk.sha256
   cat ~/forensics-lab/IR-2026-001/simulated-disk.sha256
   ```

3. Copy it (simulating a transfer to an analyst workstation) and verify
   the hash still matches:
   ```bash
   cp ~/forensics-lab/IR-2026-001/simulated-disk.dd \
      ~/forensics-lab/IR-2026-001/analysis-copy.dd
   sha256sum ~/forensics-lab/IR-2026-001/analysis-copy.dd
   # Compare output with the .sha256 file — hashes must be identical
   ```

4. Write a one-page chain of custody document (plain text or table) for
   the simulated disk image following the format in the worked example.
   Include: item description, SHA-256, collected by/when, transferred
   to/when, storage location, and two simulated "access log" entries.

### Part B — Volatile data capture [laptop]

5. On your laptop, capture the current network state as if responding to
   an incident (safe — only reads your own machine's state):
   ```bash
   # Active TCP/UDP connections with process names
   ss -antup 2>/dev/null > ~/forensics-lab/IR-2026-001/network-state.txt
   # ARP / neighbor table
   ip neigh >> ~/forensics-lab/IR-2026-001/arp-table.txt
   # Routing table
   ip route >> ~/forensics-lab/IR-2026-001/routes.txt
   # Timestamp (UTC)
   date -u >> ~/forensics-lab/IR-2026-001/capture-timestamp.txt
   echo "Captured by: $(whoami) on $(hostname)" \
     >> ~/forensics-lab/IR-2026-001/capture-timestamp.txt
   ```

6. Hash the whole evidence directory manifest:
   ```bash
   find ~/forensics-lab/IR-2026-001/ -type f -exec sha256sum {} \; \
     > ~/forensics-lab/IR-2026-001/evidence-manifest.sha256
   cat ~/forensics-lab/IR-2026-001/evidence-manifest.sha256
   ```

### Part C — Thought exercise [paper]

7. For Meridian Bank's CDE (`10.10.20.0/24`), list three evidence sources
   that would be **lost** if the IR team rebooted `10.10.20.45` as their
   first action, and estimate how long each would have survived if the host
   had remained running.

8. Identify which logs in the worked example would fall under a PCI-DSS
   audit log retention requirement (PCI-DSS Req 10.5.1: 12 months, 3 months
   immediately available) and whether the current setup satisfies it.

## Say it back (self-check)

1. What is the chain of custody and what breaks it? Give two examples of a
   break.
2. State the order of volatility. What evidence is lost the moment a server
   is rebooted?
3. Why is a SHA-256 hash computed at the moment of collection, not later?
   What does a matching hash prove (and what doesn't it prove)?
4. What is a legal hold, and which system/team at Meridian Bank must be able
   to honour it within hours?
5. What is the difference between a forensic image and a backup? Why does it
   matter for legal proceedings?

## Talk to the IT/security head

**Ask:**

- "If we had a suspected breach on a production host tonight, what is the
  process for preserving that host's evidence before you reimage it —
  and who owns that process?"

  *A good answer:* a named IR process (see S23) with a documented evidence
  collection step, a forensics team or retainer, and a clear "no-reimage
  before sign-off" rule.

  *Red flag:* "we'd just reimage immediately" — that destroys forensic
  value and may violate RBI/PCI-DSS incident preservation requirements.

- "How long do you retain logs from this system, and can you freeze
  retention for a specific period on legal notice?"

  *A good answer:* specific retention periods by log type, a legal hold
  process documented in an SOP, and confirmation that the log pipeline
  (e.g. Splunk, SIEM) can be locked independently of normal rotation.

  *Red flag:* "logs rotate every 7 days" for a PCI-in-scope system — PCI-DSS
  Req 10.5.1 requires 12 months retention with 3 months immediately available.

- "Who in the organisation has the authority to issue a legal hold, and
  what's the expected turnaround from legal counsel to IT execution?"

  *A good answer:* legal counsel + CISO co-sign; IT confirms within 2–4
  hours; a tested SOP exists.

  *Red flag:* nobody has thought about this; or "we'd just call someone."

- "Are cloud audit logs for your GCP/AWS environments shipped to an
  immutable store that the cloud admin team cannot delete?"

  *A good answer:* logs go to a separate security/logging project/account
  with restricted IAM (no delete permissions for the prod team), object
  retention lock enabled, and retention period stated.

  *Red flag:* cloud audit logs stay only in the source project and the
  infra team can delete them — that means an attacker with admin access
  can cover their tracks.

- "Has anyone on your team ever preserved a cloud VM for forensics while
  it was still running? How?"

  *A good answer:* disk snapshot + memory dump (or IR retainer has the
  playbook), with steps rehearsed in a tabletop or drill (S24).

  *Red flag:* blank stare — cloud IR forensics is a real gap at most
  on-prem-heritage banks transitioning to cloud.

**Red flags to listen for across the conversation:**

- "We're covered by our MDR vendor" (outsourcing forensics does not
  remove the bank's chain-of-custody obligation — the vendor must follow
  the same standards).
- No NTP / time synchronisation policy across hosts (timestamps from
  different clocks produce inconsistent timelines and destroy attribution).
- No tested legal hold SOP — a reactive, informal process will fail
  under regulator scrutiny.
- Log retention < 12 months for PCI-in-scope or RBI-mandated systems.

## Pitfalls & war stories

**Rebooting before evidence capture.**  
The most common and most costly mistake: a sysadmin reboots the compromised
server to "fix it fast." All RAM (running malware, encryption keys, active
network sessions) is gone. A sophisticated attacker specifically designs
malware to live only in memory, knowing this will happen. The IR team then
has no pivot point.

**Forensic image of a cloned VM, not a snapshot.**  
In a cloud environment, taking a snapshot and then starting the VM again — even
briefly — means the original volatile state is altered. A cloud disk snapshot
taken of a *running* VM (GCP default behaviour) is a crash-consistent image,
not application-consistent. For forensic purposes, the VM should be stopped
before snapshotting, or memory dumped while running before any snapshot.

**Broken time synchronisation.**  
If half the servers in HQ-DC1 (`10.10.0.0/16`) have drifted NTP clocks and
the others are UTC, reconstructing a timeline becomes impossible. A 5-minute
clock skew between a firewall log and an application log turns a clear attack
sequence into an ambiguous puzzle. Every PCI-DSS audit checks this (Req 10.6).

**Log forwarding without immutability.**  
Meridian Bank's SIEM may receive logs in real time — but if the source system
has local logs that can be overwritten (e.g. a short `/var/log` rotation), an
attacker with root on the host can delete local evidence before the SIEM
catches up. Immutable syslog shipping to a write-once bucket eliminates this
gap.

**No separation between the forensics project and the compromised environment.**  
Storing forensic images inside the same GCP project as the compromised VMs
means the attacker (if still present) can potentially access or delete them.
Evidence must go to a **separate project** with its own IAM and **no access**
from the compromised project's service accounts.

**FMCG angle (Northwind).**  
At Northwind's plants (`10.50.0.0/16`), OT/IT separation (N27) means plant-
floor forensics may require specialist OT IR tools — ordinary disk imaging
tools can crash a PLC or process-control historian. Northwind needs a separate
OT incident response playbook and vendor retainer.

## Going deeper (optional)

- **NIST SP 800-86** — "Guide to Integrating Forensic Techniques into Incident
  Response" — the canonical reference for evidence collection order of
  volatility and chain of custody process.
- **NIST SP 800-61 Rev 2** — "Computer Security Incident Handling Guide" —
  pairs with S23; positions forensics within the broader IR lifecycle.
- **PCI-DSS v4.0, Requirements 10.2–10.7** — audit log collection, protection,
  and retention obligations for cardholder data environments.
- **RBI IT Framework 2023, Annex 2** — incident management and forensic
  evidence preservation requirements for Indian scheduled commercial banks.
- **RFC 3227** — "Guidelines for Evidence Collection and Archiving" — short,
  IETF-authored; defines order of volatility and custody principles.
- **dc3dd** — DoD Cyber Crime Center fork of `dd` with built-in hashing,
  error logging, and write-blocking; standard tool for forensic imaging.
- **LiME (Linux Memory Extractor)** — open-source kernel module for live
  Linux RAM acquisition without halting the system.
- Pairs with **S20** (SIEM/logging — what to collect), **S23** (IR lifecycle —
  when forensics fits in), **S24** (tabletop drills — where to test this),
  and **N54** (VPC flow logs and packet mirroring — cloud evidence sources).

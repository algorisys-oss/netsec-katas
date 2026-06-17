# Kata N28 — IDS/IPS, NDR, DDoS protection

> **Track:** Networking · **Module:** N5 Network security & perimeter · **Prereqs:** N26, N27, S01 · **Time:** ~35 min
> **Tags:** `ids-ips` `ndr` `ddos` `security` `networking` `defense-in-depth` `fsi` `meridian-bank`

## Why it matters

A firewall decides *whether* a packet is allowed; IDS/IPS decides whether an
*allowed* packet looks malicious. These are different controls solving different
problems, and conflating them is one of the most common architectural gaps in bank
and FMCG designs. DDoS protection sits above both — it handles volume attacks that
neither a firewall nor an IPS was designed for. When a CISO says "we need
detection," or an IT head says "we got hit," you need to know which layer failed,
who owns it, and what the right counter-measure is. This kata gives you that map.

## The mental model

### IDS vs IPS — detection vs prevention

Both watch traffic and compare it against signatures or behavioral baselines. The
difference is what happens when a match is found:

```
  IDS — Intrusion DETECTION System
  ─────────────────────────────────
  Traffic ──► [copy / tap / SPAN port] ──► IDS engine
  (original flow is unaffected)                │
                                               ▼
                                          ALERT sent to SOC

  IPS — Intrusion PREVENTION System
  ───────────────────────────────────
  Traffic ──► [inline, in-band] ──► IPS engine ──► Traffic continues (or dropped)
                                         │
                                    match found?
                                    YES → drop/block/reset
                                    NO  → pass through
```

The IDS sits **out of band** — it gets a copy of traffic (mirror/SPAN/tap) and
raises alerts. It cannot block. The IPS sits **inline** — every packet passes
through it. It can drop packets in real time, but it is also a **potential single
point of failure** and adds latency (typically 50–200 µs per packet in hardware
appliances).

This is why regulated shops often run the IDS in parallel with a passive tap during
a pilot: zero risk of the sensor breaking production, while still validating
detection fidelity before going inline.

### What they detect: signatures vs anomalies

| Detection method | How it works | Strength | Weakness |
|-----------------|-------------|----------|---------- |
| **Signature / rule** | Match known attack patterns (e.g., CVE exploit payloads, port scans, SQL injection in clear text) | Low false-positives on known threats | Blind to unknown (zero-day) threats |
| **Anomaly / behavioral** | Baseline normal traffic; alert on deviations (volume spike, new protocol, unusual data flows) | Can catch novel attacks | Higher false-positive rate; baselining takes weeks |
| **Protocol analysis** | Verify traffic conforms to RFC spec (e.g., malformed DNS) | Catches evasion via malformed packets | Only covers well-defined protocols |

Modern systems (and all NDR tools) combine all three. Pure signature engines are
legacy; you'll still hear the term, but the technology has mostly converged.

### NDR — Network Detection and Response

NDR is what happened when IDS met behavioral analytics, full-packet capture, and
machine learning. It answers questions no signature engine can:

- "Show me all hosts that talked to a new external IP in the last 6 hours."
- "Is there east-west lateral movement between servers that normally don't talk?"
- "Did this host exfiltrate data slowly over DNS queries?"

```
  NDR architecture (simplified)

  Core switch / cloud flow logs
         │
         ▼
   [Sensors / probes]  ←─ full packet capture or flow (NetFlow/IPFIX)
         │
         ▼
   [Analytics engine]  ←─ ML baselines + threat intel feeds
         │
         ▼
   [Alerts / cases]  ──► SIEM / SOAR (see S20, S21)
```

NDR focuses on **east-west** (server-to-server) and **north-south** (internet-
facing) traffic — the movement signatures that a perimeter firewall cannot see once
an attacker is inside. This pairs with the segmentation logic from N27: you can
only detect lateral movement if you have sensors (or flow logs) on the internal
segments, not just the perimeter.

### DDoS — a different problem entirely

A Distributed Denial of Service attack does not exploit a software vulnerability.
It **exhausts a resource**: bandwidth, connection table, CPU. A firewall rule cannot
block it because the attack traffic is (often) structurally valid — just enormous in
volume.

```
  DDoS taxonomy (three main types):

  1. VOLUMETRIC — raw bandwidth flood
     e.g. UDP amplification, ICMP flood
     Target: saturate the upstream pipe
     Scale: tens to hundreds of Gbps (real-world IoT-botnet attacks have exceeded 3 Tbps)

  2. PROTOCOL / STATE EXHAUSTION — fill the connection table
     e.g. SYN flood: send millions of TCP SYN packets, never complete the handshake
     Target: stateful firewall or server connection table (typically 1–4 M entries)
     Scale: a 10 Gbps SYN flood can knock out a server with a 100 Gbps pipe

  3. APPLICATION LAYER (L7) — HTTP floods, slowloris, API abuse
     e.g. thousands of bots each slowly POST to /login
     Target: CPU/threads in the app, not the pipe
     Scale: relatively low bandwidth; hard to distinguish from legit traffic
```

A volumetric attack cannot be mitigated at your perimeter — the pipe is full before
packets reach your firewall. Mitigation must happen **upstream**: at the ISP, at the
cloud edge, or via a scrubbing center that receives your traffic, strips attack
packets, and returns clean traffic over a GRE tunnel.

```
  DDoS mitigation path:

  Internet ──► [Attack traffic 200 Gbps]
                      │
           ┌──────────┘
           ▼
   Scrubbing center / cloud edge (absorbs/filters)
           │
           ▼ clean traffic (~5 Gbps legitimate)
   Your network / data center
```

---

## Worked example

Meridian Bank's HQ-DC1 (`10.10.0.0/16`) hosts the card-processing (CDE) segment
and the core banking system. Their GCP deployment uses `10.100.0.0/14` for cloud
workloads and the mobile banking API.

**Scenario A — IDS/IPS placement in HQ-DC1**

The security team wants to detect port scanning and SQL injection attempts against
the database servers in the CDE segment (`10.10.20.0/24` — a typical subnet within
the DC1 range).

```
  HQ-DC1 network path (simplified)

  Internet
     │
  [Edge firewall / stateful FW — N26]
     │
  [IPS — inline, sees all north-south traffic]
     │
  [Core switch — SPAN port → IDS (passive copy)]
     │
  ┌──────────────────────────────────┐
  │   Core banking  10.10.10.0/24   │
  │   CDE           10.10.20.0/24   │  ← DB servers here
  │   Management    10.10.1.0/24    │
  └──────────────────────────────────┘
```

The IPS goes inline between the firewall and the core switch — it catches the
north-south traffic. The IDS passive tap on the core switch's SPAN port catches
**east-west** (lateral) traffic between the CDE and the core banking segments,
which the perimeter IPS never sees.

A real detection: the IDS alerts on a port scan from `10.10.10.42` (a compromised
workstation in core-banking) to `10.10.20.0/24` (CDE). The firewall would have
allowed it (same internal zone); the IPS inline at the perimeter never saw it. Only
the east-west sensor catches it. This is exactly why N27's segmentation and this
kata's sensors are **both** necessary — defense in depth (S01).

**Scenario B — DDoS on the mobile API (GCP)**

The mobile banking API is served from GCP (`10.100.0.0/14`). During a peak event,
Meridian receives a SYN flood from a botnet — roughly 80 Gbps of TCP SYN packets
to port 443. Their 10 Gbps Cloud Interconnect to GCP is not the bottleneck; the
attack arrives over the public internet path to the GCP external load balancer.

Without mitigation: the GCP load balancer's connection table fills. Legitimate
users get TCP RST or timeout.

With GCP's edge defenses: the SYN flood is an L3/L4 protocol attack, and Google's
edge network and Cloud Load Balancing infrastructure absorb it automatically and
always-on — no Cloud Armor policy is involved at this layer (Google's edge capacity
is measured in Pbps, so the attack volume never reaches Meridian's forwarding rules).
**Google Cloud Armor** sits in front of the GCP external HTTP(S) load balancer at
L7: if the attacker switches to an HTTP flood, Cloud Armor's adaptive protection
detects the L7 pattern and applies rate-based/ML-generated rules.

---

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| IDS (passive) | Dedicated appliance (Snort/Suricata on SPAN port; Cisco Firepower passive) | Packet Mirroring → IDS VM/appliance (partner solutions via Marketplace) | VPC Traffic Mirroring → partner IDS | (Azure: TODO) |
| IPS (inline) | Hardware appliance inline (Cisco Firepower, Palo Alto, Fortinet) | Packet Mirroring + inline inspection VM in a gateway VPC | AWS Gateway Load Balancer (GWLB) + partner inline appliance | (Azure: TODO) |
| NDR | On-prem NDR appliance + sensors (Darktrace, ExtraHop, Vectra) | Chronicle + Packet Mirroring; partner NDR via Marketplace | Amazon GuardDuty (flow-based detection); partner NDR via AWS Marketplace | Microsoft Defender for Cloud (network detection component) |
| Flow telemetry (NDR input) | NetFlow / IPFIX from routers and switches | VPC Flow Logs (see N54) | VPC Flow Logs | NSG Flow Logs |
| DDoS (volumetric) | ISP-level scrubbing (null-route or BGP blackhole); on-site anti-DDoS appliance | Cloud Armor (edge, integrated with external LB) | AWS Shield Standard (auto); AWS Shield Advanced (managed, SRT support) | Azure DDoS Protection — Network Protection / IP Protection SKU (the former "Basic" tier is now free always-on platform coverage) |
| DDoS (L7 application) | WAF + rate limiting (see N25) | Cloud Armor security policies (rate-based rules, adaptive protection) | AWS WAF rate-based rules + Shield Advanced | Azure WAF + Azure DDoS Protection (Network/IP Protection) |
| SIEM integration | SIEM (Splunk, IBM QRadar) receives IDS/IPS alerts via syslog | Chronicle SIEM + Cloud Logging | Amazon Security Lake + GuardDuty findings | Microsoft Sentinel |

**Key GCP specifics:**

- **Packet Mirroring** copies traffic from GCP VM instances to a collector (another
  VM or an internal LB in front of IDS VMs). You define a mirroring policy that
  specifies source and destination by subnet or tag. This is the GCP mechanism for
  both IDS and NDR.
- **Google Cloud Armor** operates at the Google Front End (GFE), *before* traffic
  reaches your VPC. It enforces IP allow/block lists, rate-based rules, OWASP rule
  sets, and adaptive protection (ML-based DDoS detection). It only attaches to
  external HTTP(S) load balancers and external TCP/SSL proxy load balancers.
- **Chronicle** (now Google Security Operations) is GCP's SIEM/SOAR + NDR
  platform. It ingests VPC Flow Logs, Packet Mirroring output, and threat intel.

**Key AWS specifics:**

- **AWS Shield Standard** is on by default for all AWS accounts; it mitigates
  common volumetric and protocol attacks at the edge (no extra cost).
- **AWS Shield Advanced** ($3,000/month base) adds managed DDoS protection, the
  DDoS Response Team (DRT), and cost protection against scaling charges during an
  attack. Required for SLA guarantees.
- **Gateway Load Balancer (GWLB)** is the AWS mechanism for inline inspection
  appliances: it transparently passes traffic to a fleet of third-party security VMs
  (e.g. Palo Alto, Fortinet) and returns it to the original path — no re-routing
  needed in routing tables.
- **Amazon GuardDuty** uses VPC Flow Logs, DNS logs, and CloudTrail to detect
  threats behaviorally. It is primarily flow-based (not full-packet), but covers NDR
  use cases for many environments. GuardDuty for EKS, S3, Lambda extend coverage.

---

## Do it (the exercise)

**Exercise 1 — Simulate an IDS with Suricata [laptop]**

Suricata is a production-grade open-source IDS/IPS. Run it in IDS mode against a
PCAP file so you see signature-based detection without touching live traffic.

```bash
# Install Suricata (Debian/Ubuntu)
sudo apt-get install -y suricata

# Download the Emerging Threats open ruleset (free)
sudo suricata-update

# Run against a test PCAP (use any PCAP with HTTP traffic)
# The -r flag reads a capture file (offline, no live traffic needed)
sudo suricata -r /var/log/suricata/test.pcap \
  -l /tmp/suricata-out \
  -c /etc/suricata/suricata.yaml \
  --runmode single

# View alerts
cat /tmp/suricata-out/fast.log
```

If you don't have a PCAP file, use the Suricata test corpus:
```bash
# Suricata includes test PCAPs; check /usr/share/suricata/
ls /usr/share/suricata/
# Or fetch a public security PCAP from Wireshark's sample captures:
# https://wiki.wireshark.org/SampleCaptures (do NOT run these against live systems)
```

What to observe: each alert line shows `[**] [SID:revision] rule name [**]`
followed by `src_ip:port -> dst_ip:port`. Note that Suricata in `-r` mode is
*passive* — it reads and classifies; it never blocks.

**Exercise 2 — Understand SYN flood mechanics [laptop / paper]**

No tools needed. Draw the TCP 3-way handshake:

```
  Normal handshake:
  Client ──SYN──► Server  (server allocates half-open connection entry)
  Client ◄─SYN-ACK── Server
  Client ──ACK──► Server  (connection fully established, entry promoted)

  SYN flood:
  Attacker ──SYN (spoofed src IP)──► Server (allocates entry; waits for ACK)
  [no ACK ever arrives — entry sits in half-open table until timeout, ~75 sec]
  Repeat millions of times → half-open table fills → server rejects legitimate SYNs
```

Mitigations to note: **SYN cookies** (server encodes state into the sequence
number, eliminating the half-open table entry until ACK arrives — standard on Linux
since kernel 2.2, enabled by default in most modern OS). A SYN-cookie-enabled
server is resilient to moderate SYN floods without a DDoS appliance.

Check whether SYN cookies are enabled on your Linux machine:
```bash
sysctl net.ipv4.tcp_syncookies
# Expected: net.ipv4.tcp_syncookies = 1  (enabled)
```

**Exercise 3 — Cloud Armor concepts [needs cloud account]**

In GCP, navigate to **Network security → Cloud Armor** and inspect the default
backend security policy. Note:
- Rules are evaluated in **priority order** (lowest number wins, like ACLs).
- A "deny" rule with a source IP CIDR drops traffic at the Google edge — your VM
  never receives the packet.
- The **adaptive protection** tab shows ML-generated attack signatures during
  active events.

---

## Say it back (self-check)

1. What is the fundamental difference between an IDS and an IPS in terms of traffic
   path and capability?
2. Name the three types of DDoS attacks and explain why a stateful firewall cannot
   mitigate a volumetric flood.
3. What does NDR add over a traditional IDS, and what input data does it require?
4. Why must sensors for east-west detection be placed *inside* the perimeter rather
   than on the edge?
5. A SYN flood targets port 443 on your web server. Your firewall rule allows port
   443. What is the correct mitigation layer, and what should already be enabled on
   your OS?

---

## Talk to the IT/security head

**Ask:**

- "Is your IPS inline or passive? If it fails open or closed, what happens to
  production traffic?"
  *Good answer:* "Inline, fail-open for traffic continuity; we accept the detection
  gap and have compensating controls (inline failover cluster). Or: we run it passive
  to avoid the risk and rely on blocking at the firewall."
  *Red flag:* "Inline, fail-closed" with no HA cluster — one sensor crash stops all
  traffic. Or: "I'm not sure" — someone doesn't know whether their IPS can brick
  production.

- "Where do you have east-west visibility — sensors, flow telemetry, or nothing?"
  *Good answer:* "We have NetFlow from the core switches to our NDR platform; it's
  not full-packet but it gives us lateral-movement detection between segments."
  *Red flag:* "Our firewall logs cover everything" — the firewall only sees traffic
  that crosses a zone boundary; east-west within a segment is invisible to it.

- "For DDoS: do you have upstream scrubbing, or do you depend on the ISP to
  null-route during an attack?"
  *Good answer:* "We have a cloud-based scrubbing service on retainer; we can
  divert via BGP in under 10 minutes. Our ISP also has a null-route SLA."
  *Red flag:* "We have a firewall with rate limiting" — a firewall cannot save you
  once a 100 Gbps flood fills your ISP link upstream of your premises.

- "How long would it take to detect a slow data exfiltration — say, 1 GB over DNS
  queries over 72 hours?"
  *Good answer:* "Our NDR baselines DNS traffic; abnormal query volume or unusual
  domain entropy would alert within the first few hours."
  *Red flag:* "Our IDS would catch it" — a signature IDS has no rule for slow DNS
  exfil unless the domain matches a known C2 list. Behavioral NDR is needed.

- "When did you last test your DDoS response runbook?"
  *Good answer:* a specific date and a named tabletop or red team exercise.
  *Red flag:* "We've never been attacked" — the runbook is untested and likely
  incomplete.

---

## Pitfalls & war stories

**"Our firewall handles IPS too."**  
Many next-generation firewalls (NGFWs) include an IPS module. That's not the same
as saying you have IPS coverage everywhere — the NGFW only sees traffic that crosses
the zone it sits between. East-west lateral movement, traffic within a VLAN, or
traffic routed around the firewall is invisible to it. Map the traffic path; don't
map the feature list.

**Inline IPS as a single point of failure.**  
A bank deployed an IPS inline across all north-south traffic. The IPS appliance
crashed during a signature update. Fail-closed by default. All branch traffic
stopped for 40 minutes. Banks consider this an outage event, not just a security
event — change-control and SLA conversations follow. Always clarify `fail-open` vs
`fail-closed` for inline devices.

**PCI-DSS and the IDS/IPS requirement.**  
PCI-DSS v4.0 Requirement 11.5 (specifically 11.5.1) mandates that intrusion-
detection and/or intrusion-prevention techniques be used to "detect and/or prevent
intrusions into the network ... at the perimeter and at critical points" of the CDE,
plus regular review of alerts. (This was Requirement 11.4 in PCI-DSS v3.2.1; v4.0
renumbered it to 11.5.) "We have a firewall" does not satisfy this.
Auditors will ask for evidence of IDS/IPS placement *and* tuning records and alert
review logs. If Meridian Bank's PCI scope includes the card-processing segment
(`10.10.20.0/24`), the security team must demonstrate monitored detection coverage
of traffic entering and leaving it.

**DDoS on a bank's internet banking portal — the reputational spike.**  
A mid-size Indian private bank had its internet banking portal taken down by a
UDP amplification attack (~60 Gbps) during a long weekend. Their ISP offered a null
route — which took the portal offline anyway, just more controlled. The board
lesson: a null route IS a DDoS success. Scrubbing capacity (not null routing) is
the correct control, and it must be tested before the attack, not during it.

**FMCG OT risk:** Northwind's plant networks (OT/IT-separated) are often not
covered by the corporate NDR deployment. An attacker who compromises a plant
vendor VPN and pivots to the plant floor may be invisible for weeks — the NDR
sensors stop at the IT/OT boundary. Architects should ask explicitly whether OT
segments have any behavioral monitoring, even lightweight flow analysis.

---

## Going deeper (optional)

- **Suricata documentation** — <https://docs.suricata.io/> — for IDS/IPS rules,
  protocol parsers, and flow engine details.
- **Emerging Threats Open Ruleset** — <https://rules.emergingthreats.net/> — the
  free community signature feed used by Suricata.
- **RFC 4987** — "TCP SYN Flooding Attacks and Common Mitigations" — canonical
  reference for SYN cookies and SYN flood mechanics.
- **PCI-DSS v4.0, Requirement 11.5 (11.5.1)** — IDS/IPS scope and tuning
  obligations (this was Requirement 11.4 in PCI-DSS v3.2.1).
- **Google Cloud Armor docs** — <https://cloud.google.com/armor/docs/> — including
  adaptive protection and rate-based rules.
- **AWS Shield documentation** — <https://docs.aws.amazon.com/waf/latest/developerguide/shield-chapter.html>
- **MITRE ATT&CK — Network** — lateral-movement and exfiltration techniques that
  NDR is designed to detect: <https://attack.mitre.org/>
- Pairs with: **N26** (firewalls), **N27** (segmentation/DMZ), **S01** (CIA/defense
  in depth), **S20** (SIEM), **S21** (SOAR/SOC workflow), **N25** (WAF — the L7
  complement to IPS).

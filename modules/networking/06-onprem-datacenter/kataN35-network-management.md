# Kata N35 — Network management: monitoring, NetFlow, change-control

> **Track:** Networking · **Module:** N6 On-prem & data center · **Prereqs:** N30, N31, N02 · **Time:** ~35 min
> **Tags:** `networking` `netflow` `monitoring` `change-control` `on-prem` `data-center` `fsi` `meridian-bank`

## Why it matters

You designed the data center — now it needs to stay up, and every change to it
needs to go through a process that satisfies the auditor. In regulated shops
like Meridian Bank, **the monitoring stack and change-control culture are
themselves compliance requirements**: PCI-DSS demands real-time alerting on the
CDE perimeter; RBI audit expects evidence that every firewall change was
reviewed and approved before it happened, not after. For Northwind FMCG, it is
simpler — you need to know when a plant WAN link is saturated before the factory
floor calls you. If you cannot speak fluently about what the network team
monitors, how they detect anomalies, and how a change gets authorized, you will
lose credibility the moment you walk into an infrastructure design review.

## The mental model

Network management sits on four questions that the IT head asks every morning:

```
  1. Is everything UP?          → availability monitoring (ICMP, SNMP)
  2. Is anything OVERLOADED?    → capacity / utilization (NetFlow, SNMP counters)
  3. Did anything CHANGE?       → configuration management (RANCID, Oxidized, NMS)
  4. Was the change AUTHORIZED? → change-control (CAB, ITSM ticketing)
```

Each question maps to a different tool family:

### Availability monitoring

The oldest and simplest layer. An NMS (network management system) polls every
device periodically using **ICMP** (ping) and **SNMP** to confirm it is alive
and to read interface counters. When a device or link goes silent, an alert
fires within seconds (or at worst, one polling cycle — typically 60–300 s).

```
  NMS (Zabbix / Nagios / SolarWinds / Auvik)
    │── ICMP poll every 60 s ──► router, switch, firewall
    │── SNMP GET every 5 min ──► interface counters, CPU, memory
    └── SNMP TRAP (async) ◄────  device sends alert on failure event
```

**SNMP** (Simple Network Management Protocol) is the protocol that has managed
network devices since 1988. Every enterprise switch and router speaks it.
Versions: SNMPv1 (insecure), SNMPv2c (community-string auth, still common),
SNMPv3 (encrypted + authenticated — the version you should insist on in FSI).

The NMS reads from a device's **MIB** (Management Information Base) — a
structured tree of variables. The OID (object identifier) for an interface's
outgoing octet count is `1.3.6.1.2.1.2.2.1.16` — a tedious but exact address.
You do not need to memorize OIDs; you need to know the MIB concept so you
understand why an NMS poll results in that number.

### NetFlow — seeing what is inside the traffic

ICMP/SNMP tells you a link is saturated. **NetFlow** tells you *why*.

A router or switch with NetFlow enabled samples each IP flow — a 5-tuple of
source IP, destination IP, source port, destination port, and protocol — and
exports a summary record to a **collector**:

```
  Router / switch (NetFlow exporter)
    │
    │  NetFlow v9 / IPFIX records (UDP, port 2055)
    ▼
  Flow collector (Elastic/ntopng/SolarWinds NTA/Kentik)
    │
    ▼
  Dashboard: "HQ-DC1 → DC2 replication = 1.2 Gbps, mobile API = 80 Mbps,
             unknown host 10.10.44.7 → external = 200 Mbps  ← anomaly!"
```

NetFlow does **not** capture packet payloads — it is metadata only (like a
phone bill: who called whom, for how long, not what they said). This makes it
legal to collect without decrypting TLS and acceptable under most data-privacy
regimes.

**Versions to know:**

| Version | Notes |
|---------|-------|
| NetFlow v5 | Cisco proprietary; IPv4 only; fixed-format records; still widespread |
| NetFlow v9 | Cisco; template-based; supports IPv6, MPLS, VLAN |
| IPFIX | IETF standard (RFC 7011); built on v9 templates; vendor-neutral |
| sFlow | Statistical sampling (every Nth packet); lower router CPU; common in non-Cisco gear |

In practice you will see all of these in a large enterprise — the key is that
the **collector** must handle whichever protocol each device exports.

### Configuration change management

A switch's running config is code. The network team stores it in a version
control system: **RANCID** (Really Awesome New Cisco confIg Differ) or its
modern successor **Oxidized** poll each device, diff the config against the
last stored copy, and alert when something changes unexpectedly.

The desired state: zero unexpected diffs. Every diff should correspond to an
open, approved change ticket. An unexpected diff is either a break-fix done
out-of-band or a compromise — both require investigation.

### Change-control culture

In FSI (see N02 for the full cast of characters), *no network change happens
without a ticket*. The lifecycle follows ITIL:

```
  ARCHITECT / APP TEAM
    └─► raises Request for Change (RFC) in ITSM (ServiceNow / Remedy)
           │  describes: what, why, blast radius, rollback plan
           ▼
         NETWORK TEAM
           │  builds change, tests in lab/pre-prod, documents steps
           ▼
         SECURITY / CISO
           │  reviews: does it widen attack surface? comply with policy?
           ▼
         CAB (Change Advisory Board — weekly or emergency slot)
           │  authorizes the change window (typically 2 a.m.–6 a.m. Sat)
           ▼
         NETWORK TEAM implements ──► MONITORING confirms no regression
           │
           ▼
         ITSM ticket closed with before/after evidence
```

**Emergency changes** (a link is down *now*) have a compressed process —
implement first, raise the "emergency CAB" retrospectively, document within
24 h. Banks audit how many emergency changes are raised; too many signals that
the normal process is too slow and teams are working around it.

## Worked example

### Meridian Bank: detecting an anomaly on the HQ-DC1 → DC2 link

HQ-DC1 uses `10.10.0.0/16`; DC2 uses `10.20.0.0/16` (see `running-example.md`).
The DR replication link runs at a steady ~800 Mbps during batch windows and
drops to ~50 Mbps otherwise. The Zabbix NMS polls each interface counter every
5 minutes via SNMP, and NetFlow v9 records export to an ntopng collector at
Meridian's security operations center.

**Tuesday 02:17 — normal batch window has ended:**

```
  SNMP counter: HQ-DC1 core-switch Gi1/0/1 (DC2 uplink)
    ifHCOutOctets  = 3,812,005,120   (at 02:12)
    ifHCOutOctets  = 4,324,823,040   (at 02:17)

  Delta = 512,817,920 bytes in 300 s
        = 512,817,920 × 8 / 300 = ~13.7 Mbps   ← normal, batch done
```

**Wednesday 02:17 — anomaly:**

```
  SNMP counter:
    ifHCOutOctets delta = 26,214,400,000 bytes in 300 s
    = 26,214,400,000 × 8 / 300 = ~699 Mbps     ← alert! not a batch window

  NetFlow top-talkers (ntopng):
    10.10.44.7:ephemeral  →  10.20.0.0/16  TCP/443  : 680 Mbps
```

`10.10.44.7` is not in the CMDB (Configuration Management Database) as a
known server — this is anomalous. The SOC opens an incident. The config-change
diff tool (Oxidized) shows no firewall rule changes this window, so it is not a
misconfiguration. The investigation leads to a compromised Windows workstation
performing exfiltration over port 443 toward a host in the DR segment — stopped
within 11 minutes of the NetFlow alert firing.

The calculation above: SNMP's `ifHCOutOctets` is the 64-bit high-capacity
counter of bytes (its 32-bit predecessor `ifOutOctets` would wrap on a link
this busy — see Pitfalls); converting: bytes × 8 = bits; divide by interval
seconds = bits/s. This is exactly what every NMS does internally.

### Northwind FMCG: plant WAN saturation

Northwind's Plant-2 uses the `10.50.x.x` block. Its MPLS link to the regional
office is 20 Mbps (see N32 for WAN building blocks). NetFlow shows that a
Windows Update job running across 47 plant-floor Windows terminals is consuming
17 Mbps, starving the WMS (warehouse management system) scanner traffic. QoS
(see N34) could fix this, but first monitoring had to *surface* the problem —
and Northwind's NMS, which collects sFlow from the branch router, fired an
alert at 85 % utilization.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Flow data (who talked to whom) | NetFlow / IPFIX / sFlow exported to collector | VPC Flow Logs (Cloud Logging) | VPC Flow Logs (CloudWatch Logs / S3) | (Azure: TODO) |
| Availability monitoring | SNMP + ICMP via NMS (Zabbix, SolarWinds) | Cloud Monitoring uptime checks + alerting policies | CloudWatch alarms + Route 53 health checks | (Azure: TODO) |
| Packet capture / deep inspection | tcpdump / Wireshark on device span port | Packet Mirroring → VM collector | VPC Traffic Mirroring → monitoring ENI | (Azure: TODO) |
| Config change tracking | RANCID / Oxidized + Git diff | Config Connector / Cloud Asset Inventory | AWS Config (tracks resource config over time) | (Azure: TODO) |
| Change-control process | ITSM (ServiceNow, Remedy) + CAB | Same ITSM; GCP Cloud Audit Logs provide evidence | Same ITSM; AWS CloudTrail provides evidence | (Azure: TODO) |
| SIEM / log aggregation | Splunk, IBM QRadar, on-prem | Chronicle SIEM / Cloud Logging | CloudWatch + Security Lake / third-party SIEM | (Azure: TODO) |

Note on cloud flow logs: they record accepted and rejected flows at the VPC
subnet or ENI level, using a similar 5-tuple + action model to NetFlow. They
do **not** capture payload bytes either — same privacy posture. See N54 for
cloud-specific flow log deep-dive.

## Do it (the exercise)

**1. Read SNMP data from a local device [laptop]**

If you have a Linux or macOS laptop with `snmpwalk` installed:

```bash
# Install: brew install net-snmp  (macOS) or apt install snmp snmp-mibs-downloader (Debian)

# Query your home router (if SNMPv2c is enabled — most home routers still support it)
snmpwalk -v2c -c public 192.168.1.1 1.3.6.1.2.1.2.2.1.10   # ifInOctets for all interfaces
snmpwalk -v2c -c public 192.168.1.1 1.3.6.1.2.1.2.2.1.16   # ifOutOctets for all interfaces
```

If your router does not have SNMP, simulate with a container:

```bash
# Run a software router with SNMP (e.g. a VyOS or FRR Docker image with snmpd)
docker run -d --name snmpsim -p 161:161/udp tandrup/snmpsim
snmpwalk -v2c -c public 127.0.0.1 1.3.6.1.2.1.2
```

**2. Compute utilization from counter deltas [laptop / paper]**

Take two readings of `ifOutOctets` 60 seconds apart, then calculate:

```
  utilization (bps) = (counter2 − counter1) × 8 / interval_seconds
  utilization (%)   = utilization_bps / link_speed_bps × 100
```

For a 1 Gbps link (1,000,000,000 bps): if the delta is 5,000,000 bytes in
60 s → `5,000,000 × 8 / 60 = 666,667 bps` → `666,667 / 1,000,000,000 × 100
= 0.067 %`. Low. Now repeat the math for a delta of 7,000,000,000 bytes in
60 s on the same link — that is 93 % utilization. Write the alert threshold.

**3. Simulate a NetFlow record [laptop]**

Use `nfdump` / `softflowd` to generate and inspect IPFIX records locally:

```bash
# Generate test flows using softflowd capturing from loopback
sudo softflowd -i lo -n 127.0.0.1:9995 -v 10

# In another terminal, collect and display:
nfcapd -w -l /tmp/flows -p 9995 &
sleep 10 && nfdump -r /tmp/flows -s srcip
```

What you see: source IPs, destination IPs, ports, protocol, bytes, packets —
the same format a real collector parses. Notice: no payload.

**4. Trace a change through the ITIL lifecycle [paper / whiteboard]**

You need to add a firewall rule to allow Meridian Bank's mobile API
(`10.100.0.0/14`, GCP) to reach the core banking service on
`10.10.5.20:8443` at HQ-DC1. Map each step:
- Who writes the RFC? What is the "blast radius" statement?
- Who reviews from a security perspective, and what do they check (hint: CDE
  exposure — see N29)?
- What is the rollback? (Remove the rule; confirm the session drops.)
- What evidence goes in the ITSM ticket at close?

## Say it back (self-check)

1. Name the four questions the IT head uses to manage a network, and one tool
   that answers each.
2. What is NetFlow collecting — payloads or metadata? What is the 5-tuple?
3. An SNMP `ifOutOctets` counter reads 1,200,000,000 at T=0 and 1,260,000,000
   at T=60 s on a 100 Mbps link. What is the utilization percentage?
   *(Answer: delta = 60,000,000 bytes; × 8 = 480,000,000 bits; /60 s =
   8,000,000 bps = 8 Mbps; 8 / 100 = 8 %.)*
4. What does Oxidized/RANCID detect, and why is an unexpected config diff
   treated as a potential security incident?
5. What is the difference between a normal change and an emergency change, and
   why do FSI auditors track the ratio?

## Talk to the IT/security head

**Ask:**

- "What NMS do you use, and what is your polling interval and alerting
  threshold for link utilization?"
  *Good answer:* a named tool (Zabbix/SolarWinds/PRTG), polling interval
  ≤ 5 min, alert at 70–80 % sustained utilization, with an on-call runbook.
  *Red flag:* "we check manually" or "we get calls from users when it's down."

- "Do you collect NetFlow or IPFIX? How long do you retain flow records, and
  where does the collector sit?"
  *Good answer:* flow collection on all core and WAN interfaces; 30–90 days
  retention; collector in a dedicated management zone. In FSI, PCI-DSS
  Req 10 mandates at least 12 months of log retention (3 months immediately
  available). If NetFlow records count as log evidence, they should match that
  horizon.
  *Red flag:* no flow collection, or flow collector on the same VLAN as
  production systems (a collector can see everything — it should be protected).

- "Is your SNMP community string still 'public'? Are you on SNMPv3?"
  *Good answer:* "SNMPv3 with auth and encryption on all production devices;
  legacy SNMPv1/v2c disabled."
  *Red flag:* "yes, it's still public" — SNMPv2c with the default community
  string 'public' exposes device config and counters to anyone on the network
  segment.

- "Walk me through what happens when a junior engineer wants to change a
  firewall rule. How long does a normal change take end-to-end?"
  *Good answer:* named ITSM tool, CAB meeting cadence, typical lead time
  (e.g. 5–10 business days for standard, 2–4 h for emergency with defined
  criteria). Auditor can pull any change and see the full trail.
  *Red flag:* "we do it ad-hoc in the console and document it later" or lead
  times over three weeks for standard changes (teams start bypassing the
  process).

- "What happens when your config-change monitoring detects a diff that matches
  no open change ticket?"
  *Good answer:* automatic alert → investigation ticket within N minutes;
  device quarantined or rolled back if unauthorized. Ties to the incident
  response process (see S23).
  *Red flag:* no config monitoring, or "we'd notice eventually."

**Red flags to listen for across the whole conversation:**

- Monitoring that only covers the WAN edge and not east-west DC traffic.
- NetFlow disabled on core switches "because it's too much CPU" — this is
  where lateral movement is invisible.
- Change-control that exists on paper but is routinely bypassed for
  "urgent" requests — the CAB approval-rate gap.

## Pitfalls & war stories

- **The phantom device.** A new server added without a CMDB entry will have
  SNMP polling fail silently (no entry to poll). Availability monitoring only
  covers what you know exists — pair it with network discovery scans so unknown
  devices appear.

- **Counter wrap.** SNMP 32-bit counters (`ifOutOctets`, not `ifHCOutOctets`)
  wrap at 2^32 − 1 = 4,294,967,295 bytes (~4 GB). On a 1 Gbps link, that
  wraps every ~34 seconds. Always use 64-bit high-capacity counters
  (`ifHCInOctets`, `ifHCOutOctets`, OIDs in the IF-MIB at
  `1.3.6.1.2.1.31.1.1.1.6` and `.10`) on any link faster than ~100 Mbps.
  A monitoring tool that naively subtracts sequential 32-bit readings will
  report absurd negative or huge utilization when the counter wraps.

- **SNMPv2c 'public' in FSI.** At a PCI-scoped bank, the community string
  'public' on a core switch is a finding. SNMPv3 with SHA-256 auth and AES-128
  privacy is the minimum. Check it before you cite "SNMP monitoring" in a
  design doc.

- **NetFlow sampling on high-speed links.** At 10 Gbps+, most devices sample
  1-in-N packets rather than every packet (where N may be 1000 or 4000).
  Sampled flow data misses short-lived flows entirely — a 100-packet burst may
  never be sampled. For forensic accuracy on the CDE perimeter, full
  packet capture (SPAN port to a probe) is needed; NetFlow is a first-level
  indicator.

- **The emergency-change debt trap (FSI).** Northwind teams that circumvent
  slow CABs by raising emergency changes for routine work build a false sense
  of speed — until an auditor counts the emergency-to-standard-change ratio
  and flags it. In banks, this ratio is a direct audit question.

- **Config drift at scale.** Northwind has 3,000+ branch sites. Manual config
  drift detection (Oxidized polling 3,000 devices via SSH) can take hours.
  SD-WAN controller-based approaches (see N33) push config from a central
  controller, making drift structurally harder — another reason FMCG shops
  adopt SD-WAN.

## Going deeper (optional)

- RFC 7011 — IPFIX protocol specification (the IETF standard that supersedes
  Cisco NetFlow v9 for export format).
- RFC 3411–3418 — the SNMP architecture and MIB-II (where `ifTable` lives).
  `ifHCOutOctets` is defined in IF-MIB (RFC 2863).
- ITIL 4 "Change Enablement" practice — the ITIL framing IT heads at FSI
  clients use when describing their CAB.
- PCI-DSS v4.0 Requirement 10 — logging and monitoring requirements for the
  CDE; the retention and alerting obligations that make flow collection
  mandatory in scope.
- Pairs with N34 (QoS — also uses SNMP DSCP counters to validate traffic
  shaping) and N54 (cloud flow logs — same mental model, cloud implementation).
  See also S20 (logging/SIEM) for how flow data feeds the SOC.

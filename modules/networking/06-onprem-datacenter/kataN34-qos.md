# Kata N34 — QoS: prioritizing voice/trading/critical traffic

> **Track:** Networking · **Module:** N6 On-prem & data center · **Prereqs:** N03, N20, N32 · **Time:** ~30 min
> **Tags:** `networking` `qos` `on-prem` `wan` `latency` `l3-network` `fsi` `meridian-bank`

## Why it matters

Not all packets are equal — and a network that treats them as if they are will
drop a voice call mid-sentence while downloading a firmware update. At Meridian
Bank, a 200 ms latency spike on the trading floor is a mis-price risk. At
Northwind, a lagging WMS scanner at a distribution center halts dispatch. Quality
of Service (QoS) is the set of tools the network team uses to impose a business
priority onto packet flows — and it shows up in every WAN, MPLS, and cloud
interconnect conversation. As an architect you will be asked to map application
SLAs to QoS requirements; you need to know what is possible and what it costs.

## The mental model

### The core problem: a shared pipe with competing flows

Every link has a fixed capacity. When arrivals briefly exceed it, traffic queues
in a buffer. Without QoS, buffers are FIFO — first in, first out — and large
file transfers bulldoze interactive voice or trading feeds.

```
  ┌────────────┐         ┌──────────────────────────────────┐
  │ FIFO queue │         │ WAN link 100 Mbps                │
  │            │ ──────► │ ─── ─── ─── ─── ─── ─── ─── ──► │
  │ file xfer  │         │ file-xfer bytes fill the window   │
  │ voice      │  queue  │ voice waits → jitter → calls drop │
  │ trading    │  spikes │                                   │
  └────────────┘         └──────────────────────────────────┘
```

QoS inserts a **scheduler** and **policer/shaper** between the queue and the
wire so the network enforces the business's traffic priority rather than luck of
arrival order.

### The three QoS jobs

| Job | What it does | Tool |
|-----|-------------|------|
| **Classification & marking** | Identify the traffic type; stamp it | DSCP, 802.1p CoS |
| **Queuing & scheduling** | Which packets leave first when the link is busy | CBWFQ, LLQ, WFQ |
| **Policing & shaping** | Enforce rate limits; drop or delay over-budget traffic | Token bucket, leaky bucket |

### DSCP: the marking language

RFC 2474 defined the Differentiated Services Code Point (DSCP), a 6-bit field in
the IP header's DS byte (the repurposed ToS byte). It sets the "class" of the
packet so every router on the path can apply the same policy.

```
  IP header (IPv4)
  ┌────────────┬──────┬─────────────────────────────────────┐
  │ Version/IHL│ DSCP │ ECN │ Total Length │ ...            │
  │  (8 bits)  │(6b)  │(2b) │              │               │
  └────────────┴──────┴─────────────────────────────────────┘
                  ▲
                  6-bit value → 64 possible classes
```

The commonly used DSCP values / Per-Hop Behaviors (PHBs):

| Name | DSCP value (decimal) | Hex | Typical use |
|------|---------------------|-----|-------------|
| EF — Expedited Forwarding | 46 | 0x2E | VoIP, real-time audio/video |
| AF41 | 34 | 0x22 | Interactive video (conferencing) |
| AF31 | 26 | 0x1A | Call signaling |
| CS3 | 24 | 0x18 | Network management (SNMP, SSH) |
| AF21 | 18 | 0x12 | Transactional data (trading feeds) |
| CS1 | 8  | 0x08 | Scavenger / low-priority bulk |
| BE — Best Effort | 0  | 0x00 | Default; everything else |

**How the values are encoded (so you can derive them):** Class Selector marks
are `CSn = n × 8` (CS1=8, CS3=24, CS5=40). Assured Forwarding marks `AFxy` use
`DSCP = 8x + 2y`, where `x` (1–4) is the class and `y` (1–3) is the drop
precedence. So AF11 = 8+2 = 10, AF21 = 16+2 = 18, AF31 = 24+2 = 26,
AF41 = 32+2 = 34. EF is the fixed value 46.

> **Standards note:** the signaling/management marks above follow the **Cisco
> enterprise QoS baseline** (SRND), which is what you will meet in most banks
> and FMCGs. RFC 4594 differs: it puts Signaling at **CS5** and OAM/network
> management at **CS2** (and reserves CS3 for Broadcast Video). When you cross
> an administrative or carrier boundary, confirm whose mapping is in force —
> the two conventions are not interchangeable.

Rule: **mark close to the source; trust at the edge; re-mark at untrusted
boundaries.** A carrier may strip or re-mark DSCP at ingress to their MPLS
network — always confirm.

### Queuing: the scheduling policy

Once marked, packets land in priority queues. A simple model (used in Cisco IOS
LLQ, Junos Strict Priority + CBWFQ, and most enterprise WAN routers):

```
  Outbound interface scheduler
  ┌─────────────────────────────────┐
  │  Priority queue (PQ / LLQ)      │ ← Voice/EF: drains first, always
  │  ── ── ── ── ── ── ── ── ── ─  │
  │  Class-Based Weighted Fair (WFQ)│
  │    Trading/AF21  [20% bw]       │ ← gets its share when not empty
  │    Business apps [30% bw]       │
  │    Default/BE    [40% bw]       │
  │    Scavenger/CS1 [10% bw]       │ ← backups, updates: last
  │                                 │
  └─────────────────────────────────┘
  Total guaranteed: 100 %
```

LLQ = Low-Latency Queue (the PQ in Cisco terminology). Traffic in the LLQ is
always dequeued first. Allocate too much to LLQ and you starve other classes;
too little and voice clips under load. A common safe limit: **EF ≤ 33% of link
bandwidth**.

### Shaping vs policing

- **Policing** drops or re-marks packets above the rate limit immediately. Hard
  enforcement; low memory cost; causes TCP retransmits.
- **Shaping** buffers (delays) over-rate packets and releases them smoothly.
  Softer; adds latency but fewer drops; needs buffer memory.

For voice, policing is preferred upstream (drop the burst early before a full
buffer adds latency). For data, shaping smooths out TCP retransmit spirals.

### The trust boundary

```
  [PC/phone]   [access switch]   [distribution switch]   [WAN router/edge]
       │               │                   │                    │
  marks DSCP    remarks to CoS      trusts or remarks      trusts/enforces
  (trust or    (802.1p tag)         depending on policy     carrier-facing
   override)                                                policy
```

Enterprise best practice: **distrust endpoint markings at the first managed
switch.** A workstation can self-mark its traffic as EF — don't let it jump the
queue over genuine voice. Instead, reclassify by ACL (e.g., traffic from the
IP phone VLAN on UDP/5060 and RTP ports → EF; everything else from PCs → BE).

## Worked example

### Meridian Bank: WAN QoS for the trading floor

HQ-DC1 (`10.10.0.0/16`) has a 1 Gbps LAN core but the MPLS WAN to a corp office
(`10.40.0.0/16`), where a dealing desk is hosted, is a 100 Mbps link.
Market-data feeds
(UDP multicast) compete with dealer-voice (RTP/SIP) and file-sync backups.

The network team's QoS design on the WAN router's outbound interface:

```
  Traffic class         Identify by                  Mark    Queue  Bw guarantee
  ─────────────────────────────────────────────────────────────────────────────
  Dealer voice (RTP)    UDP 16384–32767, src VLAN 10  EF/46  PQ/LLQ  20 Mbps
  SIP signaling         UDP/TCP 5060–5061             AF31   CBWFQ   5 Mbps
  Market-data feed      UDP dst 239.x.x.x (multicast) AF21   CBWFQ  30 Mbps
  Business apps         TCP 443, 80 (apps)            AF11   CBWFQ  30 Mbps
  Network management    TCP/UDP 22, 161, 514           CS3   CBWFQ   5 Mbps  (RFC 4594 assigns network-management to CS2)
  Backup / bulk         TCP dst file-server IPs       CS1   CBWFQ   5 Mbps
  Default / unknown     everything else               BE    CBWFQ   5 Mbps
  ─────────────────────────────────────────────────────────────────────────────
  Total                                                             100 Mbps
```

During peak (09:00–10:00, market open), the backup process is policed to 5 Mbps
so it cannot crowd out trading feeds even if it floods. The voice LLQ empties
before CBWFQ classes are served, keeping queuing delay on that hop low
(sub-millisecond at line rate), which protects the end-to-end voice latency
budget regardless of congestion.

The SIP/RTP port ranges follow RFC 3550 (RTP) and RFC 3261 (SIP). The range
`239.0.0.0/8` is the Administratively Scoped multicast block (RFC 2365); the
Organization-Local Scope is `239.192.0.0/14`. Meridian uses `239.10.0.0/16`
(within the admin-scoped block) for market data.

### Northwind: SD-WAN QoS at a distribution center

At a Northwind distribution center, the WAN is a 50 Mbps broadband link
(primary) with a 10 Mbps 4G backup (see N33 on SD-WAN). The SD-WAN controller
exports a QoS policy:

```
  App profile    Match              DSCP  Behavior on 50 Mbps link
  ────────────────────────────────────────────────────────────────
  WMS scanners   App-ID: WMS        EF    Real-time; LLQ; ≤ 10 Mbps
  VoIP           App-ID: Teams/SIP  EF    Shares LLQ with WMS
  ERP syncs      TCP dst :443 ERP   AF21  Guaranteed 20 Mbps
  General web    DPI: browsers      BE    Best effort
  Backup agent   App-ID: backup     CS1   Throttled 2 Mbps
  ────────────────────────────────────────────────────────────────
```

On 4G failover (10 Mbps), the SD-WAN controller re-applies the same DSCP marks
but tightens the backup class to 0.5 Mbps and cuts ERP to 4 Mbps — same policy,
different bandwidth envelope. This is the key SD-WAN QoS advantage: the business
policy is centrally defined; bandwidth math is per-link.

### Quick check: can voice fit?

A G.711 call uses ~87 kbps including IP/UDP/RTP headers. 20 Mbps of LLQ =
20,000 / 87 ≈ **229 simultaneous calls** — well above Meridian's 50-seat trading
floor. If you used G.729 (~26 kbps), the same 20 Mbps supports ~769 calls.
Always do this sanity check so you can tell the IT head whether QoS reserves
are over- or under-provisioned.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| DSCP marking | Set at WAN router / switch | Preserved across Cloud Interconnect (Dedicated); stripped on internet | Preserved on Direct Connect; stripped on internet VPN | (Azure: TODO) |
| Traffic prioritization | LLQ + CBWFQ on router | No per-packet queuing controls inside VPC; rely on application-layer design | No per-packet queuing inside VPC | (Azure: TODO) |
| Bandwidth guarantee | MPLS CIR/EIR contracts; link policing | Interconnect SLA on dedicated port (1/10 Gbps); no WAN QoS API | Direct Connect: dedicated port; no per-flow priority API | (Azure: TODO) |
| App-aware QoS | L7 DPI on NGFW / SD-WAN | Not built-in; partner SD-WAN on Marketplace | AWS Network Manager + SD-WAN AMIs | (Azure: TODO) |
| Scavenger / rate-limit | Policing on WAN router | Cloud Armor rate-limit (L7 HTTP); not IP-layer | VPC Traffic Mirroring + custom; WAF rate limits at L7 | (Azure: TODO) |

**Key point for architects:** the *inside* of a major cloud provider's backbone
is heavily engineered for low latency and high throughput — they run their own
traffic engineering, and it is not exposed as DSCP knobs. QoS is relevant at
the **customer edge**: the Cloud Interconnect port, the SD-WAN CPE at the
branch, and the WAN router at the data center. Inside GCP or AWS, design around
latency by choosing the right regions, availability zones, and instance types —
not by marking packets.

## Do it (the exercise)

**Part A — classify traffic [laptop / paper]**

1. Take the following five Meridian Bank traffic types and assign each a DSCP
   class (EF, AF41, AF21, CS1, or BE) with a justification:
   - Core banking API calls (TCP 443, HQ-DC1 to DC2 DR replication)
   - Compliance log upload to SIEM (TCP 514 syslog bulk)
   - ATM network keep-alive pings (ICMP from branches `10.30.0.0/16`)
   - Bloomberg terminal market data (UDP multicast `239.10.0.0/16`)
   - Nightly database backup (TCP to backup appliance `10.10.5.20`)

2. For each, state whether you would **police** or **shape** the class and why.

**Part B — inspect DSCP on your machine [laptop]**

```bash
# Linux: check DSCP markings with tcpdump
# Filter for any non-zero DSCP (tos != 0x00 means DSCP is set)
sudo tcpdump -n -i any 'ip[1] != 0' -c 20 2>/dev/null
```

Look at the `tos` field in the output. The hex value's top 6 bits = DSCP. For
example, `tos 0xb8` = 10111000b → top 6 bits = 101110 = 46 decimal = DSCP EF.
Most laptop traffic will show `tos 0x00` (BE). Try generating a VoIP/video call
(Zoom, Teams) and re-run — many clients mark EF on outbound media.

```bash
# Alternatively, use ping with DSCP EF marking (Linux)
# -Q sets the DSCP byte (46 << 2 = 184 = 0xb8)
ping -Q 0xb8 -c 5 8.8.8.8
```

**Part C — bandwidth math [paper]**

Northwind's distribution center has a 50 Mbps WAN link. Calculate:
- Maximum number of concurrent G.711 calls at 20% LLQ allocation.
- Remaining bandwidth for ERP syncs if WMS (EF) uses 8 Mbps and voice uses
  4 Mbps simultaneously.
- What happens to ERP at 4G failover (10 Mbps, same 20% LLQ rule)?

*(Answers: 50 × 0.20 = 10 Mbps LLQ; G.711 ≈ 87 kbps → 10,000/87 ≈ 114 calls.
  ERP gets 50 − 8 − 4 − backup = up to 36 Mbps. On 4G: 10 − 2 = 8 Mbps for
  non-LLQ; ERP must share 8 Mbps with all non-EF traffic.)*

## Say it back (self-check)

1. What is the DSCP field, where in the packet does it live, and how many bits
   is it?
2. What is the difference between EF and AF classes? When would you choose each?
3. Explain the difference between policing and shaping. Which causes more TCP
   retransmits and why?
4. What is a Low-Latency Queue (LLQ), and what happens if you allocate too much
   bandwidth to it?
5. Why is DSCP marking stripped at an internet boundary but typically preserved
   over a dedicated MPLS or cloud interconnect?

## Talk to the IT/security head

**Ask:**

- "Do you have a QoS policy on the WAN today — what traffic classes are defined
  and what's the LLQ allocation?"

  *Good answer:* named classes, DSCP values, and link-specific bandwidth
  percentages. The network team should know these off the top of their heads.
  *Red flag:* "we don't do QoS, the link is big enough" — true until it isn't;
  voice quality is the first casualty.

- "Who trusts the DSCP markings from endpoints — is the edge switch reclassifying
  them or letting users self-mark?"

  *Good answer:* "We reclassify at the first managed switch by ACL based on
  source port/VLAN; endpoint marks are distrusted." *Red flag:* "Endpoints
  mark their own traffic" with no override — any PC can mark its backup job as
  EF and steal voice queue headroom.

- "On the MPLS/SD-WAN contract, what CIR/EIR are agreed per traffic class with
  the carrier — does the carrier honor our DSCP marks?"

  *Good answer:* specific CIR (Committed Information Rate) per class in the
  contract, confirmation that the carrier maps their internal CoS to our DSCP.
  *Red flag:* "the carrier handles QoS for us" without knowing the mapping —
  this is often a best-effort service with a QoS label on the brochure.

- "When we extend this WAN to GCP via Dedicated Interconnect, will DSCP be
  preserved across the handoff?"

  *Good answer:* "DSCP is preserved on Dedicated Interconnect but we're
  designing application-layer redundancy inside GCP, not relying on DSCP there."
  *Red flag:* expectation that GCP will enforce QoS inside the VPC the same
  way the on-prem router does.

- "For the trading platform (N34 context): what's the measured one-way latency
  budget per hop, and is there a telemetry system that alerts when it's breached?"

  *Good answer:* a budget (e.g., < 5 ms on-prem WAN hops, < 50 ms total RTT
  to exchange) with a monitoring dashboard (e.g., NetFlow/IPSLA probes). See N35.
  *Red flag:* no latency SLA and no monitoring — QoS without telemetry is faith,
  not engineering.

## Pitfalls & war stories

- **"The link is big enough."** Teams skip QoS because average utilization is
  low. A single bursty backup or a firmware update during market open can spike
  a 100 Mbps link to 100% for 10–30 seconds — enough to drop calls and miss
  prices. QoS is for the tail, not the average.

- **LLQ starvation.** A team sets voice EF to 60% of the WAN link as "safe
  headroom." Under load, the CBWFQ classes for business apps are starved because
  LLQ always drains first. Cap EF at 30–33% of link capacity.

- **Trusting endpoint markings at FSI clients.** Meridian's PCI audit found that
  workstations in the CDE were self-marking traffic as EF. The backup agent
  vendor had set EF in its config. Override at the switch ACL, not the host.

- **SD-WAN QoS reset at failover.** At a Northwind site the 4G backup link came
  up without importing the QoS policy from the SD-WAN controller (firmware bug).
  All traffic fell to BE. WMS scanners lost connectivity, dispatch halted for
  40 minutes. Policy must be link-aware, not just link-attached.

- **DSCP bleaching by the carrier.** The MPLS carrier marked all customer traffic
  as BE at ingress regardless of DSCP. The bank's trading-floor QoS was working
  perfectly inside the network and doing nothing on the WAN. Always test with
  `tcpdump` or a probe on both sides of the carrier handoff.

- **VoIP codec mismatch and wrong bandwidth calculation.** An architect specified
  G.729 codec (26 kbps) for the QoS design; the phone system shipped with G.711
  (87 kbps). The LLQ was sized for 200 calls at G.729 but saturated at 60 calls.
  Confirm codec selection *before* sizing the queue.

## Going deeper (optional)

- RFC 2474 — Definition of the Differentiated Services Field (DSCP).
- RFC 2475 — An Architecture for Differentiated Services (DiffServ framework).
- RFC 3550 — RTP: A Transport Protocol for Real-Time Applications (VoIP).
- RFC 3261 — SIP: Session Initiation Protocol (port 5060/5061).
- RFC 4594 — Configuration Guidelines for DiffServ Service Classes — the
  definitive DSCP-to-use-case mapping table.
- RFC 2365 — Administratively Scoped IP Multicast (`239.0.0.0/8` scope).
- Cisco QoS whitepaper: "Enterprise QoS Solution Reference Network Design"
  (search Cisco.com) — the WAN QoS bandwidth model used in this kata derives
  from their recommendations.
- Pairs with N32 (WAN building blocks — MPLS CIR/EIR), N33 (SD-WAN policy
  architecture), and N35 (NetFlow monitoring to validate QoS is working).

# Kata N32 — WAN building blocks: leased lines, MPLS, broadband, 4G/5G

> **Track:** Networking · **Module:** N6 On-prem & data center · **Prereqs:** N14, N15, N30, N31 · **Time:** ~35 min
> **Tags:** `networking` `wan` `mpls` `leased-line` `sd-wan` `on-prem` `hybrid` `fsi`

## Why it matters

Before a packet leaves your data center, it has to cross a WAN link — and the
*type* of link determines cost, latency, reliability, and what you can run on it.
When you propose moving Meridian Bank's branch traffic to cloud or adding a DR
path, the IT head will immediately ask: "over what?" The answer shapes the whole
design. Leased lines, MPLS, broadband, and 4G/5G are not interchangeable — they
have different failure modes, different SLAs, and different compliance postures.
An architect who cannot distinguish them cannot hold this conversation.

## The mental model

### The problem: your LAN ends at the building wall

Inside your data center you control the cable, the switch, the latency. The moment
traffic crosses to another site — another data center, a branch, a cloud region —
you are on someone else's wire. The question is *whose* wire, at what quality, at
what cost.

Four families of answer, in rough order of cost and quality:

```
  HIGH COST / HIGH QUALITY / DEDICATED
  ──────────────────────────────────────────
  1. LEASED LINE (private circuit)
     You rent a physical pair or fibre strand. The bandwidth
     is yours alone. No other customer's traffic touches it.
     Historically 64 Kbps E1/T1 up to multi-Gbps dark fibre.

  2. MPLS (Multi-Protocol Label Switching)
     A managed service: the telco builds an IP VPN across
     their own private backbone. Traffic is label-switched,
     not internet-routed. You get a defined topology, QoS
     classes, and a point-to-point feel without owning the
     core. The internet never sees your packets.

  3. BROADBAND (internet-based)
     Shared medium (DOCSIS cable, ADSL/VDSL, fibre-to-the-
     premise). Lower cost, best-effort. You add an IPsec
     tunnel on top to get privacy (see N36). Latency and
     jitter vary with time of day and neighbour usage.

  4. 4G/5G (mobile broadband)
     Carrier network; similar economics to broadband but
     wireless. Used for backup / failover ("tail backup"),
     for sites with no fixed-line option (remote plants,
     pop-up retail), and for SD-WAN failover. 5G SA
     (standalone) opens sub-10 ms latency paths.
  ──────────────────────────────────────────
  LOW COST / SHARED / BEST-EFFORT
```

### How MPLS really works (the concept behind the name)

Ordinary IP routing at every hop reads the destination IP and looks up a routing
table. MPLS instead assigns a short **label** at the ingress PE (Provider Edge)
router; every subsequent core router (P router) switches on that label alone.
The label is swapped at each hop; at the egress PE the label is popped and normal
IP delivery resumes.

*Historical note:* MPLS was originally motivated partly by lookup speed — in the
1990s, label switching in hardware was much faster than software IP
longest-prefix matching. That advantage is gone: modern routers do both label
switching and IP longest-prefix match in hardware at line rate. MPLS's real
present-day value is **traffic engineering** (pinning paths across the backbone),
**any-to-any L3VPN** (one VPN connects every site without per-pair circuits),
and **QoS classes** — not raw lookup speed.

```
  Customer      Ingress PE      P (core)         Egress PE    Customer
  site A        (label push)   (label swap)      (label pop)  site B
  ──────────────────────────────────────────────────────────────────────
  IP pkt ──►   [42 | IP pkt]─►[17 | IP pkt]─►[IP pkt] ──►  IP pkt
                  ^                ^               ^
               label=42         label=17        label stripped
```

What you get as a customer:
- **Private backbone** — the internet is not in the path.
- **Traffic classes / QoS** — telcos typically offer 3–4 classes (real-time, 
  business-critical, best-effort). Voice goes in the real-time class; bulk backup
  goes best-effort. (Covered in depth in N34.)
- **Any-to-any topology** — a single MPLS VPN can connect DC, branches, and DR
  in a full or partial mesh without separate circuits per pair.
- **Managed SLA** — contractual packet-loss, latency, and jitter figures; the IT
  head can point to them in an audit.

### 4G/5G as a WAN option

Carriers sell enterprise 4G/5G SIMs with static IPs and private APN (Access
Point Name) options — traffic tunnelled privately through the carrier core, never
touching the public internet. This is not "just a hotspot"; it is a managed WAN
path with defined QoS. 5G NR (New Radio) with network slicing can deliver:
- eMBB: Enhanced Mobile Broadband — up to Gbps, for high-bandwidth sites.
- URLLC: Ultra-Reliable Low Latency — ~1 ms air-interface (one-way) per the
  3GPP target; end-to-end over a real WAN path is higher. For OT/plant control.
- mMTC: Massive Machine Type — low-power IoT.

Architects care because 5G can replace expensive leased lines for some branch
scenarios and is the natural backup for SD-WAN (N33).

## Worked example

### Meridian Bank — WAN for 220 branches + 2 DCs

Meridian's WAN topology (from `reference/running-example.md`):

```
  HQ-DC1 (10.10.0.0/16)          DC2/DR (10.20.0.0/16)
       │                                │
  ─────┴────── MPLS VPN backbone ───────┘
       │                                │
  ┌────┴─────────────────────────────────────────┐
  │  Branch hub router (PE termination)           │
  └────────────────┬─────────────────────────────┘
                   │  per-branch MPLS CE circuits
        ┌──────────┼──────────┐
        │          │          │
    Branch 001  Branch 002  Branch 003 ...
   10.30.1.0/24 10.30.2.0/24 10.30.3.0/24
        │
       [4G SIM]  ← backup circuit, comes up on MPLS failure
```

Branch addressing: `10.30.0.0/16` is the branch supernet. Each branch gets a
`/24` from `10.30.0.0/16`: branch 001 is `10.30.1.0/24`, branch 002 is
`10.30.2.0/24`, etc. 220 branches need 220 `/24`s — well within the /16 (which
provides 256 `/24`s). No overlap with DC (`10.10.0.0/16`) or DR (`10.20.0.0/16`).

**MPLS SLA Meridian has contracted:**
- Latency (branch to DC1): ≤ 15 ms one-way within metro, ≤ 30 ms inter-city.
- Packet loss: < 0.1% averaged over a month.
- Jitter: < 5 ms (required by VoIP on the branch).
- Uptime: 99.9% (≈ 8.7 hours downtime/year) — "four nines" costs 3× more.

**What happens on MPLS failure at Branch 045:**

1. CE (Customer Edge) router loses the MPLS link — BFD (Bidirectional Forwarding
   Detection, ~300 ms) detects the failure.
2. 4G modem dials up; IPsec tunnel to HQ-DC1 forms over the mobile carrier.
3. Static route or OSPF/BGP failover pushes branch traffic over the IPsec path.
4. Tellers notice 100–300 ms extra latency but the branch stays online.
5. NOC receives an alert and opens a ticket with the MPLS carrier.

The 4G backup is not in the MPLS SLA — it is a separate Airtel/Jio circuit.
Latency is ~40–80 ms instead of 15 ms. Core banking still works; video
conferencing degrades.

### Northwind FMCG — broadband + 4G for 3,000 retail points

Northwind cannot afford MPLS to 3,000 stores (cost is O(sites)). Their model:

```
  Regional office (10.50.x.0/24 per region)
       │
  Internet transit (dual-ISP, BGP failover — see N14)
       │
  [IPsec tunnels] ← encrypted overlay
       │
  Retail site:  broadband primary + 4G backup
                10.50.N.0/24 per site
```

Each retail point has a cheap DSL/fibre line (₹2,000–₹5,000/month) vs an MPLS
circuit (₹15,000–₹50,000/month). SD-WAN (N33) manages the two links per site and
encrypts traffic. The architecture accepts higher jitter but the POS (point-of-
sale) traffic is latency-tolerant. Total WAN bill is a fraction of an all-MPLS
estate.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Dedicated private circuit to cloud | Leased line to cloud PoP | Cloud Interconnect (Dedicated, 10/100 Gbps) | AWS Direct Connect | Azure ExpressRoute |
| Shared/managed telco backbone | MPLS VPN | — (partner interconnect for smaller BW) | Direct Connect hosted | ExpressRoute via partner |
| Internet-based overlay VPN | IPsec over broadband | Cloud VPN (HA VPN, 3 Gbps per tunnel) | AWS Site-to-Site VPN | Azure VPN Gateway |
| Cellular backup / IoT WAN | 4G/5G SIM, private APN | — (partner ecosystem) | — (partner ecosystem) | — (partner ecosystem; Azure Private 5G Core under Private MEC was retired 30 Sep 2025) |
| WAN policy & failover | SD-WAN CPE (Cisco, VMware, Fortinet) | Cloud WAN / NCC | AWS Cloud WAN | Azure Virtual WAN |
| Latency SLA measurement | MPLS carrier SLA | VPC Network Intelligence Center | AWS Reachability Analyzer, CloudWatch | Azure Network Watcher |

Cloud Interconnect / Direct Connect / ExpressRoute are covered in N38.

## Do it (the exercise)

**Part 1 — Cost and latency comparison [laptop / paper]**

For a fictional 50-branch bank, estimate the monthly WAN bill under two models:
- Model A: MPLS 10 Mbps per branch at ₹25,000/month per branch.
- Model B: 20 Mbps broadband at ₹4,000/month + 4G backup SIM at ₹1,500/month
  per branch, plus one SD-WAN CPE at ₹8,000/month capex-amortised.

Compute:
1. Monthly WAN cost, Model A vs Model B.
2. Annual saving under Model B.
3. What risk does the saving introduce that an MPLS SLA removes?

*(Expected: Model A = 50 × ₹25,000 = ₹12.5 L/month. Model B = ₹2 L broadband
(50 × ₹4,000) + ₹0.75 L 4G backup (50 × ₹1,500) + ₹4 L SD-WAN CPE
(50 × ₹8,000) = ₹6.75 L/month. Monthly saving = ₹12.5 L − ₹6.75 L = ₹5.75 L;
annual saving ≈ ₹69 Lakh (≈ ₹0.69 Cr). Risks: no telco SLA on broadband; jitter
may affect latency-sensitive apps.)*

**Part 2 — Trace an MPLS path [laptop]**

On any host with `traceroute` / `tracert`:

```bash
traceroute -n 8.8.8.8     # Linux/macOS
tracert -d 8.8.8.8        # Windows
```

Look at hops 2–5. Hop 1 is normally your own LAN gateway (`192.168.x.x`). If you
see private IP ranges (`10.x.x.x`, `192.168.x.x`, `172.16–31.x.x`) or shared
CGNAT space (`100.64.0.0/10`, RFC 6598) after that, those are usually your ISP's
internal/carrier-grade-NAT addressing on its IP access network — not reachable
from the public internet. Note: an ordinary broadband path to `8.8.8.8` does not
typically traverse an MPLS L3VPN core at all; and even on a real MPLS WAN circuit
the carrier's P routers often do not decrement the customer packet's TTL, so the
core may not appear in traceroute. When it does, you may see a few carrier
internal hops. Count how many hops are inside the carrier before reaching public
IP space.

**Part 3 — Map Meridian's branch subnet [laptop / paper]**

Given the branch supernet `10.30.0.0/16`:
1. How many `/24` subnets can you carve? (Answer: 256.)
2. Write out the network address, first usable IP, last usable IP, and broadcast
   for branch 007 (i.e. `10.30.7.0/24`).
   - Network: `10.30.7.0`
   - First host: `10.30.7.1`
   - Last host: `10.30.7.254`
   - Broadcast: `10.30.7.255`
3. Confirm there is no overlap with `10.10.0.0/16` or `10.20.0.0/16`. (They are
   different `/16`s, so no overlap.)

## Say it back (self-check)

1. Name the four WAN technology families and rank them roughly on cost and
   quality guarantee.
2. Explain the MPLS label mechanism in two sentences: what replaces IP routing
   in the core, and where is the label added/removed?
3. Why does a bank run MPLS rather than IPsec-over-broadband, even though both
   provide privacy?
4. A branch CE router loses its MPLS circuit. What mechanism detects the failure
   in sub-second time, and what path does traffic take next?
5. Northwind has 3,000 retail sites. Why is broadband + SD-WAN a better fit than
   MPLS for them, and what trade-off do they accept?

## Talk to the IT/security head

**Ask:**

1. "What's our current WAN topology — MPLS, internet-based, or a mix? Who's the
   carrier?"
   *Good answer:* names the carrier(s), topology (hub-and-spoke vs any-to-any),
   and the contract renewal date. They know the MPLS SLA off the top of their
   head.
   *Red flag:* "I think it's MPLS but I'd have to check" — if they don't know,
   circuit-level failures will be slow to diagnose.

2. "What's the SLA on the WAN — latency, packet loss, jitter, uptime — and what
   are the penalties if the carrier misses it?"
   *Good answer:* specific numbers per traffic class, and a real history of SLA
   credits claimed. They have the carrier NOC's escalation number memorised.
   *Red flag:* "It's 99.9% I think" with no idea what measurement period or what
   the credit is — the SLA may be contractually meaningless.

3. "What happens to a branch when the WAN fails? Is there a backup circuit, and
   does the branch operate in degraded mode or go dark?"
   *Good answer:* named backup (4G SIM, second broadband), a tested failover
   procedure, and a known degraded-mode for teller operations.
   *Red flag:* "the WAN doesn't fail" — every circuit fails eventually; no
   backup = no BCP.

4. "Are we planning any SD-WAN migration? What's the driver — cost, agility, or
   cloud onramp?"
   *Good answer:* a clear position — either a costed roadmap or a reasoned
   decision to stay on MPLS given the regulated environment.
   *Red flag:* "SD-WAN is what the vendor is pushing us on" without a TCO
   analysis. At a bank, SD-WAN over the internet must satisfy the CISO's data-in-
   transit policy; if security hasn't signed off, the project will stall.

5. "How does WAN QoS tie into critical application traffic — core banking, VoIP,
   video?"
   *Good answer:* named traffic classes with DSCP markings, and a guarantee that
   core banking hits the highest-priority class end-to-end, including on the
   4G backup (or a stated acceptance that backup is best-effort).
   *Red flag:* no QoS policy, or QoS configured on the CPE but not honoured on
   the MPLS class — the SLA paper says one thing; the actual path does another.

## Pitfalls & war stories

**The overlap discovery at cutover.** A bank migrated branches from MPLS to SD-
WAN-over-internet. Two days before go-live, someone noticed that the acquired
subsidiary (a recent M&A) also used `10.30.0.0/16` for its branches. Routing
collapsed. Cutover postponed six weeks for renumbering. Northwind (see running
example) has exactly this problem with Eastfield Foods. Always audit address
space *before* touching the WAN topology. (See N11.)

**MPLS "private" is not encrypted.** MPLS provides isolation — your traffic is
label-switched through the telco's core, unreachable from the internet — but the
telco can see plaintext at their PE routers. PCI DSS Requirement 4 (incl. 4.2.1)
mandates strong cryptography for PAN transmitted over *open, public* networks; a
carrier MPLS L3VPN is generally treated as a private/trusted network, so it does
not automatically trigger that requirement. Whether your MPLS counts as "trusted"
for Req 4 is a QSA judgment call — many banks run unencrypted MPLS and are
compliant — but some QSAs (or your own data-in-transit policy) will require TLS
or IPsec *on top of* MPLS for CDE traffic. Confirm with the QSA rather than
assuming either way. (See N29.)

**4G backup with no traffic shaping.** A bank added 4G SIMs as branch backup.
During an MPLS outage, branch traffic failed over — and video surveillance from
100 cameras immediately saturated the 20 Mbps 4G link, leaving zero bandwidth for
teller transactions. Without QoS on the backup path, the backup is as broken as
the failure it replaced. (See N34.)

**WAN renewal blindspot.** A 5-year MPLS contract comes up for renewal silently.
No one notices. The carrier auto-renews at list price — 40% above market. This
happens constantly. Architecture reviews should always surface the contract
expiry date, because a WAN migration project triggered by contract renewal needs
12–18 months runway.

**Latency math at the branch.** A new cloud application was designed assuming
LAN-like latency. When rolled out to branches over MPLS (15 ms one-way = 30 ms
RTT) the app made 12 sequential round-trip API calls per page load. Total page
load: 12 × 30 ms = 360 ms RTT added on top of server processing. On the 4G
backup (80 ms RTT) it was 960 ms of added latency per page. The app needed to be
re-architected for WAN-aware batching. Architects: always ask how many round
trips a new app makes per user interaction, and multiply by the WAN RTT. (See N01
for the latency framing, N53 for numbers.)

## Going deeper (optional)

- RFC 3031 — MPLS Architecture (the original specification for label switching).
- RFC 4364 — BGP/MPLS IP VPNs (how MPLS VPN services are built by carriers).
- MEF 3.0 — Carrier Ethernet and SD-WAN service definitions (industry standard
  the IT head's supplier uses).
- 3GPP TS 22.261 — 5G service requirements including URLLC and network slicing.
- Pairs with N33 (SD-WAN) for the software layer on top of these circuits, N34
  (QoS) for traffic prioritisation, and N36 (IPsec VPN) for the encryption layer
  over broadband/4G paths.

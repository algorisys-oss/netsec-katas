# Kata N53 — Latency, bandwidth, throughput, jitter, packet loss

> **Track:** Networking · **Module:** N10 Observability & troubleshooting · **Prereqs:** N03, N06, N20 · **Time:** ~35 min
> **Tags:** `networking` `latency` `troubleshooting` `monitoring` `wan` `qos` `first-principles`

## Why it matters

"The network is slow" is the most common complaint architects hear — and the least
actionable. Latency, bandwidth, throughput, jitter, and packet loss are five
distinct, measurable quantities. Confusing them leads to the wrong fix: buying
more bandwidth (expensive) when the real problem is jitter (which a QoS policy
could fix). At a bank, a 20 ms latency spike on a trading feed is a production
incident; at a large FMCG, a 1% packet-loss rate on a WMS scanner link means
stock-take data becomes unreliable. Knowing these numbers — and how to measure
them — lets you walk into a design review and ask the question that exposes
whether the IT head actually understands the problem or is just hoping for more
capacity.

## The mental model

Think of a network path as a pipe:

```
  Sender                                              Receiver
    │                                                    │
    │◄────────────── one-way distance ──────────────────►│
    │                                                    │
    │   ┌──────────────────────────┐                     │
    │──►│ pipe width = bandwidth   │────────────────────►│
    │   └──────────────────────────┘                     │
    │                                                    │
    │   time for data to cross = latency                 │
    │   data actually delivered = throughput (< bandwidth)
```

**Five quantities you must keep separate:**

### 1. Latency (RTT / one-way delay)

The time a single bit (or packet) takes to travel from source to destination.

- **Round-trip time (RTT):** what `ping` measures — time to send + time for the
  reply to return. Divide by 2 for an approximate one-way delay.
- **Components of latency:**

```
  Total latency = propagation + transmission + queuing + processing

  Propagation  light in fibre ≈ 200,000 km/s → ~5 ms per 1,000 km
               (you cannot beat physics — this is the floor)
  Transmission time to push all bits onto the wire: packet_size / bandwidth
               e.g. 1,500 bytes @ 10 Mbps = 1.2 ms; @ 1 Gbps = 0.012 ms
  Queuing      waiting behind other packets in a router buffer
               the variable, tunable part — controlled by QoS (see N34)
  Processing   crypto (TLS/IPsec), NAT, firewall state lookup — adds 0.1–5 ms
               depending on hardware
```

- **Rules of thumb:**
  - Within a city (same data center) < 1 ms
  - City-to-city (same continent) 5–30 ms
  - Intercontinental (e.g. Mumbai–London) 120–160 ms
  - GCP / AWS same-region between zones: 1–2 ms typical
  - For interactive voice, keep **one-way** mouth-to-ear delay under ~150 ms
    (ITU-T G.114, the recommendation on one-way transmission time).

### 2. Bandwidth

The maximum data rate the physical or provisioned link can carry, in bits per
second. A 100 Mbps Ethernet port has 100 Mbps of bandwidth. This is a *capacity*
number, not a performance number. Bandwidth is bought; it doesn't change moment to
moment (unless the link degrades).

Common link capacities:
```
  Branch ADSL/VDSL         10–100 Mbps
  Branch SD-WAN (4G LTE)   5–50 Mbps
  MPLS leased line          10 Mbps – 1 Gbps (typically 50–500 Mbps at FSI sites)
  Data-center interconnect  1–100 Gbps (often Dedicated Interconnect / Direct Connect)
  Cloud Dedicated Interconnect  10 Gbps or 100 Gbps per VLAN attachment
```

### 3. Throughput

The actual data rate measured end-to-end over a time period. Always ≤ bandwidth.
The gap between bandwidth and throughput is caused by:
- Packet loss (TCP retransmissions burn capacity)
- TCP flow control and slow-start
- Protocol overhead (headers, ACKs)
- Queuing delays causing TCP to back off

A link at 100 Mbps with 1% packet loss can see TCP throughput collapse to
30–50 Mbps in practice, because TCP interprets loss as congestion and reduces
its sending rate (see N20).

### 4. Jitter

Variation in packet arrival times. Packets sent at a constant 10 ms interval
might arrive at 8, 15, 11, 9, 20 ms intervals — that variance is jitter.

```
  Packet 1:  sent t=0    received t=10 ms   → one-way delay 10 ms
  Packet 2:  sent t=10   received t=22 ms   → one-way delay 12 ms
  Packet 3:  sent t=20   received t=28 ms   → one-way delay  8 ms

  Jitter (average |delta| of delay) ≈ (|12-10| + |8-12|) / 2 = (2+4)/2 = 3 ms
```

Why it matters: voice/video and real-time trading feeds are jitter-sensitive.
High jitter causes choppy audio (VoIP) or out-of-order frames that hit
retransmit buffers. TCP handles reordering; UDP (used by VoIP, real-time data
feeds) does not — jitter causes gaps. Measured and managed with QoS (N34).

### 5. Packet loss

The fraction of packets that leave the sender but never reach the receiver:

```
  Loss % = (packets sent - packets received) / packets sent × 100
```

Effects:
- **TCP:** cuts its congestion window (fast recovery on duplicate-ACK loss; full
  slow-start only after a timeout), so throughput drops sharply
- **UDP:** depends on the application — voice calls degrade; DNS may just retry;
  streaming buffers absorb small bursts

Loss causes: link errors (bad cable/SFP), congestion (full queue, tail drop),
firewall drops (rule matches), MTU mismatch (fragmentation needed but DF bit
set — see N04), or a flapping interface.

**Loss tolerance by traffic type:**

```
  Traffic type         Max tolerable loss
  ─────────────────────────────────────────
  Bulk file transfer   any (TCP retransmits)
  Web / API (TLS)      < 0.5% recommended
  VoIP / real-time     < 1%
  Trading feed (UDP)   < 0.01% (missed tick = revenue loss)
  WMS scanner          < 0.1% (retries → slow scan, stock inaccuracies)
```

### Putting them together: the SLA matrix

Network SLAs for regulated or latency-sensitive workloads should specify all five:

```
  ┌────────────────────┬───────────────────┬───────────────────┐
  │ Path               │ Latency (RTT)     │ Loss / Jitter     │
  ├────────────────────┼───────────────────┼───────────────────┤
  │ Branch → HQ (MPLS) │ < 20 ms           │ < 0.1% / < 5 ms  │
  │ HQ → GCP (Interconnect) │ < 5 ms       │ < 0.01% / < 1 ms │
  │ Core banking app   │ < 3 ms (intra-DC) │ < 0.01%           │
  │ Mobile → cloud LB  │ < 80 ms (public)  │ < 0.5%            │
  └────────────────────┴───────────────────┴───────────────────┘
```

## Worked example

**Meridian Bank scenario:** The risk team escalates that the RTGS payment feed
(UDP, latency-critical) from HQ-DC1 (`10.10.0.0/16`) to the RBI-connected gateway
at DC2 (`10.20.0.0/16`) is dropping transactions during morning peaks. The IT head
calls it "a bandwidth problem." Is it?

**Step 1 — measure latency:**

```bash
# From a host in 10.10.x.x to gateway at 10.20.4.1
ping -c 50 10.20.4.1

--- 10.20.4.1 ping statistics ---
50 packets transmitted, 50 received, 0% packet loss
min/avg/max/mdev = 1.8/2.3/8.7/1.4 ms
```

RTT avg 2.3 ms is fine for a same-country DC link (~40 km). The `mdev` of 1.4 ms
tells us jitter is present (ideal is <0.5 ms for this path). Zero packet loss —
so it is NOT a loss problem at ICMP level.

**Step 2 — measure throughput vs bandwidth:**

```bash
# iperf3: server at 10.20.4.10, client at 10.10.8.5
# [laptop-equivalent: run on two VMs or containers on a local bridge]
iperf3 -c 10.20.4.10 -u -b 100M -t 30

[ ID] Interval       Transfer     Bitrate        Jitter    Lost/Total
[  5]  0.0-30.0 sec  357 MB       99.8 Mbps      4.2 ms    312/256400 (0.12%)
```

Link bandwidth is 100 Mbps; throughput is effectively at the limit (UDP doesn't
back off). But **jitter is 4.2 ms** — well above the 1 ms SLA for this UDP feed.
High jitter on a UDP trading feed causes frames to arrive out of the receive
window and be dropped by the application layer, not the network.

**Step 3 — find the jitter source with MTR:**

```bash
mtr --report --report-cycles 50 10.20.4.1

Host                    Loss%  Snt  Last  Avg  Best  Wrst  StDev
1. 10.10.0.1  (core sw)  0.0%   50   0.2  0.3  0.1   0.5  0.1
2. 10.10.254.1 (dist rt) 0.0%   50   0.5  0.7  0.3   1.2  0.2
3. 10.20.254.1 (WAN rt)  0.0%   50   1.9  2.3  1.6   9.1  1.8   ← StDev spikes here
4. 10.20.4.1  (gateway)  0.0%   50   2.1  2.4  1.7   9.4  1.9
```

The jitter is introduced at hop 3 — the WAN router at DC2. High `StDev` (1.8 ms)
with zero loss points to **queue buildup**: the WAN router buffer fills under peak
load and introduces variable queuing delay. Root cause: insufficient QoS priority
for the RTGS feed — it competes with bulk backup traffic in the same queue.
The fix is not more bandwidth; it's a QoS policy that puts RTGS in a priority
queue (N34). No new circuit needed.

**Northwind FMCG scenario:** A distribution center on `10.50.8.0/24` reports WMS
scanner slowdowns. `ping` shows 0.8% packet loss to the WMS server. At the
scanner's 2 Mbps UDP rate, 0.8% loss triggers enough retries in the application
layer to cause a 15-second scan delay. Root cause in this case: a bad SFP (fibre
transceiver) on the access switch — visible in interface error counters, not in
bandwidth utilization.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Latency measurement | `ping`, `mtr`, `iperf3` to a known host | `ping` to cloud IPs; GCP Network Intelligence Center → Connectivity Tests | `ping`; CloudWatch Network Monitor (previewed 2023) | (Azure: TODO) |
| Bandwidth / throughput | `iperf3`, SNMP interface counters | VPC flow logs show byte counts; no built-in iperf equivalent — use GCE instances | VPC flow logs; CloudWatch NetworkIn/Out | (Azure: TODO) |
| Jitter monitoring | IPSLA / IP SLA (Cisco), commercial NPM | Network Intelligence Center → Performance Dashboard | CloudWatch Network Monitor; Internet Monitor (internet paths) | (Azure: TODO) |
| Packet loss | Interface error counters; `mtr` | VPC flow logs (dropped flows); Packet Mirroring + `tcpdump` | VPC flow logs; Traffic Mirroring | (Azure: TODO) |
| Flow data (NetFlow / IPFIX) | NetFlow on routers, sFlow on switches | VPC Flow Logs (aggregated, not per-packet) | VPC Flow Logs | (Azure: TODO) |
| Active probing / synthetic monitoring | `iperf3`, IPSLA | Network Intelligence Center → Connectivity Tests; uptime checks via Cloud Monitoring | CloudWatch Synthetics; Network Monitor probes | (Azure: TODO) |
| QoS / traffic shaping | DSCP marking, policing on router/switch | No direct QoS inside VPC (best-effort); Dedicated Interconnect VLAN attachments have bandwidth limits | No intra-VPC QoS; Direct Connect hosted connections have SLA | (Azure: TODO) |

**Key cloud insight:** inside a major cloud provider's backbone (GCP, AWS), intra-
region traffic is best-effort but engineered for very low latency and loss
(typically < 1 ms RTT within a zone, < 2 ms between zones). The degradation you
see in cloud is almost always in the **application layer** (misconfigured keep-
alives, connection pool exhaustion, TLS overhead) rather than raw network metrics.
Cross-region and internet-egress paths are where physics reassert themselves.

## Do it (the exercise)

**[laptop] Exercise 1 — measure the five metrics on your local machine**

1. Measure **latency and packet loss** to a public reliable host:
   ```bash
   ping -c 100 8.8.8.8
   # Note: avg, min, max, mdev (jitter proxy), and loss %
   ```

2. Measure **latency path and per-hop jitter** with MTR (install: `apt install mtr`
   / `brew install mtr`):
   ```bash
   mtr --report --report-cycles 30 8.8.8.8
   # Read Loss%, Avg, StDev (jitter) per hop
   # Note where StDev spikes — that's your jitter source
   ```

3. Measure **throughput** between two processes on localhost (install `iperf3`):
   ```bash
   # Terminal 1 — server
   iperf3 -s

   # Terminal 2 — client, 10-second TCP test
   iperf3 -c 127.0.0.1 -t 10
   # Note: Transfer, Bitrate, Retr (TCP retransmits)

   # Terminal 2 — UDP test, with loss and jitter reported
   iperf3 -c 127.0.0.1 -u -b 100M -t 10
   # Note: Jitter (ms), Lost/Total datagrams
   ```

4. **Bandwidth != throughput:** now introduce artificial loss:
   ```bash
   # Linux only — add 2% loss on loopback (requires root)
   sudo tc qdisc add dev lo root netem loss 2%

   # Re-run iperf3 TCP test and observe throughput collapse
   iperf3 -c 127.0.0.1 -t 10

   # Clean up
   sudo tc qdisc del dev lo root
   ```
   Notice how 2% loss causes TCP throughput to drop by far more than 2%.

**[laptop] Exercise 2 — interpret a real mtr report**

Run `mtr --report --report-cycles 60 1.1.1.1` and fill in the table:

| Hop | IP / Host | Loss% | Avg RTT | StDev | What this hop is |
|-----|-----------|-------|---------|-------|-----------------|
| 1   |           |       |         |       | your default gateway |
| ... |           |       |         |       | |

Answer: which hop contributes the most jitter? Is loss at an intermediate hop real
or is the hop just de-prioritizing ICMP? (Hint: if all subsequent hops show 0%
loss, the intermediate "loss" is an ICMP rate-limit, not true packet drop.)

**[needs cloud account] Exercise 3 — GCP latency baseline**

In GCP Console → Network Intelligence Center → Connectivity Tests:
- Create a test: source = a Compute instance in one zone, dest = instance in
  another zone, same region. Observe the round-trip latency estimate.
- Compare to `ping` between two GCE instances. Note whether results align.

## Say it back (self-check)

1. What is the difference between bandwidth and throughput? Give a scenario where a
   100 Mbps link delivers only 30 Mbps of effective throughput.
2. Name the four components of latency. Which one can you reduce with QoS? Which
   one is set by the speed of light and cannot be reduced?
3. Why does 1% packet loss hurt a UDP real-time feed differently from a TCP bulk
   transfer? What happens to TCP throughput when it detects loss?
4. What is jitter, and why does it matter for VoIP but not for a file download?
5. You see `mdev = 12 ms` in a `ping` result. What metric does that tell you, and
   is it a concern for a trading feed?

## Talk to the IT/security head

**Ask:**
- "What are your network SLAs for this path — do they specify latency, jitter,
  loss, and throughput separately, or just 'uptime'?"

  *A good answer:* a documented SLA per traffic class (voice < 150 ms, data < X ms,
  loss < Y%), backed by monitoring. Anything SLA'd should have a monitoring alert.

  *Red flag:* "we have a 99.9% uptime SLA" — availability alone says nothing about
  latency or jitter; a link that is up but 300 ms slower than expected can
  silently ruin application performance.

- "When you say the network is slow, which of the five metrics is actually
  elevated — have you measured them independently?"

  *A good answer:* the team runs `mtr` or has an NPM (Network Performance Monitor)
  dashboard showing per-hop RTT and loss trending over time.

  *Red flag:* "we just know it feels slow" — no measurement baseline means no
  root-cause diagnosis, and the fix will be guesswork (usually "buy more
  bandwidth").

- "For your latency-sensitive workloads — trading feeds, RTGS payments, VoIP —
  are they in a priority queue, or competing with backup and bulk traffic?"

  *A good answer:* DSCP marking is applied at ingress, QoS policies are in place
  at WAN router and DC switch, and there is a proof of it in config or traffic stats.

  *Red flag:* no QoS, or "QoS is configured but we've never validated it." Saying
  you have QoS and never testing it is the same as not having it.

- "How are you measuring throughput end-to-end, not just link utilization?"

  *A good answer:* active synthetic tests (iperf3 scheduled, or a commercial NPM
  tool) alongside passive utilization monitoring. Both needed — utilization shows
  average load; synthetic tests show actual achievable throughput under load.

  *Red flag:* "we monitor link utilization in SNMP" — utilization at 40% is not
  evidence of good throughput; if QoS or loss is bad, throughput can be poor even
  at low utilization.

**Red flags to listen for overall:**
- "Bandwidth" used when "throughput" is meant (or vice versa) — signals imprecise
  diagnosis, likely an expensive fix for the wrong problem.
- No baseline: "we don't know what normal looks like" — you cannot troubleshoot
  a deviation you haven't defined.
- SLAs that only cover availability (uptime %) with nothing on latency or loss —
  common at FMCGs with thin WAN budgets; leaves real problems invisible until
  something breaks badly.

## Pitfalls & war stories

- **Buying bandwidth to fix jitter.** A Northwind distribution center upgraded from
  50 Mbps to 200 Mbps MPLS. WMS still dropped scans. Root cause was QoS-less
  competition with Windows Update traffic in the morning window. A 10-line QoS
  policy (traffic shaping for WU, priority for WMS) fixed it. The bandwidth upgrade
  cost 3× the annual QoS project cost and did nothing.

- **Blaming the cloud for the last mile.** An FSI client (modelled on Meridian)
  reported high latency to their GCP region. The cloud path was fine (GCP internal
  < 2 ms). The 80 ms tail latency was their Dedicated Interconnect router — a
  misconfigured OSPF timer causing periodic route flaps, invisible in link-up/down
  monitoring because the link stayed up. `mtr` to the first on-ramp router showed
  the jitter instantly.

- **Confusing ICMP loss with real loss.** Many ISP routers and firewalls
  rate-limit or drop ICMP (ping packets) while passing TCP/UDP normally. If hop 5
  shows 50% loss in `mtr` but hop 6 shows 0%, hop 5 is rate-limiting ICMP —
  there is no real loss. Always confirm with `iperf3 -u` or application-level
  metrics before escalating "we have 50% packet loss on the WAN."

- **Ignoring MTU in throughput tests.** iperf3 uses a 128 KB default TCP buffer.
  If the path has an MTU mismatch (e.g., a tunnel reducing effective MTU to
  1,400 bytes), `iperf3` will show fine throughput but real applications that
  set the DF (Don't Fragment) bit will blackhole. Always pair throughput tests
  with a path-MTU check: `ping -M do -s 1472 <dest>` (Linux) to probe for
  1500-byte path MTU. See N04.

- **No baseline = no escalation leverage.** At both Meridian and Northwind, the
  network team's ability to SLA a vendor (MPLS provider, cloud interconnect
  partner) depends on having a historical baseline. If you didn't measure before
  the problem, you have no proof the link degraded. Set up continuous synthetic
  probing *before* you need it.

## Going deeper (optional)

- RFC 2544 — Benchmarking Methodology for Network Interconnect Devices (the
  standard for how bandwidth and throughput tests should be conducted).
- RFC 3393 — IP Packet Delay Variation (the formal IETF definition of jitter /
  IPDV).
- RFC 2681 — A Round-trip Time and Packet Loss Metric for IPPM.
- `man mtr`, `man iperf3` — authoritative flag references for the tools used here.
- GCP Network Intelligence Center docs: `cloud.google.com/network-intelligence-center`
- AWS CloudWatch Network Monitor: `docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-NetworkMonitor.html`
- Pairs with N34 (QoS) for the fix, N54 (flow logs & packet mirroring) for cloud
  observability, and N55 (structured troubleshooting playbook) which applies the
  five-metric framework to a full diagnostic workflow.

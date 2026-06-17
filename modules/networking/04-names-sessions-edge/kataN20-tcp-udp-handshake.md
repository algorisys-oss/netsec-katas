# Kata N20 — TCP vs UDP, the 3-way handshake, ports, connection state

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N03, N04 · **Time:** ~35 min
> **Tags:** `networking` `tcp` `udp` `ports` `l4-transport` `stateful-firewall` `first-principles` `fsi`

## Why it matters

Every firewall rule, every load-balancer health check, every cloud security-group
entry is written in terms of **protocol and port**. When a network engineer says
"we need TCP 443 inbound, stateful, and we'll allow the return traffic," they are
describing a contract that determines what equipment does and doesn't permit. If
you can't read that contract you can't challenge it, size it, or explain it to the
CISO. This kata is also the foundation for N21 (TLS), N22 (load balancing), and
N26 (firewalls) — everything from here on lives on top of TCP or UDP.

## The mental model

At Layer 4 (Transport — see N03), two protocols do almost all real work:

```
  TCP                                UDP
  ─────────────────────────────────  ─────────────────────────────────
  Connection-oriented                Connectionless
  Reliable: every segment ACKed      Best-effort: no ACK, no retransmit
  Ordered: seq numbers guarantee it  Unordered: application must cope
  Flow control + congestion control  None: app or network controls rate
  Has STATE: SYN → ESTABLISHED →     Stateless: each datagram independent
    TIME_WAIT → CLOSED
  Heavier: 3 messages before data    Light: just send it

  Use when: data must arrive whole   Use when: speed > reliability
  Examples: HTTP(S), SSH, SMTP,      Examples: DNS queries, NTP, DHCP,
    database connections,              streaming video (QUIC/HTTP3),
    file transfers, TLS handshake      VoIP, gaming, DTLS
```

### Ports

A **port** is a 16-bit number (0–65535) that identifies a *service* on a host.
The combination `IP:port` is a **socket**. A TCP or UDP connection is identified
by the 4-tuple: `(src IP, src port, dst IP, dst port)`.

```
  Well-known ports   0–1023      assigned by IANA; require root to listen
  Registered ports   1024–49151  common apps (Redis 6379, Postgres 5432)
  Ephemeral ports    49152–65535 OS assigns these to client-side connections
                                 (range varies: Linux often 32768–60999)
```

A firewall rule "allow TCP dst-port 443" means: match any packet whose
destination port field is 443. It says nothing about the payload — that is L7.

**Common ports every architect should know:**

| Port | Proto | Service | Notes |
|------|-------|---------|-------|
| 22 | TCP | SSH | Remote management; restrict source tightly |
| 53 | TCP+UDP | DNS | UDP for queries ≤512 B; TCP for zone transfers and large responses |
| 80 | TCP | HTTP | Often redirected to 443; don't carry cardholder data |
| 443 | TCP+UDP | HTTPS / TLS | TCP for classic HTTPS; **UDP 443** carries HTTP/3 (QUIC) — open both at the firewall |
| 5432 | TCP | PostgreSQL | Never internet-exposed; internal only |
| 6379 | TCP | Redis | Likewise; auth is often weak by default |
| 8080, 8443 | TCP | Alt HTTP/HTTPS | Used by dev and some middleware |

### The TCP 3-way handshake

Before any data flows over TCP, the two endpoints negotiate a connection. Three
messages, each with a sequence number:

```
  Client                              Server
     │                                  │
     │──── SYN  (seq=x) ───────────────>│   "I want to connect; my seq starts at x"
     │                                  │
     │<─── SYN-ACK (seq=y, ack=x+1) ───│   "OK; my seq starts at y; I got your x"
     │                                  │
     │──── ACK  (ack=y+1) ─────────────>│   "Got it; your y acknowledged"
     │                                  │
     │  ═══ ESTABLISHED: data flows ═══ │
     │                                  │
```

The sequence numbers (`x`, `y`) are chosen pseudo-randomly (RFC 6528 hardened
this to prevent sequence prediction attacks). They let TCP detect lost or
re-ordered segments.

**Why this matters for security:** a **stateful firewall** tracks this handshake.
It allows the SYN from the initiating side, records the connection in a state
table, and automatically allows return traffic (SYN-ACK + subsequent ACKs) without
a separate rule. A **stateless firewall** (packet filter) cannot do this — it must
have explicit rules for both directions. If the IT head says "don't worry, the
return traffic is covered," they are counting on a stateful device — verify that.

### Connection state machine (abbreviated)

```
  CLOSED → SYN_SENT → ESTABLISHED → FIN_WAIT_1 → FIN_WAIT_2 → TIME_WAIT → CLOSED
                                  ↑
               SYN_RCVD ─────────┘   (server side path)
```

`TIME_WAIT` is the 2×MSL (Maximum Segment Lifetime) pause after close; typically
60 seconds. Under high connection-rate workloads (e.g. a payment gateway) you can
exhaust ephemeral ports if connections don't close cleanly — this is a real
production problem (see Pitfalls).

### TCP teardown (graceful close)

```
  Client                              Server
     │──── FIN ─────────────────────>│   "I'm done sending"
     │<─── ACK ─────────────────────│
     │<─── FIN ─────────────────────│   "I'm done too"
     │──── ACK ─────────────────────>│
     │  [client enters TIME_WAIT]    │
```

A **RST** (reset) is the abrupt close — the other side discards the connection
immediately. Firewalls that drop packets mid-connection will often trigger a RST.

### UDP — no handshake, no state

```
  Client                              Server
     │──── UDP datagram ────────────>│   "Here's your DNS query"
     │<─── UDP datagram ─────────────│   "Here's your DNS answer"
     │   (done — no teardown)        │
```

DNS uses UDP for queries (≤512 bytes traditionally; EDNS0 extends this to 4096 B).
If a DNS response exceeds the UDP limit, the client retries over TCP — this is why
port 53 is **both** TCP and UDP in firewall rules.

## Worked example

Meridian Bank's mobile backend (GCP, `10.100.0.0/14`) queries the core-banking
API at HQ-DC1 (`10.10.0.0/16`) over HTTPS.

```
  GCP mobile backend                     HQ-DC1 core API
  10.100.4.11                            10.10.8.50

  [1] TCP SYN       src=10.100.4.11:54321  dst=10.10.8.50:443
  [2] TCP SYN-ACK   src=10.10.8.50:443     dst=10.100.4.11:54321
  [3] TCP ACK       src=10.100.4.11:54321  dst=10.10.8.50:443
      ── connection ESTABLISHED ──
  [4] TLS ClientHello  (inside TCP; see N21)
      ... TLS handshake ...
  [5] HTTP POST /api/balances  (encrypted inside TLS)
  [6] HTTP 200 OK              (encrypted inside TLS)
  [7] TCP FIN/ACK × 2 (teardown)
```

**Source port** `54321` is an ephemeral port the OS on the cloud VM assigned
automatically. The firewall rule the network team writes references **only the
destination** port (443) — they do not predict or need to know the ephemeral port.

**The firewall rule at the on-prem edge** (stateful):
```
  permit tcp 10.100.0.0/14 any host 10.10.8.50 443   ← initiating SYN
  (return traffic allowed by state table — no explicit rule needed)
```

If a junior engineer writes this as a stateless filter, they need:
```
  permit tcp 10.100.0.0/14 any  host 10.10.8.50 443    ← outbound SYN
  permit tcp host 10.10.8.50 443  10.100.0.0/14 any    ← inbound SYN-ACK/ACK
```
The second rule is dangerously broad: it allows *any* packet from 10.10.8.50:443
inbound, including spoofed or unexpected initiations.

**Northwind FMCG parallel:** a distribution center scanner at `192.168.1.15`
sends inventory updates to the warehouse management system (WMS) at
`10.50.4.20:8080` over TCP. The same 3-way handshake occurs; the IT head at
Northwind would verify the `TIME_WAIT` buildup doesn't accumulate across their
3,000 retail points when all scanners reconnect after a nightly reboot window —
a real scale concern (see Pitfalls).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Stateful L4 firewall | Hardware/software NGFW | VPC Firewall Rules (stateful by default) | Security Groups (stateful) | (Azure: TODO) |
| Stateless packet filter | ACL on router/switch | VPC Firewall Rules have no stateless mode; use hierarchical rules | Network ACLs (NACLs — stateless; layered with SGs) | (Azure: TODO) |
| Connection state table | NGFW session table | Managed by GCP; not directly visible | Managed by AWS; not directly visible | (Azure: TODO) |
| Port-based allow rule | `permit tcp any host X port Y` | Target tag or service account + port in firewall rule | Inbound rule: protocol, port, source CIDR in SG | (Azure: TODO) |
| Ephemeral port range | OS-level (32768–60999 Linux) | Same (GCP VM is a standard Linux kernel) | Same | (Azure: TODO) |
| Connection tracking / flow logs | NGFW session logs | VPC Flow Logs (sampled; 5-tuple) | VPC Flow Logs (sampled; 5-tuple) | (Azure: TODO) |

**GCP nuance:** GCP VPC Firewall Rules are stateful — return traffic for allowed
connections is automatically permitted. GCP also has **Firewall Policies** (a newer
hierarchical construct) that supersede per-VPC rules in Landing Zone designs; they
are also stateful. You do not need to write explicit return-traffic rules.

**AWS nuance:** Security Groups are stateful (return traffic auto-allowed). Network
ACLs (NACLs) are stateless and are evaluated *before* security groups — this is
the classic AWS gotcha: an SG rule allows ingress on 443, but if the NACL doesn't
allow egress on the ephemeral port range (1024–65535), the TCP ACK and response
never leave the subnet.

## Do it (the exercise)

**[laptop]** Watch the 3-way handshake live:

1. In one terminal, capture TCP traffic on the loopback:
   ```bash
   sudo tcpdump -i lo -n tcp port 8080 -S
   # -S: show absolute sequence numbers
   ```

2. In a second terminal, start a tiny server and connect to it:
   ```bash
   # Terminal 2: start a listener
   nc -l 8080 &

   # Terminal 3: connect a client
   nc 127.0.0.1 8080
   ```

3. Observe in tcpdump output:
   ```
   SYN     seq=<x>  ack=0
   SYN-ACK seq=<y>  ack=<x+1>
   ACK     seq=<x+1> ack=<y+1>
   ```
   Type something in the client `nc`, see a data segment (`PSH`). Ctrl-C the
   client; observe the `FIN` / `ACK` / `FIN` / `ACK` teardown.

4. Kill the server: `kill %1`

**[laptop]** See connection state on your machine:

```bash
# Linux
ss -tn state established   # TCP connections in ESTABLISHED state
ss -tn state time-wait     # connections waiting 2×MSL to close
ss -tn                      # all TCP connections with state column

# macOS
netstat -anp tcp | grep ESTABLISHED
```

**[laptop]** Verify DNS uses both UDP and TCP:

```bash
# Default UDP query (should show ;; SERVER and short latency)
dig +short A google.com

# Force TCP
dig +tcp +short A google.com

# Large response that can trigger TCP fallback
# DNSSEC answers are reliably large; watch for the truncated (TC) flag then
# an automatic retry over TCP:
dig +dnssec DNSKEY cloudflare.com   # large signed response; may set TC over UDP
# Note: `dig ANY` is no longer a reliable trigger — since RFC 8482 (2019) most
# large resolvers/authoritative servers refuse ANY with a minimal HINFO
# "not implemented" answer instead of returning the full record set.
```

**[laptop]** Map ports on your own machine:

```bash
# What is my machine currently listening on?
ss -tlnp        # TCP listeners with process (Linux; needs sudo for full output)
netstat -anp tcp | grep LISTEN  # macOS
```
Identify 3 services. For each: look up the port, name the service, and decide
whether you'd allow it through a perimeter firewall. (Hint: you probably should
not expose all of them.)

## Say it back (self-check)

1. Name the three messages in the TCP 3-way handshake and what each carries.
2. What is an ephemeral port, and why does a firewall rule typically reference only
   the destination port?
3. What is the difference between a stateful and a stateless firewall, and why does
   it matter for return traffic?
4. Why does DNS use both UDP and TCP on port 53?
5. What is `TIME_WAIT`, and what production problem does it cause at scale?

## Talk to the IT/security head

**Ask:**

- "Is the firewall at the cloud-to-on-prem edge stateful or stateless, and how is
  return traffic handled?" *(A stateless filter needs explicit return rules; a gap
  here is both a security risk and a connectivity failure waiting to happen.)*
- "What ephemeral port range does your OS standard build use, and are your NACL /
  stateless ACL rules covering that full range?" *(In AWS especially, NACL egress
  rules that omit 1024–65535 silently break TCP responses.)*
- "How do you monitor connection-state table exhaustion or TIME_WAIT buildup on
  high-throughput services?" *(Relevant for Meridian Bank's payment gateway and
  any API receiving burst load from mobile.)*
- "When you write a firewall rule for a new service, what is the process — who
  decides the port, who writes the rule, and who validates it didn't break
  something else?" *(Reveals change-control maturity — see N02.)*

**A good answer sounds like:** the engineer can immediately state "stateful — return
traffic is tracked in the session table," can name their standard ephemeral range,
and has monitoring for session table size. They know which devices are stateful and
which are stateless in the path.

**Red flags:**
- "We just allow the return traffic with a rule from any" — stateless thinking, or
  worse, an overly broad rule that allows unsolicited inbound.
- "We don't track TIME_WAIT, that's the OS's problem" — for a bank processing
  millions of API calls per hour, this is a production risk.
- Inability to say whether the perimeter device is stateful — suggests the rule
  base isn't well understood (common after years of accumulated changes).
- "Port 53 is UDP only" — common misconception; DNS over TCP is required for large
  responses and zone transfers. A missing TCP-53 rule can silently break DNSSEC or
  split-horizon replies.

## Pitfalls & war stories

**TIME_WAIT port exhaustion at Meridian Bank's payment gateway.** Short-lived HTTPS
connections to the card-processor API close quickly. Each goes through `TIME_WAIT`
for ~60 seconds. At 1,000 connections/second × 60 s = 60,000 sockets in
`TIME_WAIT` simultaneously. The Linux ephemeral range (32,768–60,999) is ~28,000
ports. Without `SO_REUSEADDR` / `tcp_tw_reuse` tuning or persistent connections
(keep-alive), the gateway runs out of source ports and starts dropping new
connections. The tell-tale error is `EADDRNOTAVAIL` / "cannot assign requested
address" from `connect()`/`bind()` — *not* "connection refused" (`ECONNREFUSED`),
which specifically means a RST from a closed or unlistening destination port.
(Behind a connection-pool library the same exhaustion may instead surface as
generic connection timeouts, which makes it harder to diagnose.) The fix is
usually HTTP keep-alive (reuse the TCP connection for multiple requests) rather
than OS tuning.

**AWS NACL + SG confusion.** A team at Northwind's AWS account opened port 443
in the Security Group but forgot the NACL. The SG is stateful — it would have
handled return traffic automatically. But the NACL (stateless) blocked the outbound
ephemeral port range. Every HTTPS response was silently dropped. The symptom was
"SSL handshake timeout" — which led the team to suspect a TLS issue for two hours
before someone checked the NACL outbound rules.

**"We allow TCP 443 both ways" as a stateless rule.** An FMCG IT team, unfamiliar
with stateful inspection, wrote both directions explicitly: `permit tcp any :443
dst-any` and `permit tcp any src-any :443`. The inbound rule allowed *any* host to
initiate a connection *from port 443* to any port inside the network — a valid
technique for source-port spoofing. The safer approach is stateful-only, or if
stateless is unavoidable, restrict return traffic to `established` (TCP flag ACK
set, no SYN).

**Firewall rule says "TCP 53" but DNS breaks on large responses.** A common
mistake: the firewall passes UDP 53 (DNS queries) but the TCP-53 rule is missing.
Small queries work fine. The moment a DNS response is too large for UDP (DNSSEC
records, large TXT/SPF records), the client retries over TCP and hits the implicit
deny. DNSSEC validation silently fails; the app sees intermittent "name resolution
failed." Always pair UDP 53 with TCP 53.

## Going deeper (optional)

- **RFC 793** — original TCP specification (1981); defines the state machine and
  handshake formally.
- **RFC 6528** — "Defending Against Sequence Number Attacks": why initial sequence
  numbers must be hard to predict.
- **RFC 9293** — updated TCP specification (2022), supersedes RFC 793.
- **RFC 768** — UDP specification (2 pages; genuinely that simple).
- **RFC 6056** — "Recommendations for Transport-Protocol Port Randomization": why
  the OS should *randomize* ephemeral source-port selection (to resist off-path
  attacks), not how the numeric range itself is chosen.
- Pairs with **N21** (TLS: the session that lives *inside* the TCP connection) and
  **N26** (firewalls: how stateful inspection tables are built and limits).
- For cloud specifics: GCP VPC Firewall documentation; AWS Security Groups vs NACLs
  comparison in the AWS VPC User Guide.

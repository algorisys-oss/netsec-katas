# Kata N06 — Tools: ping, traceroute/mtr, tcpdump/Wireshark

> **Track:** Networking · **Module:** N1 Packets & layers · **Prereqs:** N03, N04, N05 · **Time:** ~40 min

## Why it matters

In a design review or an incident bridge, the person who can *show* where a packet
dies wins the argument. These four tools — `ping`, `traceroute`/`mtr`, and
`tcpdump`/Wireshark — let you locate a fault on the OSI ladder (N03) in minutes
instead of trading blame across teams. You won't run them daily, but knowing what
each *proves* (and what it can't) means you can ask the network team for the right
capture and read it back. This is the kata that turns the previous three from
theory into something you can see.

## The mental model

Each tool answers a different layer's question:

```
 Question                                   Tool            Layer it probes
 ───────────────────────────────────────────────────────────────────────
 "Is the host reachable at all?"            ping            L3 (ICMP)
 "Where on the path does it break/slow?"    traceroute/mtr  L3, hop by hop
 "Can I open this TCP port / service?"      nc / curl       L4 / L7
 "What's actually on the wire?"             tcpdump/Wireshark  L2–L7 (truth)
```

The golden rule: **work up the layers.** Don't debug TLS (L7) before you've proven
the host pings (L3) and the port opens (L4). Most "the app is down" tickets die at
a lower layer than anyone first assumes.

### What each tool really does

- **`ping`** sends ICMP echo requests and times the replies. Proves L3
  reachability + round-trip latency + loss. *Caveat:* many firewalls drop ICMP, so
  "ping fails" ≠ "host down" — it may just mean ICMP is blocked while TCP/443 works
  fine. Never conclude an outage from ping alone.
- **`traceroute`** (Linux/mac) / **`tracert`** (Windows) maps the hops. It sends
  packets with increasing **TTL** (1, 2, 3…); each router that decrements TTL to 0
  sends back an ICMP "time exceeded," revealing itself. *Caveats:* routers may
  rate-limit/hide ICMP (shown as `* * *`), and paths can be asymmetric (the return
  path differs), so a mid-path `*` is often cosmetic, not a fault.
- **`mtr`** = traceroute + ping, continuously. It's the better tool for *loss and
  latency per hop over time* — run it for 60 seconds to catch intermittent loss
  that a single traceroute misses. Read the **Loss%** column at the *destination*,
  not at an intermediate hop that merely deprioritizes ICMP.
- **`tcpdump` / Wireshark** capture the actual frames — the ground truth. tcpdump
  is the CLI (great on a server/jump host); Wireshark is the GUI for deep analysis.
  This is where you confirm the 3-way handshake, see retransmits, watch ARP (N05),
  or prove a packet never arrived.

## Worked example

A Meridian engineer reports "the mobile backend can't reach the core API at
`10.10.50.10:8443`." Walk up the layers:

```bash
# L3 — is the host even reachable? (expect: replies, or timeout if ICMP blocked)
ping -c 4 10.10.50.10

# L3 path — where does it stop? (look for where hops turn into * * *)
mtr -rwc 50 10.10.50.10          # report mode, 50 cycles, wide; read Loss% at end
#   or:  traceroute 10.10.50.10

# L4 — can we actually open the TCP port? (this is the real test, ICMP-independent)
nc -vz -w3 10.10.50.10 8443      # "succeeded!" = port open; "refused"/"timed out" differ!
#   refused  → host up, nothing listening (or RST from firewall)
#   timed out → silently dropped (firewall DROP, or no route back)

# L7 — does the service actually answer / is TLS healthy?
curl -vk https://10.10.50.10:8443/health

# Ground truth — capture on the path while retrying from the client
sudo tcpdump -ni any host 10.10.50.10 and port 8443
```

**Reading the result is the skill:** `ping` failing but `nc` succeeding → ICMP is
blocked, the path is fine, stop blaming the network. `nc` *refused* → the host is
up but nothing's listening (app problem, not network). `nc` *timed out* → a
firewall is silently dropping (the difference between refused and timed-out points
at totally different owners — see N02). tcpdump showing SYNs going out with no
SYN-ACK back → the request leaves but nothing returns (firewall or asymmetric
route). That distinction, made in two minutes, saves a day of cross-team blame.

## Do it (the exercise) [laptop]

1. **Latency & loss feel:**
   ```bash
   ping -c 5 8.8.8.8                 # low RTT, 0% loss nearby
   mtr -rwc 30 1.1.1.1              # watch RTT climb hop-by-hop with distance
   ```
   Note where latency jumps — that hop is a long physical link or a congested one.
2. **Port reachability, the way you'd actually test a service:**
   ```bash
   nc -vz -w3 github.com 443        # open
   nc -vz -w3 github.com 444        # contrast: refused/timeout — feel the difference
   ```
3. **Capture and read a handshake (the payoff):**
   ```bash
   sudo tcpdump -ni any -c 20 'tcp port 443'    # then run: curl https://example.com
   ```
   Find the 3-way handshake: a packet with flags `[S]` (SYN), the reply `[S.]`
   (SYN-ACK), then `[.]` (ACK). You're seeing N04's segments and N03's L4 live.
4. Optional GUI: open the same capture logic in Wireshark, filter `tcp.port == 443`,
   and use **Statistics → Flow Graph** to visualize the handshake.

## Say it back (self-check)

1. Why is "ping fails" not proof that a host is down?
2. How does traceroute use TTL to discover each hop?
3. What's the difference between `nc` reporting *connection refused* vs *timed out*,
   and which team does each point to?
4. When would you reach for `mtr` instead of a single `traceroute`?
5. What does tcpdump prove that the other three tools can't?

## Talk to the IT/security head

**Ask:**
- "Can we get a packet capture at both ends of the path during the next failure
  window?" *(two-ended capture instantly shows if packets leave but don't arrive)*
- "Is ICMP allowed through, or will ping/traceroute give misleading results here?"
- "Do you have flow logs or packet mirroring on this segment?" (ties to N54)

**A good answer sounds like:** they offer a capture from a known tap/jump host and
already know which protocols are filtered ("ICMP is dropped at the perimeter, so
test with `nc` on 8443; I'll mirror the port and we'll capture both sides").

**Red flags:** no way to capture traffic anywhere; conclusions drawn purely from
ping; or "we don't allow tcpdump and have no flow logs" — meaning nobody can ever
see ground truth, so every incident is guesswork.

## Pitfalls & war stories

- Declaring an outage because ICMP is blocked, while the actual service on TCP/443
  was healthy the whole time.
- Panicking over `* * *` mid-traceroute — usually a router deprioritizing ICMP, not
  a fault. Judge by loss/latency at the **destination**, not intermediate hops.
- Forgetting **asymmetric routing**: the request path and reply path can differ, so
  a one-ended capture can mislead. Capture both ends for anything subtle.
- Running tcpdump without a filter on a busy host and drowning in output (or
  impacting the box). Always scope: `host X and port Y`.
- Treating `nc`/ping success as proof the *application* works — they prove the
  network/port, not that the service behind it is healthy (that's the L7 `curl`).

## Going deeper (optional)

- Wireshark's "Expert Information" and TCP analysis flags (retransmission, dup ACK,
  zero window) — how the GUI surfaces problems automatically.
- Revisit after N20 (TCP handshake in depth) to fully read a capture, and N55
  (the structured layer-by-layer troubleshooting playbook) which formalizes this.

# Kata N04 — Encapsulation: follow one packet down the stack and back up

> **Track:** Networking · **Module:** N1 Packets & layers · **Prereqs:** N03 · **Time:** ~30 min
> **Tags:** `networking` `encapsulation` `mtu` `l3-network` `l4-transport` `troubleshooting`

## Why it matters

"Encapsulation" sounds academic until you're staring at an MTU problem, a VPN
that mangles large packets, or a firewall that "sees" a port but not a URL.
Every one of those is explained by the same idea: each layer wraps the layer
above it in its own envelope with its own header. Understanding the nested
envelopes tells you *what each device can actually inspect*, *why packets have a
maximum size*, and *where overhead and fragmentation come from* — three things
that bite hybrid and cloud designs constantly.

## The mental model

Going **down** the stack on the sender, each layer adds a header (and L2 adds a
trailer). This is **encapsulation**. Going **up** on the receiver, each layer
strips its own header — **decapsulation**. The payload of one layer is the entire
packet of the layer above ("a TCP segment is the payload of an IP packet").

```
 SEND (encapsulate, top → down)            the unit's name at each layer
 ───────────────────────────────────────────────────────────────────────
 L7  [ HTTP request: GET /balance ]                         → "data"
 L4  [ TCP hdr | HTTP....................... ]              → "segment"
 L3  [ IP hdr  | TCP hdr | HTTP............. ]              → "packet"
 L2  [ Eth hdr | IP hdr | TCP hdr | HTTP | Eth trailer ]   → "frame"
 L1   101000111010...  (bits on the wire)                  → "bits"

 RECEIVE (decapsulate, down → top): strip Eth → strip IP → strip TCP → hand HTTP up
```

**Nested envelopes.** Read it like postal mail: the HTTP request is the letter;
TCP is the envelope (with a port = which mailroom slot); IP is the shipping label
(source/dest address, routable worldwide); Ethernet is the local courier's tag
for the *next* building only. Each courier reads only its own label.

This is exactly why (from N03) **the IP stays constant end-to-end but the MAC is
rewritten at every hop**: routers strip and rebuild the L2 frame at each hop while
leaving the L3 packet's addresses intact.

### What each device can see

A device can only act on the headers it bothers to (and is allowed to) unwrap:

| Device | Unwraps up to | Can decide on | Cannot see |
|--------|---------------|---------------|------------|
| Switch (L2) | Ethernet | dest MAC | IP, port, URL |
| Router (L3) | IP | dest IP | port, URL |
| Stateful firewall (L3–L4) | TCP/UDP | IP + port + state | URL, payload (unless DPI) |
| L7 proxy / WAF | HTTP | URL, headers, cookies | (nothing — it's the top) |

If a device sits at L3, asking it to "block by URL" is asking it to read an
envelope it never opens. That single sentence resolves countless design arguments.

### Sizes, MTU, and overhead

Each header costs bytes. A standard Ethernet frame carries a **payload up to 1500
bytes — the MTU** (maximum transmission unit); 1500 is specifically the L3
payload/MTU, while the full frame on the wire is up to 1518 bytes (1500 payload +
14-byte Ethernet header + 4-byte FCS). Typical headers on the wire:

| Header | Typical size |
|--------|--------------|
| Ethernet | 14 bytes (+4 if VLAN-tagged, see N15) |
| IPv4 | 20 bytes (no options) |
| TCP | 20 bytes (no options) |

So over a 1500-byte MTU, TCP+IP eat 40 bytes, leaving **1460 bytes** of actual
application data per segment — the **MSS** (maximum segment size). If something
adds *more* headers — a VPN tunnel (IPsec/GRE) wraps the whole packet again — the
usable payload shrinks. Exceed the path's MTU and the packet must **fragment**, or
get dropped if the "don't fragment" bit is set. That's the root cause of the
classic "small pages load, big uploads hang over the VPN" bug.

## Worked example

`curl https://mobile.meridian.example/balance` from a laptop on Wi-Fi:

1. **L7** browser builds `GET /balance HTTP/2` + headers → *data*.
2. **L4** TCP wraps it: source port (ephemeral, e.g. 51514) → **dest port 443**,
   sequence numbers for ordering → *segment*.
3. **L3** IP wraps that: source `192.168.1.23` → dest (resolved by DNS, see N17),
   TTL, "don't fragment" maybe set → *packet*. **These IPs don't change** all the
   way to the server.
4. **L2** Ethernet/Wi-Fi wraps it for the **next hop only** — dest MAC = your
   default gateway's MAC (from ARP, see N05) → *frame*. The router strips this,
   looks up the dest IP, and builds a **new** L2 frame for *its* next hop.
5. **L1** bits on radio/fiber/copper.

Receiver reverses it: NIC reads the frame, strips Ethernet, IP confirms it's the
destination and strips its header, TCP reassembles segments in order and strips
its header, HTTP gets the clean request. Now picture step 3 going through
Meridian's **IPsec VPN** to HQ-DC1: the entire IP packet is encrypted and wrapped
in a *new* outer IP header — extra ~50–60 bytes — which is why VPN paths often run
a lower effective MTU (~1400) and why MSS-clamping exists.

## Do it (the exercise) [laptop]

1. Watch real encapsulation. Capture one request and read the layers (see N06):
   ```bash
   sudo tcpdump -ni any -c 5 -v 'tcp port 443'   # then trigger a request elsewhere
   ```
   Identify the IP header (src/dst, TTL) and the TCP header (ports, flags).
2. See your MTU and the headers' cost:
   ```bash
   ip link show            # look for "mtu 1500" on your interface
   ```
   Confirm the math: 1500 MTU − 20 (IPv4) − 20 (TCP) = **1460** MSS.
3. Find the path MTU by forcing "don't fragment" with growing payloads:
   ```bash
   ping -M do -s 1472 8.8.8.8     # 1472 + 8 (ICMP) + 20 (IP) = 1500 → should pass
   ping -M do -s 1473 8.8.8.8     # one byte over → "message too long" / dropped
   ```
   The largest size that passes reveals the path MTU — exactly how you'd diagnose a
   VPN/tunnel fragmentation problem.

## Say it back (self-check)

1. Name the unit (data/segment/packet/frame) at each of L7, L4, L3, L2.
2. What's the difference between encapsulation and decapsulation, and where does
   each happen?
3. Why can a router block by IP but not by URL?
4. With a 1500-byte MTU and no options, what's the TCP MSS, and why?
5. Why does sending traffic through a VPN tunnel reduce usable payload, and what
   symptom does an MTU mismatch produce?

## Talk to the IT/security head

**Ask:**
- "What's the path MTU across the VPN/interconnect, and do we clamp MSS?" *(reveals
  whether they've been bitten by fragmentation)*
- "Where in the path is traffic decapsulated and re-encapsulated?" *(tunnel
  endpoints, NAT, proxies — each is an inspection/break point)*
- "At what layer does each inline device inspect — and therefore what can it
  filter on?"

**A good answer sounds like:** they know their tunnel overhead and MTU/MSS
settings cold ("interconnect is 1500, the IPsec backup is clamped to 1350"), and
they can place each device's inspection depth on the right layer.

**Red flags:** "MTU is whatever the default is"; unexplained intermittent failures
on large transfers (classic unacknowledged fragmentation); or expecting an L3/L4
firewall to filter on URLs.

## Pitfalls & war stories

- "Small requests work, big uploads hang over the VPN" — almost always MTU/MSS
  and a blocked ICMP "fragmentation needed" message breaking Path MTU Discovery.
- Stacking tunnels (VPN inside VPN, or VXLAN + IPsec) and running out of MTU,
  silently fragmenting everything and tanking throughput.
- Believing encryption hides the addressing — the **outer** IP/port are still
  visible; only the inner payload is protected. Metadata leaks at the envelope.

## Going deeper (optional)

- RFC 1191 (Path MTU Discovery) and the role of ICMP "fragmentation needed."
- Revisit after N05 (where the L2 MAC in step 4 comes from via ARP) and N36
  (IPsec, where the extra outer header lives).

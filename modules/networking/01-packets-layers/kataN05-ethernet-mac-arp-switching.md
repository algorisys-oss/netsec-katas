# Kata N05 — Ethernet, MAC, ARP, switching (the local segment)

> **Track:** Networking · **Module:** N1 Packets & layers · **Prereqs:** N03, N04 · **Time:** ~30 min
> **Tags:** `networking` `ethernet` `mac` `arp` `switching` `l2-data-link` `broadcast-domain`

## Why it matters

Everything routable starts and ends on a **local segment** — a single broadcast
domain where machines talk by MAC address, not IP. This is where VLANs,
segmentation, "why can't these two VMs see each other," and a whole class of
attacks (ARP spoofing, MAC flooding) live. Architects skip L2 as "the cabling
layer," then can't follow a segmentation discussion or understand why a cloud
subnet behaves like a switch. Get the local segment right and L3 routing, VLANs
(N15), and micro-segmentation (N27) all click into place.

## The mental model

A **switch** connects hosts into one **broadcast domain** (a LAN segment). Within
it, delivery is by **MAC address** (L2). To leave the segment, you go through the
**default gateway** (a router, L3). The problem every host faces constantly:

> "I have the destination **IP**. To put it in an Ethernet frame I need the
> destination **MAC**. How do I find it?" — that's **ARP**.

### ARP: IP → MAC resolution

```
 Host A (10.10.1.5) wants to send to 10.10.1.9 (same subnet):

 A broadcasts:  "Who has 10.10.1.9? Tell 10.10.1.5"   ─┐ ARP request
                (dest MAC = ff:ff:ff:ff:ff:ff = all)   │ (everyone hears it)
                                                        ▼
 10.10.1.9 replies (unicast): "10.10.1.9 is at 00:1a:2b:3c:4d:5e"
                                                        │
 A caches it in its ARP table, then sends the frame ───┘ to that MAC.
```

Two cases, and telling them apart is the whole game:

| Destination is… | Host resolves the MAC of… | Why |
|-----------------|---------------------------|-----|
| **Same subnet** | the destination host itself | direct delivery on the segment |
| **Different subnet** | the **default gateway** | router forwards it onward (then re-ARPs on the next segment) |

The host uses its **subnet mask** (see N08) to decide "same subnet or not." This
is the bridge to the next module: ARP is *why* the subnet mask matters in practice.

### How a switch learns (MAC address table)

A switch is not magic — it builds a **MAC table** by watching source addresses:

1. Frame arrives on port 3 with source MAC `aa:aa`. Switch learns: `aa:aa → port 3`.
2. Frame for dest `bb:bb` it hasn't learned yet → **flood** out all ports.
3. `bb:bb` replies; switch learns `bb:bb → port 7`. Future frames are **forwarded**
   only out port 7, not flooded.

**Broadcast domain vs collision domain:** modern switches give each port its own
collision domain (full-duplex, no collisions), but all ports share one
**broadcast domain** — an ARP/broadcast reaches every host on the switch (and
across trunked switches in the same VLAN). VLANs (N15) slice one switch into
multiple broadcast domains; routers separate them at L3.

### Addresses, concretely

- A **MAC** is 48 bits, shown as `00:1a:2b:3c:4d:5e`. First 24 bits = **OUI**
  (vendor), so `00:50:56` = VMware, `02:42` = Docker-assigned. Locally-administered
  addresses (cloud/virtual NICs) set the 2nd-least-significant bit of the first byte.
- `ff:ff:ff:ff:ff:ff` = broadcast (all hosts on the segment).
- MAC is **flat and local** — it has no hierarchy and never routes between
  networks. That's why we need IP (L3) on top.

## Worked example

A teller PC `10.10.1.5/24` in a Meridian branch sends to two destinations:

**Case 1 — print server `10.10.1.40` (same /24 subnet):**
1. `10.10.1.40` is in `10.10.1.0/24` → same subnet → ARP for the *server's* MAC.
2. ARP broadcast on the segment; server replies; PC caches `10.10.1.40 → 00:1a:..`.
3. Frame sent directly to that MAC via the branch switch.

**Case 2 — core banking API `10.10.50.10` (different subnet):**
1. `10.10.50.10` is **not** in `10.10.1.0/24` → off-subnet → ARP for the **default
   gateway** `10.10.1.1` instead.
2. PC frames the packet to the *gateway's* MAC (dest IP is still `10.10.50.10`).
3. The router strips the L2 frame, looks up `10.10.50.10`, ARPs on the next
   segment, and builds a **new** frame — exactly the per-hop MAC rewrite from N03/N04.

See it on a real machine:
```
$ ip neigh                       # the ARP/neighbor cache: IP ↔ MAC ↔ port-ish
10.10.1.1   dev eth0 lladdr 00:1a:2b:3c:4d:5e REACHABLE   ← the gateway
10.10.1.40  dev eth0 lladdr 00:50:56:aa:bb:cc STALE       ← a same-subnet host
```
Note the gateway entry is always there — every off-subnet packet needs it.

## Do it (the exercise) [laptop]

1. Inspect your own L2 state:
   ```bash
   ip link            # your MAC address(es) — find the OUI, identify the vendor
   ip neigh           # ARP cache: which IPs you've recently resolved to MACs
   ip route           # the default gateway your off-subnet traffic uses
   ```
   Confirm: your default gateway appears in `ip neigh` with both an IP and a MAC.
2. Watch ARP happen live (see N06 for tcpdump):
   ```bash
   ip neigh flush all                      # clear the cache (may need sudo)
   ping -c 1 <a-same-subnet-host>          # forces a fresh resolution
   sudo tcpdump -ni any arp                # see "who-has / is-at" in another shell
   ```
3. Prove the same-vs-different-subnet rule: `ping` a host on your subnet and one
   off it, then check `ip neigh`. The off-subnet ping should have refreshed the
   **gateway's** entry, not the remote host's.

## Say it back (self-check)

1. What problem does ARP solve, and what does the request/reply look like?
2. When a host sends off-subnet, whose MAC does it put in the frame — and why?
3. How does a switch learn which MAC is on which port, and what does it do with a
   frame for an unknown MAC?
4. Difference between a broadcast domain and a collision domain on a modern switch?
5. Why can't a MAC address route across the internet the way an IP can?

## Talk to the IT/security head

**Ask:**
- "How big are the broadcast domains / VLANs on the branch and DC switches?" *(huge
  flat L2 = broadcast storms and a wide blast radius)*
- "Do you have any L2 protections — DAI (dynamic ARP inspection), port security,
  DHCP snooping?" *(defends against ARP spoofing / rogue devices)*
- "Where's the L2/L3 boundary — what's switched vs routed?" (ties to N15)

**A good answer sounds like:** segments are sized deliberately and bounded by VLANs
with L2 hardening enabled on access ports ("DAI + DHCP snooping on, port-security
limits MACs per port, no flat /16 broadcast domains").

**Red flags:** one enormous flat L2 segment "because it's simpler"; no ARP/port
protections (trivial ARP-spoof man-in-the-middle); or nobody can say where L2 ends
and L3 begins.

## Pitfalls & war stories

- **ARP spoofing:** ARP has no authentication, so a malicious host can answer
  "I'm the gateway" and intercept traffic. This is the L2 reason segmentation and
  DAI matter — a security problem hiding in "the cabling layer."
- **Flat L2 blast radius:** a single broadcast domain means one compromised host
  reaches every neighbor directly (no router/firewall to cross). Connects straight
  to N01's blast-radius lever and N27's micro-segmentation.
- Assuming a cloud subnet is "just like on-prem L2." It mostly *behaves* like one
  broadcast domain to you, but the provider fabric handles ARP/forwarding —
  promiscuous sniffing and gratuitous-ARP tricks generally don't work there.
- Duplicate MACs after sloppy VM cloning → intermittent, maddening connectivity.

## Going deeper (optional)

- RFC 826 (ARP) — it's short; read the request/reply format once.
- Revisit alongside N08 (the subnet mask that drives the same-vs-different
  decision) and N15 (VLANs that carve broadcast domains).

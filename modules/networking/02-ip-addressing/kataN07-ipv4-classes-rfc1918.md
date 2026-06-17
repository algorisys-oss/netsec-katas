# Kata N07 — IPv4, address classes & private ranges (RFC 1918)

> **Track:** Networking · **Module:** N2 IP addressing & subnetting · **Prereqs:** N03, N05 · **Time:** ~30 min
> **Tags:** `networking` `ipv4` `rfc1918` `l3-network` `cidr` `on-prem` `fsi` `meridian-bank`

## Why it matters

Every network conversation you'll have — from "why can't the app reach the
database?" to "can we peer these two VPCs?" — traces back to IP addresses. The
IT head thinks in RFC 1918 ranges and supernets; cloud architects think in CIDR
blocks. If you don't know what `10.100.0.0/14` means, or why `192.168.x.x`
cannot route across the internet, you can't follow the conversation — let alone
challenge a design. This kata also plants the seed for the **overlap problem**
(the #1 cause of hybrid-cloud pain), which comes back in N11 and N41.

## The mental model

### Part 1 — Why IP addresses exist at all

In N05 (see Kata N05) you learned that MAC addresses work on a local segment but
are rewritten at every hop. What stays *constant* across all those hops is the
**IP address**. IP (Layer 3) gives every device a logically assigned, routable
identity. Two big jobs:

1. **Identify** the source and destination (like a postal address on an envelope).
2. **Allow routing** — intermediate devices (routers) read the IP and decide *next
   hop* without knowing the full path.

An IPv4 address is 32 bits, written as four decimal octets (0–255):

```
  192   .  168   .   1   .  42
 8 bits   8 bits   8 bits   8 bits  → 32 bits total
```

### Part 2 — Classful addressing (history that still haunts you)

Before CIDR (pre-1993), the internet used *classes* to carve up the 32-bit space.
This is taught here because you'll still hear "Class A" and "Class C" from senior
network engineers — it's their vocabulary.

```
 Class  First octet   Default mask     # networks   Hosts/network
 ─────────────────────────────────────────────────────────────────
   A    1  – 126      255.0.0.0  /8       126        16,777,214
   B    128 – 191     255.255.0.0  /16   16,384          65,534
   C    192 – 223     255.255.255.0 /24  2,097,152           254
   D    224 – 239     (multicast, not host addresses)
   E    240 – 255     (reserved / experimental)
```

Special cases carved out of Class A:
- `127.0.0.0/8` — loopback (127.0.0.1 = "this device itself")
- `0.0.0.0` — "any address" / unspecified

**Why classes were abandoned:** they wasted space. A company needing 500 hosts
got a full Class B (65,534 addresses). The internet would have run out of addresses
in the mid-1990s. CIDR (Kata N08) fixed this by letting the prefix length be
*anything* (`/17`, `/22`, `/27`…), not just `/8`, `/16`, or `/24`.

### Part 3 — The internet / private split (the key insight)

The 32-bit address space was designed assuming every device would have a unique,
globally routable address. That ran out quickly. The fix came in two parts:

1. **RFC 1918 (1996)** — reserved three blocks as *private*: only meaningful inside
   your network; routers on the public internet **must drop** packets with these
   source or destination addresses. This is not a convention — it's a hard rule.

2. **NAT (Network Address Translation, N16)** — lets many private addresses share
   one public IP for outbound internet traffic. This is how billions of devices
   survive on a few billion public IPs.

```
 RFC 1918 private ranges — the three blocks you must memorize:

  10.0.0.0   – 10.255.255.255     10.0.0.0/8     ~16.7 M addresses
  172.16.0.0 – 172.31.255.255     172.16.0.0/12  ~1.0 M addresses
  192.168.0.0– 192.168.255.255    192.168.0.0/16 ~65,536 addresses
```

A fourth range is also non-routable on the public internet:

```
  100.64.0.0 – 100.127.255.255    100.64.0.0/10  ~4.2 M addresses
  (RFC 6598 — Carrier-Grade NAT / shared address space; see N11)
```

### Part 4 — The public internet is what's left

Everything not in those ranges (and not the special-purpose blocks above) is
*public* address space — globally unique, routed by BGP (N14), issued by IANA
and the regional registries (ARIN, RIPE, APNIC, etc.).

Your bank's external web IP, a cloud load balancer's frontend IP, and Google's
`8.8.8.8` are all public. The servers *behind* Meridian Bank's firewall are all
`10.x.x.x` — unreachable from the internet directly, by design.

```
  Meridian Bank HQ (10.10.0.0/16) ──── firewall ──── public internet
                   ▲                       ▲
           private / RFC 1918         NAT translates outbound
           stays inside               to the bank's public IP
```

## Worked example

Meridian Bank's IP plan (from `reference/running-example.md`) uses `10.0.0.0/8`
as its enterprise supernet, carved into `/16` blocks per site:

```
 Supernet: 10.0.0.0/8 (entire Class A block → ~16.7 M addresses)

  10.10.0.0/16  — HQ-DC1         (65,534 usable in this block)
  10.20.0.0/16  — DC2 / DR
  10.30.0.0/16  — 220 branches   (further subnetted per branch → N09)
  10.40.0.0/16  — corp offices

  Cloud (non-overlapping — this matters for VPN/Interconnect):
  10.100.0.0/14 — GCP (covers 10.100.0.0 – 10.103.255.255)
  10.104.0.0/14 — AWS (covers 10.104.0.0 – 10.107.255.255)
  10.108.0.0/14 — Azure (reserved for later)
```

Verify that `10.100.0.0/14` indeed covers the range claimed:
- `/14` means 32 − 14 = 18 host bits → 2^18 = 262,144 addresses.
- Base: `10.100.0.0`. Last address: `10.100.0.0 + 262,143` = `10.103.255.255`. ✓

Why does Northwind FMCG have a headache? Their M&A sprawl left them with:
- Original Northwind: `10.50.0.0/16`
- Acquired Eastfield Foods: *also* `10.50.0.0/16`  ← **same range, different company**

When Northwind tried to connect both networks after the acquisition, routers
couldn't distinguish "10.50.1.45 at Northwind" from "10.50.1.45 at Eastfield."
Full diagnosis in Kata N11; the seed of the problem is right here.

## Cloud / vendor mapping (when applicable)

RFC 1918 ranges work the same in every cloud — they are private by definition.
The *implementation* of what "private" means differs:

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Private address space | RFC 1918 subnets, NAT at edge | VPC subnets — same RFC 1918 ranges | VPC subnets — same RFC 1918 ranges | VNet subnets — same RFC 1918 ranges |
| Public IP assignment | ISP-allocated block on firewall/router | Ephemeral or static external IP on instance/LB | Elastic IP (EIP) or auto-assigned public IP | Public IP resource (dynamic or static) |
| NAT for private→internet | Dedicated NAT device or firewall PAT | Cloud NAT gateway | NAT Gateway | Azure NAT Gateway |
| Loopback (127.0.0.1) | Configured on every OS | Same — not a cloud construct | Same | Same |
| Non-routable on internet | RFC 1918 packets dropped at border routers | RFC 1918 VPC addresses never leave GCP fabric | RFC 1918 VPC addresses never leave AWS fabric | RFC 1918 VNet addresses never leave Azure fabric |
| IP planning tooling | IPAM (Infoblox, etc.) | Internal ranges / IP address management in VPC network management | Amazon VPC IP Address Manager (IPAM) | IPAM in Azure Virtual Network Manager |

**GCP note:** in GCP, a VPC is *global* — subnets are regional, but VPC peering
and Shared VPC span regions without extra gateways. This means your IP plan must
be globally non-overlapping *within one VPC* from day one (see N39, N52).

**AWS note:** a VPC is *regional* — you pick the RFC 1918 CIDR when you create
it and cannot change the primary block later without adding secondary CIDRs.
Plan the range before you click "Create VPC."

**Azure:** (Azure: TODO) — VNet address space; same RFC 1918 principles apply.

## Do it (the exercise)

**[laptop — no cloud account needed]**

1. Find your own machine's IP and confirm it's RFC 1918:
   ```bash
   # Linux
   ip addr show | grep 'inet '

   # macOS
   ifconfig | grep 'inet '
   ```
   Is it in `10.x.x.x`, `172.16.x.x–172.31.x.x`, or `192.168.x.x`? It almost
   certainly is. Find your public IP and confirm it's *different*:
   ```bash
   curl -s https://api.ipify.org
   ```

2. Confirm that RFC 1918 addresses are unreachable from the public internet by
   trying to reach one directly:
   ```bash
   curl --connect-timeout 3 http://10.0.0.1
   # Expected: connection timeout (no route, or your own LAN's gateway)
   ```

3. Verify that `127.0.0.1` is always yourself:
   ```bash
   ping -c 2 127.0.0.1
   ```
   This never leaves the machine — it never even hits the NIC.

4. Check Meridian Bank's cloud range math by hand (or with Python):
   ```bash
   python3 -c "
   import ipaddress as i
   net = i.ip_network('10.100.0.0/14')
   print('First:', net.network_address)
   print('Last: ', net.broadcast_address)
   print('Size: ', net.num_addresses)
   "
   # Expected: First 10.100.0.0 / Last 10.103.255.255 / Size 262144
   ```

5. Paper exercise: Northwind wants to give each of its ~3,000 retail points a
   unique `/24` (254 usable hosts) so no two sites collide. How many `/24` subnets
   fit inside a `/16`? (Answer: 2^(24−16) = 256 — nowhere near 3,000.) So a `/16`
   is far too small. Work out what you actually need:
   - To hold 3,000 unique `/24`s you need at least a `/13` (2^(24−13) = 2,048 `/24`s
     — still short) or a `/12` (2^(24−12) = 4,096 `/24`s — enough). From the
     `10.0.0.0/8` supernet, a `/12` such as `10.16.0.0/12` would do it.
   - Or shrink the per-site prefix: a `/27` gives 30 usable hosts (plenty for a tiny
     store). A `/16` holds 2^(27−16) = 2,048 `/27`s — still short of 3,000; a `/15`
     holds 4,096. Right-sizing the per-site prefix is cheaper than burning a `/24`
     on a shop with five devices.

   The lesson: counting subnets, not eyeballing block size, is what tells you
   whether a plan fits. N09 carves the full per-site plan; the math here is why a
   single `/16` can't be the answer for 3,000 sites.

## Say it back (self-check)

1. What are the three RFC 1918 private ranges? What does "private" mean in
   practice — what happens if a packet with a RFC 1918 source reaches the internet?
2. What did classful addressing use Class A, B, and C for? Why was it abandoned?
3. What does `127.0.0.1` do, and why does a ping to it never leave the machine?
4. Meridian Bank's GCP range is `10.100.0.0/14`. What is the last address in
   that block? How many total addresses does it contain?
5. Why must Meridian Bank's on-prem ranges (`10.10–10.40`) and cloud ranges
   (`10.100+`) be non-overlapping? What breaks if they overlap?

## Talk to the IT/security head

**Ask:**

- "What's your enterprise IP supernet — and how is it carved up by site and
  function?" *(Reveals whether they have an IP plan at all. The good answer names
  a supernet and allocation policy.)*
- "Are any of your sites still on `192.168.x.x` defaults?" *(Red flag if yes and
  they're planning a VPN or cloud hybrid — SOHO gear defaults create overlap
  instantly.)*
- "Are your on-prem and cloud ranges non-overlapping end to end?" *(The single
  most important question before any hybrid/VPN/interconnect design.)*
- "Do you have an IPAM tool, or is the IP plan a spreadsheet?" *(At scale — 220
  branches, 3 clouds — a spreadsheet is a risk. Infoblox, NetBox, and cloud-native
  IPAM are the answers.)*
- "Have you ever done an M&A where both companies used the same `10.x` range?"
  *(If yes, follow with "how did you resolve it?" — the answer tells you how
  mature their network ops are.)*

**A good answer sounds like:** a named supernet with a documented allocation
scheme, confirmed non-overlap between on-prem and all cloud environments, and
an IPAM tool or at minimum a single authoritative spreadsheet owned by NetOps.
The IT head should be able to say "our cloud ranges start at 10.100+ precisely
*because* we reserved that range before we deployed anything."

**Red flags:**
- "We just used what the cloud defaulted to" — almost always `172.31.0.0/16`
  in AWS. That overlaps on-prem only if the corporate network uses the part of
  `172.16.0.0/12` that includes `172.31` (a site on `172.16.0.0/24` alone does
  *not* collide). Many enterprises do carve broadly from `172.16.0.0/12`, so the
  risk is real — but check the actual on-prem allocation before assuming pain.
- "We have multiple teams managing IPs separately" — overlap waiting to happen.
- Inability to state the enterprise supernet — means there isn't one.
- "We'll sort out the IPs when we get to the VPN" — that conversation will be
  a painful rework.

## Pitfalls & war stories

- **The AWS default VPC trap:** AWS creates a default VPC at `172.31.0.0/16`
  (with default `/20` subnets) in every region. Many teams run workloads in it for
  months, then try to connect it to on-prem — only to discover their corporate
  network already uses the `172.31` portion of `172.16.0.0/12`, so the two collide.
  The VPC's primary CIDR cannot be re-addressed; they end up NATting between the two,
  which breaks source-IP-based controls. Delete the default VPC before workloads
  land in it.

- **Branch offices on `192.168.1.x`:** Northwind's retail points came with SOHO
  routers defaulting to `192.168.1.0/24`. All 3,000 of them. Every site looks the
  same to the routing table. SD-WAN vendors solve this with overlapping-NAT tricks,
  but it's fragile. A proper IP plan before rollout would have carved a block big
  enough to give every site a unique range — and that takes more than a `/16`:
  3,000 unique `/24`s need at least a `/12` (4,096 `/24`s), or you give each site
  a smaller prefix (e.g. a `/27`, sized to the handful of devices in a shop) out of
  a suitably large block. (Note: `10.50.0.0/16` is Northwind's *original company*
  supernet — and the very range that collided with acquired Eastfield Foods — not a
  spare pool for branches.) Counting before allocating is exactly what N09 teaches.

- **"We're RFC 1918, so we're safe" fallacy.** Private addresses are not a security
  control — they are a routing boundary. An attacker already inside your network
  can reach `10.10.x.x` just fine. Segmentation (N27) and firewall rules (N26)
  are the security controls. The IT head who says "we're on 10.x, so it's secure"
  is conflating routing with security.

- **Forgetting loopback in firewall rules.** Applications that bind to `127.0.0.1`
  are unreachable from the network — which is either intentional (internal API
  sidecar) or a bug (forgot to bind to `0.0.0.0`). Know the difference.

- **IP exhaustion inside a /16.** Meridian's `10.10.0.0/16` has 65,534 usable
  addresses — sounds huge. But if you allocate `/24` subnets per function and have
  hundreds of subnets, waste adds up. VLSM (Variable Length Subnet Masking, N09)
  is the answer: right-size each subnet rather than defaulting to `/24` everywhere.

## Going deeper (optional)

- **RFC 1918** — "Address Allocation for Private Internets" (1996). Short, readable.
  The canonical source for the three private ranges.
- **RFC 1519** — the original CIDR specification (1993). Read alongside N08.
- **RFC 6598** — Shared Address Space (`100.64.0.0/10`): the "fourth" private-ish
  range used by ISPs for CGNAT. Revisited in N11.
- **RFC 5735** — Special-Use IPv4 Addresses: the full list of reserved blocks
  (loopback, link-local `169.254.x.x`, TEST-NET, etc.).
- **IANA IPv4 Special-Purpose Address Registry** —
  `https://www.iana.org/assignments/iana-ipv4-special-registry/` — authoritative,
  kept current.
- Next: **N08** (CIDR & subnet masks: the math) builds directly on this kata.
  N09 applies it to carve Meridian Bank's full address plan.

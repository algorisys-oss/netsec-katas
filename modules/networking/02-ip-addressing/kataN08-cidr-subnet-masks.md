# Kata N08 — CIDR & subnet masks: the math, by hand

> **Track:** Networking · **Module:** N2 IP addressing & subnetting · **Prereqs:** N07 · **Time:** ~35 min
> **Tags:** `networking` `cidr` `subnetting` `ipv4` `l3-network` `first-principles` `meridian-bank` `northwind`

## Why it matters

Every firewall rule, every cloud subnet, every routing decision names a network in
CIDR notation: `10.10.0.0/16`, `10.100.64.0/20`. If you cannot read those numbers
and instantly know the range they cover, you are guessing — and guesses in security
rules create either accidental exposure or mysterious breakage. The IT head will
draw a network diagram covered in `/24`s and `/26`s. The cloud console asks you to
enter a CIDR block before you create a single subnet. This is the arithmetic behind
all of that, done once by hand so you never have to reach for a calculator in the
room.

## The mental model

### 1. An IP address is 32 bits

```
  10   .  10   .   1   .   0
00001010.00001010.00000001.00000000
```

Four octets, eight bits each, written as decimals for human readability. Every
address is really just a 32-bit integer.

### 2. A subnet mask says "how many leading bits are the network"

The `/n` in `a.b.c.d/n` is a count of leading **1** bits. Everything to the left
of that boundary is the **network prefix** — it's the same for every host in the
subnet. Everything to the right is the **host part** — it identifies the
individual device.

```
  10.10.1.0 / 24

  00001010.00001010.00000001 | 00000000
  ←────── network (24 bits) ─────────→ ←─ host (8 bits) ─→

  Subnet mask:   11111111.11111111.11111111.00000000
              =  255      .255     .255     .0
```

The subnet mask is just those leading 1s written out as four octets.

### 3. Three numbers define every subnet

Given a CIDR block you can derive everything else:

```
  Network address   — host bits all 0     → first address in the block
  Broadcast address — host bits all 1     → last address in the block
  Usable hosts      — 2^(32 − n) − 2     → subtract network + broadcast
```

Exception: `/31` (RFC 3021 point-to-point links) and `/32` (single host) have no
broadcast in the usual sense.

### 4. The /n↔mask↔size facts you must have in your head

| /n | Subnet mask | Block size | Usable hosts |
|----|-------------|------------|--------------|
| /8  | 255.0.0.0       | 16,777,216 | 16,777,214 |
| /16 | 255.255.0.0     | 65,536     | 65,534     |
| /24 | 255.255.255.0   | 256        | 254        |
| /25 | 255.255.255.128 | 128        | 126        |
| /26 | 255.255.255.192 | 64         | 62         |
| /27 | 255.255.255.224 | 32         | 30         |
| /28 | 255.255.255.240 | 16         | 14         |
| /29 | 255.255.255.248 | 8          | 6          |
| /30 | 255.255.255.252 | 4          | 2          |

**The block-size shortcut (for /25 and below):** `block size = 256 − last-octet mask value`.
For /26 the mask's last octet is 192, so block size = 256 − 192 = **64**. Subnets
land at 0, 64, 128, 192 in that octet, and nowhere else.

### 5. "Is this IP in that subnet?" — the AND test

To check whether `10.10.1.75` belongs to `10.10.1.64/26`:

```
  IP address:    10.10.1.75   = ...01001011
  Subnet mask:   255.255.255.192  last octet = 11000000
  AND result:    10.10.1.64   = ...01000000   ← matches network address ✓
```

Binary AND of the IP with the mask must equal the network address. Here it does:
`10.10.1.75` is in `10.10.1.64/26` (range .64–.127).

## Worked example

Meridian Bank's HQ-DC1 owns `10.10.0.0/16` (see `reference/running-example.md`).
The network team has carved out the block `10.10.1.0/24` for the PCI-scoped server
tier. The security architect asks: "Can we split that /24 into four equal pieces to
separate web, app, DB, and management?"

**Step 1 — how many host bits do I need to steal to get 4 subnets?**

Four subnets = 2² → steal **2 bits** from the host portion.

```
  Original /24 host bits:  8
  Bits borrowed:           2
  New prefix:             /24 + 2 = /26
  Number of /26 subnets:   2² = 4
  Hosts per subnet:        2^(8−2) − 2 = 64 − 2 = 62
```

**Step 2 — enumerate the four /26 subnets**

Block size for /26 = 256 − 192 = **64**. Subnets start at multiples of 64 in the
last octet:

```
  Subnet            Range                     Broadcast    Usable hosts
  ──────────────────────────────────────────────────────────────────────
  10.10.1.0/26      10.10.1.0  – 10.10.1.63   10.10.1.63   .1 – .62
  10.10.1.64/26     10.10.1.64 – 10.10.1.127  10.10.1.127  .65 – .126
  10.10.1.128/26    10.10.1.128– 10.10.1.191  10.10.1.191  .129 – .190
  10.10.1.192/26    10.10.1.192– 10.10.1.255  10.10.1.255  .193 – .254
```

**Step 3 — assign by function**

```
  10.10.1.0/26    → Web tier (internet-facing, PCI out-of-scope side)
  10.10.1.64/26   → App tier (application servers, PCI in-scope)
  10.10.1.128/26  → DB tier (cardholder data, PCI CDE — strictest rules)
  10.10.1.192/26  → Management (bastion/jump hosts, monitoring agents)
```

Now each zone has its own subnet and the firewall can state rules precisely:
"allow `10.10.1.64/26` to reach `10.10.1.128/26` on port 5432 (PostgreSQL); deny
all other sources." Without the subnets, the rule would have to name individual
IPs — fragile and audit-unfriendly.

**The Northwind contrast:** Northwind runs on `10.50.0.0/16`, and its acquired
"Eastfield Foods" also used `10.50.0.0/16` — both even put their server tier on
`10.50.1.0/24`. When Northwind tried to connect the two networks after the M&A,
both sides claimed the same addresses — classic overlap. Packets routed to
`10.50.1.80` could land on either company's server depending on which routing
table was consulted. There is no CIDR trick that fixes overlap in place; one side
must renumber. (Full treatment in N11.)

## Cloud / vendor mapping (when applicable)

CIDR is universal — the notation is the same on-prem and in every cloud. The
differences are in **what the cloud reserves** from each subnet and **where you
enter the block**:

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Define a network | router/switch, IPAM | VPC (global) with a primary CIDR | VPC (regional) with a CIDR block | VNet with an address space |
| Define a subnet | VLAN + IP plan | Regional subnet, `/29` minimum | AZ subnet, `/28` minimum | Subnet, `/29` minimum |
| Addresses reserved per subnet | 2 (network + broadcast) | **4** (.0, .1, second-to-last, last) | **5** (.0, .1, .2, .3, last) | **5** (.0, .1, .2, .3, last) |
| Usable hosts in a /26 (64 addrs) | 62 | 60 | 59 | 59 |
| Smallest routable subnet | /32 host route | /29 subnet | /28 subnet | /29 subnet |
| CIDR notation required? | usually dotted-decimal mask | yes, CIDR only | yes, CIDR only | (Azure: TODO) |

The reserved-address gap matters when you size tight subnets. A cloud `/28` (16
addresses) gives you only 11 usable hosts in AWS — easy to undersize if you forget
the five reserved slots. Taught in depth in N40.

## Do it (the exercise)

### Part A — pencil-and-paper math [laptop]

For each of the following, write the network address, broadcast address, and the
full usable host range **before** running any tool to verify:

1. `10.10.5.0/24`
2. `10.10.5.128/25`
3. `10.10.5.192/26`
4. `10.30.16.0/20` (a Meridian branch block — what's the host range?)

Check your answers:
```bash
python3 -c "
import ipaddress as i
for cidr in ['10.10.5.0/24','10.10.5.128/25','10.10.5.192/26','10.30.16.0/20']:
    n = i.ip_network(cidr)
    print(f'{cidr}: {n.network_address} – {n.broadcast_address}  ({n.num_addresses} addrs, {n.num_addresses-2} usable)')
"
```

### Part B — subnet split [laptop / paper]

Meridian Bank's DC2 block is `10.20.0.0/16`. The network team wants to carve a
`/22` for a new application cluster.

1. How many addresses does a `/22` provide? How many usable hosts?
2. List the first four valid `/22` subnets within `10.20.0.0/16`.
3. If they take `10.20.4.0/22`, is `10.20.5.200` inside it? Show the AND test
   (or use Python).

```bash
# Verify Part B
python3 -c "
import ipaddress as i
net = i.ip_network('10.20.0.0/16')
subs = list(net.subnets(new_prefix=22))
print('First four /22s:', subs[:4])
candidate = i.ip_address('10.20.5.200')
block = i.ip_network('10.20.4.0/22')
print('10.20.5.200 in 10.20.4.0/22:', candidate in block)
"
```

### Part C — mask-to-CIDR recognition [paper]

A network engineer emails you a firewall rule with the mask written out:

```
permit tcp 10.10.1.64 0.0.0.63 any eq 443
```

The `0.0.0.63` is a **wildcard mask** (Cisco ACL style — the inverse of a subnet
mask). Convert it: `255 − 63 = 192` → last-octet mask 192 → that is a `/26`. The
source is `10.10.1.64/26`. Now you can read it: "allow any host in the
app-tier subnet to reach anywhere on HTTPS." [laptop: no tool needed; practice
reading it on paper first]

## Say it back (self-check)

1. A subnet is `10.10.5.64/27`. State the network address, broadcast address,
   usable host range, and the subnet mask in dotted-decimal form.
2. You need 100 hosts. Which prefix length is the smallest that fits? (Show the
   host-bit calculation.)
3. An IT head says "we put everything in a /16." What does that mean for blast
   radius if a host is compromised?
4. How many /26 subnets can you carve from a /22? (Hint: how many bits change?)
5. Why does a /26 in AWS give you only 59 usable host addresses, not 62?

## Talk to the IT/security head

**Ask:**

- "What CIDR block is assigned to this zone, and does it overlap with any other
  site or cloud region?" *(N11 teaches why overlap is the M&A nightmare — probe
  early)*
- "Are your cloud VPC subnets sized to last three years, or will you have to
  tear them down and rebuild when you run out of IPs?" *(cloud subnets cannot be
  resized in place in AWS; GCP allows expanding but not arbitrary edits)*
- "Is this /24 a single flat network, or is it subnetted by function/tier?"
  *(a flat /24 with web, DB, and management all on the same broadcast domain is a
  PCI-DSS finding waiting to be issued)*
- "Who owns the IP address management tool (IPAM), and how do teams request a
  new subnet?" *(at scale, ad-hoc subnetting creates overlap and wasted space;
  absence of IPAM = future pain)*

**A good answer sounds like:** the network team can pull up their IPAM and show
you the full allocation tree: which /16 is assigned to which site, how it's broken
into /24s, and how far down they've gone. They know the cloud CIDRs by heart and
can confirm they don't overlap with on-prem.

**Red flags:**

- "We just use /24 for everything" — sizes chosen by convention, not by actual
  host count; cloud subnets may be over-allocated or will run out.
- "I'll have to ask someone" for a basic IP range question — IPAM is not in place
  or ownership is unclear. Hybrid connectivity (VPN, Cloud Interconnect) will be
  painful.
- Any on-prem range that overlaps `10.100.0.0/14` (Meridian's GCP allocation) —
  the VPN will not route correctly without NAT hacks.

## Pitfalls & war stories

**The /24-everywhere trap.** Many shops default to /24 (254 hosts) for every
subnet, regardless of need. In cloud, where you pay nothing extra for the IP block
itself but may hit AWS's five-reserved-address penalty, small services end up on
/24s with 240+ wasted addresses — then the same team complains the VPC CIDR ran
out when they needed 300 subnets.

**Undersizing a cloud subnet on day one.** AWS subnets cannot be resized. If you
create a `/28` (11 usable) and later need to run 20 replicas of a service, you
must create a second subnet and update routing. GCP allows expanding a primary
subnet range, but secondary ranges are fixed. Size for three years of growth.

**Forgetting the broadcast address in firewall rules.** The broadcast address of a
subnet (e.g. `10.10.1.63` for `10.10.1.0/26`) should not be used as a host
address. Some older rule-generation tools include it; hosts ignore it, but auditors
flag it.

**The wildcard-vs-subnet-mask confusion.** Cisco ACLs use wildcard masks (inverse
of subnet mask). A Juniper/cloud engineer writes `10.10.1.0/26`; a Cisco ACL
engineer writes `10.10.1.0 0.0.0.63`. Same thing; different notation. Read which
format you're given before translating.

**Meridian Bank: the /20 block for a small DMZ.** A past project allocated
`10.10.20.0/20` (4,094 hosts) for a DMZ that held four servers. The wasted space
wasn't the real problem — every security scan of the "DMZ" also scanned 4,090
unused addresses and triggered false positives in the IDS. Size purposefully.

## Going deeper (optional)

- RFC 4632 — "Classless Inter-Domain Routing (CIDR): The Internet Address
  Assignment and Aggregation Plan." The definitive specification of the notation.
- RFC 1918 — private address allocations (taught in N07).
- RFC 3021 — using /31 prefixes for point-to-point links.
- `reference/cheatsheet-cidr.md` in this repo — quick-reference table; keep it
  open when reading N09 (VLSM) and N40 (cloud subnets).
- Follows up in N09 (VLSM: carving Meridian's full address plan) and N11
  (enterprise-scale overlap and the M&A problem Northwind inherited).

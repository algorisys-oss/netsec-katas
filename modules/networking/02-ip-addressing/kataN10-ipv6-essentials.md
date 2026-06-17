# Kata N10 — IPv6 essentials

> **Track:** Networking · **Module:** N2 IP addressing & subnetting · **Prereqs:** N07, N08, N09 · **Time:** ~35 min
> **Tags:** `networking` `ipv6` `l3-network` `cidr` `subnetting` `hybrid` `cloud` `fsi`

## Why it matters

IPv4's 4.3 billion addresses ran out long ago — IANA gave away the last /8 blocks
in 2011. That scarcity didn't kill the internet; it drove NAT everywhere (see N16),
which created its own pain. IPv6 solves address scarcity with a 128-bit space so
large it's practically infinite, but it also changes *everything* about how
packets are addressed, how ARP works, and how your cloud VPCs behave. Most
enterprise GCP and AWS environments today run dual-stack (IPv4 + IPv6 in parallel),
and Google's own infrastructure has been IPv6-native for years. When a bank's IT
head asks "are we IPv6-ready?" before a cloud migration, you need to know what
that question actually means and what it costs to say yes.

## The mental model

### Why 128 bits?

IPv4 = 32 bits = ~4.3 × 10⁹ addresses.
IPv6 = 128 bits = ~3.4 × 10³⁸ addresses.

That's not 4× bigger — it's roughly 79 octillion times bigger. The design intent:
every device on earth gets a globally unique, publicly routable address, making NAT
optional.

### IPv6 address notation

An IPv6 address is 128 bits, written as eight groups of four hex digits separated
by colons:

```
Full form:   2001:0db8:0000:0042:0000:0000:0000:0001
             ████ ████ ████ ████ ████ ████ ████ ████
              g1   g2   g3   g4   g5   g6   g7   g8
```

Two compression rules:
1. Leading zeros in each group may be dropped.
2. One (and only one) consecutive run of all-zero groups may be replaced by `::`.

```
Full:      2001:0db8:0000:0042:0000:0000:0000:0001
Drop zeros:2001:db8:0:42:0:0:0:1
Use :::    2001:db8:0:42::1
```

Verify a compression: expand `::` by filling as many `0000` groups as needed to
restore the total to eight groups.

### Prefix notation is still CIDR

```
2001:db8::/32     → first 32 bits are the network; 96 bits for hosts
2001:db8:a:b::/64 → first 64 bits are the network; 64 bits for hosts
```

A `/64` is the standard subnet size in IPv6 — it gives you 2⁶⁴ ≈ 18 quintillion
host addresses in a single subnet. That is intentional; it enables auto-config
(SLAAC, below).

### Special and reserved ranges (know these)

```
::/128              Unspecified address (like 0.0.0.0 in IPv4)
::1/128             Loopback (like 127.0.0.1)
fe80::/10           Link-local: auto-assigned, not routed beyond the link
fc00::/7            Unique Local Address (ULA): RFC 4193, like RFC 1918 private
                      → fc00::/8 and fd00::/8 sub-ranges; fd:: is commonly used
2000::/3            Global Unicast Address (GUA): routable on the public internet
                      → the space cloud providers and ISPs assign from
ff00::/8            Multicast (replaces IPv4 broadcast)
```

The key substitution for architects: **ULA (fd00::/8) ≈ RFC 1918 private**;
**GUA (2000::/3) ≈ public IPv4**. Cloud providers assign GUA space to VPCs.

### What replaces ARP? Neighbor Discovery Protocol (NDP)

IPv4 uses ARP (broadcast) to find the MAC for a known IP (see N05). IPv6 replaces
ARP with **Neighbor Discovery Protocol** (NDP, RFC 4861), which uses ICMPv6
*multicast* instead of broadcast:

```
  IPv4 ARP                     IPv6 NDP
  ─────────────────────────    ─────────────────────────────────────────────
  "Who has 10.10.0.5?"         "Solicited-node multicast for ...0005 →
  → L2 broadcast to all         please reply" (ICMPv6 type 135)
  → target replies unicast      → target replies unicast (type 136)
```

Multicast is more efficient than broadcast (only listeners on the solicited-node
multicast group receive the message, not all hosts). The solicited-node multicast
address is derived from the last 24 bits of the target's IPv6 address:
`ff02::1:ff<last 24 bits>`.

NDP also handles: router discovery, prefix advertisement, and duplicate address
detection (DAD).

### Stateless Address Autoconfiguration (SLAAC)

IPv6 hosts can configure themselves without DHCP:
1. The router multicasts its prefix via an NDP Router Advertisement (RA) to the
   all-nodes multicast group (`ff02::1`) — IPv6 has no broadcast.
2. The host combines the /64 prefix with its own EUI-64 (derived from the MAC) or
   a random Interface Identifier (privacy/temporary-address extensions,
   RFC 8981 — which obsoletes the older RFC 4941).
3. The host runs Duplicate Address Detection (DAD) to confirm uniqueness on link.

```
  Router sends RA:  prefix 2001:db8:a:b::/64
  Host MAC:         aa:bb:cc:dd:ee:ff
  EUI-64 IID:       a8bb:ccff:fedd:eeff
                    (insert fffe in the middle of the MAC, THEN flip the
                     Universal/Local bit — bit 7 of the first octet:
                     aa = 1010 1010 → 1010 1000 = a8)
  Full address:     2001:db8:a:b:a8bb:ccff:fedd:eeff/64
```

The U/L bit flip is the step learners most often forget: the first octet `aa`
becomes `a8`, not `aa`.

Privacy/temporary-address extensions (RFC 8981, obsoleting RFC 4941) generate a
random, rotating IID instead — important
for user-facing devices and mandated by some FSI compliance policies.

### Dual-stack: the practical reality

Most enterprise networks today run **dual-stack**: both IPv4 and IPv6 on every
interface. The host uses whichever protocol the destination supports (RFC 6555
"Happy Eyeballs" picks the faster one). This is the migration path — you don't
"switch" to IPv6 overnight; you enable it alongside IPv4 and let traffic shift.

```
  Dual-stack host
  ┌─────────────────────────────────────────────┐
  │  IPv4:  10.10.4.25/24     (RFC 1918)        │
  │  IPv6:  2001:db8:a:b::25/64   (GUA or ULA) │
  │  Link-local: fe80::1%eth0  (always present) │
  └─────────────────────────────────────────────┘
```

## Worked example

### Meridian Bank's GCP environment gets IPv6

Meridian's GCP VPC uses `10.100.0.0/14` for IPv4 (see `reference/running-example.md`).
GCP's external-IPv6 model is **per-subnet, not per-VPC**: you don't get a /48 GUA
to carve. When you enable a subnet with `--ipv6-access-type=EXTERNAL`, Google
assigns *that subnet* its own /64 GUA prefix from Google's pool — you don't pick
the bits, and the per-subnet /64s are not contiguous slices of a single /48:

```
Each EXTERNAL subnet gets its own /64 GUA, assigned by Google:

  mobile-backend subnet (us-central1-a):  2600:1900:4000:8a01::/64
  analytics subnet      (us-central1-b):  2600:1900:42f0:1c00::/64
  management subnet     (us-central1-c):  2600:1900:4111:3d00::/64
```

(The /48 GUA you might expect to carve does not exist in GCP's external model.
GCP *does* assign a /48 to the VPC — but that is the **internal ULA** range, from
which internal /64 subnets are derived; see the ULA discussion below.)

A VM in the mobile-backend subnet (`2600:1900:4000:8a01::/64`) gets:
- IPv4: `10.100.0.5/22` (internal)
- IPv6: `2600:1900:4000:8a01::5/64` (GUA, internet-routable)

Notice: the IPv6 address is **globally routable by default** — no NAT. This
changes the firewall model: the GCP VPC firewall (and any on-prem firewall for
hybrid paths) must explicitly block unwanted inbound IPv6.

### Northwind FMCG: ULA for internal segments

Northwind's AWS environment uses ULA for subnets that should never be directly
reachable from the internet — matching the "private by default" mental model their
IT head is used to from RFC 1918:

```
Northwind ULA block:  fd12:3456:789a::/48   (fd:: prefix, randomly chosen)

  plants subnet:       fd12:3456:789a:0001::/64
  distribution subnet: fd12:3456:789a:0002::/64
  corp offices:        fd12:3456:789a:0003::/64
```

ULA is never advertised to the internet — routers at the edge drop it — matching
the regulatory expectation that OT/plant networks are never directly exposed.

### Verify notation by hand

Expand the compressed address `2001:db8::1` to full form:
- Count groups: `2001`, `db8`, then `::`, then `1` → 3 explicit groups.
- `::` must fill 8 − 3 = 5 groups of zeros.
- Full: `2001:0db8:0000:0000:0000:0000:0000:0001`

Compress `2001:0db8:0000:0001:0000:0000:0000:0001`:
- Number the groups 1–8. The zero groups are group 3 (`0000`) and groups 5, 6, 7
  (`0000:0000:0000`); group 8 is `0001` (non-zero).
- Two runs of zeros: group 3 alone (length 1) and groups 5-7 (length 3). The
  second run is longer.
- Choose the longer run: groups 5-7 → replace with `::`.
- Result: `2001:db8:0:1::1`

## Cloud / vendor mapping

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| IPv6 address space | ISP assigns GUA /48; use ULA (fd::/8) internally | EXTERNAL: Google assigns each subnet its own /64 GUA from its pool (no per-VPC /48 to carve). INTERNAL: VPC gets a /48 ULA, internal /64 subnets derived from it | Amazon assigns /56 GUA per VPC; subnets get /64 from it | (Azure: TODO) |
| Dual-stack enablement | Native on modern routers; enable per-interface | Enable per-subnet ("Stack type: IPv4 and IPv6") on VPC creation or later | Enable per VPC + subnet; requires explicit IPv6 CIDR association | (Azure: TODO) |
| Replaces ARP | NDP (ICMPv6 RA/NS/NA) on the segment | Managed by GCP (hypervisor handles NDP) | Managed by AWS (VPC does not expose NDP) | (Azure: TODO) |
| Private addressing | ULA (RFC 4193, fd::/8) | ULA supported; GUA commonly used in internal subnets too | ULA supported for internal; VPC IPv6 CIDRs are GUA | (Azure: TODO) |
| SLAAC / DHCPv6 | SLAAC from router RA; DHCPv6 for stateful | Cloud VMs use metadata server; SLAAC not used | DHCPv6 for address assignment inside VPC | (Azure: TODO) |
| Firewall default for IPv6 | Explicit rules needed | GCP firewall rules apply to IPv6 separately; default deny | AWS Security Groups apply to IPv6; NACLs need explicit IPv6 rules | (Azure: TODO) |
| Link-local | fe80::/10, always present, not routed | Present on VM interfaces; used for router-VM communication | Present; AWS routes IPv6 via GUA, not link-local | (Azure: TODO) |

**Critical difference between GCP and AWS IPv6 approach:**
For *external* (internet-routable) IPv6, GCP assigns each subnet its own /64 GUA
from Google's pool — there is no per-VPC /48 GUA you carve, and you don't choose
the prefix bits. (GCP does allocate a /48 per VPC, but that is the *internal* ULA
range; internal /64 subnets are derived from it.)
AWS assigns a /56 per VPC (or you can use BYOIP for a /48), and each subnet gets
a /64 carved from that /56. The AWS /56 → /64 math: 2^(64−56) = 256 possible /64
subnets per VPC.

## Do it (the exercise)

### Part 1 — Address notation [laptop]

```bash
# Check if your machine has IPv6 (Linux/Mac)
ip -6 addr show          # Linux
ifconfig | grep inet6    # macOS

# You'll see fe80:: link-local addresses even on IPv4-only networks
# Look for the %eth0 or %en0 scope identifier — that's the link-local scope

# Expand/compress addresses with Python (no extra tools needed)
python3 - <<'EOF'
import ipaddress
addrs = [
    "2001:0db8:0000:0042:0000:0000:0000:0001",
    "fd12:3456:789a:0001:0000:0000:0000:0025",
    "::1",
    "fe80::1",
]
for a in addrs:
    expanded = ipaddress.ip_address(a).exploded
    compressed = ipaddress.ip_address(a).compressed
    print(f"  {a}")
    print(f"    expanded:   {expanded}")
    print(f"    compressed: {compressed}\n")
EOF
```

### Part 2 — Subnet arithmetic [laptop]

```bash
python3 - <<'EOF'
import ipaddress

# A /48 you DO carve into /64s: GCP's INTERNAL (ULA) VPC range, or an AWS BYOIP /48.
# (GCP EXTERNAL IPv6 is per-subnet /64 assigned by Google — nothing to carve.)
block = ipaddress.ip_network("fd20:1900:4000::/48")
print(f"Block: {block}")
print(f"Total /64 subnets available: {2**(64-48)}")   # 65,536

# Carve out first 5 /64 subnets (the subnet ID lives in the 4th hextet)
for i, subnet in enumerate(block.subnets(new_prefix=64)):
    if i >= 5:
        break
    print(f"  Subnet {i}: {subnet}  (first host: {list(subnet.hosts())[0]})")
EOF
```

### Part 3 — Ping over IPv6 [laptop]

```bash
# Ping the IPv6 loopback (always works)
ping6 ::1           # Linux
ping -6 ::1         # macOS/some Linux

# Ping a dual-stack public host
ping6 ipv6.google.com    # Linux
ping -6 ipv6.google.com  # macOS

# Check the route IPv6 traffic takes
traceroute6 ipv6.google.com    # Linux
traceroute -6 ipv6.google.com  # macOS
```

### Part 4 — Cloud IPv6 subnet [needs cloud account]

In GCP console (or `gcloud`):
```bash
# Enable IPv6 on an existing subnet (Stack type: IPv4 and IPv6)
# EXTERNAL = globally routable GUA, matching the worked example above.
# (Use INTERNAL only if you want ULA-style, non-internet-routable IPv6.)
gcloud compute networks subnets update meridian-mobile-subnet \
  --stack-type=IPV4_IPV6 \
  --ipv6-access-type=EXTERNAL \
  --region=us-central1

# Inspect the assigned IPv6 CIDR
gcloud compute networks subnets describe meridian-mobile-subnet \
  --region=us-central1 \
  --format="value(ipv6CidrRange,externalIpv6Prefix)"
```

In AWS:
```bash
# Associate an Amazon-provided IPv6 /56 with a VPC
aws ec2 associate-vpc-cidr-block \
  --vpc-id vpc-0abc1234 \
  --amazon-provided-ipv6-cidr-block

# Then associate a /64 with a subnet
aws ec2 associate-subnet-cidr-block \
  --subnet-id subnet-0def5678 \
  --ipv6-cidr-block 2600:1f18:abcd:1200::/64
```

## Say it back (self-check)

1. How many bits does an IPv6 address have, and how is it written? Compress
   `2001:0db8:0000:0001:0000:0000:0000:0001` by hand.
2. What does `::` mean in a compressed address, and how do you know how many
   zero groups it represents?
3. What is the IPv6 equivalent of RFC 1918 private addressing, and what prefix
   identifies it?
4. What protocol replaces ARP in IPv6, and why does it use multicast instead of
   broadcast?
5. What is SLAAC, and why does the standard subnet size of /64 make it possible?
6. Why does enabling IPv6 in a cloud VPC require reviewing firewall rules, even for
   subnets that were "private" under IPv4?

## Talk to the IT/security head

**Ask:**
- "Are your cloud VPCs dual-stack today, or IPv4-only? Do your firewall rule sets
  explicitly cover IPv6 traffic?"
  *(Many shops enabled IPv6 on subnets but forgot to mirror their IPv4 firewall
  rules to IPv6 — leaving IPv6 paths wide open.)*

- "What is your IPv6 address plan for cloud — GUA assigned by the provider, ULA,
  or BYOIP?"
  *(A good IT head knows which approach they use and why; BYOIP signals mature
  address management.)*

- "Do your on-prem firewalls and IDS/IPS support IPv6 inspection?"
  *(Many older appliances inspect IPv4 but pass IPv6 unexamined — a known attack
  vector called "IPv6 tunneling.")*

- "Are you using privacy/temporary-address extensions (RFC 8981) on end-user
  devices?"
  *(In FSI, regulators sometimes ask to correlate a session to a device; random
  rotating IIDs can complicate that audit trail.)*

**A good answer sounds like:** "We're dual-stack on GCP; for external IPv6 Google
assigns each subnet its own /64 GUA from its pool (the /48 we hold is the internal
ULA range). Our firewall rules are mirrored for IPv6. On-prem is
still IPv4-only — our edge firewalls are IPv4-only appliances, so hybrid IPv6 is
on the roadmap but not live." Clear, self-aware, with known gaps.

**Red flags:**
- "We don't use IPv6" — but their cloud provider is assigning IPv6 addresses to
  their VMs anyway (GCP does this by default when subnet stack type is
  IPV4_IPV6).
- Firewall policy that only mentions IPv4 addresses and prefixes — the IPv6
  equivalent paths may be uncontrolled.
- No awareness that a /64 is standard for a subnet — IT head who thinks they
  should subnet the /64 further (common IPv4 instinct, wrong for IPv6 — SLAAC
  requires a /64).

## Pitfalls & war stories

**"We turned off IPv6 on the servers" isn't enough.** If the cloud subnet is
dual-stack, the provider's routing infrastructure may still accept IPv6 traffic
destined for addresses in that range. Control must be at the VPC firewall level,
not just on the VM's OS network stack.

**IPv6 tunneling evasion.** Attackers have historically used IPv6-in-IPv4
tunneling (6in4, Teredo) to bypass IPv4-only firewalls and IDS systems. In
FSI/bank environments with strict perimeter controls, ensure your IDS/IPS and
NGFW inspect or block unauthorized IPv6 tunneling protocols. Relevant for PCI-DSS
audits where "no unauthorized tunnels" is a control.

**The /64 is not negotiable for SLAAC.** Engineers accustomed to IPv4 conservation
habits try to allocate /80 or /112 subnets. This breaks SLAAC (which requires
exactly a /64 network portion for EUI-64 and RFC 8981 temporary addresses) and
some NDP implementations.
The correct posture: every network-facing subnet is a /64 and address scarcity is
not a concern.

**Northwind M&A trap in IPv6.** The same M&A IP-overlap problem from IPv4 (see
N11) can occur in IPv6 if acquired companies happened to use the same ULA prefix
— both picked `fd12::/48`, say. ULA prefixes should be randomly generated (RFC 4193
specifies a 40-bit pseudo-random field to make collision astronomically unlikely,
but if someone picked `fd00::/48` manually, collisions happen). Always check ULA
prefixes during M&A network due diligence.

**Meridian Bank PCI scope and IPv6.** The Cardholder Data Environment (CDE) subnet
isolation rules apply equally to IPv6 paths. A PCI auditor will ask for evidence
that no unauthorized IPv6 path bypasses the segmentation between the CDE and
general network segments. If your firewall rule set only names IPv4 addresses, that
is an audit finding.

## Going deeper (optional)

- **RFC 4291** — IPv6 addressing architecture (the canonical reference for address
  types, notation rules, and prefix assignments).
- **RFC 4861** — Neighbor Discovery Protocol; what NDP does in detail.
- **RFC 4193** — Unique Local IPv6 Unicast Addresses (the ULA spec).
- **RFC 8981** — Temporary Address Extensions for SLAAC (privacy extensions;
  obsoletes RFC 4941).
- **RFC 6555** — Happy Eyeballs: how dual-stack clients choose IPv4 vs IPv6.
- **GCP docs:** "IPv6 addresses in VPC networks" — covers stack types (IPv4-only,
  dual-stack), internal vs external IPv6, and GUA assignment.
- **AWS docs:** "IPv6 support in Amazon VPC" — covers BYOIP vs Amazon-provided,
  the /56 per VPC allocation, and subnet /64 assignment.
- Pairs with **N11** (enterprise IP planning — IPv6 address management at scale,
  M&A overlap) and **N16** (NAT — how IPv6 changes the NAT model).

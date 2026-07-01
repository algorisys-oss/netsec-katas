# Kata N15 — VLANs & segmentation; trunking; the L2/L3 boundary

> **Track:** Networking · **Module:** N3 Routing & switching · **Prereqs:** N03, N05, N08, N12 · **Time:** ~35 min
> **Tags:** `networking` `vlan` `l2-data-link` `switching` `segmentation` `broadcast-domain` `fsi`

## Why it matters

Every bank and FMCG you walk into has the same two compliance demands on the
network team: **isolate regulated traffic** (cardholder data, trading systems,
OT plant floors) and **limit blast radius** when something gets compromised.
VLANs are the primary tool for both. When the IT head says "the CDE is
segmented," they almost always mean "it's on its own VLAN." If you don't
understand what a VLAN can and cannot do — and crucially where the L2/L3
boundary sits — you'll accept a design that looks segmented on the diagram but
isn't in reality.

## The mental model

### The problem VLANs solve

In N05 you saw that an Ethernet switch forms one big **broadcast domain**: every
ARP, DHCP discovery, and BPDU goes to every port. Scale that to a 500-port
data center switch and three problems emerge:

1. **Blast radius** — one misconfigured machine can ARP-flood the whole switch.
2. **Security** — trading systems and guest Wi-Fi share the same L2 segment.
3. **Broadcast noise** — at scale, uncontrolled broadcasts degrade performance.

VLANs carve one physical switch into multiple **logical switches**. Each VLAN
is its own broadcast domain; traffic cannot cross between VLANs at L2. To move
traffic *between* VLANs you need an L3 hop — a router or a Layer 3 switch.

```
Physical switch (24 ports):
  VLAN 10 (servers)   ── ports 1-8  ─┐
  VLAN 20 (staff PCs) ── ports 9-16 ─┤  separate broadcast domains
  VLAN 30 (printers)  ── ports 17-20─┘
  VLAN 99 (mgmt)      ── port 24

  Traffic in VLAN 10 cannot reach VLAN 20 without going through a router.
```

### Access ports vs trunk ports

A switch port operates in one of two modes:

**Access port** — carries exactly one VLAN; the end device (PC, server, IP
phone) knows nothing about VLANs. The switch tags the frame internally and
strips the tag before delivery.

**Trunk port** — carries *multiple* VLANs on one physical link, tagged with
IEEE 802.1Q. The 802.1Q header inserts a 4-byte tag (including a 12-bit VLAN
ID; the field is 0–4095 with 0 and 4095 reserved, so usable IDs are 1–4094)
into the Ethernet frame.

```
802.1Q Ethernet frame (simplified):

  Dst MAC | Src MAC | 802.1Q tag (4 bytes) | EtherType | Payload | FCS
                      ┌──────────────────┐
                      │ TPID 0x8100      │  2 bytes: marks this as 802.1Q
                      │ PCP (3) | DEI (1)│  priority + drop-eligible (DEI, formerly CFI)
                      │ VID (12 bits)    │  0–4095; 0 and 4095 reserved
                      └──────────────────┘
```

Trunk links run between switches, and between a switch and a router or L3
switch. The **native VLAN** on a trunk carries *untagged* frames — misconfiguring
the native VLAN on two connected trunks is a common source of VLAN hopping
attacks (see Pitfalls).

### The L2/L3 boundary

VLANs live at L2. Routing happens at L3. There are two ways to cross the
boundary:

**Option 1 — Router on a Stick (ROAS)**
One physical link from the switch to a router, with sub-interfaces, one per
VLAN. The router routes between VLANs. Simple to configure; the link is a
single bottleneck.

```
  Switch ──── trunk (802.1Q) ──── Router
                                  ├── sub-if eth0.10  10.10.10.1/24  (VLAN 10)
                                  ├── sub-if eth0.20  10.10.20.1/24  (VLAN 20)
                                  └── sub-if eth0.30  10.10.30.1/24  (VLAN 30)
```

**Option 2 — Layer 3 switch (SVIs)**
Modern data center and campus switches have a routing ASIC built in. A
**Switched Virtual Interface (SVI)** is a virtual L3 interface for each VLAN —
the switch itself is the inter-VLAN router. This is the dominant design today:
no external router needed, line-rate L3 switching in hardware.

```
  L3 Switch
  ├── VLAN 10 → SVI: 10.10.10.1/24   ← the default gateway for VLAN 10 hosts
  ├── VLAN 20 → SVI: 10.10.20.1/24
  └── VLAN 30 → SVI: 10.10.30.1/24
  Hosts in VLAN 10 use 10.10.10.1 as their default gateway (see N12).
```

The SVI is *the default gateway* for hosts in that VLAN. Once traffic crosses
to the SVI it becomes a routed (L3) packet — firewall rules, ACLs, and routing
policies apply. Before that it's pure L2 and firewalls cannot see it.

### The key insight: L2 is invisible to your firewall

A firewall operates at L3 and above. Traffic that never crosses an L3 boundary
— hosts within the same VLAN — is **invisible to the firewall**. That is both
why VLANs are segmentation tools and why they are *not sufficient* on their own:
two servers in the same VLAN can reach each other at L2, bypassing every
firewall rule you wrote. PCI-DSS requirement 1 demands not just VLAN isolation
but firewall-enforced ACLs at the inter-VLAN boundary.

## Worked example

Meridian Bank's HQ-DC1 (`10.10.0.0/16`) runs a three-tier card-processing
application. The security team must put each tier on its own VLAN and enforce
firewall rules between them — a PCI-DSS requirement 1 control.

### VLAN plan for HQ-DC1

```
VLAN  ID   Subnet            Gateway          Purpose
──────────────────────────────────────────────────────────────────
  10  10   10.10.10.0/24   10.10.10.1       Web tier (DMZ-ish)
  20  20   10.10.20.0/24   10.10.20.1       DB tier (CDE)
  30  30   10.10.30.0/24   10.10.30.1       App tier
  40  40   10.10.40.0/24   10.10.40.1       Staff workstations
  99  99   10.10.99.0/28   10.10.99.1       OOB management (14 hosts)
```

Subnet check for the management VLAN (tight sizing is intentional):
`/28` = 16 addresses, 14 usable (10.10.99.1–10.10.99.14, .0 network, .15
broadcast). 14 hosts covers all network devices in DC1 without wasting space.

### Traffic flow: web tier → DB tier

A web server in VLAN 10 queries the database in VLAN 20. The path:

```
  web-01 (10.10.10.5)
    │  L2 frame to default gateway 10.10.10.1 (SVI on L3 switch)
    ▼
  L3 Switch SVI 10.10.10.1
    │  routes packet to 10.10.20.0/24 → exits SVI 10.10.20.1
    │  traffic passes through inter-VLAN firewall ACL:
    │    PERMIT  10.10.10.0/24 → 10.10.20.0/24  tcp dport 5432
    │    DENY    any
    ▼
  db-01 (10.10.20.7)  ← packet arrives, firewall permitted it
```

If someone moved db-01 into VLAN 10 by mistake, it would share a broadcast
domain with web-01 and an ARP request alone could enumerate the database.
That is why auditors check VLAN assignments, not just firewall rules.

### Trunk between two switches

DC1 has a distribution switch and an access switch per rack row. The link
between them carries all VLANs:

```
  Distribution switch ──── 802.1Q trunk (all VLANs allowed) ──── Rack-A access switch
                            native VLAN 99 on both ends
```

The trunk allows VLANs 10, 20, 30, 40, 99. In a **double-tagging** attack, an
attacker whose access port sits in the native VLAN crafts a frame with two
802.1Q tags: an **outer tag = the native VLAN** (which the first switch strips,
because native-VLAN traffic is sent untagged on the trunk) and an **inner tag =
the target VLAN**. The next switch then reads the surviving inner tag and
forwards the frame into a VLAN the attacker should never reach — injecting
traffic *into* it. It is one-way only (there is no return path). The fix: never
put production traffic on the native VLAN; use a dedicated, unused native VLAN ID
that carries no real hosts.

### Northwind FMCG — OT/IT separation

Northwind's manufacturing plants need OT (operational technology — PLCs, SCADA)
separated from corporate IT. They achieve this with dedicated VLANs per plant:

```
  Plant-1 switch:
    VLAN 110  10.50.11.0/24  OT/SCADA (no internet, no corp routing)
    VLAN 120  10.50.12.0/24  IT (printers, PCs, WMS terminals)
    VLAN 130  10.50.13.0/24  Wi-Fi (guest/contractors)
```

Inter-VLAN routing is *disabled* between VLAN 110 and all others. Any
plant-floor-to-corporate path requires physical passage through a firewall.
This is the OT/IT separation the plant manager insists on (see N27 for DMZ
patterns that extend this).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| VLAN (L2 isolation) | 802.1Q VLAN on switch | Not exposed — GCP is L3-only; isolation via VPC/subnets | Not exposed — VPCs are L3; no L2 broadcast domain shared across VMs | (Azure: TODO) |
| Broadcast domain | Per-VLAN; bounded by switches | Does not exist — GCP suppresses broadcasts at the hypervisor | Does not exist — AWS VPC is unicast-only | (Azure: TODO) |
| Inter-VLAN routing | L3 switch SVI or router-on-stick | VPC routes between subnets; firewall rules control it | Route tables + security groups / NACLs | (Azure: TODO) |
| Trunk port | 802.1Q link between switches | Not applicable (no physical switch exposure) | Not applicable | (Azure: TODO) |
| VLAN-tagged guest traffic | 802.1Q on physical NIC | NIC bonding / LACP in GCE done at OS; VLANs via Linux `ip link add link` | Similar: OS-level VLAN tagging if needed | (Azure: TODO) |
| Network segmentation primitive | VLAN + inter-VLAN firewall | VPC subnet + VPC firewall rule (stateful) | VPC subnet + Security Group (instance-level) + NACL (subnet-level) | (Azure: TODO) |

**The key cloud insight:** cloud VPCs eliminate the L2 complexity entirely. There
are no broadcast storms, no ARP floods, no VLAN hopping attacks because the
hypervisor never exposes shared L2. Segmentation is all L3 — subnet boundaries
enforced by firewall rules. This makes cloud segmentation in some ways simpler
than on-prem, but it also means concepts like "trunk port" and "SVI" have no
direct cloud analog. When the IT head asks "what VLAN is this in?", the honest
cloud translation is "what subnet, and which firewall rule governs it?"

## Do it (the exercise)

### Part A — map the broadcast domains [laptop / paper]

1. Draw the Meridian DC1 VLAN layout above (the five VLANs). For each VLAN,
   write: (a) the subnet, (b) the default gateway IP, (c) how many usable host
   addresses it provides.
2. Check your gateway IPs make sense: the gateway must be *within* the subnet.
   Verify with:
   ```bash
   python3 -c "
   import ipaddress
   for net, gw in [('10.10.10.0/24','10.10.10.1'),
                   ('10.10.99.0/28','10.10.99.1')]:
       n = ipaddress.ip_network(net)
       g = ipaddress.ip_address(gw)
       print(net, '->', gw, 'in-net:', g in n, 'usable:', n.num_addresses-2)
   "
   ```
   Expected output: both `in-net: True`; /24 gives 254 usable, /28 gives 14 usable.

### Part B — observe VLAN tagging on Linux [laptop]

On any Linux machine (or a VM), you can create a software VLAN interface over a
physical or virtual NIC. This shows you exactly what 802.1Q does at the OS level:

```bash
# See your interfaces
ip link show

# Create a VLAN 10 sub-interface on eth0 (replace eth0 with your interface name)
# Note: this requires root; on a VM, the hypervisor must pass tagged frames
sudo ip link add link eth0 name eth0.10 type vlan id 10
sudo ip link show eth0.10

# Assign an IP and bring it up
sudo ip addr add 10.10.10.5/24 dev eth0.10
sudo ip link set eth0.10 up

# Inspect the VLAN config
cat /proc/net/vlan/eth0.10   # shows VID, Rx/Tx stats

# Clean up
sudo ip link delete eth0.10
```

What you see in `ip link show eth0.10`: the interface name includes `.10` and
the VLAN ID is listed. Any frame sent out this interface will carry the 802.1Q
tag with VID=10; the receiving switch's trunk port strips it (or uses it).

### Part C — simulate two real VLANs and inter-VLAN routing [laptop]

To actually demonstrate VLAN isolation you need *separate broadcast domains*,
not just separate IP subnets. A single flat Linux bridge is **one** broadcast
domain, so two ports on it are in the **same** VLAN no matter what IPs you
assign — that would prove nothing about L2 isolation. Instead we use a
**VLAN-aware bridge** with 802.1Q VLAN filtering, the same mechanism a real
switch uses. Each access port is a `pvid` (untagged) member of exactly one VLAN,
so the bridge keeps VLAN 10 and VLAN 20 in genuinely separate broadcast domains.

```bash
# Create two namespaces (hosts in VLAN 10 and VLAN 20)
sudo ip netns add host-vlan10
sudo ip netns add host-vlan20

# Create a VLAN-aware bridge (the switch). vlan_filtering=1 is the key flag:
# without it the bridge is one flat broadcast domain.
sudo ip link add br0 type bridge vlan_filtering 1
sudo ip link set br0 up

# veth pairs: one end in each namespace, one end as a bridge "access port"
sudo ip link add veth10a type veth peer name veth10b
sudo ip link add veth20a type veth peer name veth20b

sudo ip link set veth10a netns host-vlan10
sudo ip link set veth10b master br0
sudo ip link set veth10b up

sudo ip link set veth20a netns host-vlan20
sudo ip link set veth20b master br0
sudo ip link set veth20b up

# Make each bridge port an ACCESS port: untagged member (pvid) of one VLAN.
# Remove the default VLAN 1 membership so the two ports share no VLAN at all.
sudo bridge vlan del dev veth10b vid 1
sudo bridge vlan add dev veth10b vid 10 pvid untagged
sudo bridge vlan del dev veth20b vid 1
sudo bridge vlan add dev veth20b vid 20 pvid untagged

# Inspect the VLAN-to-port mapping (this is the switch's VLAN table)
sudo bridge vlan show
# veth10b -> VLAN 10 (PVID, untagged); veth20b -> VLAN 20 (PVID, untagged)

# Assign host IPs (different subnets, one per VLAN)
sudo ip netns exec host-vlan10 ip addr add 10.10.10.5/24 dev veth10a
sudo ip netns exec host-vlan10 ip link set veth10a up
sudo ip netns exec host-vlan20 ip addr add 10.10.20.5/24 dev veth20a
sudo ip netns exec host-vlan20 ip link set veth20a up

# Ping VLAN 10 -> VLAN 20 — FAILS even on the SAME bridge: separate VLANs are
# separate broadcast domains, so the frames never reach each other at L2.
sudo ip netns exec host-vlan10 ping -c2 10.10.20.5
# Expected: 100% packet loss — true L2 isolation, not just an IP-subnet mismatch.

# Now add the inter-VLAN router (an SVI per VLAN on the bridge itself).
# Make the bridge a tagged member of both VLANs so its internal port can route them.
sudo bridge vlan add dev br0 vid 10 self
sudo bridge vlan add dev br0 vid 20 self

# Create an SVI (L3 interface) for each VLAN on the bridge.
sudo ip link add link br0 name br0.10 type vlan id 10
sudo ip link add link br0 name br0.20 type vlan id 20
sudo ip addr add 10.10.10.1/24 dev br0.10
sudo ip addr add 10.10.20.1/24 dev br0.20
sudo ip link set br0.10 up
sudo ip link set br0.20 up

# Point each host at its SVI as default gateway.
sudo ip netns exec host-vlan10 ip route add default via 10.10.10.1
sudo ip netns exec host-vlan20 ip route add default via 10.10.20.1

# Enable IP forwarding (the "routing" in the L3 switch).
sudo sysctl -w net.ipv4.ip_forward=1

# Now ping works — traffic left VLAN 10 to its SVI, was routed at L3, and was
# delivered into VLAN 20. It crossed the L2/L3 boundary.
sudo ip netns exec host-vlan10 ping -c2 10.10.20.5

# Clean up
sudo ip netns delete host-vlan10
sudo ip netns delete host-vlan20
sudo ip link delete br0
```

The failed ping before the SVIs existed is the whole point — and note *why* it
failed: the two hosts are in **separate VLANs (separate broadcast domains) on
the same switch**, so their frames can never reach each other at L2, regardless
of IP addressing. That is true VLAN isolation. The moment the SVIs (the L3
gateways) exist, packets cross the L2/L3 boundary and flow — and now they are
routed L3 traffic a firewall can see and filter.

## Say it back (self-check)

1. What is a VLAN and how does it relate to a broadcast domain? Can two hosts on
   the same physical switch in different VLANs communicate without a router?
2. What is the difference between an access port and a trunk port? Which one
   carries 802.1Q tags to the end device?
3. What is an SVI and how does it serve as a default gateway for a VLAN?
4. A PCI auditor asks "are your web and DB tiers segmented?" You say "yes,
   different VLANs." What follow-up question should the auditor ask that you
   must be able to answer?
5. Why don't cloud VPCs have VLANs? What takes their place for segmentation?

## Talk to the IT/security head

**Ask:**

- "Can you show me the VLAN plan and which VLANs are in PCI/CDE scope?" *A good
  answer names specific VLAN IDs, their subnets, and which firewall or ACL
  enforces inter-VLAN policy. A vague answer ("it's segmented") is a red flag.*
- "Where exactly is the L3 boundary between the CDE VLANs and the rest? Is it a
  dedicated firewall, an L3 switch ACL, or both?" *You want to know whether a
  stateful firewall sits there or just an ACL — ACLs alone don't track connection
  state and are easier to misconfigure.*
- "What is your native VLAN on trunk links, and is it a dedicated VLAN ID with no
  assigned hosts?" *The answer "we use the default VLAN 1 as native" is a red
  flag — VLAN 1 is often the default for management and for untagged traffic,
  making VLAN hopping easier.*
- "How do you prevent unauthorized VLAN assignment — can a rogue device on an
  access port claim membership in the CDE VLAN?" *A good answer mentions 802.1X
  port authentication or dynamic VLAN assignment via RADIUS; a bad answer is
  "physical security is enough."*
- "In your OT/IT separation, is the boundary a VLAN boundary or a firewall
  boundary?" *For Northwind-style plants, "VLAN only" without a firewall means
  a misconfigured trunk could bridge the two — the boundary needs a physical
  firewall or a dedicated L3 hop.*

**Red flags to listen for:**

- "We have VLANs so we're segmented" — without mentioning firewall rules at the
  inter-VLAN boundary. L2 isolation is step one; L3 enforcement is the control.
- VLAN 1 used for management or as the native VLAN on trunks.
- No 802.1X or port security — any device plugged in joins a VLAN without
  authentication.
- VLANs span the WAN (VLAN extended over MPLS without scrutiny) — L2 extensions
  over WAN widen the blast radius dramatically.

## Pitfalls & war stories

**VLAN hopping via double-tagging.** An attacker on an access port sends a frame
with two 802.1Q headers: the outer tag matches the native VLAN (stripped by the
first switch), revealing an inner tag for the target VLAN (processed by the next
switch). Mitigation: set the native VLAN to an unused, dedicated VLAN ID; never
put hosts on the native VLAN.

**"It's on a different VLAN" mistaken for firewall isolation.** At a bank audit,
the security team shows VLAN separation between the card vault and the web tier.
But the L3 switch is configured for full any-to-any inter-VLAN routing with no
ACL. VLANs stop L2 broadcasts; they don't stop L3 traffic. PCI-DSS requirement
1 requires firewall controls, not just VLANs.

**Spanning-Tree surprises on trunks.** When VLANs span multiple switches,
Spanning Tree Protocol (STP) runs per VLAN (Per-VLAN Spanning Tree, PVST+).
A misconfigured priority causes a core switch to lose root bridge election —
traffic stops. Architects often don't know STP is running until it breaks. Ask
the network team which switch holds root bridge for each VLAN.

**Extended VLANs across WAN (VPLS / stretched L2).** FMCGs doing M&A sometimes
ask to stretch a VLAN between two data centers over MPLS or VPLS for live
migration. A single broadcast storm at one site propagates to the other. The
safer design is routed connectivity (L3) with the firewall on each side.

**Cloud team applies on-prem VLAN thinking to VPCs.** A cloud team creates one
VPC per VLAN because "that's how we segment things." In GCP and AWS, subnets
within a VPC are already L3 isolated (controlled by route tables and firewall
rules). Over-segmenting into too many VPCs creates peering complexity without
adding real security. The mapping is: on-prem VLAN ≈ cloud subnet, not cloud VPC.

## Going deeper (optional)

- **IEEE 802.1Q-2018** — the standard defining VLAN tagging; section 9 covers the
  frame format and VLAN ID semantics.
- **IEEE 802.1X-2020** — port-based Network Access Control; the standard that
  forces authentication before VLAN assignment.
- **Cisco PVST+ / Rapid PVST+** documentation — understand STP per VLAN before
  any production trunk design.
- **PCI-DSS v4.0, Requirement 1** — the actual text of network segmentation and
  firewall requirements for CDE isolation. Read it before the next bank
  architecture review.
- Pairs with **N05** (Ethernet/switching/ARP), **N12** (default gateway and
  routing tables), **N26** (firewall design), and **N27** (DMZ and segmentation
  patterns). Security track: **S01** (defense in depth, blast radius) and
  **S26** (Zero Trust, where VLAN-based segmentation gives way to identity-based
  micro-segmentation).

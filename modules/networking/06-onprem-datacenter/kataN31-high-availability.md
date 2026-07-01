# Kata N31 — High availability: redundancy, HSRP/VRRP, link aggregation

> **Track:** Networking · **Module:** N6 On-prem & data center · **Prereqs:** N30, N05, N12 · **Time:** ~35 min
> **Tags:** `networking` `high-availability` `vrrp` `hsrp` `link-aggregation` `on-prem` `data-center` `fsi`

## Why it matters

When Meridian Bank's IT head says "we need five-nines on the core banking path,"
the answer is not a better single box — it is **eliminating every single point of
failure**. Routers fail, line cards crash, cables get cut during maintenance.
The network team's job is to build a design where no single failure matters,
because something else is already ready to take over before anyone notices.
As an architect, you need to know what "HA on the network" actually means so you
can challenge a design that claims five-nines while hiding single points of
failure, and so you can estimate the cost and complexity of genuine redundancy.

## The mental model

High availability in a data center network rests on **three independent
mechanisms**, applied at different failure points:

```
  PROBLEM                  MECHANISM                 Standard / protocol
  ─────────────────────────────────────────────────────────────────────
  Router/gateway fails     First-hop redundancy       HSRP (Cisco) / VRRP (RFC 5798)
  Link fails               Link redundancy + failover  Spanning Tree (L2) or
                                                       link aggregation (LACP/802.3ad)
  Switch fails             Dual-homing, stacking,     vendor-specific (VSS, vPC, MC-LAG)
                           chassis redundancy
```

Understand each one in turn.

### 1. The single-gateway problem (and HSRP/VRRP)

Every host has a **default gateway** configured — one IP address the host sends
all off-subnet traffic to (see N12). If that gateway goes down, the host is
cut off even if the rest of the network is fine. With a *naive* design (a
single physical router as gateway) the host's ARP table still maps the gateway
IP to the dead router's MAC, and recovery waits on ARP/neighbour aging — which
on hosts is fast (Linux `base_reachable_time` ~30 s, stale entries reaped in
seconds–minutes; Windows similar) rather than the oft-quoted "4 hours," which
is the **Cisco router** ARP-cache default, not a host OS default. The real fix
is to not depend on host ARP aging at all: that is exactly what FHRP achieves
with a shared **virtual MAC** (see below) — the gateway's MAC never changes on
failover, so the host's ARP entry stays valid.

**First-hop redundancy protocols (FHRPs)** solve this by making *two or more
routers share one virtual IP address* (the VIP). Hosts are configured to use
the VIP as their gateway. The routers elect an active/standby owner:

```
         HOSTS (10.10.10.x/24)
         default GW = 10.10.10.1   ← virtual IP (VIP), no physical owner
                │
      ┌─────────┴─────────┐
      │                   │
  ┌───┴───┐           ┌───┴───┐
  │ RTR-A │◄──hello──►│ RTR-B │   hello / advertisement packets
  │ ACTIVE│           │STANDBY│   every 1–3 seconds (configurable)
  │.10.2  │           │.10.3  │   physical IPs
  └───────┘           └───────┘
      │                   │
  upstream            upstream
  (or same upstream — may itself be redundant)
```

- **ACTIVE** router owns the VIP and responds to ARP for it with a **virtual
  MAC** (e.g. `00:00:5e:00:01:xx` for VRRP). All traffic flows through it.
- **STANDBY** router listens for hello packets. If hellos stop for the hold
  time, it takes over and begins responding to ARP with the same virtual MAC.
  The default hold time differs by protocol: **~10 s for HSRP** (3 s hello,
  10 s hold) but only **~3.6 s for VRRP** — per RFC 5798 the Master_Down_Interval
  is `(3 × advertisement_interval) + skew`, i.e. `3 × 1 s + (256−priority)/256`
  ≈ 3.6 s for the default priority 100.
- Hosts see a seamless switch: the virtual IP and virtual MAC never changed.
  Sub-second failover is possible with tuned timers.

**HSRP vs VRRP:**

| Property | HSRP | VRRP |
|----------|------|------|
| Vendor | Cisco proprietary | RFC 5798 (open standard) |
| Virtual MAC prefix | `00:00:0c:07:ac:xx` | `00:00:5e:00:01:xx` |
| Active/standby naming | Active / Standby | Master / Backup |
| IPv6 support | HSRPv2 | VRRPv3 (RFC 5798) |
| Multi-vendor interop | No (Cisco–Cisco only) | Yes |
| Typical use | All-Cisco shops (common in banks) | Mixed-vendor; open environments |

In practice: the bank's existing Cisco estate will run HSRP; any new open or
multi-vendor deployment (including hypervisor-hosted virtual routers) should
use VRRP. You do not need to configure these — you need to ask which is
running and verify the failover time is measured.

### 2. Link redundancy and link aggregation (LACP / 802.3ad)

A router/switch can be redundant, but if the two boxes connect via a single
cable to a single upstream switch, the cable is the single point of failure.

**Option A — Active/passive failover:** two links, one up at a time. The
second activates on failure (e.g. STP puts it in blocking, then forwarding on
failure). Simple, wastes capacity.

**Option B — Link aggregation (LAG / 802.3ad / LACP):** multiple physical
links bundled into one logical link. **Both links carry traffic simultaneously
(active-active)**. The bundle is called a **port channel**, **bond**, or **LAG**.

```
  Switch A                  Switch B
  ┌────────┐  link 1 ───── ┌────────┐
  │        ├─ link 2 ─────►│        │
  │  SW-A  ├─ link 3 ─────►│  SW-B  │
  │        ├─ link 4 ─────►│        │
  └────────┘               └────────┘
   logical: one 4×10G = 40G bond (if each link is 10G)
```

**LACP (Link Aggregation Control Protocol, IEEE 802.3ad):** the protocol by
which the two switches negotiate and maintain the bundle. If one physical link
fails, LACP removes it from the bundle; the rest continue. The logical link
stays up.

Key properties:
- **Load balancing across member links** — algorithm is vendor-specific
  (common: hash on src/dst IP or src/dst MAC); a single flow always takes
  the same link (preserving TCP order).
- **Minimum-links setting** — the LAG goes down if fewer than N links remain
  (prevents degraded operation you don't know about).
- **Active vs passive LACP mode** — at least one side must be active to bring
  the bundle up.

### 3. Putting it together: dual-homed with FHRP + LAG

A fully redundant server or switch attachment looks like this:

```
                         ┌─────────────────────────┐
      VIP 10.10.10.1     │   REDUNDANCY DOMAIN      │
                         │                          │
  ┌──────────────────────┤    RTR-A (HSRP Active)   │
  │  10.10.10.2          │    10.10.10.2            │
  │    ┌─────────────────┤    SW-CORE-A             │
  │    │  LAG (2×10G)    └─────┬──────────────┬─────┘
  │    │                       │              │
  │    │                  uplinks         downlinks
  │    │                       │              │
  │  ┌─┴──────────────────────-┤──────────────┤
  │  │ (cross-link: VPC/MC-LAG)│              │
  │  └──────────────────────────────────────────┐
  │                         ┌─────────────────────────┐
  └──────────────────────── │    RTR-B (HSRP Standby) │
      10.10.10.3             │    10.10.10.3            │
                             │    SW-CORE-B             │
                             └─────────────────────────┘
```

Any single failure — a router, a switch, or a link — leaves *another path
intact*. This is called **N+1 redundancy** (N active, 1 spare). More critical
paths use **2N** (two fully independent paths, both active or in hot standby).

## Worked example

Meridian Bank's HQ-DC1 (10.10.0.0/16) runs the **core banking application
tier** on physical servers in two rows of racks. The network team shows you
this design before a design review:

```
  Servers: 10.10.10.0/24 (app tier)
  Default gateway configured on all servers: 10.10.10.1

  HSRP group 10:
    RTR-A: 10.10.10.2/24  (Active)
    RTR-B: 10.10.10.3/24  (Standby)
    Virtual IP: 10.10.10.1
    Virtual MAC: 00:00:0c:07:ac:0a  (last octet = group 10 decimal = 0x0a)
    Hello timer: 3 s, Hold timer: 10 s
    Preempt: enabled (RTR-A reclaims active if it recovers)

  Uplinks from RTR-A to distribution switch SW-DIST-A:
    Port-channel 1: eth0/0 + eth0/1 (2×10G LACP active)
    Minimum links: 1 (degraded operation allowed — RED FLAG, see Pitfalls)
```

What happens when RTR-A's NIC fails hard (link down):
1. RTR-A's uplink LAG loses a member; if only 1 member remains, LACP keeps
   the bundle up (minimum-links = 1).
2. RTR-B stops receiving HSRP hellos from RTR-A. HSRP does not count missed
   hellos — RTR-B transitions to Active only when its **10 s hold timer**
   (reset by each hello) expires with no hello received.
3. RTR-B sends a **gratuitous ARP** for 10.10.10.1, binding the virtual MAC
   to RTR-B's uplink. Switches update their CAM tables.
4. Server traffic resumes via RTR-B. Downtime: ~10 s (configurable down to
   sub-second with millisecond timers, at the cost of stability).

**The DC2 DR link (10.20.0.0/16):** DC2 is ~40 km away. Redundancy across
sites requires a dedicated **inter-DC link** (dark fiber or DWDM) in addition
to these within-site mechanisms. HSRP group membership *can* span both DCs, but
doing so requires extending the L2 segment across the DCI (L2 data-center
interconnect) — an anti-pattern banks usually avoid, because it stretches a
broadcast/failure domain across sites. If you do stretch FHRP, the protocol
hellos must traverse the inter-DC link, and inter-DC latency only matters once
you have **aggressively tuned, sub-second timers** — at default HSRP timers
(10 s hold) a few tens of ms of RTT is irrelevant. As a rough guide, keep RTT
below ~50 ms *only if* you run sub-second timers; the better answer for most
banks is L3 at the DC edge with route-based failover, not stretched L2.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| First-hop redundancy | HSRP / VRRP (routers) | Not needed — cloud routes are software-defined; the default route is a logical construct, not a physical router | Not needed — route tables point to logical gateways | (Azure: TODO) |
| Link aggregation (LAG) | LACP / 802.3ad (physical switches) | Interconnect uses LACP on the on-prem side for Cloud Interconnect VLAN attachments | AWS Direct Connect uses LACP for LAG bundles (up to 4 × 10G or 2 × 100G) | (Azure: TODO) |
| Zonal redundancy | Dual-homed racks across power domains | Deploy across multiple **zones** within a region; GCP zones = independent failure domains | Deploy across multiple **Availability Zones** (AZs); each AZ = one or more data centers | (Azure: TODO) |
| N+1 / 2N compute HA | Redundant servers in passive standby | Managed instance groups (MIG) + health checks auto-replace failed instances | Auto Scaling Groups + ELB health checks; or multi-AZ RDS | (Azure: TODO) |
| Link failover time | HSRP/VRRP: ~1–10 s tunable; LACP: sub-second | Milliseconds (software routing) | Milliseconds | (Azure: TODO) |

**The key cloud insight:** cloud providers already abstract away first-hop
redundancy because there is no physical router your VM addresses. The *cloud
equivalent* of "redundancy" is spreading workloads across zones and using
managed services that are zone-aware. The HSRP/VRRP problem simply does not
exist in a well-designed cloud VPC. This is a genuine simplification — but it
creates a gap when you bring on-prem and cloud together over an interconnect:
the on-prem side still needs FHRP, and the interconnect itself should be a LAG
for resilience (see N38).

## Do it (the exercise)

### Part 1 — paper design [laptop]

Draw the HA network for Meridian Bank's app tier (10.10.10.0/24). Include:
- Two core switches (SW-CORE-A, SW-CORE-B)
- Two routers (RTR-A, RTR-B) with HSRP group, virtual IP, physical IPs
- Two LAGs (one per router to its core switch)
- Uplinks from both core switches to a distribution layer (or spine — see N30)

Mark every component. Circle each single point of failure you can find. If you
find any, you have a gap in the design.

### Part 2 — verify LACP on Linux [laptop]

Linux uses `bonding` or the newer `team` driver to bond links. Simulate a
two-link bond and confirm LACP negotiation:

```bash
# Requires two network interfaces. On most laptops, use two virtual interfaces.
# Create a bond using the bonding driver (requires root / sudo):
sudo modprobe bonding
sudo ip link add bond0 type bond mode 802.3ad
sudo ip link set bond0 up

# Attach two interfaces (replace eth1, eth2 with your interface names):
sudo ip link set eth1 master bond0
sudo ip link set eth2 master bond0

# Check bond status:
cat /proc/net/bonding/bond0
```

Look for:
- `Bonding Mode: IEEE 802.3AD Dynamic link aggregation`
- `MII Status: up` for each slave link
- `LACP rate: slow` or `fast` (fast = hellos every 1 s)

```bash
# Remove the bond when done:
sudo ip link set eth1 nomaster
sudo ip link set eth2 nomaster
sudo ip link del bond0
```

### Part 3 — observe HSRP/VRRP state [needs cloud account or lab router]

If you have a GNS3, EVE-NG, or physical lab with two Cisco or FRRouting
routers sharing a segment, configure VRRP (open standard) on both and observe
the state machine:

```
# FRRouting (vtysh) — configuring VRRP on interface eth0, group 1
interface eth0
 vrrp 1 ip 192.168.1.1
 vrrp 1 priority 110        ! higher priority wins master
 vrrp 1 advertisement-interval 1000   ! FRR expresses this in MILLISECONDS; 1000 = 1 s (the default)
```

Watch `show vrrp` output: one router shows `Master`, the other `Backup`.
Shut down the Master's interface and measure the time until Backup becomes
Master — this is your **failover time**. Tune the advertisement interval down
to 200 ms (`vrrp 1 advertisement-interval 200`) and repeat. (FRR's valid range
is 10–40950 ms, default 1000; values below 10 ms are rejected.)

## Say it back (self-check)

1. What problem does HSRP/VRRP solve, and why can't the host solve it itself?
2. What is a virtual IP and a virtual MAC, and which router responds to ARP for
   them?
3. What is LACP, and how does it differ from a simple active/passive failover
   between two links?
4. If a bank claims "five-nines availability" but runs a single uplink from
   each server to a single switch, where is the real single point of failure?
5. Why does HSRP/VRRP not exist as a concept in a cloud VPC?

## Talk to the IT/security head

**Ask:**

- "Walk me through the failure modes for the default gateway. What happens if
  RTR-A goes down — how long before servers can send traffic, and how is that
  measured?" *(A good answer cites the HSRP/VRRP hold timer, the failover time
  in seconds, and a test date. A bad answer is "the standby takes over" with
  no number.)*

- "Are your uplinks to the distribution/core LAGs or single links? What's the
  minimum-links setting on the port channel?" *(Minimum-links set to 1 means
  a degraded LAG looks up — you only notice when the second link silently
  fails.)*

- "How do you test this? When did you last simulate a failover?" *(At a bank,
  if it hasn't been tested in the last 12 months, assume it doesn't work.
  Failover mechanisms drift — firmware updates, config drift, timer changes
  post-upgrade.)*

- "Is the inter-DC link (DC1 ↔ DC2) itself redundant — diverse physical
  routes, different carriers?" *(Single-carrier, single-conduit inter-DC link
  is the most common single point of failure the bank doesn't know about.)*

- "What's your RTO and RPO for the core banking path, and does the network
  design actually deliver those numbers?" *(Pushes the conversation from
  aspiration to measurement.)*

**A good answer sounds like:** the network team can state the FHRP protocol,
group number, VIP, hold timer, and the last failover test date. They distinguish
link-level from device-level redundancy. They can map specific failure scenarios
to specific failover mechanisms and times.

**Red flags to listen for:**
- "We have redundant switches" with no mention of uplinks or gateways — the
  classic gap.
- "We've never needed to test it" — hope is not a strategy for PCI-DSS-scoped
  infrastructure.
- "The vendor guarantees the hardware" — device MTBF is not the same as
  network availability; software bugs and config errors cause most outages.
- "Minimum-links is set to 1 so the link always shows up" — this hides
  degraded LAG operation and means silent half-capacity running can go
  undetected for months.

## Pitfalls & war stories

**The "minimum-links = 1" trap:** a port channel set to minimum-links 1 will
stay up with a single surviving member. The LAG shows green in monitoring. The
second link failed silently two months ago. Traffic is now half the expected
bandwidth and asymmetric. You find out during a core banking batch window at
2 a.m.

**HSRP preempt not enabled:** RTR-A goes down, RTR-B becomes active. RTR-A
recovers, but without `preempt` configured, it stays standby. Now RTR-B (the
lower-priority, possibly older box) remains active indefinitely. Next time
RTR-B fails, you have no standby — and the team doesn't notice because the
VIP is still responding.

**HSRP / VRRP group mismatch:** two routers are configured with different
group numbers or different VIPs. Both believe they are the only router in the
group. Both respond to ARP for the VIP. Result: ARP instability and
intermittent traffic blackholing. Diagnosable only by capturing ARP traffic and
seeing two different MACs for the same IP.

**Inter-DC link as single point of failure:** Meridian Bank's DC1 and DC2 are
40 km apart. The inter-DC fiber runs through one conduit, one carrier. A
construction crew cuts the conduit. Both HSRP and storage replication go dark.
This is the most common pattern for bank-wide outages — not a device failure
but a physical path failure that bypasses all device-level redundancy.

**FSI change-control risk:** modifying HSRP group priority or timer parameters
requires a CAB window (see N02). In practice, HA tuning (sub-second timers for
trading floors) is treated as a significant change — it touches the forwarding
path of production traffic. An architect who proposes millisecond timers without
understanding this will be surprised by a six-week lead time for a "simple"
config change.

**Northwind FMCG contrast:** Northwind's 12 distribution centers need uptime for
WMS scanners — but thin-margin operations mean they often run a single router per
site with a 4G backup link rather than full FHRP+LAG redundancy. This is a
deliberate cost trade-off, not an oversight. The conversation is about
documenting and accepting the risk, not always fixing it.

## Going deeper (optional)

- RFC 5798 — Virtual Router Redundancy Protocol (VRRPv3); covers both IPv4
  and IPv6. The reference for VRRP behavior, timer semantics, and the virtual
  MAC address format.
- IEEE 802.3ad / IEEE 802.1AX — Link Aggregation specification; 802.1AX-2008
  is the current consolidation.
- Pairs with N30 (spine-leaf topology — where LAGs live in the fabric) and
  N38 (dedicated interconnect — where on-prem LAGs meet cloud interconnect
  ports).
- Pairs with N32 (WAN building blocks — redundancy extends to the WAN edge)
  and N35 (monitoring — HA only works if you know when a standby has taken
  over or a LAG member has silently failed).
- Cisco documentation on HSRP: "First Hop Redundancy Protocol" feature guides
  (IOS / IOS-XE); useful for understanding timer math even in non-Cisco shops.

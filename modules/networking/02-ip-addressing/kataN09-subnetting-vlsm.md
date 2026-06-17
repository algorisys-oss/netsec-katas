# Kata N09 — Subnetting & VLSM: carve an address plan

> **Track:** Networking · **Module:** N2 IP addressing & subnetting · **Prereqs:** N07, N08 · **Time:** ~40 min
> **Tags:** `networking` `subnetting` `vlsm` `cidr` `ipv4` `l3-network` `meridian-bank` `fsi`

## Why it matters

Every VPC, firewall zone, and cloud subnet you design starts with the same act:
taking a block of address space and carving it into smaller pieces that match your
security and operational requirements. Segment too coarsely and a breach in the app
tier can reach the database with no firewall in between. Segment too finely and you
run out of addresses, or the IT head's team spends a week re-IPing when you grow.
At Meridian Bank, the RBI audit will ask *specifically* what is in the CDE subnet
and why it is isolated — a hand-wavy "we subnetted it" is not an answer. Knowing
how VLSM works is what lets you draw that answer on a whiteboard in the room.

## The mental model

**Fixed-length vs variable-length subnetting**

The old way: divide a network into equal-sized pieces.
`10.10.0.0/16` → sixteen /20 subnets, all 4,096 addresses, used or not.

The problem: real networks have zones of wildly different sizes — 500 app servers,
30 admin hosts, 2 WAN P2P link endpoints. Equal slices waste address space and
hide security boundaries behind sameness.

**VLSM** (Variable Length Subnet Masking) lets every subnet have a different prefix
length, sized to what it *actually* holds:

```
Parent block:  10.10.0.0/16  (65,536 addresses — Meridian HQ-DC1)
                │
                ├─ App/prod tier   10.10.0.0/23   (512 addrs, 510 usable)
                ├─ DB tier         10.10.2.0/24   (256 addrs, 254 usable)
                ├─ Mgmt/admin      10.10.3.0/26   ( 64 addrs,  62 usable)
                ├─ DMZ             10.10.3.64/27  ( 32 addrs,  30 usable)
                ├─ CDE / core bnk  10.10.20.0/27  ( 32 addrs,  30 usable, in CDE /24)
                ├─ WAN P2P DC1-DC2 10.10.3.128/30 (  4 addrs,   2 usable)
                └─ (reserved for growth)
```

Each subnet is a **blast-radius boundary** (see N01). Traffic between them must
cross a router and, at Meridian, a firewall rule.

**The two laws you cannot violate:**

1. **No overlap.** Subnets must not share any address. A `/27` starting at `.64`
   runs to `.95`; the next `/27` starts at `.96` — not `.80`.
2. **Alignment.** A subnet of size `2^n` must start at a multiple of `2^n`.
   A `/27` (block of 32) is valid at `.0`, `.32`, `.64`, `.96`, `.128`, `.160`,
   `.192`, `.224` — not `.10` or `.50`. Routes aggregate cleanly only when
   aligned.

**Sizing algorithm (VLSM recipe):**

1. List your zones largest-first (most hosts needed).
2. For each zone, find the smallest prefix where `2^(32−n) − 2 ≥ required hosts`.
3. Assign from the parent, aligned, largest first. Leave gaps; don't force them
   to be contiguous.
4. Reserve 20–30 % of your parent block for growth before you start carving.

## Worked example

Meridian Bank's primary data center HQ-DC1 sits on `10.10.0.0/16` (N07, N08).
The network team must carve a VLSM plan that satisfies:
- Audit: CDE (cardholder data environment) must be an *isolated* subnet, not just
  a VLAN tag mixed with other traffic.
- Operations: admin/management hosts need their own subnet so firewall rules are
  simple ("only jump-hosts in 10.10.3.0/26 can SSH to servers").
- Connectivity: a dedicated /30 for the point-to-point WAN link to DC2 (the DR
  site at 10.20.0.0/16).

**Step 1 — list zones and host requirements, largest first:**

| Zone            | Hosts needed | Smallest prefix | Block size |
|-----------------|-------------|-----------------|------------|
| App / prod tier | ~500        | /23             | 512        |
| DB tier         | ~200        | /24             | 256        |
| Mgmt / admin    | ~60         | /26             | 64         |
| DMZ             | ~20         | /27             | 32         |
| CDE / core bnk  | ~20         | /27             | 32         |
| WAN P2P (DC2)   | 2           | /30             | 4          |

**Step 2 — assign aligned subnets from 10.10.0.0/16, largest first:**

```
Subnet            CIDR               Network      Broadcast    Usable range
─────────────────────────────────────────────────────────────────────────────
App / prod tier   10.10.0.0/23       10.10.0.0    10.10.1.255  .0.1 – .1.254
DB tier           10.10.2.0/24       10.10.2.0    10.10.2.255  .2.1 – .2.254
Mgmt / admin      10.10.3.0/26       10.10.3.0    10.10.3.63   .3.1 – .3.62
DMZ               10.10.3.64/27      10.10.3.64   10.10.3.95   .3.65 – .3.94
WAN P2P (DC2)     10.10.3.128/30     10.10.3.128  10.10.3.131  .3.129 – .3.130
CDE / core bnk    10.10.20.0/27      10.10.20.0   10.10.20.31  .20.1 – .20.30
(reserved)        10.10.3.96/27, .3.132 onward
(reserved)        10.10.4.0/22 onward  ← entire /22 free for future growth
```

The CDE is carved from the **dedicated CDE block `10.10.20.0/24`** (the canonical
PCI-scope range for HQ-DC1, see `reference/running-example.md`). Giving the CDE its
own `/24` parent — rather than squeezing it next to DMZ in the `.3.x` range — keeps
the regulated zone in a clearly-labeled, separately-routed block that an auditor can
point at. Within that `/24`, only a `/27` is needed today (~20 hosts); the rest of
the `/24` stays reserved for CDE growth and stays inside PCI scope.

**Verify each subnet — no overlaps, all aligned:**

- `/23` at `10.10.0.0`: block size 512. `0 mod 512 = 0` ✓. Runs to `10.10.1.255`.
- `/24` at `10.10.2.0`: block size 256. `2×256 offset = 512` from /16 base. Starts
  where the /23 ends + 1. ✓ No overlap.
- `/26` at `10.10.3.0`: block size 64. `3×256 + 0 = 768` from base. `0 mod 64 = 0` ✓
- `/27` at `10.10.3.64`: block size 32. `64 mod 32 = 0` ✓. Runs to `.3.95`.
- `/30` at `10.10.3.128`: block size 4. `128 mod 4 = 0` ✓. Runs to `.3.131`.
- `/27` at `10.10.20.0` (CDE, inside the `10.10.20.0/24` block): block size 32.
  `0 mod 32 = 0` ✓. Runs to `.20.31`. Separate `/24` parent — no overlap with `.3.x`.

**The resulting security picture at HQ-DC1:**

```
Internet
    │
    ▼
[ Perimeter FW ]
    │
    ├──[ DMZ: 10.10.3.64/27 ]─── web/API front-ends, reverse proxies
    │
[ Internal FW ]
    │
    ├──[ App tier: 10.10.0.0/23 ]──── application servers
    │       │  (firewall blocks App→DB except port 5432)
    ├──[ DB tier: 10.10.2.0/24 ]───── databases (PostgreSQL, Oracle)
    │
    ├──[ CDE: 10.10.20.0/27 (in 10.10.20.0/24) ]── core banking, card systems
    │       (hardest-isolated; PCI-DSS scope; separate ACLs on every hop)
    │
    ├──[ Mgmt: 10.10.3.0/26 ]──────── jump-hosts, monitoring collectors
    │       (only subnet allowed to SSH/RDP to all others)
    │
    └──[ WAN P2P: 10.10.3.128/30 ]─── link to DC2 (DR)
              .129 = HQ-DC1 router
              .130 = DC2 router
```

Notice: the management and DMZ subnets share the `.3.x` octet range, but they are
**different subnets with different routes and firewall rules**. Being adjacent in
address space does not make them adjacent in security — the router and firewall
between them enforce that boundary. The CDE goes one step further: it lives in its
own `/24` parent (`10.10.20.0/24`), so even its supernet is distinct — the regulated
zone is not just a different subnet, it is a different block an auditor can isolate
and route separately.

**Northwind contrast (see `reference/running-example.md`):**

Northwind acquired "Eastfield Foods," which also used `10.50.0.0/16`. Their IT team
tried to bring the two networks together and hit the overlap problem immediately:
same addresses, different physical networks — no routing without NAT or re-IPing.
This is the M&A subnetting horror that VLSM planning prevents (full story in N11).
At Northwind's plants, each site gets a `/24` carved from `10.50.0.0/16`
(pre-acquisition). With 4 plants + 12 DCs = 16 sites, that is 16 × 256 addresses
out of 65,536 — only 1/16 of the block used. Proof that reserving a `/16` per
region even at "waste" is cheap insurance.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Carving subnets from a parent block | VLSM from enterprise supernet (e.g. `10.10.0.0/16`) | Subnets inside a VPC; GCP VPCs are **global** — one subnet per region, any size /8–/29 | Subnets inside a VPC; AWS VPCs are **regional**; subnets are per-AZ | (Azure: TODO) |
| Smallest usable host subnet | /30 (2 hosts, RFC 3021 allows /31) | /29 minimum for a regular subnet | /28 minimum for most subnets | (Azure: TODO) |
| Reserved addresses per subnet | .0 (network) + last (broadcast) = 2 | 4 reserved: .0 network, .1 gateway, second-to-last, .last broadcast | 5 reserved: .0 network, .1 router, .2 DNS, .3 future, last broadcast | (Azure: TODO) |
| Alignment requirement | Must align to block boundary | No explicit UI check — but misaligned CIDRs are rejected by the API | Must be a valid CIDR (aligned); console enforces this | (Azure: TODO) |
| Isolation between subnets | Router + firewall rules | Firewall rules (VPC-scoped); default: deny-between-subnets not automatic — *you* must write rules | Security Groups (per-ENI, stateful) + NACLs (per-subnet, stateless) | (Azure: TODO) |
| Non-overlapping requirement for hybrid | Critical: VPN/Interconnect breaks on overlap | Cloud VPN / Cloud Interconnect: overlapping ranges cause route conflicts | VPN Gateway / Direct Connect: same; overlapping = broken hybrid | (Azure: TODO) |

**GCP nuance:** In GCP, subnet CIDR ranges within a single VPC cannot overlap, and
you cannot resize a subnet to a smaller prefix later — plan generously. GCP does
allow **secondary ranges** on a subnet (for GKE pod and service IPs), which is
VLSM within a subnet: a separate carved range used only for Pod addresses.

**AWS nuance:** AWS reserves 5 addresses per subnet (not 2 like classic IPv4). For
a `/28` (16 addresses), only 11 are usable. Size your cloud subnets accordingly —
a tight `/28` for a prod tier is risky. Full table in `reference/cheatsheet-cidr.md`.

## Do it (the exercise)

### Part A — Verify Meridian's plan by hand [laptop]

```bash
# Install ipcalc (Debian/Ubuntu) or use Python's ipaddress module
# Option 1: ipcalc
ipcalc 10.10.0.0/23
ipcalc 10.10.2.0/24
ipcalc 10.10.3.0/26
ipcalc 10.10.3.64/27
ipcalc 10.10.3.128/30
ipcalc 10.10.20.0/27

# Option 2: Python (no install needed on most systems)
python3 - <<'EOF'
import ipaddress as ip
subnets = [
    "10.10.0.0/23",
    "10.10.2.0/24",
    "10.10.3.0/26",
    "10.10.3.64/27",
    "10.10.3.128/30",
    "10.10.20.0/27",
]
for cidr in subnets:
    n = ip.ip_network(cidr)
    hosts = list(n.hosts())
    print(f"{cidr:22s}  network={n.network_address}  "
          f"broadcast={n.broadcast_address}  usable={len(hosts)}")
EOF
```

Expected output (verify network/broadcast/usable match the table above):
```
10.10.0.0/23        network=10.10.0.0  broadcast=10.10.1.255  usable=510
10.10.2.0/24        network=10.10.2.0  broadcast=10.10.2.255  usable=254
10.10.3.0/26        network=10.10.3.0  broadcast=10.10.3.63   usable=62
10.10.3.64/27       network=10.10.3.64 broadcast=10.10.3.95   usable=30
10.10.3.128/30      network=10.10.3.128 broadcast=10.10.3.131 usable=2
10.10.20.0/27       network=10.10.20.0  broadcast=10.10.20.31 usable=30
```

### Part B — Detect overlap [laptop]

```python
python3 - <<'EOF'
import ipaddress as ip
nets = [ip.ip_network(c) for c in [
    "10.10.0.0/23", "10.10.2.0/24", "10.10.3.0/26",
    "10.10.3.64/27", "10.10.3.128/30", "10.10.20.0/27",
]]
overlaps = [(a, b) for i, a in enumerate(nets)
            for b in nets[i+1:] if a.overlaps(b)]
print("Overlaps found:", overlaps if overlaps else "none — plan is clean")
EOF
```

Now try adding `10.10.3.80/28` to the list (it overlaps the `/27` at .64) and
observe the script catch it. This is the kind of check every
IPAM tool runs automatically — see N19.

### Part C — Carve a branch subnet for Northwind [paper/laptop]

Northwind's original block is `10.50.0.0/16`. Design a VLSM plan for a single
distribution center with:
- Warehouse floor (scanners/WMS): 120 devices
- Office LAN: 40 devices
- OT/plant-floor network (isolated): 15 devices
- Management/monitoring: 10 devices
- WAN uplink P2P: 2 endpoints

Write the subnet table. Check alignment. Verify no overlaps with the Python snippet
above. Compare with the worked answer:

```
Warehouse floor   10.50.0.0/25   (128 addrs, 126 usable)
Office LAN        10.50.0.128/26 ( 64 addrs,  62 usable)
OT / plant        10.50.0.192/27 ( 32 addrs,  30 usable)
Mgmt/monitoring   10.50.0.224/28 ( 16 addrs,  14 usable)
WAN P2P           10.50.0.240/30 (  4 addrs,   2 usable)
```

Alignment check: each prefix starts at a multiple of its block size. `/25`→128:
`0 mod 128=0` ✓. `/26`→64: `128 mod 64=0` ✓. `/27`→32: `192 mod 32=0` ✓.
`/28`→16: `224 mod 16=0` ✓. `/30`→4: `240 mod 4=0` ✓.

## Say it back (self-check)

1. What is VLSM and why is it superior to equal-length subnetting for a real
   enterprise network?
2. Why must a /27 subnet start at an address that is a multiple of 32? What breaks
   if it doesn't?
3. Meridian's CDE subnet is `10.10.20.0/27` (carved from the dedicated CDE block
   `10.10.20.0/24`). What is the broadcast address? What is the last usable host
   address? (Work it, don't look it up.)
4. AWS reserves 5 addresses per subnet; classic IPv4 reserves 2. If you size a
   `/28` for a cloud subnet, how many hosts can you actually assign?
5. Why does address overlap between two sites make a site-to-site VPN fail, even
   if both sites are technically reachable?

## Talk to the IT/security head

**Ask:**

- "Can you show me the VLSM plan or the IPAM system — specifically how the CDE
  subnet is isolated from app and DB subnets?"
  *Good answer:* a named subnet with a distinct CIDR, distinct VLAN or segment,
  and firewall rules that require explicit permit from every other zone.
  *Red flag:* "CDE is on VLAN 10 but it shares a /16 with everything else and
  we ACL at the switch" — an ACL on a shared subnet is not isolation; it is a
  misconfiguration away from open.

- "What is your process for allocating new subnets — IPAM tool or spreadsheet?"
  *Good answer:* a live IPAM system (Infoblox, NetBox, BlueCat, or even a
  carefully controlled spreadsheet with overlap checks). Someone owns it, changes
  are audited.
  *Red flag:* "people just pick what they need" — overlapping ranges and M&A
  disasters (see N11) are the direct consequence.

- "Do your cloud VPC CIDRs overlap with any on-prem range?"
  *Good answer:* a documented non-overlap matrix (on-prem vs GCP vs AWS vs Azure)
  cross-checked before any new VPC is created. Meridian's plan uses exactly this
  (`10.100.0.0/14` for GCP, `10.104.0.0/14` for AWS — see `running-example.md`).
  *Red flag:* "I think they're different" — uncertainty here is a production
  outage waiting for the first VPN or Interconnect to be provisioned.

- "When you need a new subnet in the CDE, who approves it and how long does it
  take?"
  *Good answer:* a named change process (CAB approval, PCI-DSS scope assessment,
  security sign-off) with a realistic SLA — 2–5 business days in a regulated shop.
  *Red flag:* either "instantly — dev just adds it" (no controls) or "months —
  it's basically impossible" (process so heavy that teams work around it,
  creating shadow subnets).

**Red flags to listen for in any design review:**

- A single /8 or /16 with no internal subnetting ("it's all 10.10.x.x"). No blast
  radius control, no audit trail for zone boundaries.
- Subnet names like "dev", "prod", "test" without documented CIDRs — it's not
  documented until there's an actual IP range.
- Cloud subnets that are copies of on-prem ranges ("we reused 10.10.0.0/24 in the
  VPC"). Hybrid connectivity will break the moment you try to peer them.

## Pitfalls & war stories

- **The /24-everywhere bank.** A mid-size bank had standardized every subnet to
  exactly `/24` regardless of zone size. The CDE had 200 empty addresses and the
  app tier was split across six subnets because someone ran out and carved another.
  The firewall rule base had hundreds of entries trying to compensate. VLSM would
  have cut this to eight subnets and a clean rule policy.

- **The M&A overlap at Northwind.** Northwind acquired Eastfield Foods, both using
  `10.50.0.0/16`. No VPN could be established without NAT on both ends; routing
  tables were contradictory. The re-IP project took eight months (N11). The root
  cause: nobody reserved unique supernets per legal entity during the acquisition
  due-diligence phase — a document-review task, not a network task.

- **Cloud /28 too small.** A team provisioned a `/28` for a GCP Cloud SQL private
  IP subnet (16 addresses, 12 usable after GCP's 4 reserved). GCP's Private Service
  Access requires a `/24` minimum for the managed services peering range. The
  team had to delete and re-create the subnet — a breaking change mid-launch.
  Lesson: cloud services often have *minimum subnet size requirements* that are
  larger than you'd expect. Read the service docs before sizing.

- **The unsegmented CDE.** An RBI audit at a regional bank found that the CDE
  hosts (core banking servers) sat on the same /24 as the general application
  servers — "separated by firewall rules at the same layer-3 boundary." The
  auditor ruled this insufficient: PCI-DSS requires network-level isolation, not
  just access-list filtering within a shared subnet. Emergency re-subnetting during
  an audit window: expensive, risky, and avoidable.

- **Alignment off-by-one.** A junior engineer typed `10.10.3.80/27` instead
  of `10.10.3.96/27`. `80 mod 32 = 16`, not 0 — `.80` is not a valid `/27`
  network address. Rather than creating the intended new subnet, the misaligned
  spec silently collapses onto `10.10.3.64/27` (`.64`–`.95`) — colliding with the
  existing DMZ subnet — because tools normalize host bits away to the block base.
  Always run the alignment check (`network == ip & mask`) before allocating.

## Going deeper (optional)

- **RFC 1918** — the authoritative source for private address ranges. Short
  and worth reading once.
- **RFC 4632** — CIDR (Classless Inter-Domain Routing): the formal specification
  of variable-length prefixes and how routers aggregate them.
- **RFC 3021** — Using 31-bit prefixes on point-to-point links (why /31 is valid
  for WAN P2P even though it has no "network" and "broadcast" in the classical
  sense).
- `reference/cheatsheet-cidr.md` in this repo — quick lookup table for prefix
  sizes, usable counts, and cloud reservations.
- Follows from **N08** (CIDR math) and feeds directly into **N10** (IPv6
  addressing, where VLSM is even more important given /64 per-subnet norms) and
  **N11** (enterprise IP planning at scale: overlap, RFC 6598, M&A).
- Cloud application: **N40** covers subnetting inside GCP and AWS VPCs — the
  same VLSM principles, with cloud-specific constraints (minimum sizes, reserved
  addresses, secondary ranges for GKE).

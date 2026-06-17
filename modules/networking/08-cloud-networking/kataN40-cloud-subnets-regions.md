# Kata N40 — Subnets, regions, zones, cloud IP planning

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N08, N09, N39 · **Time:** ~35 min
> **Tags:** `cloud` `subnets` `regions` `zones` `vpc` `ipam` `gcp` `aws`

## Why it matters

Every cloud resource you deploy lands in a **subnet**. Get the subnet design wrong
and you face one of three pain points: you run out of IP addresses in a region and
can't deploy more VMs without re-architecting; your subnets overlap with on-prem
ranges and the hybrid VPN breaks (the #1 hybrid networking gotcha — see N39); or
regulated data ends up in the wrong geographic region and you fail an RBI or
data-residency audit. For an architect advising Meridian Bank, the IP plan for
cloud is as important — and as hard to change later — as the IP plan for HQ-DC1.

## The mental model

### Region and zone: the physical geography underneath

A **region** is a named geographic cluster of cloud infrastructure — think
"Mumbai" or "Iowa." A **zone** is a failure domain *within* a region — separate
power, cooling, and physical building. Zones share the region's low-latency
backbone but are independent enough that a zone failure doesn't cascade.

```
  GCP: asia-south1 (Mumbai)
  ┌──────────────────────────────────────────────────────┐
  │   Zone a          Zone b          Zone c             │
  │  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
  │  │  VM/GKE  │   │  VM/GKE  │   │  VM/GKE  │         │
  │  └──────────┘   └──────────┘   └──────────┘         │
  │        shared low-latency regional backbone          │
  └──────────────────────────────────────────────────────┘
         ║  interconnect / internet edge
  ────────────────────────────────────────────────────────
  AWS: ap-south-1 (Mumbai)
  ┌──────────────────────────────────────────────────────┐
  │   AZ ap-south-1a    AZ ap-south-1b    AZ ap-south-1c │
  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
  │  │ public subnet│  │ public subnet│  │  (unused)  │  │
  │  │ priv  subnet │  │ priv  subnet │  │            │  │
  │  └──────────────┘  └──────────────┘  └────────────┘  │
  └──────────────────────────────────────────────────────┘
```

**On-prem parallel:** a data center = a region; a separate power feed / UPS
group = a zone. You already spread core and DR across physical failure domains.
Cloud just makes it cheaper and API-driven.

### Subnets: where IPs actually live

A **subnet** is a CIDR block carved from the VPC and tied to placement:

- In **GCP**, subnets are **regional** — one subnet spans all zones in a region.
  A VM in zone `asia-south1-a` and another in `asia-south1-b` can share the
  same subnet and communicate at layer 3 over the VPC fabric (GCP provides no
  L2 broadcast domain). This regional-subnet model is unique to GCP; AWS is
  different (see below).
- In **AWS**, subnets are **zonal** — each subnet lives in exactly one
  Availability Zone. To span three AZs you need (at least) three subnets. The
  high-availability pattern forces you to replicate subnets per AZ.
- In **Azure**, subnets are regional (like GCP) — a VNet spans the whole region
  and subnets cover the region. Zones are assigned per resource, not per subnet.
  (Azure: TODO — verify AZ pinning behaviour per resource type.)

**Why the GCP vs AWS difference matters to an architect:** In AWS, if you size a
subnet too small and it fills up, the other AZ's subnet has free space — but
resources can't "spill over" automatically. You plan capacity per AZ. In GCP,
the whole region's subnet grows or shrinks together, which is simpler to plan but
means a poorly-sized subnet blocks the whole region.

### Cloud IP reservations — not all addresses are usable

Cloud providers silently reserve IPs in every subnet. Before you size a subnet,
subtract the reservations (from N08 cheat-sheet):

| Cloud | Reserved per subnet | /24 usable hosts |
|-------|--------------------|--------------------|
| GCP   | 4 (.0 network, .1 gateway, second-to-last, .255 broadcast) | 252 |
| AWS   | 5 (.0 network, .1 router, .2 DNS, .3 future, last broadcast) | 251 |
| Azure | 5 (.0, .1, .2, .3 reserved, last broadcast) | 251 |

A `/28` (16 addresses) leaves you only **12 usable in GCP**, **11 in AWS/Azure**
— not 14. This is the bite that stings teams who size "tight" subnets for
"security."

### The non-overlap rule

Cloud subnets must **not overlap** with:
1. Each other within the VPC.
2. On-prem ranges (a VPN or Interconnect requires unique address space both ends).
3. Other VPCs you intend to peer (VPC peering rejects overlapping CIDRs).

This is why Meridian Bank's IP plan in `reference/running-example.md` sets cloud
at `10.100.0.0/14` (GCP) and `10.104.0.0/14` (AWS) — deliberately far from
`10.10.0.0/16` (HQ-DC1) and `10.20.0.0/16` (DC2-DR). See also N11 (overlap pain)
and N43 (peering topology).

## Worked example

Meridian Bank is deploying its mobile-banking backend on GCP (`asia-south1`,
Mumbai) with DR in AWS (`ap-south-1`, Mumbai). Data-residency regulation requires
customer data to stay in India.

### GCP subnet plan — carved from `10.100.0.0/14`

Meridian allocates `10.100.0.0/16` to GCP `asia-south1`. One /16 gives 65,536
addresses across the region; sub-dividing into /20 blocks (4,096 addresses, 4,092
usable in GCP) by function:

```
  VPC: meridian-prod (GCP, global; subnet scoped to asia-south1)
  ┌──────────────────────────────────────────────────────────┐
  │  asia-south1                                             │
  │                                                          │
  │  10.100.0.0/20  ── frontend (load balancer backends)     │
  │  10.100.16.0/20 ── backend-api (app servers)             │
  │  10.100.32.0/20 ── data-tier  (Cloud SQL, Memorystore)   │
  │  10.100.48.0/20 ── mgmt/ops   (bastion, monitoring)      │
  │  10.100.64.0/18 + 10.100.128.0/17 (remainder,            │
  │     10.100.64.0–10.100.255.255) — reserved for future    │
  │     services                                             │
  └──────────────────────────────────────────────────────────┘
```

Math check for `10.100.16.0/20`:
- Network address: `10.100.16.0`
- Broadcast address: `10.100.31.255`
- Host range: `10.100.16.1` – `10.100.31.254`
- Usable in GCP: 4096 − 4 = 4,092 addresses (gateway at .1, reserved near top)
- Next block starts cleanly at `10.100.32.0` ✓

A secondary GCP region (e.g. `asia-south2` Delhi, still in-country for data
residency) would share the same global VPC (GCP VPCs are global), so Meridian
uses `10.101.0.0/16` for it, still within the `10.100.0.0/14` supernet
(`10.100.0.0` – `10.103.255.255`).

### AWS subnet plan — carved from `10.104.0.0/14`

AWS subnets are **zonal**. Meridian uses `10.104.0.0/16` for `ap-south-1`. They
need public subnets (for NAT gateways and load balancers) and private subnets
(for app + DB) in two AZs for HA:

```
  VPC: meridian-dr (AWS, ap-south-1)   10.104.0.0/16
  ┌────────────────────────────────────────────────────────┐
  │  AZ ap-south-1a              AZ ap-south-1b            │
  │  10.104.0.0/20  (public)     10.104.16.0/20 (public)   │
  │  10.104.32.0/20 (private)    10.104.48.0/20 (private)  │
  └────────────────────────────────────────────────────────┘

  10.104.0.0/20:  .0 network · .1 router · .2 DNS · .3 reserved
                  first usable: 10.104.0.4
                  last usable:  10.104.15.254  (10.104.15.255 broadcast)
                  usable hosts: 4096 − 5 = 4,091
```

The ranges do not overlap each other or the on-prem ranges (`10.10.0.0/16`,
`10.20.0.0/16`), so a VPN from HQ-DC1 can route cleanly to both clouds without NAT.

### The IP plan on one page

```
  10.0.0.0/8   Meridian enterprise supernet
  ├── 10.10.0.0/16  HQ-DC1 (on-prem primary DC)
  ├── 10.20.0.0/16  DC2-DR (on-prem DR)
  ├── 10.30.0.0/16  Branches (220 retail branches)
  ├── 10.40.0.0/16  Corp offices
  ├── 10.100.0.0/14 GCP  (10.100–10.103)
  │   ├── 10.100.0.0/16  asia-south1 (Mumbai, primary)
  │   └── 10.101.0.0/16  (reserved, second GCP region)
  └── 10.104.0.0/14 AWS  (10.104–10.107)
      └── 10.104.0.0/16  ap-south-1  (Mumbai, DR)
  (10.108.0.0/14 reserved for Azure — running-example.md)
```

No overlaps. Hybrid routing works without NAT. The auditor can trace any IP to
its owner and zone.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Address space container | IP plan / supernet | VPC (global resource) | VPC (regional resource) | VNet (regional resource) |
| Subnet scope | VLAN / L3 segment per switch | Regional (spans all zones) | Zonal (one AZ each) | Regional (spans all zones) |
| HA subnet pattern | Deploy to two physical chassis/feeds | One subnet serves all zones | Separate subnet per AZ — minimum 2× subnets per tier | One subnet, pin resources to zones |
| Reserved IPs per subnet | 2 (network + broadcast) | 4 | 5 | 5 |
| Subnet size minimum | Any (/30 practical) | /29 minimum | /28 minimum | /29 minimum |
| IP address management | IPAM tool (Infoblox, etc.) | Cloud IPAM (preview) / spreadsheet / Terraform | AWS VPC IPAM (service) | Azure IPAM (within portal) |
| Subnet naming & tagging | IPAM or AD conventions | Labels on subnet resource | Tags on subnet resource | Tags on subnet resource |
| Private RFC 1918 range | Any RFC 1918 | Any RFC 1918 (GCP also supports RFC 6598) | Any RFC 1918 | Any RFC 1918 |
| Region choice driver | DC location, latency, DR | Nearest region to users + data-residency requirement | Same | Same |

## Do it (the exercise)

**Part 1: Subnet math by hand** [laptop]

1. Open a terminal and verify the Meridian GCP backend-api subnet:
   ```bash
   python3 -c "
   import ipaddress as ip
   n = ip.ip_network('10.100.16.0/20')
   print('Network:   ', n.network_address)
   print('Broadcast: ', n.broadcast_address)
   print('Addresses: ', n.num_addresses)
   print('GCP usable:', n.num_addresses - 4)
   print('Next block:', ip.ip_network('10.100.32.0/20').network_address)
   "
   ```
   Expected: network `10.100.16.0`, broadcast `10.100.31.255`, 4096 addresses,
   4092 GCP-usable, next block at `10.100.32.0`.

2. Verify the AWS public subnet `10.104.0.0/20`:
   ```bash
   python3 -c "
   import ipaddress as ip
   n = ip.ip_network('10.104.0.0/20')
   print('First usable (AWS, .4):', list(n.hosts())[3])
   print('Last usable:           ', list(n.hosts())[-1])
   print('AWS usable:            ', n.num_addresses - 5)
   "
   ```

3. Confirm the GCP supernet bounds — does `10.100.0.0/14` really cover
   `10.100.0.0` through `10.103.255.255`?
   ```bash
   python3 -c "
   import ipaddress as ip
   n = ip.ip_network('10.100.0.0/14')
   print('First:', n.network_address, 'Last:', n.broadcast_address)
   print('/16 blocks available:', n.num_addresses // 65536)
   "
   ```
   Expected: First `10.100.0.0`, Last `10.103.255.255`, 4 × /16 blocks.

**Part 2: Check for overlaps** [laptop]

```bash
python3 -c "
import ipaddress as ip
nets = {
    'HQ-DC1':    '10.10.0.0/16',
    'DC2-DR':    '10.20.0.0/16',
    'Branches':  '10.30.0.0/16',
    'Corp':      '10.40.0.0/16',
    'GCP':       '10.100.0.0/14',
    'AWS':       '10.104.0.0/14',
}
pairs = [(a, b) for a in nets for b in nets if a < b]
for a, b in pairs:
    na = ip.ip_network(nets[a])
    nb = ip.ip_network(nets[b])
    if na.overlaps(nb):
        print(f'OVERLAP: {a} {nets[a]} overlaps {b} {nets[b]}')
print('Done — any OVERLAP lines above mean trouble.')
"
```
Expected: no OVERLAP lines printed. If you see any, the hybrid VPN would break.

**Part 3: Region / zone reasoning** [paper]

Draw a box for `asia-south1`. Inside it draw three zones (a, b, c). Add a single
`10.100.16.0/20` subnet rectangle spanning all three zones. Add two VMs — one in
zone-a, one in zone-b — both inside the same subnet. Now draw the AWS equivalent:
two separate `/20` subnets, one per AZ, each containing its own VM. Label which
design needs more subnets to achieve the same HA outcome, and why.

**Part 4: Inspect real cloud subnet reservations** [needs cloud account]

GCP (Cloud Shell or `gcloud`):
```bash
gcloud compute networks subnets describe <your-subnet> \
  --region=asia-south1 \
  --format="value(ipCidrRange, gatewayAddress)"
```
The `gatewayAddress` is always the `.1` of the range — confirming the GCP /20
gateway reservation.

AWS (CLI):
```bash
aws ec2 describe-subnets --filters "Name=cidr-block,Values=10.104.0.0/20" \
  --query 'Subnets[*].{CIDR:CidrBlock,AZ:AvailabilityZone,Available:AvailableIpAddressCount}'
```
The `AvailableIpAddressCount` for a fresh /20 should be 4091 (4096 − 5).

## Say it back (self-check)

1. What is the difference between a region and a zone? Give one concrete example
   of when you'd spread resources across zones but *not* regions.
2. In GCP, a subnet is regional. In AWS, a subnet is zonal. What practical
   consequence does this have when you design a two-AZ HA cluster in each cloud?
3. A `/24` subnet in AWS has how many usable host addresses? In GCP? Why do they
   differ?
4. Meridian Bank's GCP range is `10.100.0.0/14`. List the four /16 blocks it
   contains without a calculator.
5. Why must cloud subnets not overlap with on-prem ranges, even if the on-prem
   and cloud networks aren't yet connected?

## Talk to the IT/security head

**Ask:**
- "What IP ranges are already in use on-prem, in cloud, and across any acquired
  companies?" *(If they can't answer immediately, that's the gap — expect pain
  when you try to build hybrid connectivity.)*
- "Have you defined a cloud IP plan at the supernet level, or are VPCs and
  subnets being created ad-hoc per project team?" *(Ad-hoc = eventual overlap =
  blocked Interconnect.)*
- "Which regions must regulated/customer data stay within? Does your subnet plan
  enforce that, or does it rely on people not making mistakes?" *(The right answer
  is policy + automation, not trust.)*
- "How many IP addresses do you actually need per subnet tier, including future
  growth? Have you accounted for cloud provider reservations?" *(A /28 for a
  Kubernetes node pool is the classic "we didn't think it would grow" mistake.)*
- "Do you have a process to detect and prevent subnet-CIDR overlap before a new
  VPC is provisioned?" *(AWS VPC IPAM / GCP Cloud IPAM / Terraform validation
  policies are the right answers here.)*

**A good answer sounds like:** a named supernet per cloud, documented non-overlap
with on-prem, region choices tied to data-residency policy, and subnet sizes
chosen with at least 3× headroom for growth. The IT head or cloud platform team
should have a single source of truth for IP allocation (spreadsheet at minimum,
IPAM tool ideally).

**Red flags:**
- "Each team just picks a /16 when they need it." → Overlap is coming.
- "We can always NAT." → NAT breaks VPN routing and complicates troubleshooting;
  it's a workaround, not a plan.
- "We haven't connected on-prem to cloud yet so it doesn't matter." → It matters
  the day you do; re-subnetting live VPCs is painful and disruptive.
- Regions chosen by default (e.g. `us-east-1` for an Indian bank) with no
  data-residency review.

## Pitfalls & war stories

**The /28 Kubernetes node pool.** A team creates `10.100.64.0/28` (12 usable in
GCP after reservations) for a "small" GKE node pool. At 3 nodes × 110 pods each,
GCP's secondary IP ranges for pods also need space. They exhaust addresses within
weeks, can't add nodes, and have to re-create the cluster. Always size for peak +
growth + cloud reservations + secondary ranges if using GKE/EKS.

**Overlap discovered at Interconnect time.** Northwind acquires Eastfield Foods
(also on `10.50.0.0/16` — see running-example.md). When the network team tries to
connect both to the same AWS Transit Gateway, AWS rejects the route advertisement
because both VPCs claim the same CIDR. The fix is re-IPing one side — weeks of
work. The lesson: establish a supernet registry before the M&A deal closes.

**Data residency by default, not by design.** A project team deploys a GCP subnet
in `us-central1` because that's the default region in Terraform. Meridian Bank's
RBI data-residency requirement says customer PII stays in India. Nobody checks
until the annual audit. Remediating means migrating VMs, snapshots, and Cloud SQL
instances — all while live. The right fix: org policy constraints
(`gcp.resourceLocations`) that prevent resource creation outside approved regions.

**"We'll plan IPs later."** For on-prem VLANs this is painful. For cloud VPCs
it's worse: a VPC's primary CIDR cannot be changed after creation in AWS or GCP.
You can add secondary ranges, but the original /16 stays. Get the supernet
allocation right before the first `terraform apply`.

## Going deeper (optional)

- GCP documentation — [Subnets overview](https://cloud.google.com/vpc/docs/subnets):
  GCP-specific regional subnet model and secondary ranges for GKE.
- AWS documentation — [VPCs and subnets](https://docs.aws.amazon.com/vpc/latest/userguide/configure-your-vpc.html):
  the zonal model and VPC IPAM.
- RFC 1918 — private address space. The bedrock of enterprise and cloud IP
  planning (see N07).
- RFC 6598 — `100.64.0.0/10` CGNAT range; GCP uses this for internal
  load-balancer forwarding rules and some Google-internal services.
- Pairs with N39 (the VPC mental model — what a VPC is before you subnet it),
  N41 (route tables and internet/NAT gateways — where traffic goes once it leaves
  a subnet), and N11 (IP overlap, M&A pain, and how to fix it).

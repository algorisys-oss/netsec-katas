# Kata N51 — Multi-cloud connectivity & the egress-cost trap

> **Track:** Networking · **Module:** N9 Hybrid & multi-cloud · **Prereqs:** N39, N41, N43, N48 · **Time:** ~40 min
> **Tags:** `multi-cloud` `egress` `cost` `vpc` `interconnect` `hybrid` `gcp` `aws`

## Why it matters

The moment Meridian Bank's analytics team and digital channel are split across
GCP and AWS — or Northwind consolidates three acquisitions onto different clouds —
traffic that used to stay "inside" now crosses cloud boundaries. Cloud providers
charge for every gigabyte that leaves their network (egress pricing). A 10 TB/day
data pipeline between GCP and AWS that nobody modelled at design time can add
$30,000+ per month to the cloud bill. Beyond cost, the routing path between clouds
often surprises architects: data may cross the public internet unless a private
path is explicitly engineered, which matters enormously to the Meridian CISO and
any PCI/RBI auditor asking "where does cardholder data travel?"

## The mental model

### 1. Egress is priced; ingress is (mostly) free

Every major cloud provider charges for data **leaving** their network. Prices
vary by destination — traffic to the public internet costs more than traffic to
another region; traffic via a dedicated link may cost less than public egress.
Ingress (data coming in) is almost always free.

```
  Cloud Provider
  ┌────────────────────────────────────────────┐
  │                              (free ingress)│◄── from internet / partner cloud
  │   GCP / AWS / Azure                        │
  │                                            │──► to internet          $$$ EGRESS
  │                                            │──► to another cloud     $$$ EGRESS
  │                                            │──► to on-prem           $ EGRESS (less via
  └────────────────────────────────────────────┘     dedicated link)
```

Rule of thumb for 2024–2025 list pricing (always verify with pricing calculator):
- GCP egress to internet: ~$0.08–$0.12/GB after the first 1 GB/month free
- AWS egress to internet: ~$0.09/GB (first 100 GB/month free, then tiered)
- Cloud-to-cloud (GCP ↔ AWS) via internet: both providers charge their own egress
  — you pay **twice**, once on each side
- Via dedicated link (Cloud Interconnect / Direct Connect): typically ~$0.02–0.05/GB
  egress, often cheaper than internet egress

### 2. The three ways clouds talk to each other

```
Option A — Public internet (default, zero config, worst for cost/security)

  GCP VPC ──────► GCP public IP ──► internet ──► AWS public IP ──► AWS VPC
  ($_egress_GCP)                                 ($_egress_AWS)

Option B — IPsec VPN over internet (encrypted, still pays egress)

  GCP VPC ──► Cloud VPN gateway ──► internet ──► AWS VPN gateway ──► AWS VPC
  (traffic encrypted, but both sides still charge egress)

Option C — Private backbone via dedicated interconnect at a co-location exchange

  GCP VPC ──► Cloud Interconnect ──► IX / colocation ──► Direct Connect ──► AWS VPC
  (private, lower latency, typically cheaper per-GB at scale)
```

Option C requires a colocation or IX facility where both providers are present
(Equinix, Digital Realty, etc.). The actual fiber connects your dedicated
interconnect port to an AWS Direct Connect port in the same building.

### 3. Why the default path is usually "public internet without you noticing"

An app on GCP that calls an API endpoint `api.aws-service.example.com` resolves
that name to a public IP. Packets leave GCP via its default internet gateway,
traverse the public internet, and enter AWS at a public IP — even if both VPCs
carry RFC 1918 addresses internally. Neither side refuses to forward it; there is
no warning. Egress charges accumulate silently.

### 4. The egress-cost trap at scale

```
  10 TB/day inter-cloud × 30 days = 300 TB/month

  GCP egress:  300,000 GB × $0.08 = $24,000
  AWS ingress:  free
  AWS egress (responses): variable — even at 10% response volume:
               30,000 GB × $0.09 = $2,700

  Monthly surprise: ~$26,700 (just the cloud bills; circuit costs on top)
```

For a bank with data residency rules the cost is secondary to the question:
**does this traffic leave the country?** Public internet routing cannot
guarantee which AS paths or physical cables it traverses.

## Worked example

**Meridian Bank** runs:
- GCP (primary cloud): `10.100.0.0/14` — mobile/web banking, customer analytics
- AWS (secondary cloud): `10.104.0.0/14` — fraud detection microservices

The fraud service (`10.104.10.5`) needs to consume the transaction-event stream
from a Pub/Sub-like queue in GCP (`10.100.20.0/24` — analytics subnet).

**Step 1 — What happens without explicit design (the trap)**

The GCP service publishes to a topic endpoint with a public IP. The AWS Lambda
consumer resolves the public endpoint, traffic exits GCP's network, traverses
the internet, and re-enters AWS. Both clouds charge egress. Daily volume: 2 TB.

```
  Monthly egress cost (rough):
    GCP:  60,000 GB × $0.08 = $4,800
    AWS:  ~6,000 GB responses × $0.09 = $540
    Total: ~$5,340/month — for one pipeline
```

The Meridian CISO also flags that the transaction events (which include partial
account references) traversed the public internet — a PCI-DSS gap.

**Step 2 — Adding a private path**

Meridian contracts for a 1 Gbps Cloud Interconnect at Equinix MB1 (Mumbai) and
a 1 Gbps AWS Direct Connect at the same facility. On the GCP side, 1 Gbps is only
available via **Partner Interconnect** (a 1 Gbps VLAN attachment) — GCP Dedicated
Interconnect circuits start at 10 Gbps. On the AWS side, Direct Connect offers a
1 Gbps Dedicated port directly. Both IP ranges are non-overlapping (by design —
see `reference/running-example.md`), so no NAT is needed.

```
  GCP VPC (10.100.0.0/14)
       │
       │  Cloud Interconnect VLAN attachment
       │  (router: 169.254.0.1/30 link-local on the GCP side)
       ▼
  Equinix MB1 cross-connect
       │
       │  AWS Direct Connect Virtual Interface (VIF)
       │  (router: 169.254.0.2/30 link-local on the AWS side)
       ▼
  AWS VPC (10.104.0.0/14)
```

BGP sessions advertise:
- GCP announces `10.100.0.0/14` to AWS side
- AWS announces `10.104.0.0/14` to GCP side

The fraud service now reaches `10.100.20.x` directly over the private path.

**Step 3 — Cost comparison**

```
  Partner Interconnect (GCP, 1 Gbps VLAN attachment): ~$700/month
  + egress over interconnect: 60,000 GB × $0.02 = $1,200
  Direct Connect (AWS, 1 Gbps port): ~$220/month port fee
  Cross-connect at Equinix: ~$300/month

  Total with private path: ~$2,420/month
  Saving vs public internet: ~$5,340 − $2,420 = $2,920/month saving

  Break-even: 1 month (ports paid for in month 1 by savings alone)
```

At higher volumes (Northwind's analytics scale) the saving is proportionally
larger and the case is made in week one of a design conversation.

**On-prem anchor — HQ-DC1 as the meet-me point**

An alternative (common at banks that already have MPLS and a co-lo presence):
route cloud-to-cloud traffic through on-prem:

```
  GCP ──► Cloud Interconnect ──► HQ-DC1 (10.10.0.0/16) ──► MPLS ──► co-lo ──► Direct Connect ──► AWS
```

This lets the security team apply firewall inspection at HQ-DC1 before traffic
reaches AWS (defense in depth — see S01). It adds latency (one extra hop) and
uses the Interconnect + MPLS bandwidth, but is a common choice when the security
and compliance team requires east-west inspection of inter-cloud flows.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem equivalent | GCP | AWS | Azure |
|---------|-------------------|-----|-----|-------|
| Dedicated private link to cloud provider | Private leased line / MPLS to DC | **Cloud Interconnect** (Dedicated or Partner) | **Direct Connect** (Dedicated or Hosted) | ExpressRoute |
| Cloud-to-cloud via private backbone | Site-to-site MPLS between DCs | Cloud Interconnect + cross-connect + Direct Connect (at same IX) | Same, from AWS side | (Azure: TODO) |
| Encrypted tunnel over internet (budget option) | IPsec VPN between firewalls | **Cloud VPN** (HA VPN, 2 tunnels, up to ~3 Gbps per tunnel, per-flow, best-effort) | **Site-to-Site VPN** (up to 1.25 Gbps per tunnel) | VPN Gateway |
| Transit routing hub | Core router / MPLS PE | **Network Connectivity Center (NCC)** | **Transit Gateway (TGW)** | Virtual WAN |
| Egress pricing unit | Bandwidth (committed rate) | Per-GB; free within same region, priced cross-region & internet | Per-GB tiered; free tier 100 GB/month | Per-GB tiered |
| Private service endpoint (no internet) | MPLS private APN | **Private Service Connect (PSC)** | **PrivateLink** | Private Endpoint |
| Colocation / IX where both providers meet | Your own DC / co-lo rack | Equinix, Digital Realty, CoreSite (GCP-listed facilities) | Same facilities (AWS Direct Connect locations list) | Same IX facilities |

**Key difference — GCP vs AWS VPC model for hybrid:**
- GCP VPCs are **global**: a single VPC spans all regions; one BGP session via
  Cloud Interconnect can advertise subnets from any region in that VPC.
- AWS VPCs are **regional**: you need a Direct Connect Virtual Interface (VIF)
  per VPC, or use Transit Gateway to aggregate multiple VPCs behind one VIF.

This matters for design: connecting Meridian's GCP analytics (multi-region) to
AWS fraud detection requires one Cloud Interconnect VLAN attachment on the GCP
side but potentially a Transit Gateway VIF aggregator on the AWS side.

## Do it (the exercise)

**Part 1 — Cost modelling [laptop]**

Using publicly available pricing pages (no account needed):

1. Open GCP's egress pricing page (search "GCP network egress pricing") and
   find the price for traffic exiting GCP to "worldwide destinations (excluding
   China & Australia)" after the first 1 TB/month. Note the per-GB price.
2. Open AWS's data transfer pricing page and find the price for data transferred
   OUT to the internet (non-AWS) after the free tier.
3. Model this scenario: an AWS service pulls 5 TB/month from a GCP API endpoint
   over the public internet. What is the combined monthly egress cost? Show the
   math (GCP side + AWS response egress).
4. Now model the same 5 TB/month via Cloud Interconnect + Direct Connect. Use
   GCP's "Interconnect egress" rate and AWS's "Direct Connect data transfer out"
   rate. Add approximate port fees for a 1 Gbps port at each provider. At what
   monthly volume does the private path break even vs the public path?

**Part 2 — BGP route logic [laptop / paper]**

No cloud account needed — reason through this:

1. GCP advertises `10.100.0.0/14` over the BGP session on the Cloud Interconnect
   VLAN attachment. AWS's Direct Connect router receives this prefix. Write the
   BGP UPDATE message fields you'd expect: NLRI prefix, next-hop (use the
   link-local `169.254.x.x` range).
2. An EC2 instance in `10.104.10.0/24` sends a packet to `10.100.20.5`. Trace
   the path: which routing table entry matches? Is this a host route or prefix
   route? What is the next hop?
3. Why must `10.100.0.0/14` and `10.104.0.0/14` not overlap? What would happen
   to BGP route selection if they did? (See `reference/running-example.md` for
   Meridian's IP plan rationale.)

**Part 3 — Verify public vs private path [laptop]**

You can observe the difference in path character without a real Interconnect:

```bash
# From your laptop, traceroute to a public GCP IP vs a known AWS endpoint
# and compare AS path length / RTT
traceroute -n storage.googleapis.com   # GCP public egress
traceroute -n s3.amazonaws.com         # AWS public egress
```

Note how many hops each takes and the RTT. A private interconnect would reduce
hop count (no internet AS hops) and improve RTT consistency.

**Part 4 — Read a cloud pricing bill line [laptop / needs cloud account]**

[needs cloud account] In GCP Console → Billing → Reports, filter by SKU
"Network Egress." Identify:
- Egress to the same continent vs egress to another continent (price differs)
- Whether any "inter-region" egress appears (same cloud, different regions)
- The unit price per GB for each line

## Say it back (self-check)

1. Why does cloud-to-cloud traffic over the public internet incur egress charges
   on **both** sides? Describe the path for a GCP-to-AWS call and name where each
   charge occurs.
2. What is the key structural difference between Cloud Interconnect and Cloud VPN,
   and when does the cost equation favour the Interconnect?
3. GCP VPCs are global; AWS VPCs are regional. How does this difference affect
   the number of BGP sessions needed to connect a multi-region GCP setup to AWS?
4. Meridian's IP plan uses `10.100.0.0/14` for GCP and `10.104.0.0/14` for AWS.
   Why is non-overlap mandatory when routing over a private interconnect?
5. Name two reasons — beyond cost — why a bank CISO cares which physical path
   inter-cloud traffic takes.

## Talk to the IT/security head

**Ask:**

- "Have we modelled the egress cost for traffic that will cross cloud boundaries?
  What's the daily volume and which path does it take today?" *(Most teams
  haven't — this question alone saves money.)*

- "Is any regulated or PCI-scoped data flowing between our clouds? If so, can
  we prove it stays in-country and on a private path?" *(The CISO needs a
  clear yes/no for the auditor; "probably yes" is not an answer.)*

- "Do we have a dedicated interconnect today, or are we using VPN over internet?
  At what data volume did we last revisit that decision?" *(VPN made sense at
  100 GB/month; at 10 TB/month it's both expensive and a bandwidth ceiling.)*

- "Which colocation facility are our Cloud Interconnect and Direct Connect ports
  in? Who manages the cross-connect between them?" *(Often no single person owns
  this; it falls in the seam between cloud team and network team.)*

- "What is our BGP policy at the interconnect edge — do we announce default
  routes, or specific prefixes only?" *(Announcing a default route from cloud to
  on-prem can accidentally route all internet traffic through the cloud; a common
  mistake with real cost and security consequences.)*

**A good answer sounds like:** the network team can state the daily/monthly
cross-cloud data volume, the path it takes (VPN vs Interconnect), the colocation
facility and port owner, and the BGP prefix policy. The CISO can confirm whether
regulated data has been assessed for path compliance. Cost is modelled in the
cloud billing dashboard.

**Red flags:**
- "We just let it go over the internet" (no design decision, no cost model,
  likely no data-residency assessment).
- Blank looks when you ask about the colocation cross-connect owner — this is a
  gap that causes outages and mis-billed months.
- BGP policy that announces `0.0.0.0/0` from cloud into on-prem — unless
  intentional, this routes all branch internet traffic via the cloud, multiplying
  egress cost and adding unexpected latency.
- No cost model for egress; engineers say "it can't be that much" — it usually is.

## Pitfalls & war stories

**The invisible inter-cloud pipeline.** A Northwind analytics team built an ETL
job that pulls 8 TB/day from an AWS S3 bucket into GCP BigQuery. Both were in
the same AWS region (ap-south-1) and GCP region (asia-south1). The pipeline ran
happily for two months before the cloud bill review. The month's egress: ~$17,000.
Nobody had mapped the data flow in the architecture review.

**BGP default-route leak.** An FSI client set up Cloud Interconnect and
configured the on-prem router to accept a `0.0.0.0/0` default route advertised
from GCP. All 220 bank branches started routing their internet traffic through
the cloud (via HQ-DC1), quadrupling GCP egress. The cloud bill arrived before
anyone noticed the latency increase. The fix was a BGP route filter — a one-line
config — but it took three weeks to get through change control.

**Double-NAT kills private routing.** A team added NAT on both sides of the
interconnect "just in case." The result: both ends thought they were talking to
an RFC 1918 address in the other party's range, but the NAT tables weren't
synchronized. Connections worked intermittently. The lesson: design non-
overlapping address spaces (as Meridian did) and avoid NAT on the private path.

**The colocation cross-connect nobody owns.** Cloud Interconnect terminates in a
GCP cage at Equinix; Direct Connect terminates in an AWS cage. The copper/fiber
between them is a "cross-connect" ordered from Equinix's portal. At one client,
the cloud team ordered the GCP port, the network team ordered the AWS port, and
nobody ordered the cross-connect — the circuit sat dark for six weeks while both
teams assumed the other had done it.

**Latency surprise on the cloud-over-on-prem path.** Routing AWS→on-prem→GCP
added 18 ms each way compared to direct interconnect. For fraud detection that
needed sub-100 ms end-to-end, this was an architectural show-stopper discovered
in load testing, not design. Lesson: model the latency budget before committing
to a topology (see N53).

**Data residency and the regional BGP session.** Meridian's GCP setup is multi-
region (asia-south1 and asia-east1). Because GCP VPCs are global, a Cloud
Interconnect in Mumbai could, without policy, route traffic destined for the
asia-east1 subnet. For data-residency compliance (India-based customer data must
not transit Hong Kong), Meridian applied VPC subnet-level routing policies to
ensure only asia-south1 subnets are reachable via the Mumbai Interconnect.

## Going deeper (optional)

- GCP Cloud Interconnect overview and pricing:
  `cloud.google.com/network-connectivity/docs/interconnect`
- AWS Direct Connect documentation and pricing:
  `aws.amazon.com/directconnect/`
- RFC 4271 — BGP-4: the protocol specification for the BGP sessions described here.
- RFC 1918 — address allocation for private internets: the basis for Meridian's
  non-overlapping address plan.
- Equinix Cloud Exchange Fabric (ECX): mechanism that automates cross-cloud
  private connectivity in co-location (avoids manual cross-connect ordering).
- Pairs with N48 (hub-and-spoke / Transit Gateway / NCC) for topology design,
  and N57 (costing a network design) for full cost modelling.
- For data-residency compliance context, see N29 (PCI-DSS / RBI / data residency).

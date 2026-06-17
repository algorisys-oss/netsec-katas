# Kata N57 — Costing a network design (egress, interconnect, LB, NAT, IPs)

> **Track:** Networking · **Module:** N11 Conversation mastery · **Prereqs:** N41, N43, N46, N51, N38 · **Time:** ~35 min
> **Tags:** `networking` `cost` `egress` `cloud` `interconnect` `load-balancing` `nat` `architecture-review`

## Why it matters

Network costs are the surprise line item that blows cloud budgets and kills
business cases. A vendor proposes a "simple" hub-and-spoke design; the IT head
says yes; then three months later the egress and interconnect bills arrive and
the CFO asks why nobody modelled them. At Meridian Bank, a 1 TB/month data-
replication flow between GCP and AWS can cost more per year than the EC2 instance
running the workload. At Northwind, moving analytics from on-prem to GCP while
keeping the source data in an on-prem warehouse can triple the expected cloud bill.

As the architect in the room, your job is not to produce a precise invoice — that
is the cloud team's job with a billing calculator. Your job is to name the cost
*dimensions*, know which traffic pattern drives which meter, ask the questions
that surface surprises early, and flag when a design trades latency or simplicity
for a cost the business has not seen yet.

## The mental model

There are five cost meters on any cloud network design. Each has its own billing
model and its own traffic trigger. Know them in order of surprise potential:

```
  1. EGRESS          outbound bytes leaving a cloud region (or zone, or CDN PoP)
  2. INTERCONNECT     port-hour + Gbps commitment for a dedicated link; or
                      VPN gateway-hour + data processed
  3. LOAD BALANCER    forwarding-rule-hour + data processed per LB rule
  4. NAT GATEWAY      gateway-hour + data processed per GB
  5. PUBLIC IPs       hourly charge per reserved or in-use external IP
```

**Egress is the big one.** The asymmetry is intentional: ingress (data coming
*in* to the cloud) is usually free; egress (going *out*) is priced. This shapes
every design decision that involves getting data *back out* — to the internet, to
another region, to another cloud, or to on-prem.

```
  ┌──────────────────────────────────────────────────────────┐
  │              CLOUD REGION                                │
  │                                                          │
  │  ┌────────┐    ┌─────┐    ┌──────────────┐              │
  │  │ source │───>│ LB  │───>│  workload VM │              │
  │  └────────┘    └─────┘    └──────┬───────┘              │
  │                 ▲ meter          │ meter: zone egress    │
  │                 │ fwd rule-hr    │                       │
  │                 │ + data proc    ▼                       │
  │               ┌─────┐     ┌──────────────┐              │
  │               │ NAT │     │  object store│              │
  │               └──┬──┘     └──────────────┘              │
  │  meter:          │  meter: gateway-hr                    │
  │  gateway-hr +    │  + data processed                     │
  │  data proc   ────┼──────────────────────────────────────►│
  │                  │                       REGION EGRESS   │
  └──────────────────┼──────────────────────────────────────┘
                     │
           internet / on-prem / other cloud
           ← this byte flow gets billed at egress rates ►
```

**Hierarchy of egress pricing (cheapest to most expensive, roughly):**

| Traffic path | Typical cost band |
|---|---|
| Same zone (GCP: within zone) | Free or near-free |
| Same region, different zones | Low (GCP ~$0.01/GB) |
| Same continent, different region | Medium (~$0.01–0.08/GB) |
| Cross-continent (e.g. us→europe) | Higher (~$0.08/GB) |
| To internet (general) | High (~$0.08–0.12/GB) |
| Via CDN PoP → internet | Often cheaper than direct egress |
| To another cloud (cross-cloud) | Same as internet egress, often ~$0.08/GB |

*Rates shift; always confirm with the pricing calculator. The proportions are
stable even when exact numbers move.*

**Why interconnect changes the math.** A 10 Gbps Cloud Interconnect (GCP) or
Direct Connect (AWS) port costs a flat monthly fee (roughly $1,700–2,000/month
for a 10 Gbps GCP VLAN attachment at the partner tier) plus the attached VLAN
attachment hourly rate, but the data transferred *over* the interconnect is
priced at a lower per-GB egress rate (~$0.02–0.05/GB vs ~$0.08/GB over the
internet). The break-even point depends on volume: small flows are cheaper over
internet VPN; large sustained flows tip toward interconnect.

**Load balancer forwarding rules** are billed by the hour (GCP: ~$0.025/rule-hr,
~$18/month per rule). Data processed through the LB adds another per-GB charge.
Running five unused forwarding rules for a year costs more than most people expect.

**NAT gateways** charge gateway uptime plus per-GB processed. For a large VM
fleet where most traffic is outbound (e.g. package pulls, telemetry agents), the
NAT data-processing meter runs continuously. The fix is often "use Private Google
Access or VPC endpoints so traffic never hits NAT."

**Public (external) IP addresses** have an hourly charge when reserved but not
attached, or sometimes when attached to a running instance. At Northwind's scale
— 3,000 sites each with an SD-WAN device — the IP address bill alone is non-
trivial.

## Worked example

**Meridian Bank: GCP primary region (`asia-south1`, Mumbai) + AWS secondary
(`ap-southeast-1`, Singapore) + HQ-DC1 on-prem.**

GCP VPC: `10.100.0.0/14` (see `reference/running-example.md`).
AWS VPC: `10.104.0.0/14`.

Suppose the mobile-banking analytics pipeline moves 500 GB/day from GCP Cloud
Storage to an AWS Redshift cluster (cross-cloud). Here is the cost breakdown
the architect should be able to sketch before the billing team runs the calculator:

```
  Scenario: 500 GB/day GCP → AWS (cross-cloud = internet egress from GCP's view)

  Egress from GCP asia-south1 to internet:
    500 GB/day × 30 days = 15,000 GB/month
    GCP internet egress rate (asia): ~$0.12/GB (higher than US)
    ≈ 15,000 × $0.12 = $1,800/month egress alone

  AWS ingress from internet: free
  AWS Redshift data in: free

  Total surprise line item: ~$1,800/month = ~$21,600/year
  ... for one analytics pipeline nobody priced.
```

**Design fix 1 — use an interconnect instead:**
```
  GCP → AWS via dedicated cross-cloud link (not native; requires a co-lo or
  partner e.g. Megaport, Equinix Fabric).
  Co-lo port cost: ~$700/month (partner-dependent; use one figure consistently).
  Egress rate over interconnect: ~$0.02/GB.
  15,000 GB/month × $0.02 = $300/month data + $700/month port = ~$1,000/month.
  Saving: ~$800/month.
  Break-even: set internet egress = interconnect cost.
    0.12V = 700 + 0.02V  →  0.10V = 700  →  V = 7,000 GB/month
    ≈ 233 GB/day sustained before the interconnect pays for itself.
```

**Design fix 2 — move the Redshift cluster to GCP (BigQuery), eliminate
cross-cloud:**
```
  GCP internal egress (same region) for query results to analyst workstations:
  typically <10 GB/day → negligible.
  BigQuery storage: ~$0.02/GB/month.
  One-time migration cost vs $21,600/year egress — usually the right call.
```

**Northwind FMCG: NAT gateway costs at scale**

Northwind runs 200 VMs in AWS `ap-south-1` (Mumbai, `10.50.0.0/16`).
Each VM pulls OS updates (Ubuntu `apt`) and sends CloudWatch metrics — roughly
5 GB/day/VM through the NAT gateway.

```
  NAT data processed (per-GB meter):
    200 VMs × 5 GB/day × 30 days = 30,000 GB/month
    AWS NAT Gateway data-processing rate (ap-south-1): ~$0.052/GB
    ≈ 30,000 × $0.052 = $1,560/month

  NAT gateway uptime (per-hour meter, one gateway per AZ, 3 AZs):
    AWS NAT Gateway hourly rate (ap-south-1): ~$0.056/hr
    3 × $0.056/hr × 730 hr/month ≈ $123/month

  Total: ~$1,683/month for traffic many engineers assume is "free."
  (Note the two distinct meters: per-GB data-processing AND per-hour uptime.)
```

**Fix:** add a VPC endpoint for S3 and Systems Manager. OS updates from S3
bypass NAT (VPC endpoint traffic is free). CloudWatch metrics can use a VPC
endpoint too. This alone can cut NAT data processing by 60–80% for a typical
workload fleet.

## Cloud / vendor mapping (when applicable)

| Cost meter | On-prem equivalent | GCP | AWS | Azure |
|---|---|---|---|---|
| Egress (region→internet) | ISP transit/bandwidth bill | Cloud Egress; ~$0.08–0.12/GB (varies by region) | Data Transfer Out; ~$0.09/GB (first 10 TB/month US) | Bandwidth / Outbound Data Transfer; (Azure: TODO) |
| Egress (inter-region) | MPLS circuit utilization | Inter-region egress; ~$0.01–0.08/GB | Cross-region data transfer; ~$0.02/GB (same continent) | (Azure: TODO) |
| Egress (inter-zone) | LAN cost (near-zero) | ~$0.01/GB between zones | ~$0.01/GB between AZs | (Azure: TODO) |
| Dedicated interconnect | Leased line / MPLS port | Cloud Interconnect (Dedicated or Partner); port-hr + VLAN attachment-hr + data at ~$0.02/GB | Direct Connect; port-hr + data at ~$0.02/GB | ExpressRoute; circuit + gateway + data (Azure: TODO) |
| VPN gateway | IPsec device + ISP | Cloud VPN; gateway-hr + tunnel-hr + data processed | VPN Gateway; gateway-hr; data at internet egress rates | VPN Gateway; (Azure: TODO) |
| Load balancer | F5/Nginx appliance (CapEx) | Cloud Load Balancing; forwarding rule-hr (~$0.025) + data processed (~$0.008/GB) | ALB/NLB; LCU-hr + data processed | Azure Load Balancer / Application Gateway; (Azure: TODO) |
| NAT gateway | NAT device / PAT on router | Cloud NAT; gateway-hr + data processed (~$0.005–0.045/GB by region) | NAT Gateway; gateway-hr + data processed (~$0.045–0.052/GB) | NAT Gateway; (Azure: TODO) |
| VPC endpoints / Private Service Connect | On-prem private network paths (no transit charge) | Private Service Connect endpoint; per endpoint-hr | VPC Interface / Gateway Endpoints; interface-hr + data for interface; gateway endpoints free | Private Endpoint; (Azure: TODO) |
| Public (external) IP addresses | Static IP from ISP | External IP; ~$0.005/hr in-use (attached to VM, running or stopped), higher rate reserved-but-unattached — not free since Feb 2024 | Elastic IP / public IPv4; ~$0.005/hr for all public IPv4 incl. attached to a running instance since Feb 2024 (only a 750 hr/month EC2 free-tier allowance) | Public IP; (Azure: TODO) |
| CDN egress | CDN contract | Cloud CDN; ~$0.02–0.08/GB (cheaper than direct egress) | CloudFront; ~$0.0085–0.12/GB (tiered) | Azure CDN; (Azure: TODO) |

## Do it (the exercise)

**Exercise 1: back-of-envelope the Meridian egress bill [laptop]**

Take the numbers from the worked example. Use the GCP Pricing Calculator
(cloud.google.com/products/calculator) to verify the ~$1,800/month figure for
500 GB/day egress from `asia-south1` to the internet.

1. Open the calculator. Add a "Cloud Storage" product. Set region to
   `asia-south1`. Set monthly egress to "Internet" = 15,000 GB.
2. Compare the result to the manual calculation. Adjust for current rates if
   they have changed. [needs cloud account] — calculator is free but sign-in
   recommended for saving estimates.
3. Now add a second line: same 15,000 GB but to a `asia-south1` destination
   (same region, GCS to GCS). Observe the near-zero result. *This is the
   design signal: keep data co-located with compute.*

**Exercise 2: find the NAT waste [laptop / paper]**

For Northwind's 200-VM fleet, sketch the per-month cost under three scenarios:

```
  A) All 200 VMs route all traffic through NAT gateway (baseline above)
  B) Add S3 Gateway Endpoint: OS updates and backups bypass NAT (-70% of data)
  C) Add SSM VPC Interface Endpoint: agent traffic bypasses NAT too (-10% more)
```

Calculate the monthly saving from B and C. Decide whether the endpoint cost
(~$0.01/hr/AZ for interface endpoints) is justified. *Answer: at 30,000 GB/month
baseline, even a 70% reduction saves ~$1,092/month vs ~$22/month endpoint cost.*

**Exercise 3: break-even for interconnect [paper]**

For Meridian Bank, use these inputs:

- GCP internet egress rate from `asia-south1`: $0.12/GB
- GCP Partner Interconnect VLAN attachment 50 Mbps: ~$70/month + $0.05/GB egress
- Find the monthly GB volume at which Partner Interconnect becomes cheaper than
  internet egress.

```
  Break-even:
    Internet: $0.12 × V = cost_internet
    Interconnect: $70 + ($0.05 × V) = cost_interconnect
    Set equal: 0.12V = 70 + 0.05V
               0.07V = 70
               V     = 1,000 GB/month

  Conclusion: above ~1,000 GB/month (~33 GB/day), the Partner Interconnect
  at 50 Mbps beats internet egress on cost alone — before counting latency
  and SLA benefits.
```

## Say it back (self-check)

1. Name five network cost meters in a cloud design. Which one is typically the
   largest surprise on a first cloud bill?
2. Why is CDN egress often cheaper than direct internet egress from a cloud
   region, even though it is the same data?
3. A workload pulls 10 TB/month of package updates through a NAT gateway. Name
   two architectural changes that could reduce or eliminate that NAT data-
   processing charge.
4. At what sustained data volume does a dedicated interconnect typically become
   cheaper than VPN + internet egress? (State the variables, not just a number.)
5. Why does an unused reserved external IP address cost money in both GCP and AWS?

## Talk to the IT/security head

**Ask:**

- "Have you modelled egress costs for each data flow that leaves the region —
  especially cross-cloud or to on-prem?" *(reveals whether the design has a cost
  time-bomb; good answer: yes, with monthly GB estimates per flow)*
- "Is this load balancer billed by forwarding rule, by data processed, or both?
  How many rules are active vs idle?" *(good answer: they know the forwarding-
  rule count and clean up unused rules on a schedule)*
- "Which workloads route through NAT, and have you introduced VPC endpoints for
  high-volume paths like S3, CloudWatch, or GCP API endpoints?" *(good answer:
  endpoint coverage for top-5 traffic destinations; bad answer: "we'll add them
  later")*
- "What is the break-even on your interconnect commitment vs current traffic
  volume — and do you have enough headroom if the analytics team adds three
  more pipelines?" *(good answer: they have a utilization dashboard and a growth
  buffer; red flag: they signed a 10 Gbps commitment for 200 Mbps of actual use,
  or the opposite — they are saturating a 1 Gbps link)*
- "How many external IPs are reserved and unattached right now?" *(good answer:
  none, there is a policy; at Northwind's scale, dozens of zombie IPs add up)*

**Red flags to listen for:**

- "We don't monitor egress separately; it's in the overall cloud bill." Network
  costs buried in a single total never get optimised — and they compound.
- "The interconnect is committed at a flat rate so we don't track utilisation."
  A 10 Gbps port commitment at $1,700/month that carries 500 Mbps is burning
  money and was approved on an assumption someone needs to revisit.
- "We add a NAT gateway per environment automatically." Multi-environment orgs
  (dev/test/staging/prod) can end up with twelve NAT gateways if nobody audits.
- "Public IPs? We just allocate from the pool." At bank scale with hundreds of
  services, each with a reserved IP, the idle-IP bill is real.
- Inability to name the traffic volume for their largest inter-cloud flow. If
  nobody has measured it, the bill is already wrong.

## Pitfalls & war stories

**The analytics replication trap (FSI).** A bank migrates its primary application
to GCP but keeps the data warehouse on-prem. Daily replication of 2 TB pulls
~$7,200/month in egress that no one costed. The fix — either move the warehouse
or query it in place with a federated query — is technically simple but requires
a data-governance approval process that takes four months. The lesson: cost the
egress before you design the data flow, not after.

**Committed use on interconnect with shrinking load (FMCG).** Northwind signed
a 1 Gbps Direct Connect commitment during an M&A integration. The acquired
company's traffic was repatriated to AWS after twelve months. The commitment
ran for two more years at ~$1,200/month with 80 Mbps of actual use. Interconnect
commitments (often 12–36 month) should be sized to *steady-state* traffic, not
integration peaks.

**The LB forwarding-rule sprawl.** A development team at Meridian Bank creates
a new internal load balancer per microservice for testing. After six months there
are 40 forwarding rules; at $0.025/rule-hr that is ~$730/month for load balancers
serving a handful of RPS in non-production. A shared L7 internal LB with path-
based routing for non-prod would serve the same need for 2 forwarding rules.

**NAT gateway per AZ × per environment.** A 3-AZ, 4-environment deployment
(dev / test / staging / prod) with one NAT gateway per AZ creates 12 NAT
gateways. At ~$38/month per gateway (AWS, us-east-1) that is $456/month in
gateway uptime before any data is processed. Shared NAT per environment, or
VPC endpoints for the high-volume paths, cuts this significantly.

**The "free tier" IPv6 assumption.** Some architects assume IPv6 public addresses
are always free. GCP charges for dual-stack external IPs on Compute Engine; AWS
charges for public IPv4 per the 2024 pricing change ($0.005/hr per public IPv4,
whether attached or not, effective February 2024). Audit the IP allocation list
before it becomes a line item your IT head has to explain to finance.

**Data residency + egress double constraint (FSI).** Meridian Bank's regulated
customer data must stay in `asia-south1`. Analytics must run on a team-choice
tool that only exists in `us-central1`. The fix (a de-identified extract) requires
a PCI/data classification review — which adds eight weeks. Knowing the egress
cost *and* the compliance cost of a cross-region flow in advance would have
changed the design at the whiteboard stage. Always ask "where is the data, where
is the compute, and is there a regulatory reason they can't be together?" before
drawing the first arrow (see N29, N51).

## Going deeper (optional)

- GCP Network Pricing overview:
  https://cloud.google.com/vpc/network-pricing
- AWS Data Transfer Pricing:
  https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer
- AWS Pricing Change — Public IPv4 addresses (Feb 2024):
  https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/
- GCP Cloud NAT pricing:
  https://cloud.google.com/nat/pricing
- GCP Cloud Interconnect pricing:
  https://cloud.google.com/network-connectivity/docs/interconnect/pricing
- AWS Direct Connect pricing:
  https://aws.amazon.com/directconnect/pricing/
- GCP Pricing Calculator:
  https://cloud.google.com/products/calculator
- AWS Pricing Calculator:
  https://calculator.aws/pricing/2/home
- RFC 4632 — CIDR: the Internet Address Assignment and Aggregation Plan (for
  the IP allocation math underlying address planning and egress routing decisions).
- Pairs with N51 (multi-cloud egress trap), N41 (route tables + NAT gateways),
  N46 (cloud load balancing), N38 (dedicated interconnect), N56 (design-review
  playbook).

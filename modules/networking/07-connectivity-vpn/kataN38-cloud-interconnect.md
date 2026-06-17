# Kata N38 — Dedicated interconnect: Cloud Interconnect / Direct Connect / ExpressRoute

> **Track:** Networking · **Module:** N7 Connectivity: VPN & hybrid · **Prereqs:** N36, N32, N14 · **Time:** ~35 min
> **Tags:** `networking` `interconnect` `hybrid` `bgp` `gcp` `aws` `latency` `fsi`

## Why it matters

Site-to-site IPsec VPN (N36) runs over the public internet — adequate for many
workloads but not for the ones that matter most at a bank or large FMCG: core
banking queries, card-transaction settlement, synchronous replication, bulk
analytics pipelines. Those workloads need **predictable latency, guaranteed
bandwidth, and no shared-internet path**. Every major cloud provider sells a
product that directly solves this: a physical, private circuit from the customer's
data center into the cloud's edge. When an IT head mentions "we have a Direct
Connect" or "we need a dedicated 1 Gbps to GCP," this kata is the mental model
you need to follow the conversation, challenge the design, and ask the question
that exposes the risk.

## The mental model

### The problem with VPN over the internet

IPsec VPN encrypts the payload, but the underlying internet path is shared, has
variable latency (20–200 ms jitter across continents), and has no SLA for
throughput. For core banking — where a synchronous round-trip to check an account
balance must be sub-20 ms — internet jitter alone disqualifies VPN.

```
  HQ-DC1 ─── IPsec/internet ─── GCP region
             ↑ shared, bursty, no SLA
```

### What a dedicated interconnect is

A **dedicated interconnect** is a direct, private layer-2 (Ethernet) cross-connect
between the customer's premises (or a colocation facility) and the cloud
provider's **edge/peering point of presence (PoP)**. No public internet in the
data path.

```
  HQ-DC1 ─── leased dark fiber / carrier-provisioned circuit ─── Cloud PoP
             ↑ private Ethernet, fixed bandwidth, SLA on uptime
                           │
                    BGP session runs over this
                    to exchange routes between
                    on-prem and cloud VPC/VNet
```

The circuit itself is a physical cable (or WDM wavelength). What runs *on top* of
it is:

1. **Layer 2** — 802.1Q VLAN tagging to multiplex multiple logical connections
   over one physical port (GCP calls these "VLANs" or "VLAN attachments"; AWS
   calls them "Virtual Interfaces" / VIFs).
2. **Layer 3 / BGP** — a BGP session (see N14) that advertises cloud subnets to
   on-prem and on-prem subnets to the cloud. The cloud VPC route table learns
   your `10.10.0.0/16` (HQ-DC1) prefix via BGP; your on-prem router learns the
   cloud's `10.100.0.0/14` prefix the same way.
3. **Encryption (optional)** — the base circuit is *not* encrypted by default.
   You add MACsec (link-layer) or IPsec over the circuit if the compliance team
   requires encryption at the physical layer.

### Two deployment patterns

**Dedicated / direct (own the port):**
The customer orders a physical cross-connect at a colocation facility where the
cloud provider has a PoP. The customer router sits in that colo and the fiber runs
directly to the provider's cage. Higher setup cost, highest bandwidth (10 Gbps or
100 Gbps ports). Suits Meridian Bank HQ-DC1 if HQ-DC1 is already in a Tier 3
colo.

**Partner / hosted (share someone else's port):**
A network partner (e.g. Tata Communications, Equinix, AT&T) already has a
dedicated port to the cloud. The customer buys a sub-circuit from the partner.
Lower setup cost, faster provisioning, but the partner's circuit is a shared
aggregation link. Suits Northwind's regional offices or Meridian's branches where
a full dedicated port cannot be justified.

```
  Dedicated:                    Partner / hosted:
  Customer router               Customer router
       │                              │
  Colo cross-connect            Partner aggregation link
       │                              │
  Cloud PoP port (owned)        Cloud PoP port (partner's)
       │                              │
  Cloud VPC/VNet                Cloud VPC/VNet
```

### Redundancy

A single circuit is a single point of failure. Production designs at regulated
shops require **two independent circuits to two separate PoPs**, often in two
geographically separate colocation facilities. This requires two BGP sessions with
appropriate route advertisement; the cloud BGP will use equal-cost multipath
(ECMP) across both or fall over to the live path if one drops.

```
  HQ-DC1 ─── circuit-A ─── PoP-1 (city A)
         └── circuit-B ─── PoP-2 (city B)   ← independent physical path
```

### Encryption posture

| Layer | Mechanism | When required |
|-------|-----------|---------------|
| No encryption | bare circuit | low-sensitivity workloads |
| MACsec (L2) | IEEE 802.1AE on the Ethernet link | when data must be encrypted in transit on carrier fiber |
| IPsec over interconnect | tunnel inside the dedicated circuit | when policy requires encryption AND dedicated-circuit performance |

Regulators (RBI, PCI-DSS) generally require encryption in transit. The IT head
will often ask: "does the interconnect count as an encrypted channel?" The answer
is: *not by default* — you need MACsec or IPsec explicitly configured on top.

## Worked example

**Meridian Bank — GCP primary cloud, `10.100.0.0/14`**

Meridian's HQ-DC1 (`10.10.0.0/16`) houses core banking and must serve the new
GCP-hosted mobile backend (`10.100.0.0/14`, `asia-south1` region). The
requirements:

- Sub-5 ms one-way latency between GCP and HQ-DC1 (both in the same city).
- 2 Gbps peak throughput for batch settlement at end-of-day.
- No public-internet path for production traffic.
- PCI-DSS: cardholder data in transit must be encrypted.

**Chosen design:** 2 × 10 Gbps Dedicated Interconnect from HQ-DC1 colo to two
separate GCP PoPs, with MACsec enabled on each circuit. IPsec as belt-and-braces
for the CDE VLAN.

```
  HQ-DC1 (10.10.0.0/16)
      │
  Meridian edge router (AS 65001)
  ├── circuit-A  ─── GCP PoP, Mumbai-1   ─── Cloud Router (AS 16550)
  └── circuit-B  ─── GCP PoP, Mumbai-2   ─── Cloud Router (AS 16550)
                                                    │
                                          GCP VPC 10.100.0.0/14
                                          (asia-south1)
```

**What BGP exchanges:**

On circuit-A, the BGP session between Meridian's router (AS 65001) and GCP's
Cloud Router (AS 16550) advertises:

- Meridian → GCP: `10.10.0.0/16` (HQ-DC1 supernet)
- GCP → Meridian: `10.100.0.0/14` (GCP VPC)

GCP's Cloud Router installs the `10.10.0.0/16` custom route into the VPC route
table. Meridian's on-prem router installs `10.100.0.0/14` into its routing table.
Both know each other's subnets without static routes — BGP handles it dynamically.

**MACsec and PCI scope:**

The CDE traffic (card auth queries) flows on a dedicated VLAN attachment
(`vlan-id: 100`). MACsec is enabled at the Ethernet layer on this VLAN. Because
the path is now encrypted at L2, the PCI-DSS "encryption in transit" requirement
for data crossing the carrier network is satisfied. The external auditor gets a
network diagram showing the MACsec boundary, the VLAN isolation, and the BGP
advertisement scope.

**Northwind comparison:**

Northwind (AWS primary) connects its ERP VPC (`10.104.0.0/14`) to its two
regional offices (`10.50.16.0/20` and `10.50.32.0/20`, both carved from the
Northwind supernet `10.50.0.0/16`) via AWS Direct Connect hosted connections
through a carrier partner. They chose the hosted model because:

- No regional office has a router physically in a colo with a Direct Connect PoP.
- 500 Mbps is sufficient; a partner hosted connection is cheaper than a 1 Gbps
  dedicated port.
- Provisioning lead time is 2 weeks vs 6–12 weeks for a dedicated port.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Dedicated private circuit | Leased line / MPLS PE port | **Cloud Interconnect** (Dedicated or Partner) | **AWS Direct Connect** (Dedicated or Hosted) | **Azure ExpressRoute** (Direct or Provider) |
| Cloud-side router that runs BGP | BGP-capable PE / CE router | **Cloud Router** (managed, per region) | **Virtual Private Gateway** or **Direct Connect Gateway** | **ExpressRoute Gateway** (in a VNet) |
| Logical sub-circuit / VLAN on the port | 802.1Q sub-interface | **VLAN attachment** (Interconnect Attachment) | **Virtual Interface (VIF)** — private or transit | **ExpressRoute Circuit** peering (private peering) |
| Multi-VPC / multi-VNet over one circuit | N/A (on-prem handled by the CE router) | **VLAN attachment + NCC** or Cross-Connect Router | **Direct Connect Gateway** (spans multiple VPCs/regions) | **ExpressRoute Global Reach** |
| Speed options | Whatever you order (1/10/100 Gbps) | 50 Mbps – 50 Gbps (Partner); 10 or 100 Gbps (Dedicated) | 50 Mbps – 25 Gbps (Hosted); 1/10/100 Gbps (Dedicated) | 50 Mbps – 100 Gbps (Provider); 5/10/40/100 Gbps (ExpressRoute Direct) |
| SLA | Carrier SLA (99.9–99.99%) | 99.9% (single) / 99.99% (redundant pair) | 99.9% (single-device, 2 locations) / 99.99% (redundant, 2 devices) | 99.95% (with redundant circuits) |
| Default encryption | None (private wire, not encrypted) | None; add MACsec (GA) or IPsec over IC | None; add MACsec (select ports) or IPsec over DX | None; add IPsec or MACsec (ExpressRoute Direct only) |
| BGP AS used by cloud | — | AS 16550 (GCP) | AS 64512 (or custom private ASN) | AS 12076 (Azure) |

> **GCP note:** Cloud Router is a fully managed regional BGP daemon — no VM to
> patch, no BGP config on the GCP side beyond route advertisement policies.
> Cloud Interconnect supports 99.99% SLA only with two VLAN attachments in two
> separate metropolitan areas.
>
> **AWS note:** A *private VIF* connects to a single VPC. A *transit VIF* connects
> to a Direct Connect Gateway, which can then attach to Transit Gateways across
> regions (see N48). This is the AWS pattern for hub-and-spoke at scale.

## Do it (the exercise)

### Part 1 — BGP route advertisement on paper [laptop / paper]

Using the Meridian Bank topology above, trace what the routing tables look like
after BGP converges:

1. What prefix does Meridian's on-prem router advertise toward GCP?
2. What prefix does GCP Cloud Router advertise toward on-prem?
3. If a GCP VM at `10.100.5.10` sends a packet to `10.10.22.1` (HQ-DC1), which
   next-hop does the GCP VPC route table use? (Answer: the Cloud Router's link IP
   on the VLAN attachment, pointing toward the interconnect.)
4. If circuit-A drops, what happens to the BGP session? (Answer: the session goes
   down, the route is withdrawn, and traffic fails over to circuit-B within BGP
   convergence time — typically seconds to ~1 minute depending on BFD timers.)

### Part 2 — Inspect BGP (simulated) [laptop]

Run a local BGP simulation with FRRouting in Docker to see a BGP session exchange
prefixes. (This is identical to what Cloud Router does under the hood.)

```bash
# Requires Docker
docker pull frrouting/frr:latest

# Start two FRR containers on a shared bridge network
docker network create bgp-lab

docker run -d --name r1 --cap-add NET_ADMIN --net bgp-lab frrouting/frr sleep infinity
docker run -d --name r2 --cap-add NET_ADMIN --net bgp-lab frrouting/frr sleep infinity

# Inspect that both are running
docker ps --filter name=r1 --filter name=r2
```

Configure a minimal BGP session on r1 (simulating the on-prem CE router):

```bash
docker exec -it r1 vtysh -c "
configure terminal
 router bgp 65001
  bgp router-id 10.0.0.1
  neighbor 172.17.0.3 remote-as 16550
  address-family ipv4 unicast
   network 10.10.0.0/16
  exit-address-family
end
write
"
```

Configure r2 (simulating GCP Cloud Router):

```bash
docker exec -it r2 vtysh -c "
configure terminal
 router bgp 16550
  bgp router-id 10.0.0.2
  neighbor 172.17.0.2 remote-as 65001
  address-family ipv4 unicast
   network 10.100.0.0/14
  exit-address-family
end
write
"
```

> **Note:** The `172.17.0.x` IPs above are Docker bridge addresses — check
> `docker inspect bgp-lab` and substitute the actual container IPs before running.

Verify the session and prefix exchange:

```bash
docker exec -it r1 vtysh -c "show ip bgp summary"
docker exec -it r1 vtysh -c "show ip bgp"
# Expect to see 10.100.0.0/14 in r1's BGP table, received from r2
```

This is the same exchange that happens between your on-prem router and GCP's Cloud
Router over a Dedicated Interconnect, minus the fiber and the colo handshake.

### Part 3 — Cloud Console exploration [needs cloud account]

In GCP Console → Hybrid Connectivity → Cloud Interconnect:

1. Locate the **Interconnect locations** map and find the closest PoP to a site you
   care about (e.g. `mum-zone1-739` for Mumbai). Note the colo facility and the
   colocation provider.
2. Review a **VLAN attachment** object: observe the BGP peer ASN, the peer and
   cloud-side IP addresses on the `/29` BGP link subnet, and the advertised routes.
3. In Cloud Router, check **Advertised routes** — you will see the VPC subnets
   being announced to the peer.

In AWS Console → Direct Connect → Virtual Interfaces:

1. Find a **private VIF** and inspect the BGP configuration (customer ASN, Amazon
   ASN, VLAN ID).

## Say it back (self-check)

1. What physical and logical elements make up a dedicated interconnect end-to-end?
   (Name: the fiber, the cross-connect, the BGP session, the VLAN attachment.)
2. Why is a dedicated interconnect's latency more predictable than VPN over the
   internet, even though both can carry the same traffic?
3. What does BGP do in this context — what does each side advertise, and why is
   this better than static routes?
4. A single dedicated interconnect gives 99.9% SLA. How do you get to 99.99%?
5. A PCI auditor asks: "Is the interconnect an encrypted channel?" What is the
   correct answer, and what would you add to make it compliant?

## Talk to the IT/security head

**Ask:**

- "Is your interconnect dedicated or partner/hosted? Who is the colocation or
  carrier partner?"
  *Good answer:* names the colo facility, the carrier, the port speed, and whether
  it's dedicated or aggregated. They can tell you the contract renewal date.
  *Red flag:* "I think it goes through Telecom X" — vague ownership means vague
  accountability when it breaks.

- "Do you have a redundant second circuit to a different PoP?"
  *Good answer:* yes, and they can describe the two independent physical paths and
  the BGP failover behavior (with BFD timers).
  *Red flag:* "we have redundant routers on-prem" — router redundancy does not help
  if both connect to the same physical circuit or the same PoP.

- "Is the interconnect encrypted? What does your PCI or RBI assessment say about
  it?"
  *Good answer:* "We run MACsec on the Ethernet link / IPsec over the circuit for
  CDE traffic — here is the scope diagram the auditor accepted."
  *Red flag:* "it's a private line, so it's fine" — a private line is not encrypted
  by default and this is a common audit finding.

- "What prefixes are you advertising into the cloud via BGP? Have you reviewed the
  advertisement scope lately?"
  *Good answer:* they know the exact CIDRs advertised and have a documented
  justification for each (least-privilege routing). They run periodic BGP hygiene
  reviews.
  *Red flag:* "we advertise the whole `10.0.0.0/8`" — over-advertisement is a
  blast-radius problem; a misconfigured or compromised cloud workload can reach
  segments it should never touch.

- "What is your failover time if the primary circuit drops — and when did you last
  test it?"
  *Good answer:* sub-60 seconds with BFD (Bidirectional Forwarding Detection)
  enabled; they have a test log from the last change window.
  *Red flag:* never tested, or the answer is "a few hours" — BGP without BFD can
  take minutes to converge, and some shops have never tested the failover path.

## Pitfalls & war stories

**"The private wire needs no encryption."**
The most common FSI finding: teams assume a leased or dedicated line is secure
because it's not internet-facing. Carriers run shared DWDM infrastructure; a
sophisticated attacker with physical access to a carrier PoP can tap an unencrypted
circuit. PCI-DSS Req 4.2.1 requires encryption of CHD in transit over open/public
networks — and some auditors now challenge unencrypted dedicated circuits in
shared-colo environments. Add MACsec or IPsec; don't rely on physical obscurity.

**Over-advertising the on-prem supernet.**
Advertising `10.0.0.0/8` into the cloud VPC because "it's all ours" means every
cloud workload has a BGP-learned route to every on-prem segment, including OT
networks, legacy mainframes, and the treasury system. When the cloud environment is
compromised (it will be), blast radius is the whole network. Advertise only the
subnets the cloud actually needs to reach.

**Single PoP, dual routers — false redundancy.**
A bank spent six figures on redundant on-prem routers and dual-homed them to the
same colo cross-connect panel. The colo had a power event; both routers lost the
circuit simultaneously. True redundancy requires two independent physical paths to
two geographically separate PoPs.

**Underestimating provisioning lead time.**
A dedicated interconnect typically takes 4–12 weeks to provision (physical cabling,
colo paperwork, LOA-CFA from the cloud provider, carrier provisioning). Northwind's
plant modernization program was delayed six weeks because the architecture assumed
"cloud connectivity in sprint 1." Partner/hosted connections are faster (2–4 weeks)
but still not instant. Plan for it.

**Forgetting BGP convergence in a failover.**
Without BFD, BGP hold-down timers default to 90 seconds. A circuit drop can leave
traffic black-holing for over a minute before BGP withdraws the route and traffic
shifts to the redundant circuit. Enable BFD (sub-second detection) on the BGP
session; GCP Cloud Router and AWS Virtual Private Gateway both support it.

**Treating Direct Connect Gateway as free capacity.**
AWS Direct Connect Gateway lets one DX circuit reach VPCs across multiple regions
and accounts — useful, but all traffic still traverses the physical circuit.
Northwind discovered that adding five new AWS accounts to a single DX Gateway
caused their 1 Gbps circuit to saturate during batch ETL runs. Capacity planning
must account for all VPCs behind the gateway.

## Going deeper (optional)

- **GCP:** Cloud Interconnect overview and VLAN attachment architecture —
  `cloud.google.com/network-connectivity/docs/interconnect`
- **GCP:** Cloud Router BGP configuration and BFD —
  `cloud.google.com/network-connectivity/docs/router`
- **AWS:** Direct Connect User Guide (Virtual Interfaces, Direct Connect Gateway) —
  `docs.aws.amazon.com/directconnect/latest/UserGuide`
- **Azure:** ExpressRoute circuits and peerings —
  `learn.microsoft.com/azure/expressroute`
- **RFC 4271** — BGP-4 specification; the protocol underlying every interconnect
  route exchange.
- **IEEE 802.1AE** — MACsec standard; the encryption layer on the Ethernet circuit.
- **RFC 5880** — BFD (Bidirectional Forwarding Detection); how fast failover works.
- Pairs with N36 (IPsec VPN — the complement to dedicated interconnect), N14 (BGP
  deep dive), N32 (WAN building blocks), and N48 (hub-and-spoke / Transit Gateway
  patterns that build on top of the interconnect).
- Cross-track: N29 (PCI-DSS network compliance) and S12 (encryption in transit /
  CMEK) give the security and compliance depth behind the "is the circuit
  encrypted?" question.

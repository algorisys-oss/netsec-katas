# Kata N33 — SD-WAN: why FMCGs love it; how it changes the branch

> **Track:** Networking · **Module:** N6 On-prem & data center · **Prereqs:** N32, N15, N12 · **Time:** ~35 min
> **Tags:** `sd-wan` `wan` `branch` `networking` `mpls` `fmcg` `on-prem` `cost`

## Why it matters

Northwind FMCG has ~3,000 retail and field points, each needing internet and
ERP access. With a traditional MPLS circuit at every site, the cost is
prohibitive and the lead time for each new circuit can run 60–90 days. SD-WAN
is the answer most IT heads at large FMCGs already have or are actively
buying: it cuts branch WAN costs by 30–70 %, reduces provisioning from months
to hours, and gives central policy control over thousands of sites. As an
architect proposing a cloud workload that will be consumed from branches, you
need to understand what SD-WAN is, what it isn't, and how it changes the
security and performance conversation at the branch.

## The mental model

### The problem SD-WAN solves

A traditional branch has one WAN connection — usually an MPLS leased line —
that is expensive, rigid, and managed circuit-by-circuit by the network team.
Every route change is a human ticket. Every new site is a procurement
journey. Internet traffic must trombones back to HQ (hairpin) before going
out:

```
 Traditional branch ("hairpin" to HQ):

   Branch ──[MPLS]──► HQ router ──► Internet
                                        │
                              branch user  hits SaaS app
                              after a 50 ms round-trip extra hop
```

SD-WAN solves three things:

1. **Transport abstraction** — the branch can carry traffic over *multiple*
   underlay links (MPLS, broadband, 4G/5G) simultaneously. The SD-WAN layer
   picks the best path per application, per moment.

2. **Policy-driven routing** — rules like "send video conferencing over the
   broadband link; send Core Banking traffic over MPLS; if MPLS fails, fall
   back to broadband" are configured centrally and pushed to every site.

3. **Local internet breakout** — internet-bound SaaS traffic (Microsoft 365,
   Salesforce) exits directly at the branch, bypassing the HQ hairpin. Latency
   to SaaS apps drops dramatically.

### The architecture in one diagram

```
                    ┌─────────────────────┐
                    │   SD-WAN Controller  │   (cloud-hosted or on-prem)
                    │  (centralized brain) │   — policy, visibility, zero-touch
                    └──────────┬──────────┘        provisioning
                               │ management plane (HTTPS to controller)
           ┌───────────────────┼─────────────────────┐
           │                   │                     │
    ┌──────▼──────┐     ┌──────▼──────┐     ┌───────▼─────┐
    │  HQ / DC    │     │   Branch A  │     │  Branch B   │
    │  SD-WAN GW  │     │  SD-WAN CPE │     │  SD-WAN CPE │
    └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
           │                   │                    │
      MPLS │         MPLS +────┤                    ├──── Broadband
      link │       Broadband   │                    │     4G/5G backup
           │                   │                    │
     data-plane tunnels (IPsec/overlay) between CPEs
```

**Underlay vs overlay** — the key SD-WAN mental model:

| Plane | What it is | Examples |
|-------|-----------|---------|
| **Underlay** | The physical circuits the packets actually travel on | MPLS, broadband, 4G/5G |
| **Overlay** | The IPsec-encrypted tunnels SD-WAN builds *on top of* those circuits | Vendor-specific: Cisco Viptela, VMware VeloCloud, Fortinet, Palo Alto Prisma SD-WAN |
| **Controller** | The centralized policy engine that tells each CPE what to do | Cloud-SaaS or on-prem; the new "brain" |
| **CPE** (Customer Premises Equipment) | The physical or virtual device at the branch | Replaces the old router + separate firewall combo |

The overlay tunnels carry traffic; the controller programs the forwarding
policy; the underlay just moves bits.

### What changes at the branch

Before SD-WAN: a router + separate firewall, configured per-device by hand.

After SD-WAN: a single CPE (often a small box the size of a hardback book),
zero-touch provisioned — it dials home to the controller on first boot,
downloads its policy, and is production-ready in under an hour. A network
engineer does not fly to the branch.

**Security shift:** because traffic now breaks out locally to the internet, the
old model of "inspect everything at HQ firewall" no longer works. SD-WAN
deployments almost always pair with a **cloud-based security stack** (a Secure
Web Gateway and CASB, sometimes called SSE or SASE — see N37, S27) that
inspects branch internet traffic in the cloud rather than at HQ.

## Worked example

### Northwind's SD-WAN rollout

Northwind has 3,000 retail/field sites on `192.168.0.0/16` (default sprawl —
the M&A mess from running-example.md). The IT head wants to:

- Replace expensive leased lines at field sites with broadband + 4G backup.
- Keep the 12 distribution centers and 4 plants on MPLS (uptime-critical OT/IT
  workloads).
- Give the ~3,000 retail sites local breakout to AWS (their ERP SaaS runs in
  AWS `eu-west-1`).

**Before (per retail site cost estimate):**

```
  MPLS leased line:  ~₹40,000/month per site
  3,000 sites × ₹40,000 = ₹12,00,00,000/month (~₹12 crore/month)
```

**After (SD-WAN with broadband + 4G backup):**

```
  Broadband:         ~₹2,500/month
  4G SIM backup:     ~₹800/month
  SD-WAN CPE amort:  ~₹700/month (3-year)
  Total:             ~₹4,000/month per site
  3,000 × ₹4,000 = ₹1,20,00,000/month (~₹1.2 crore/month)
```

Saving: ~₹10.8 crore/month at retail sites alone, while improving latency to
AWS SaaS (direct breakout vs hairpin through HQ).

**Policy the IT head programs once, pushed to all 3,000 CPEs:**

```
  IF  app == "SAP ERP" (port 443, dest 52.x.x.x/AWS):
      primary = broadband-local-breakout → internet → AWS
      fallback = 4G-local-breakout

  IF  app == "Point-of-Sale VLAN" (VLAN 20, tagged):
      primary = broadband → SD-WAN overlay → DC
      fallback = 4G → SD-WAN overlay → DC
      QoS = high-priority queue

  IF  app == "guest-wifi" (VLAN 30):
      breakout = local internet, isolated (no overlay tunnel)
```

Notice how SD-WAN policy is application-aware — it distinguishes SAP traffic
from POS traffic from guest Wi-Fi on the same box and routes them differently.
That awareness requires the CPE to do DPI (deep packet inspection) or app
signatures. This is Layer 7 logic in what used to be a Layer 3 router (see N03).

### Northwind's address plan under SD-WAN

The `192.168.0.0/16` sprawl is not fixed by SD-WAN itself. SD-WAN overlays
*wrap* whatever addressing exists. But the SD-WAN rollout is Northwind's
forcing function to clean up the overlap (see N11). During rollout, the IT
head allocates unique `/24` subnets per site from a new `10.50.0.0/16` plan,
and the CPE does local NAT from the legacy `192.168.x.x` until hosts are
renumbered:

```
  Retail site 001:  LAN 10.50.1.0/24  → SD-WAN overlay → DC
  Retail site 002:  LAN 10.50.2.0/24  → SD-WAN overlay → DC
  ...
  Retail site 255:  LAN 10.50.255.0/24
  (sites 256+: move to 10.51.0.0/16 block)
```

The overlay treats each site as a uniquely addressed stub — overlapping LAN
addresses only matter if two sites need to talk *directly* to each other (rare
at retail). If that need arises, NAT at the CPE bridges the gap until
renumbering is done.

### How Meridian Bank's 220 branches use SD-WAN differently

Meridian (FSI) is more conservative. Its 220 branches are also SD-WAN
candidates — thin endpoints needing connectivity to HQ-DC1 (`10.10.0.0/16`)
for core banking. But Meridian keeps MPLS as the *primary* underlay for
regulated traffic (PCI-DSS requires that card data paths be demonstrably
isolated and auditable). Broadband and 4G are **active backup only**:

```
  Meridian branch WAN policy:

  IF  dest == 10.10.0.0/16 (HQ-DC1) OR 10.20.0.0/16 (DC2):
      primary   = MPLS tunnel (encrypted overlay)
      fallback  = broadband tunnel (IPsec, MPLS-equivalent SLA tag)
      fallback2 = 4G (IPsec)

  IF  dest == 0.0.0.0/0 (internet):
      path = enforced SWG inspection (here a cloud SASE PoP), NOT unfiltered local breakout
      reason: bank's control standard requires all branch internet egress to be
              inspected and logged by an enforced SWG, so unfiltered local
              breakout is forbidden (PCI-DSS/RBI drive the controls + logging,
              not the location of the inspection point)
```

This is a real design difference: **FMCG favors local breakout for cost;
an FSI/bank control standard typically requires every internet egress to pass
an enforced, logged SWG (cloud SASE PoP or HQ proxy) and forbids unfiltered
local breakout, even at a latency cost.**

## Cloud / vendor mapping (when applicable)

| Concept | On-prem / traditional | GCP | AWS | Azure |
|---------|----------------------|-----|-----|-------|
| SD-WAN controller | On-prem or vendor SaaS (Cisco vManage, VMware Orchestrator) | GCP Network Connectivity Center (NCC) can serve as hub; SD-WAN integrates via partner appliances | AWS Transit Gateway + VPN; SD-WAN vendors integrate via marketplace appliances | (Azure: TODO) Virtual WAN integrates SD-WAN vendor solutions |
| Branch-to-cloud tunnel | IPsec overlay over broadband/MPLS | Cloud VPN (HA VPN) as the cloud endpoint; SD-WAN CPE terminates the other end | AWS VPN or Direct Connect as cloud endpoint | (Azure: TODO) |
| Internet breakout inspection | On-prem proxy / firewall at HQ | Cloud NGFW / third-party NGFW in GCP; or SASE vendor PoP | AWS Network Firewall; or third-party (Palo Alto, Fortinet) from Marketplace | (Azure: TODO) |
| Zero-touch provisioning | Not native in router; requires manual config or RANCID/Ansible | SD-WAN vendor (not GCP native); GCP Cloud Shell/API used for cloud-side VPN auto-provisioning | Similar: SD-WAN vendor handles CPE ZTP; AWS side uses CloudFormation or Terraform | (Azure: TODO) |
| App-aware routing | Manual PBR on Cisco routers; fragile | SD-WAN vendor + NCC route import; no native GCP app-aware routing | SD-WAN vendor; AWS Traffic Mirror can observe but not classify | (Azure: TODO) |

**Key point for architects:** the cloud providers do not sell SD-WAN CPEs.
SD-WAN is a vendor market (Cisco Viptela / SD-WAN, VMware VeloCloud, Fortinet
FortiSASE, Palo Alto Prisma SD-WAN, Versa). The cloud provider is the
*destination* (or transit hub), not the SD-WAN vendor. Your design must
integrate the SD-WAN vendor's cloud gateway with the cloud provider's VPN or
Interconnect endpoint (see N36, N38).

## Do it (the exercise)

### Step 1: Model the cost case [laptop / paper]

Take any client with 50+ branch offices currently on MPLS. Estimate:

```
  Current cost:  N_sites × monthly_MPLS_rate
  SD-WAN cost:   N_sites × (broadband + 4G_backup + CPE_amortized)
  TCO year 1:    add SD-WAN controller licence (SaaS or on-prem)
  Break-even:    usually 9–18 months
```

Write the numbers down. The IT head has already done this calculation — if you
walk in having done it too, the conversation shifts from "should we?" to "how?"

### Step 2: Read a routing table the way SD-WAN CPE sees it [laptop]

On a Linux laptop, simulate the concept of policy-based routing (a tiny piece
of what SD-WAN does):

```bash
# Show your current routing table (L3 — destination-based)
ip route show

# Create a dummy second table to simulate "prefer path B for this dest"
# (This is conceptual — real SD-WAN uses vendor-proprietary forwarding logic)
ip rule show   # list routing policy rules; priority 0 = local table, 32766 = main, 32767 = default
```

You won't replicate SD-WAN, but you'll see that Linux already has the building
block: multiple routing tables, with rules to pick which table applies for
which traffic. SD-WAN CPE runs this at scale, per application, per second.

### Step 3: Inspect IPsec-like tunnel overhead [laptop]

SD-WAN overlays use IPsec. IPsec adds header overhead:

```
  Standard Ethernet MTU:   1500 bytes
  IPsec tunnel (ESP/AH):  − 50–80 bytes overhead (ESP header + IV + padding + auth tag)
  Effective payload MTU:   ~1420–1450 bytes (varies by mode and cipher)
```

Check your path MTU (from your laptop to any host):

```bash
# Linux: send packets with DF (Don't Fragment) bit and vary size
ping -M do -s 1400 8.8.8.8    # should succeed
ping -M do -s 1472 8.8.8.8    # may fail if MTU < 1500 somewhere in path
```

If the 1472-byte ping fails but 1400 succeeds, there is an ICMP-based path
MTU negotiation issue in the path — exactly the kind of hidden problem SD-WAN
tunnels surface at branch sites. The CPE must clamp TCP MSS to account for
tunnel overhead (see N04 for encapsulation / MTU framing).

### Step 4: Map an SD-WAN policy for a client [paper]

Pick a client (or use Northwind). Write a three-row application routing policy:

| Application | Identify-by | Primary path | Fallback | Notes |
|-------------|-------------|-------------|---------|-------|
| (fill in)   | (port/dest) | (MPLS/BB/4G)| (?)     |       |

Hand this table to the IT head and ask if this matches their intent. You'll
quickly discover whether they have thought about path preference per app or
have been applying MPLS to everything uniformly.

## Say it back (self-check)

1. What are the three problems SD-WAN solves that a traditional MPLS-only
   branch cannot?
2. What is the difference between the *underlay* and the *overlay* in an SD-WAN
   architecture?
3. Why does local internet breakout improve SaaS latency — and what security
   control must you add when you do it?
4. Why might an FSI (bank) keep MPLS as primary even after deploying SD-WAN,
   while an FMCG would not?
5. What does "zero-touch provisioning" mean, and why does it matter when you
   have 3,000 sites to roll out?

## Talk to the IT/security head

**Ask:**

- "Are your branches on MPLS today — and if so, what percentage of that traffic
  is SaaS vs core-system?" *(Determines whether local breakout would actually
  save latency; if 80 % is SaaS, the business case is obvious.)*

- "Do you currently hairpin branch internet traffic through HQ? What's the
  latency penalty to, say, Microsoft 365?" *(A good IT head knows this number
  — often 60–120 ms of avoidable round-trip.)*

- "What's your SD-WAN deployment model — controller on-prem, vendor SaaS, or
  integrated with SASE?" *(Reveals maturity; also tells you whether the branch
  security stack is handled or is still a gap.)*

- "For PCI / RBI traffic, what's your policy on broadband as a failover path —
  does the compliance team accept it?" *(Critical FSI question: the regulator
  may require specific transport-level assurances that broadband + IPsec may or
  may not satisfy.)*

- "What SD-WAN vendor are you on, and have you integrated the cloud gateways
  with your GCP / AWS landing zones?" *(Exposes whether the cloud-to-branch
  path is designed or improvised.)*

**A good answer sounds like:** the IT head can state which traffic goes where
and why, has a policy document (even informal), has tested failover, knows the
latency numbers to key SaaS apps, and can name the compliance position on
broadband fallback for regulated traffic.

**Red flags to listen for:**

- "All branch traffic goes over MPLS — we don't use the internet for anything"
  — SD-WAN not deployed, or deployed but with breakout disabled. Cost savings
  and SaaS performance sitting on the table.
- "We have SD-WAN boxes but they're all configured the same as the old routers"
  — zero-touch and app-aware routing not used; typical failed rollout.
- No answer on what inspects internet traffic at the branch — if local breakout
  exists without a cloud SWG or on-CPE NGFW, you have unmonitored egress from
  every branch. At a bank this is an audit finding; at an FMCG it is a ransomware
  entry point.
- "The MPLS contract runs until 2028 — we can't change it" — common; do not
  design around the ideal. Know the contract anchor and work with it.

## Pitfalls & war stories

- **"SD-WAN = cheaper WAN" and nothing else.** Teams deploy SD-WAN, save money
  on circuits, and forget to add local breakout inspection. Three months later
  a branch gets ransomware via unmonitored internet. Local breakout without a
  Secure Web Gateway (SWG) is a security hole, not a feature.

- **MTU mismatch kills performance silently.** SD-WAN tunnels eat MTU headroom
  (see Step 3 above). Large TCP segments get fragmented or silently dropped.
  Symptoms: small files transfer fine, large file transfers stall or are slow.
  Fix: the CPE must clamp TCP MSS. Always verify during rollout.

- **Address overlap surfaces at rollout.** Northwind's `192.168.0.0/16`
  default-sprawl only becomes a real problem when SD-WAN tries to route between
  sites — the controller sees two sites with identical subnets and cannot build
  routes. Fixing it means renumbering, which is a change-control project of its
  own (see N11). Budget for it.

- **MPLS contract anchor.** Most large enterprises are mid-contract on MPLS.
  SD-WAN is typically deployed alongside MPLS first (hybrid: MPLS primary,
  broadband backup), then MPLS is shed site-by-site as contracts expire. A
  "big bang" cutover is rarely possible — know the contract cliff dates.

- **Controller availability = all branches.** If the SD-WAN controller goes
  down, the CPEs typically maintain their last-known policy (they can forward
  traffic) but you cannot push changes. A controller outage during a security
  incident (when you need to push emergency policy) is serious. At FSI clients,
  HA controller design is non-negotiable.

- **Northwind plants and distribution centers:** do not run SD-WAN with local
  internet breakout across the OT/IT boundary. OT networks at plants need
  isolated underlay (dedicated MPLS or private circuit), not broadband-based
  overlays that share internet infrastructure. SD-WAN is for IT; the OT segment
  (VLAN 40 in Northwind's plan) gets a hard L2 break before the CPE.

## Going deeper (optional)

- MEF 70.1 — SD-WAN service attributes & services standard (the industry spec,
  not vendor marketing).
- Cisco SD-WAN (Viptela) architecture guide: understand vSmart (controller),
  vManage (orchestrator), vBond (discovery), and the WAN Edge (CPE) roles.
- VMware VeloCloud: compare the Orchestrator/Controller/Edge terminology to
  Cisco's — same four-plane concept, different names.
- Palo Alto Prisma SD-WAN: notable for integrating NGFW on the CPE, simplifying
  the "where does inspection happen" question.
- RFC 7348 — VXLAN (a Layer 2 overlay; compare to SD-WAN's Layer 3 overlay to
  understand why both exist).
- Pairs with: N32 (WAN building blocks — the underlay circuits SD-WAN rides),
  N36 (IPsec — the tunnel technology SD-WAN uses), N37 (ZTNA/SASE — what
  replaces the HQ-backhauled security stack when breakout happens), S27
  (SASE — the security architecture SD-WAN forces you to reconsider).

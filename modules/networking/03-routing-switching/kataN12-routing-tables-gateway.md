# Kata N12 — Routing tables & the default gateway

> **Track:** Networking · **Module:** N3 Routing & switching · **Prereqs:** N08, N09 · **Time:** ~30 min
> **Tags:** `networking` `routing` `default-gateway` `l3-network` `on-prem` `mental-model` `fsi` `meridian-bank`

## Why it matters

Every packet that leaves a host — a bank teller's laptop, a GCP VM, a container
in EKS — consults a **routing table** to decide where to go next. If that lookup
fails or sends the packet to the wrong place, the connection silently dies.
Understanding routing tables is the difference between diagnosing "the network is
down" in minutes versus hours. It's also the concept behind every cloud route
table, VPC internet gateway, and NAT gateway you'll design — those are just routing
tables with managed interfaces. When a Meridian Bank network engineer says
"traffic should go via the interconnect, not the public internet," they mean a
specific routing table entry that you need to know how to read and question.

## The mental model

### The problem routing solves

A host knows its own subnet — the hosts it can reach by putting a frame directly
on the wire (see N05). Every *other* destination needs a **next hop**: a router's
IP address that is on the same local segment and will forward the packet toward
its destination.

```
 10.10.1.50 (host in HQ-DC1)               10.10.2.80 (different subnet)
      │                                            │
      │  same /24 → send direct (L2)              │
      │──────────────────────────────────          │
      │                                            │
      │  different subnet → consult routing        │
      │  table → send to next-hop (router)         │
      └──────► ROUTER ────────────────────────────►│
              10.10.1.1                       10.10.2.1
```

The host doesn't need to know the *full* path — only the *next hop*. Every router
along the way makes the same local decision. This is IP's core design: **hop-by-hop
forwarding**, each device responsible for one step.

### Anatomy of a routing table

A routing table is an ordered list of rules. Each row answers:
"For traffic destined for *this prefix*, send it to *this next hop*, via *this interface*."

```
Destination       Gateway/Next-hop   Iface    Metric   Source
─────────────────────────────────────────────────────────────
10.10.1.0/24      0.0.0.0 (direct)   eth0     0        connected
10.10.0.0/16      10.10.1.1          eth0     10       static
0.0.0.0/0         10.10.1.1          eth0     100      static (default)
```

Key columns:

| Column | Meaning |
|--------|---------|
| **Destination** | IP prefix (CIDR). "Does the dest IP match this prefix?" |
| **Gateway / Next-hop** | Where to send the packet. `0.0.0.0` or blank means "directly attached — use ARP." |
| **Interface** | Which NIC to send out |
| **Metric** | Preference when multiple routes match the same prefix; lower wins |
| **Source** | How this route was learned: `connected`, `static`, `ospf`, `bgp`, etc. |

### Longest prefix match — the critical rule

When a destination IP matches *more than one* prefix, the router picks the
**most specific** (longest) match — the entry with the highest prefix length.

```
Packet to 10.10.2.99. Routing table has:
  10.0.0.0/8        via 10.10.1.254    ← matches (shorter)
  10.10.0.0/16      via 10.10.1.1      ← matches (longer)
  10.10.2.0/24      via 10.10.2.1      ← matches (longest) ✓ WINS
  0.0.0.0/0         via 203.0.113.1    ← matches everything (shortest, last resort)
```

Longest prefix match is why you can have a specific route for one subnet and a
broader default route for everything else, and they coexist without conflict.

### The default gateway

`0.0.0.0/0` is the **default route** — it matches every destination (prefix
length 0). On a host or a router, this is the "I don't know — send it here and
let someone upstream decide" entry. The IP that handles it is the
**default gateway**.

On an end-host (laptop, server, VM):
- All local-subnet traffic → direct (ARP to find the MAC; see N05).
- Everything else → default gateway.

On a router at the network edge:
- Internal subnets → specific routes pointing inward.
- Everything else (internet, other clouds) → default route pointing outward.

```
 Branch laptop
   ip: 10.30.5.20/24
   gw: 10.30.5.1
        │
        ▼
 Branch router (10.30.5.1)
   route 10.30.0.0/16 → MPLS/SD-WAN to HQ
   route 0.0.0.0/0    → internet (local breakout or SD-WAN policy)
        │
        ▼ (for HQ-bound traffic)
 HQ-DC1 core router (10.10.0.1)
   route 10.10.0.0/16 → connected (DC1)
   route 10.20.0.0/16 → DC2 link
   route 10.30.0.0/16 → MPLS cloud
   route 10.100.0.0/14 → Cloud Interconnect
   route 0.0.0.0/0    → internet firewall
```

This layered structure — each router knowing only the routes it needs — is why a
network with thousands of subnets stays manageable.

## Worked example

### Meridian Bank: packet from HQ-DC1 to GCP

A server at `10.10.1.50` (HQ-DC1, see `reference/running-example.md`) queries a
GCP-hosted analytics API at `10.100.4.20` (within GCP's `10.100.0.0/14` range).

Step 1 — server checks its own routing table:

```
Destination        Gateway       Iface
──────────────────────────────────────
10.10.1.0/24       0.0.0.0       eth0     ← local segment, direct
10.10.0.0/16       10.10.1.1     eth0     ← rest of HQ, via DC1 core router
0.0.0.0/0          10.10.1.1     eth0     ← everything else, same next-hop
```

`10.100.4.20` doesn't match `10.10.1.0/24` or `10.10.0.0/16`. It falls through to
`0.0.0.0/0` → next-hop `10.10.1.1` (DC1 core router).

Step 2 — DC1 core router has a more specific route for GCP:

```
Destination        Gateway           Source
───────────────────────────────────────────
10.10.0.0/16       connected         direct
10.20.0.0/16       10.10.255.2       static (DC1→DC2 link)
10.100.0.0/14      10.10.255.10      static (Cloud Interconnect endpoint)
10.104.0.0/14      10.10.255.10      static (AWS via interconnect)
0.0.0.0/0          203.0.113.1       static (internet edge firewall)
```

`10.100.4.20` matches `10.100.0.0/14` (prefix length 14 beats `0.0.0.0/0`'s 0).
Packet goes to `10.10.255.10` — the Cloud Interconnect handoff. Never touches the
public internet. This is exactly the "traffic must go via the interconnect, not
the internet" requirement the IT head states in a Meridian design review.

Step 3 — GCP side: the VPC's subnet route delivers `10.100.4.20` to the target VM
(the subnet CIDR covers it; no per-VM /32 entry is needed). Same principle,
different management interface.

### Reading the table on a Linux host [laptop]

```bash
ip route show
# Output (abbreviated):
# default via 192.168.1.1 dev eth0 proto dhcp metric 100
# 192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.50
```

- `default via 192.168.1.1` = the default gateway (`0.0.0.0/0` → `192.168.1.1`).
- `192.168.1.0/24 dev eth0 scope link` = local subnet, direct (no gateway needed).

On macOS:
```bash
netstat -rn -f inet
```

On Windows:
```cmd
route print
```

The three commands show the same logical table on different OSes. The `default`
row is what you look for first when "can't reach the internet" issues arrive.

### Tracing the hop-by-hop path [laptop]

```bash
traceroute -n 10.10.1.1      # -n skips reverse-DNS, faster output
# or on many Linux distros:
mtr --no-dns --report 10.10.1.1
```

Each line is one router that decremented TTL to 0 and sent back an ICMP "Time
Exceeded" — that *is* the routing table in motion (see N06).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Routing table | OS routing table / router RIB | **VPC Route** (per-subnet or per-VPC) | **Route Table** (per-subnet) | **(Azure: TODO)** |
| Default gateway | Router IP on local segment | Implicitly the subnet's `.1` gateway | Implicitly the subnet's `.1` gateway | (Azure: TODO) |
| Default route (`0.0.0.0/0`) | Static route to edge router/firewall | Route to **`default-internet-gateway`** (Cloud NAT adds SNAT for private-IP VMs; it is *not* a route next hop) | Route to **Internet Gateway** or **NAT Gateway** | (Azure: TODO) |
| More-specific route wins | Longest prefix match | Same (longest prefix wins) | Same | Same |
| Learned route (dynamic) | OSPF / BGP route | BGP route via **Cloud Router** (on Interconnect/VPN) | BGP route via **AWS Transit Gateway** or **Virtual Private Gateway** | (Azure: TODO) |
| "No route to host" | ICMP Unreachable / drop | Same | Same | Same |
| Route to on-prem | Static or OSPF | **Cloud Router** + BGP (Interconnect or VPN) | **Virtual Private Gateway** BGP | (Azure: TODO) |

**Key GCP distinction:** GCP VPC routes are *VPC-wide* by default; AWS routes are
per-subnet. In GCP you attach a route with a priority (lower = preferred) rather
than a metric. Priority 1000 is GCP's default (valid range 0–65535); set a
primary route below 1000 and a backup route to a higher value. This
matters when designing active/active interconnects.

**AWS subnet gotcha:** every subnet in AWS must be associated with a route table.
A subnet with no explicit association inherits the VPC's main route table — a
common source of "why is this talking to the internet?" surprises.

## Do it (the exercise)

**Part A — read a real routing table [laptop]**

1. On your laptop or any Linux VM, run:
   ```bash
   ip route show
   ```
2. Identify: (a) the default gateway IP, (b) the local subnet entry, (c) any
   additional routes (VPN, Docker, etc.).
3. For each entry, answer: what destination does this cover, and where does
   matching traffic go next?

**Part B — longest prefix match by hand [laptop / paper]**

Given this routing table:
```
10.0.0.0/8        via 10.10.1.254
10.10.0.0/16      via 10.10.1.1
10.10.2.0/24      via 10.10.2.1
0.0.0.0/0         via 203.0.113.1
```
Where does each packet go?
- `10.10.2.55`
- `10.10.3.1`
- `10.20.0.1`
- `8.8.8.8`

(Answers: `/24` → `10.10.2.1`; `/16` → `10.10.1.1`; `/8` → `10.10.1.254`;
`0.0.0.0/0` → `203.0.113.1`)

**Part C — trace the gateway in action [laptop]**

```bash
# Find your default gateway:
ip route show default

# Confirm you can reach it (one hop away):
ping -c 3 <gateway-ip>

# Watch a packet leave your host and reach the first router:
traceroute -n -m 3 8.8.8.8
```

The first hop in `traceroute` output is your default gateway.

**Part D — cloud route table inspection [needs cloud account]**

In GCP:
```bash
gcloud compute routes list --project=<PROJECT>
# Look for: destRange, nextHopGateway, nextHopIp, priority
```

In AWS (CLI):
```bash
aws ec2 describe-route-tables --region <REGION> \
  --query 'RouteTables[*].Routes'
```

Find the `0.0.0.0/0` route for a public subnet and a private subnet. Notice:
public → Internet Gateway; private → NAT Gateway. Same concept as on-prem
default-route design, different managed constructs.

## Say it back (self-check)

1. What question does a routing table entry answer, and what are its key columns?
2. Explain longest prefix match: if a packet matches both `10.10.0.0/16` and
   `0.0.0.0/0`, which route wins and why?
3. What is the default gateway and what happens to a packet when no more-specific
   route exists?
4. In the Meridian example, why does the packet to `10.100.4.20` (GCP) go via the
   Cloud Interconnect rather than the internet?
5. What is the difference between a "connected" route and a static route in a
   routing table?

## Talk to the IT/security head

**Ask:**
- "Can you show me the routing table entry that ensures cloud-bound traffic goes
  via the dedicated interconnect and not the public internet?" *(If they can't
  show a specific route, the guarantee may not exist.)*
- "What happens if the interconnect goes down — is there a backup route, and does
  it automatically fail over to VPN/internet?" *(Reveals HA design and whether
  regulated traffic could accidentally route over the internet.)*
- "For Meridian's GCP traffic: is the route to `10.100.0.0/14` static, or
  dynamically learned via BGP? Who manages it?" *(Static routes need manual
  updates when IP ranges change; BGP scales but needs someone who owns it.)*
- "Is there a route audit trail — who last changed the routing table, and was it
  change-controlled?" *(In regulated shops, a silent route change is a control
  failure; see N02.)*

**A good answer sounds like:** the engineer can pull up the routing table on the
spot, name the specific route entry, state whether it's static or BGP, explain
the failover path, and reference the CAB change that added it.

**Red flags:**
- "Traffic goes to GCP via the interconnect" — but no one can show the actual
  route. It may be going over the internet with no one noticing.
- "We'll add the route when we need it." Static routes are manual; if they're not
  in place before go-live, traffic silently takes the wrong path.
- No route for the cloud range, just a default route pointing to the internet
  firewall — regulated/sensitive traffic is going in the clear.
- The default route on internal servers points directly to the internet (no
  segmentation). Everything can reach everything outbound — a CISO problem.

## Pitfalls & war stories

- **Missing the more-specific route.** A team set up a Cloud Interconnect for
  Meridian-style traffic but forgot to add `10.100.0.0/14` to the on-prem core
  router. Traffic fell through to `0.0.0.0/0`, went via the internet firewall,
  and was blocked by the firewall's "no RFC-1918 source to internet" rule.
  Symptom: connection times out (silent drop), not an immediate refusal.
  Diagnosis: `traceroute` showed 1 hop to internet
  gateway, not the interconnect handoff.

- **Asymmetric routing breaks stateful firewalls.** Packet goes out via path A,
  reply comes back via path B. The firewall on path A has no state for the return
  traffic and drops it. The symptom is a TCP connection that opens but hangs on
  the first data exchange. Check that forward and return paths are symmetric.

- **Cloud subnet / route table mismatch (AWS).** In AWS, a subnet that isn't
  explicitly associated with a route table gets the VPC's **main** route table.
  If the main table has `0.0.0.0/0 → igw-xxx`, that "private" subnet has internet
  access by accident. Always explicitly associate private subnets with a route
  table that has no internet gateway route.

- **Northwind M&A overlap kills routing.** When Northwind acquired Eastfield Foods,
  both used `10.50.0.0/16` (see `reference/running-example.md`). Two routes for
  the same prefix → the router picks one arbitrarily, half the traffic disappears.
  There is no routing solution to overlapping prefixes — you must renumber first
  (see N11).

- **Forgetting the return path.** Architects often check "can host A reach host B"
  but forget that B's routing table must also have a route back to A. Asymmetric
  routing and missing return routes account for a large fraction of
  "intermittently broken" reports.

## Going deeper (optional)

- RFC 1812 — *Requirements for IP Version 4 Routers*: the canonical spec for how
  routers must process and forward packets.
- RFC 4632 — *CIDR: the Internet Address Assignment and Aggregation Plan*:
  longest-prefix match formally defined.
- `ip-route(8)` man page — full Linux `ip route` syntax including policy routing.
- Pairs with N13 (static vs dynamic routing, OSPF) and N14 (BGP — the routing
  protocol Meridian's interconnect actually runs).
- Cloud route tables in depth: N41 (GCP/AWS/Azure VPC route design).

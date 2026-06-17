# Kata N50 — Hybrid DNS resolution end-to-end

> **Track:** Networking · **Module:** N9 Hybrid & multi-cloud · **Prereqs:** N17, N18, N38, N45 · **Time:** ~35 min
> **Tags:** `dns` `l7-application` `hybrid` `networking` `cloud` `cloud-dns` `gcp` `aws`

## Why it matters

When Meridian Bank connects its on-premise data center to GCP and AWS, every
application depends on name resolution — and DNS is almost always the first thing
that breaks. A VM in GCP trying to reach the core-banking API at
`corebanking.internal.meridian.local` gets an NXDOMAIN because that name only
exists on the bank's internal DNS. Conversely, an on-prem batch job trying to
reach `cloudsql.private.meridian-prod.gcp` fails for the same reason but in
reverse. Neither the interconnect nor the VPN helps until DNS works. Architects
who understand hybrid DNS resolution can diagnose these failures in minutes and
design the plumbing so they never happen in the first place — a conversation the
IT head and network team will respect.

## The mental model

### The problem: two DNS worlds

Every enterprise runs at least one authoritative internal DNS zone — a name space
that only exists inside the corporate network. Cloud VPCs run their own private
zones managed by the cloud provider. By default, neither side knows how to resolve
the other's names.

```
  ON-PREM                             CLOUD (GCP / AWS)
  ─────────────────────────────────────────────────────────────────
  Internal DNS server                 Cloud-managed private DNS
  (e.g. Windows DNS / BIND)          (Cloud DNS private zone /
                                       Route 53 Private Hosted Zone)

  Knows:                              Knows:
    *.internal.meridian.local           *.private.meridian-prod.gcp
    *.meridian.bank (internal)          *.meridian-aws.internal
    public internet names               public internet names

  Doesn't know:                       Doesn't know:
    cloud-private names      ←→         on-prem internal names
```

The resolver on each side answers its own namespace; everything else either falls
through to public DNS (where private names don't exist) or fails with NXDOMAIN.

### Two mechanisms to bridge the gap

**1. Conditional forwarding (the core tool)**

A conditional forwarder says: "for names matching `*.private.meridian-prod.gcp`,
don't recurse publicly — forward the query to *this* IP address instead." The
on-prem DNS server forwards only that domain suffix to the cloud's inbound DNS
resolver; all other queries remain local.

```
  On-prem DNS resolver                Cloud inbound DNS endpoint
  (10.10.1.53)                        (GCP: 10.100.x.x inbound policy IP)
       │
       │  Query: sqldb.private.meridian-prod.gcp
       │  → matches conditional forwarder rule
       │  → forward to 10.100.x.x:53
       │─────────────────────────────────────────────────────►│
       │                                                       │ authoritative answer
       │◄─────────────────────────────────────────────────────│
  Answer: 10.100.4.11
       │
       │  Query: corebanking.internal.meridian.local
       │  → matches local zone
       │  serve from local zone
  Answer: 10.10.5.22
```

**2. DNS forwarding from cloud to on-prem**

The reverse path: a cloud VM querying an on-prem name. Cloud DNS can be configured
to forward queries for `*.internal.meridian.local` to the on-prem DNS server's IP
(reachable over the interconnect or VPN). The cloud forwards; the on-prem server
answers authoritatively.

```
  Cloud VM                Cloud DNS                  On-prem DNS
  (10.100.4.5)            (169.254.169.254 →          (10.10.1.53)
                           forwarding policy)
       │
       │  Query: corebanking.internal.meridian.local
       │──────────────────►│
       │                   │  forwarding rule matches *.internal.meridian.local
       │                   │──────────────────────────────────────────────────►│
       │                   │                                                   │ answer
       │                   │◄──────────────────────────────────────────────────│
       │◄──────────────────│
  Answer: 10.10.5.22
```

### The full hybrid DNS stack — how it fits together

```
                        ┌───────────────────────────────────────┐
                        │           PUBLIC INTERNET DNS          │
                        │  (root → TLD → authoritative public)   │
                        └──────────────┬────────────────────────┘
                                       │ public names only
              ┌────────────────────────┼───────────────────────┐
              │                        │                        │
   ┌──────────▼─────────┐  ┌──────────▼──────────┐  ┌─────────▼──────────┐
   │   ON-PREM DNS      │  │    GCP Cloud DNS     │  │  AWS Route 53      │
   │  (10.10.1.53)      │  │  (private zone)      │  │  (Private Hosted   │
   │                    │  │                      │  │   Zone)            │
   │ auth: *.meridian   │  │ auth: *.meridian-    │  │ auth: *.meridian-  │
   │       .local       │  │       prod.gcp       │  │       aws.internal │
   │                    │  │                      │  │                    │
   │ fwd → GCP inbound  │  │ fwd → on-prem DNS    │  │ fwd → on-prem DNS  │
   │   for *.gcp zone   │  │   for *.local zone   │  │   for *.local zone │
   └────────────────────┘  └──────────────────────┘  └────────────────────┘
           │                        │                        │
           └─── Interconnect / VPN ─┴─ Interconnect / VPN ───┘
                (reachable layer 3 — see N36, N38)
```

**Critical dependency:** DNS forwarding travels over the same interconnect or VPN
as application traffic. If the link is down, DNS breaks and *applications appear
to fail*, even if the problem is actually a routing/connectivity issue. This is why
the IT head always says "check DNS first."

### The 53/UDP rule and security implications

DNS uses **UDP port 53** (for queries up to 512 bytes) and **TCP port 53** (for
larger responses, zone transfers, and DNSSEC). Hybrid DNS forwarding must be
explicitly allowed through every firewall on the path. In a bank, the security
team will ask: "are we allowing arbitrary DNS forwarding, or is it locked to
specific source/destination pairs?"

---

## Worked example

Meridian Bank's hybrid setup (using real IP ranges from `reference/running-example.md`):

```
  Site                 Network           DNS server / resolver
  ─────────────────────────────────────────────────────────────
  HQ-DC1 (on-prem)     10.10.0.0/16      10.10.1.53 (Windows DNS)
  GCP VPC (primary)    10.100.0.0/14     169.254.169.254 via Cloud DNS
  AWS VPC (secondary)  10.104.0.0/14     169.254.169.253 via Route 53
```

**Zone ownership:**

| Zone suffix | Authoritative on | Query path |
|---|---|---|
| `*.internal.meridian.local` | On-prem DNS (10.10.1.53) | All clouds forward here |
| `*.private.meridian-prod.gcp` | GCP Cloud DNS private zone | On-prem DNS conditionally forwards here |
| `*.meridian-aws.internal` | Route 53 Private Hosted Zone | On-prem DNS conditionally forwards here |

**Scenario: GCP VM resolves on-prem hostname**

A GCP Compute instance at `10.100.4.5` running the mobile-banking API needs to
reach the core-banking service at `corebanking.internal.meridian.local`.

Step-by-step resolution:

```
1.  VM sends UDP query to 169.254.169.254:53 (Cloud DNS stub resolver)
2.  Cloud DNS checks: does a private zone match *.internal.meridian.local? No.
3.  Cloud DNS checks: does a forwarding policy match? Yes —
      rule: *.internal.meridian.local → forward to 10.10.1.53
4.  Cloud DNS forwards UDP/53 to 10.10.1.53 over the Cloud Interconnect
      (traffic path: GCP VPC → Interconnect → HQ-DC1 router → 10.10.1.53)
5.  On-prem DNS answers: corebanking.internal.meridian.local → 10.10.5.22
6.  Cloud DNS returns the answer to the VM
7.  VM connects TCP to 10.10.5.22 (routed back via Interconnect)
```

Verify it works [laptop with `dig` installed, run from any Linux/Mac host]:

```bash
# Simulate the query that the cloud VM would make
# (Run from a host that can reach 10.10.1.53 — or a test resolver)
dig @10.10.1.53 corebanking.internal.meridian.local

# Expected output (authoritative answer from on-prem):
;; ANSWER SECTION:
corebanking.internal.meridian.local. 300 IN A 10.10.5.22

# If NXDOMAIN: the zone doesn't exist on that server
# If no response: network/firewall blocking UDP/53
```

**Scenario: on-prem host resolves GCP private hostname**

A batch job on HQ-DC1 (`10.10.8.100`) needs to write to Cloud SQL at
`sqldb-prod.private.meridian-prod.gcp`.

```
1.  Host queries 10.10.1.53 (its configured DNS server)
2.  On-prem DNS checks: local zone match? No.
3.  On-prem DNS checks: conditional forwarder for *.meridian-prod.gcp? Yes →
      forward to GCP inbound DNS policy endpoint (e.g. 10.100.0.2:53)
4.  The query travels over the Interconnect to GCP
5.  GCP Cloud DNS (inbound policy) answers from its private zone:
      sqldb-prod.private.meridian-prod.gcp → 10.100.4.11
6.  Answer returned to on-prem DNS, then to the batch job
7.  Batch job connects TCP to 10.100.4.11 over the Interconnect
```

**What breaks if DNS forwarding is missing:**

```bash
# Without the conditional forwarder, on-prem DNS recurses to the public internet
dig @8.8.8.8 sqldb-prod.private.meridian-prod.gcp
# Result: NXDOMAIN — the name is private, it doesn't exist publicly
# The batch job errors: "connection refused" or "no such host"
```

---

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---|---|---|---|---|
| Authoritative private zone | BIND / Windows DNS zone | Cloud DNS private zone | Route 53 Private Hosted Zone | Azure Private DNS zone |
| Inbound DNS endpoint (cloud receives forwarded queries) | N/A (DNS server is directly addressable) | Cloud DNS inbound policy + forwarding rule creates a forwarding IP in the VPC | Route 53 Resolver inbound endpoint (ENI with IP) | Azure DNS Private Resolver inbound endpoint |
| Outbound DNS forwarder (cloud forwards to on-prem) | N/A | Cloud DNS forwarding zone (target: on-prem IP) | Route 53 Resolver outbound endpoint + forwarding rule | Azure DNS Private Resolver outbound endpoint |
| On-prem forwards to cloud | Conditional forwarder on BIND/Windows DNS → cloud inbound IP | ← receives via inbound policy | ← receives via inbound endpoint | (Azure: TODO) |
| DNS query transport | UDP/53 (small), TCP/53 (large/DNSSEC) | Same, over VPC networking | Same, over VPC | Same |
| Zone attached to VPC | N/A | Private zone peered to VPC | PHZ associated with VPC | Private zone linked to VNet |
| Split-horizon (same name, different answer per source) | DNS view (BIND views / Windows DNS zones) | Separate public + private zones for the same name | Separate public hosted zone + PHZ | Separate public + private zones |

**GCP specifics:** Cloud DNS inbound policies attach to a VPC and create reserved
forwarding IP addresses inside the VPC subnet you choose. Those IPs (e.g.
`10.100.0.2`) are what on-prem conditional forwarders target. Cloud DNS forwarding
zones (outbound) let GCP resolve names by forwarding to on-prem servers.

**AWS specifics:** Route 53 Resolver uses explicit **inbound** and **outbound**
ENI-based endpoints. Inbound endpoints receive queries from on-prem. Outbound
endpoints send queries to on-prem, governed by Resolver forwarding rules. The
default VPC resolver is at the VPC CIDR base + 2 (e.g. `10.104.0.2`).

---

## Do it (the exercise)

### Part 1 — trace a hybrid DNS failure [laptop]

1. Open two terminal windows. In the first, simulate a successful resolution:
   ```bash
   # Query a public name — always works
   dig @8.8.8.8 example.com +short
   ```

2. Simulate what happens when a private name leaks to public DNS:
   ```bash
   # This private name does not exist publicly — you will get NXDOMAIN
   dig @8.8.8.8 corebanking.internal.meridian.local +short
   # Expected: (nothing — NXDOMAIN)
   ```

3. Test that UDP/53 forwarding can reach a target. Substitute a real DNS server
   IP on your network (your router is usually fine):
   ```bash
   dig @$(ip route | awk '/default/ {print $3}') example.com +short
   # Should return an IP — confirms UDP/53 is reachable to that forwarder
   ```

4. Inspect the response flags to understand authoritative vs forwarded answers:
   ```bash
   dig @8.8.8.8 example.com
   # Look for: "aa" flag absent = non-authoritative (forwarded/cached)
   # Look for: "ra" flag present = recursion available
   # Look for: Query time and SERVER line
   ```

### Part 2 — design the Meridian Bank DNS configuration [paper/whiteboard]

Draw the full DNS forwarding topology for Meridian Bank:

- On-prem DNS at `10.10.1.53` serves `internal.meridian.local`
- GCP Cloud DNS private zone serves `private.meridian-prod.gcp`
  — inbound policy endpoint at `10.100.0.2`
- AWS Route 53 PHZ serves `meridian-aws.internal`
  — inbound resolver endpoint at `10.104.0.2`

Write out the conditional forwarder rules you would add to the on-prem DNS server
and the forwarding zones you would create in GCP Cloud DNS and AWS Route 53.
Check: can a GCP VM resolve `corebanking.internal.meridian.local`? Can an on-prem
host resolve `sqldb-prod.private.meridian-prod.gcp`?

### Part 3 — simulate forwarding with a local resolver [laptop]

If you have `dnsmasq` or `unbound` installed locally, configure a simple
conditional forward and verify it:

```bash
# dnsmasq: forward *.example-internal to a specific server
# Add to /etc/dnsmasq.conf (or a temp config file):
# server=/example-internal/127.0.0.1#5353

# Then start dnsmasq and test:
# dig @127.0.0.1 host.example-internal
```

This gives you the muscle-memory of configuring and verifying a forwarder
before doing it in a real cloud console [needs cloud account].

### Part 4 — cloud console configuration [needs cloud account]

**GCP:** IAM → Network Services → Cloud DNS →
- Create a private zone for `private.meridian-prod.gcp`, associate with the VPC.
- Create a forwarding zone for `internal.meridian.local`, target = on-prem DNS IP.
- Create an inbound DNS policy, associate with the VPC, note the assigned IPs.

**AWS:** VPC → Route 53 Resolver →
- Create an inbound endpoint (choose subnets, get two ENI IPs per AZ).
- Create an outbound endpoint + forwarding rule for `internal.meridian.local`
  pointing to the on-prem DNS server.

---

## Say it back (self-check)

1. Why does a GCP private zone name return NXDOMAIN when queried from on-prem
   without any forwarding configuration?
2. What is the difference between a Cloud DNS **inbound policy** (GCP) and a
   **forwarding zone** (GCP)? Which direction does each serve?
3. What IP address does a GCP Compute instance use as its DNS resolver, and how
   does Cloud DNS know to forward specific suffixes to on-prem?
4. Name the Route 53 feature that accepts forwarded DNS queries from on-prem
   networks, and what AWS resource type implements the forwarding endpoint.
5. If hybrid DNS forwarding breaks, what symptom will application teams see, and
   why might they initially blame the application rather than DNS?

---

## Talk to the IT/security head

**Ask:**

- "Which DNS servers are authoritative for your internal zones, and are they
  highly available?" *(reveals single points of failure — one DNS server going
  down silently breaks cloud hybrid paths)*

- "Do you have conditional forwarders configured for cloud-private zones today,
  or are cloud names expected to resolve publicly?" *(a surprising number of
  hybrid setups rely on public DNS for names that should be private — a data-
  residency and security gap)*

- "Is UDP/53 and TCP/53 from the cloud VPC explicitly allowed to on-prem DNS
  servers in your firewall rule base?" *(often forgotten; DNS traffic is not
  automatically permitted by interconnect or VPN)*

- "What TTL do you set on internal records, and how does that interact with
  failover?" *(a 3,600-second TTL on a record that changes during a DR event
  means clients are cached to the wrong IP for an hour)*

- "Who owns DNS changes — the network team or a separate DNS admin team? What is
  the change window?" *(in banks, DNS changes can require CAB approval; knowing
  the lead time prevents launch-day surprises)*

**A good answer sounds like:** the network team can name their internal DNS
software (BIND 9, Windows DNS, Infoblox), the specific zone names used, the
existing conditional forwarders if any, and the firewall rules that permit
DNS forwarding traffic. They know the TTL policy and the change process.

**Red flags:**
- "DNS just works — we haven't touched it in years." (No visibility = hidden
  fragility; internal zones are often undocumented in legacy shops.)
- "Cloud names just resolve automatically." (They don't, unless someone configured
  forwarding; if it "works," check why — there may be a public DNS workaround
  that exposes private IPs.)
- Very long TTLs (>3,600 s) on records that change during DR or failover.
- DNS server is a single VM with no HA pair or health check.
- No firewall rule explicitly permitting DNS traffic — it may be allowed by an
  overly broad "allow all" rule that is a separate audit risk.

---

## Pitfalls & war stories

**The "it works in dev, broken in prod" split-horizon trap.** Dev and prod use
the same internal zone name but different IPs. If the wrong forwarder is
configured in one environment, the dev VM happily connects to the prod database
because the conditional forwarder answers with the wrong record. Split-horizon
exists to prevent this — but only if every environment's DNS is configured
consistently.

**DNS as a hidden interconnect dependency.** The network team proves the Cloud
Interconnect is up (ping works) and declares the hybrid link healthy. DNS
forwarding still fails because the firewall blocks UDP/53 from the cloud to
on-prem. Applications see NXDOMAIN and report "cloud is down." The real problem
is a firewall rule — but DNS symptoms hide it. Always test DNS explicitly when
validating a new interconnect.

**TTL-based outage extension during failover (a Meridian Bank scenario).** Assume
the primary Cloud SQL instance at `10.100.4.11` fails and a DR switch moves the
service to `10.100.4.55`. If the DNS record `sqldb-prod.private.meridian-prod.gcp`
has a TTL of 3,600 seconds, batch jobs on-prem continue trying `10.100.4.11` for
up to one hour, even though the record has been updated. For DR, internal records
should carry TTLs of 60–300 seconds — long enough to cache normally, short enough
to expire quickly during a switch.

**Overlapping zone names across on-prem and cloud.** If Northwind FMCG's acquired
entity "Eastfield Foods" also used `*.eastfield.internal` as its internal zone
and Northwind's cloud team created a Cloud DNS private zone with the same suffix,
queries become ambiguous. Which server wins? The answer depends on the resolution
order, and the wrong answer silently returns the wrong IP — the M&A DNS overlap
problem (pairs with the IP overlap problem from `reference/running-example.md`).

**PCI-DSS and DNS exfiltration.** DNS queries from the CDE to an external resolver
can be used as a data-exfiltration channel (DNS tunneling). PCI-DSS v4.0 Req 1.3
(restrict network access into and out of the CDE) and Req 10 (logging and
monitoring) both apply
to DNS. On-prem DNS servers that forward to cloud must not themselves forward
unrestricted queries to the public internet; a split-horizon design where CDE
hosts only reach controlled resolvers is the correct posture. Pairs with N29 and S01.

---

## Going deeper (optional)

- RFC 1034 / RFC 1035 — the foundational DNS specs; section 2 of RFC 1034
  explains the delegation and zone model that makes conditional forwarding work.
- RFC 7858 — DNS over TLS (DoT); relevant if the network team asks about
  encrypting DNS traffic over the interconnect.
- [GCP Cloud DNS documentation](https://cloud.google.com/dns/docs) — specifically
  "DNS policies" (inbound) and "DNS forwarding zones" (outbound).
- [AWS Route 53 Resolver](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html)
  — inbound and outbound endpoints, forwarding rules.
- Pairs with: N17 (DNS fundamentals), N18 (split-horizon and enterprise DNS),
  N38 (Interconnect — the transport that DNS forwarding uses), N45 (Cloud DNS
  per-cloud deep dive), N48 (hub-and-spoke — where DNS inbound endpoints sit).

# Kata N17 — DNS deep dive: resolution path, records, TTL, caching

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N03, N07, N12 · **Time:** ~40 min
> **Tags:** `dns` `l7-application` `networking` `hybrid` `cloud-dns` `latency` `meridian-bank` `troubleshooting`

## Why it matters

Every connection in every system starts with a DNS lookup. If DNS is slow,
everything is slow. If DNS is wrong, nothing works — and the symptom looks like
"the network is down" even though the network is fine. At Meridian Bank, DNS is
also a **security and compliance surface**: what resolves where, for whom, tells
the story of your network segmentation. An architect who understands the full
resolution path can diagnose a broken hybrid cloud connection in minutes, design
a split-horizon setup that doesn't leak internal names to the internet, and ask
the questions that expose fragile single points of failure in the IT head's DNS
infrastructure.

## The mental model

### First principles: the phone book problem

Computers speak to IP addresses. Humans speak to names. DNS is the lookup
service that bridges them — a globally distributed, delegated hierarchy of
databases, each authoritative for its own slice.

The hierarchy has three tiers:

```
  Root (.)          13 root server clusters globally; know who runs .com, .in, etc.
     │
  TLD (.com, .in)   Top-level domain servers; know who runs meridian.com, etc.
     │
  Authoritative     Meridian's own DNS server; knows the real IPs for
  name server       api.meridian.com, core.meridian.com, etc.
```

No single server knows everything. Every name is resolved by **asking the
hierarchy**, starting at the root — unless the answer is already cached.

### The resolution path, step by step

A developer's laptop at HQ-DC1 tries to connect to `api.meridian.example`:

```
  Laptop                 Recursive resolver          Authoritative servers
  (10.10.5.21)           (10.10.0.2)
      │                       │
   1. stub query              │
      └──── "api.meridian.example?" ────────────────────────────────────>
                              │
                     cache miss; starts iteration
                              │
                         2. asks root (.)
                              │<── "ask .example TLD server at 192.5.6.30"
                              │
                         3. asks TLD (.example)
                              │<── "ask meridian.example NS at 10.10.0.53"
                              │
                         4. asks authoritative (10.10.0.53)
                              │<── "api.meridian.example A 10.10.1.44  TTL 300"
                              │
      <───── returns 10.10.1.44 ──────────────────────────────────────────
      │
   5. connects to 10.10.1.44
```

Key actors:

| Actor | Role | Runs by |
|-------|------|---------|
| **Stub resolver** | Library in the OS; sends queries to the recursive resolver | OS (configured via DHCP or static) |
| **Recursive resolver** (a.k.a. full-service resolver) | Does the iterative work — root → TLD → auth; caches answers | Network team / cloud DNS / ISP |
| **Authoritative name server** | Holds the actual records; gives definitive answers for its zones | Whoever owns the domain |

The laptop's stub resolver sends **one recursive query** and waits. All the hard
work (steps 2–4) happens inside the recursive resolver. This is why your
corporate DNS server has a much richer cache than your laptop.

### Record types you must know

| Type | Meaning | Example |
|------|---------|---------|
| **A** | IPv4 address | `api.meridian.example.  300  IN  A  10.10.1.44` |
| **AAAA** | IPv6 address | same name, `IN  AAAA  fd00::1:44` |
| **CNAME** | Canonical name (alias) | `www IN CNAME  api.meridian.example.` |
| **MX** | Mail exchanger (+ priority) | `meridian.example. IN MX 10 mail.meridian.example.` |
| **NS** | Name server for a zone | `meridian.example. IN NS ns1.meridian.example.` |
| **PTR** | Reverse lookup (IP → name) | `44.1.10.10.in-addr.arpa. IN PTR api.meridian.example.` |
| **SOA** | Start of Authority: serial, refresh, retry, expire, minimum TTL | One per zone |
| **TXT** | Free-form text | SPF records, domain ownership verification |
| **SRV** | Service location (port + host) | Used by SIP, XMPP, Active Directory domain controllers |

CNAME chains resolve left to right. A CNAME target must itself resolve to an A
or AAAA — you cannot put a CNAME at the zone apex (the naked domain) because the
zone must have an SOA and NS record there. Cloud providers work around this with
proprietary ALIAS or ANAME records.

### TTL and caching

TTL (here: the DNS resource-record TTL, not the IP hop-counter from N06 — same
name, different field) is the number of **seconds** a recursive resolver may
cache an answer before asking again.

```
  Record:  api.meridian.example.  300  IN  A  10.10.1.44
                                  ^^^
                                  TTL = 300 s (5 min)
```

Once cached, every subsequent query within those 300 seconds gets the cached
answer — instantly, without touching the authoritative server. The **cache hit
rate** is the most important DNS performance metric.

TTL trade-offs:

| TTL | Good for | Risk |
|-----|----------|------|
| Low (30–60 s) | Fast failover; frequent IP changes (blue/green deploy) | More queries; more latency on every cache miss |
| High (3600 s+) | Stable IPs; reduces load; faster for users | Slow propagation of changes; long-lived stale answers after failover |
| Too high (24 h+) | N/A | Clients hold wrong IP for up to 24 h after a migration |

**Pre-lower TTL before any migration.** If you need to move `api.meridian.example`
from 10.10.1.44 to 10.10.1.99, lower the TTL to 60 s at least one TTL period
*before* the change. Otherwise old resolvers serve the stale IP until their
existing cache expires.

### Negative caching

When a name does *not* exist (NXDOMAIN), resolvers also cache the negative
result — for the duration specified in the SOA's minimum TTL field. This means a
typo'd hostname is cached as "not found" for minutes to hours, not just for one
query.

## Worked example

Meridian Bank's network:

- HQ-DC1 internal range: `10.10.0.0/16` (see `reference/running-example.md`)
- Corporate recursive DNS (on-prem): `10.10.0.2` and `10.10.0.3` (redundant pair)
- Authoritative DNS for `meridian.example` (internal): `10.10.0.53`
- GCP primary cloud range: `10.100.0.0/14`

The mobile banking API lives in GCP at `10.100.1.20`.

**Query from a branch laptop at `10.30.4.7` resolving `api.meridian.example`:**

```bash
# On the branch laptop, dig shows:
$ dig api.meridian.example @10.10.0.2

;; QUESTION SECTION:
;api.meridian.example.          IN      A

;; ANSWER SECTION:
api.meridian.example.   300     IN      A       10.100.1.20

;; Query time: 8 msec
;; SERVER: 10.10.0.2#53(10.10.0.2)
```

The `300` is the TTL in seconds. `Query time: 8 msec` means the recursive
resolver had to fetch it (cache miss). Run the same command again immediately:

```bash
$ dig api.meridian.example @10.10.0.2
;; Query time: 0 msec        # cache hit — answer stored at 10.10.0.2
```

**Tracing the resolution path with `+trace`** [laptop]:

```bash
$ dig +trace api.meridian.example

.                       518400  IN      NS      a.root-servers.net.
example.                172800  IN      NS      a.iana-servers.net.
meridian.example.       86400   IN      NS      ns1.meridian.example.
api.meridian.example.   300     IN      A       10.100.1.20
```

(Abbreviated/illustrative — real `+trace` output is longer: it shows the full
root NS set and a `;; Received … bytes from …` line after each stanza.)

Each stanza shows one iteration step — root → TLD → authoritative — exactly the
path in the mental model above. Run this against any real domain to see the
hierarchy live.

**Reverse lookup (PTR):** The IT head's monitoring system sees `10.100.1.20` in
logs. To confirm it's the API host:

```bash
$ dig -x 10.100.1.20 @10.10.0.2
;; ANSWER SECTION:
20.1.100.10.in-addr.arpa.  300 IN PTR api.meridian.example.
```

PTR records live in the special `in-addr.arpa.` zone (for IPv4), written with
octets reversed. Meridian's network team must maintain these alongside A records,
or the monitoring logs are full of raw IPs.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Recursive / caching resolver | Bind / Unbound / Windows DNS (AD-integrated) | Metadata server `169.254.169.254` answers internally; Cloud DNS private zones resolve within VPC | Route 53 Resolver (per-VPC; implicit at `169.254.169.253`) | Azure DNS (VNet-scoped at `168.63.129.16`) |
| Authoritative DNS (public) | Bind / NSD / vendor appliance | **Cloud DNS** — globally anycasted; managed zones | **Route 53** — public hosted zones; health-check-aware routing | **Azure DNS** — public zones |
| Private / internal zones | Internal Bind/Windows DNS server on LAN | Cloud DNS **private zones** scoped to VPCs | Route 53 **private hosted zones** associated to VPCs | Azure Private DNS zones linked to VNets |
| Hybrid resolution (on-prem ↔ cloud) | Conditional forwarders on on-prem resolver | Cloud DNS **inbound / outbound forwarding policies** + DNS peering | Route 53 Resolver **inbound / outbound endpoints** (ENIs in the VPC) | Azure Private Resolver (inbound + outbound endpoints) |
| Health-check-aware / geo-routing | F5 GTM / GSLB | Cloud DNS + **Traffic Director** policies | Route 53 **routing policies** (weighted, latency, failover, geolocation) | Azure Traffic Manager (DNS-based) |
| DNS Security (DNSSEC) | Bind with DNSSEC signing | Cloud DNS supports DNSSEC for public zones | Route 53 supports DNSSEC signing | Azure DNS supports DNSSEC for public zones |
| DNS query logging | Bind `query-log`; syslog | Cloud DNS **query logging** (→ Cloud Logging) | Route 53 Resolver query log (→ CloudWatch / S3) | Azure Monitor DNS metrics / diagnostics |

**GCP note:** within a VPC, instances automatically get a recursive resolver that
answers for the VPC's private Cloud DNS zones. You do not run your own resolver
inside GCP — you configure zones and the infrastructure handles resolution.

**AWS note:** Route 53 Resolver is available at the second IP of every VPC CIDR
(e.g., for `10.100.0.0/16` the resolver is at `10.100.0.2`). Inbound and outbound
endpoints are elastic network interfaces you create in your subnets — they carry
DNS traffic across VPN/Direct Connect into and out of on-prem.

## Do it (the exercise)

**All steps below run on any Linux/macOS laptop with `dig` installed.** [laptop]

1. **Trace a full resolution**
   ```bash
   dig +trace www.example.com
   ```
   Identify: the root servers queried, the TLD delegation, the authoritative
   NS, and the final A record with its TTL.

2. **Inspect the TTL in real time**
   ```bash
   dig www.example.com | grep -E 'ANSWER|IN'
   # wait 30 seconds, then run again
   dig www.example.com | grep -E 'ANSWER|IN'
   ```
   The TTL in the second answer is lower — it counts down as the cache ages.
   When it hits zero, the next query fetches fresh.

3. **Look up each record type**
   ```bash
   dig MX    gmail.com
   dig NS    gmail.com
   dig TXT   gmail.com      # look for SPF records starting with "v=spf1"
   dig AAAA  google.com
   ```

4. **Reverse lookup**
   ```bash
   dig -x 8.8.8.8           # Google's public DNS — should return dns.google.
   ```

5. **Check what your machine is using as its recursive resolver**
   ```bash
   cat /etc/resolv.conf       # Linux
   # or
   scutil --dns | grep nameserver    # macOS
   ```
   Note the IP. Is it your corporate DNS? Your router (NAT gateway)? A public
   resolver (8.8.8.8, 1.1.1.1)? Each has different caching scope and privacy
   implications.

6. **Simulate a negative cache (NXDOMAIN)**
   ```bash
   dig doesnotexist.meridian.example @8.8.8.8
   ```
   Note the `NXDOMAIN` status and the minimum TTL in the SOA record — that is
   how long the negative answer will be cached.

7. **[needs cloud account — GCP]** Create a Cloud DNS private zone named
   `meridian.example.` in your VPC, add an A record `api.meridian.example.`
   pointing to `10.100.1.20` (TTL 300), and resolve it from a GCP VM:
   ```bash
   gcloud dns managed-zones create meridian-internal \
     --dns-name="meridian.example." \
     --visibility=private \
     --networks=YOUR_VPC \
     --description="Meridian internal DNS"

   gcloud dns record-sets create api.meridian.example. \
     --zone=meridian-internal \
     --type=A --ttl=300 \
     --rrdatas="10.100.1.20"
   ```
   From the VM: `dig api.meridian.example` — you should see `10.100.1.20`.

## Say it back (self-check)

1. Name the three tiers of the DNS hierarchy and state what each tier knows.
2. What is the difference between a stub resolver, a recursive resolver, and an
   authoritative name server?
3. A record's TTL is 3600 s. You update its IP. How long before all clients see
   the new IP? What could you have done to make that window smaller?
4. What does NXDOMAIN mean, and why can it be cached?
5. An A record cannot coexist with a CNAME at the same name. Why not, and what
   does the zone apex rule have to do with it?

## Talk to the IT/security head

**Ask:**

- "Who is authoritative for your internal DNS zones, and is it the same team that
  manages external/public DNS?" *(split ownership is common; if the teams don't
  coordinate, hybrid resolution breaks and nobody owns the seam)*
- "What are the TTLs on your critical service records — API endpoints, database
  names, VPN gateway names?" *(TTLs above 3600 s mean a failover or migration
  takes hours to propagate; this is often discovered the hard way)*
- "Do you have conditional forwarding set up for your cloud private zones, and
  does on-prem DNS know to forward `*.googleapis.internal` queries to GCP?" *(the
  most common hybrid DNS failure; see N18 for the full hybrid pattern)*
- "Is DNS query logging turned on, and does your SIEM consume it?" *(DNS logs are
  a tier-one security signal; exfiltration via DNS tunneling and C2 beaconing
  both appear here first — see N18 and S20)*
- "What is the blast radius if your recursive resolvers go down?" *(a pair at
  one site, with no cross-site fallback, means a site outage = total name
  resolution failure for that site; Meridian's 220 branches each need a fallback)*

**A good answer sounds like:** named owners for internal vs external zones,
explicit TTL values for critical records, a documented hybrid forwarding design
with health checks, DNS logs flowing to the SIEM, and resilient resolver
deployment (at least two, in different failure domains).

**Red flags:**

- "DNS just works, we don't really touch it." DNS is infrastructure that *appears*
  to just work until it doesn't — at which point everything stops and nobody
  knows why, because nobody owned it.
- TTLs of 86400 (24 h) or higher on service records — discovery of this before
  a migration saves significant pain.
- No query logging — blind spot for DNS tunneling, data exfiltration, and
  malware C2 (a PCI-DSS and RBI audit concern).
- "We use the internet resolver (8.8.8.8) for internal names." Internal names
  should never leave the corporate network; relying on a public resolver for
  private zones leaks topology and fails silently for RFC 1918 addresses.

## Pitfalls & war stories

**The forgotten TTL before the cutover.** Meridian migrates `api.meridian.example`
from the old app server (`10.10.1.44`) to the new GCP instance (`10.100.1.20`).
The record TTL is 86400 s. The migration goes live at 09:00 — but 40% of branch
laptops cached the old IP at 08:50 and will keep hitting the dead server until
their cache expires, up to 24 h later. The fix (lower TTL 48 h in advance) was
in the runbook but skipped. See this at least once at a financial institution and
you never skip it again.

**CNAME at the zone apex.** A developer configures `meridian.example. IN CNAME
alb-1234.us-east-1.elb.amazonaws.com.` for a naked-domain vanity URL. This
violates DNS standards (RFC 1034 §3.6.2) because the zone must have SOA and NS
records at the apex and a CNAME cannot coexist with other records. The resolver
behaviour is undefined — some drop the record, some return SERVFAIL. Use Route
53 ALIAS or Cloud DNS CNAME flattening instead.

**Split-horizon misconfiguration.** Meridian runs two views: `api.meridian.example`
resolves to `10.10.1.44` for internal clients and `203.0.113.55` (public LB) for
external. A junior admin updates only the internal view. External clients keep
reaching the old IP. Worse: if the internal recursive resolver is reachable from
the cloud and the cloud workloads use it, they get the internal IP — which is
correct by design, but breaks if the cloud VPN path goes down. Always update
both views atomically and test from both network segments. (The split-horizon
pattern is taught in full in N18.)

**DNS as a single point of failure.** A bank with two recursive resolvers, both
in HQ-DC1, on the same UPS, on the same VLAN. One power event — 220 branches
lose all name resolution. DNS is often under-invested because "it just works";
the blast radius of a DNS outage rivals that of a core router failure.

**DNS tunneling / exfiltration.** Malware can encode data in DNS query names
(e.g., `base64data.c2.attacker.com`) and get answers back via TXT records —
bypassing HTTP/HTTPS filters. Without DNS query logging, this is invisible. For
PCI-DSS environments, the cardholder data environment's DNS traffic must be
logged and monitored (see S20 for SIEM integration).

## Going deeper (optional)

- RFC 1034 and RFC 1035 — the original DNS specification (1987); still the
  authoritative source on record types, zone structure, and resolution algorithm.
- RFC 2308 — negative caching (NXDOMAIN TTL from the SOA minimum field).
- RFC 6891 — EDNS0 (extension mechanisms); explains how responses larger than
  512 bytes work (needed for DNSSEC, many TXT records).
- RFC 4033–4035 — DNSSEC: how zones are signed and how resolvers validate.
- GCP Cloud DNS documentation:
  https://cloud.google.com/dns/docs/overview
- AWS Route 53 Resolver documentation:
  https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html
- Pairs with **N18** (split-horizon DNS, conditional forwarding, hybrid
  resolution end-to-end) and **N45** (cloud DNS at VPC scale). Cross-references
  security in **S20** (DNS logs to SIEM) and **N29** (PCI-DSS / data-residency
  constraints on DNS).

# Kata N18 — DNS in the enterprise: split-horizon, forwarding, hybrid

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N17 · **Time:** ~40 min
> **Tags:** `dns` `hybrid` `networking` `l7-application` `cloud-dns` `fsi` `meridian-bank` `on-prem`

## Why it matters

Every enterprise runs two DNS worlds simultaneously: a **public** DNS that the
internet uses to reach your services, and a **private** DNS that internal hosts
and cloud workloads use to reach each other. Getting these wrong produces the
most common and hardest-to-diagnose connectivity failures in hybrid
GCP/AWS+on-prem environments: a workload that resolves public IPs when it
should resolve private ones, or a branch that can't resolve a cloud-hosted
service at all. At Meridian Bank, where cloud workloads must reach the core
banking system in HQ-DC1 *by private IP* without the name ever appearing in
public DNS, the enterprise DNS design is a security control as much as a
plumbing detail. The network team owns it and the CISO cares about it.

## The mental model

### The resolution path (recap from N17)

When a host needs to resolve `api.meridian.internal`:

```
  Host stub resolver
        │  query: api.meridian.internal?
        ▼
  Recursive resolver (which one depends on what the host is configured with)
        │  knows? → answer from cache
        │  doesn't know? → forward or recurse
        ▼
  Authoritative nameserver for meridian.internal
```

The whole enterprise DNS conversation turns on *which recursive resolver* the
host hits, and *what that resolver is configured to forward*.

---

### Pattern 1 — Split-horizon DNS (split-brain)

The same zone name is served with **different answers** depending on who asks.

```
  Internet query:  api.meridian.example  →  203.0.113.42  (public IP, WAF front door)
  Internal query:  api.meridian.example  →  10.10.5.20    (private IP, internal LB)
```

How it works: two separate authoritative zones with the same name, one on
public DNS (e.g. NS records in the registrar's zone), one on your internal
DNS server. Internal hosts use the internal resolver → they get the private
answer. The internet never sees your internal zone.

```
                     ┌─────────────────────┐
  internet client ──▶│ public DNS (e.g.    │──▶ 203.0.113.42 (WAF)
                     │ Cloudflare/Route53) │
                     └─────────────────────┘

  internal host   ──▶ 10.10.1.10 (Meridian DNS) ──▶ 10.10.5.20 (internal LB)
  (10.10.x.x)         knows meridian.example as
                       a private authoritative zone
```

**Why this matters for the architect:** if a cloud workload's DHCP resolver
points at a public DNS instead of the internal one, it resolves the *public*
IP and traffic bounces out to the internet before coming back in — spiking
latency, triggering firewall rules, and potentially breaking data-residency
controls. Every cloud subnet's DNS configuration must be intentional.

---

### Pattern 2 — Conditional forwarding

A resolver is told: "for queries matching *this specific zone*, forward to
*this nameserver*; for everything else, recurse normally."

```
  On-prem resolver (10.10.1.10) forwarding table:
  ┌────────────────────────────┬──────────────────────────────────┐
  │ Zone                       │ Forward to                       │
  ├────────────────────────────┼──────────────────────────────────┤
  │ gcp.meridian.internal      │ 10.100.1.2  (GCP inbound EP)    │
  │ aws.meridian.internal      │ 10.104.1.2  (AWS inbound EP)    │
  │ 100.10.in-addr.arpa        │ 10.100.1.2  (reverse DNS, GCP)  │
  │ (everything else)          │ recurse / ISP forwarders         │
  └────────────────────────────┴──────────────────────────────────┘
```

This is the mechanism that makes hybrid DNS work: your on-prem resolver
*doesn't* recurse for private cloud zones (those zones aren't in public DNS),
it *delegates* resolution to the cloud's DNS system for those zones.

The mirror exists in the cloud: GCP/AWS resolvers are told "for
`meridian.internal` (on-prem), forward to 10.10.1.10."

---

### Pattern 3 — Hybrid DNS: the full picture

In a hybrid architecture you need *four* forwarding rules operating in
concert:

```
  On-prem host wants  gcp.meridian.internal  (a GCP private zone):
  ─────────────────────────────────────────────────────────────────
  host → on-prem resolver (10.10.1.10)
       → forwarding rule: gcp.meridian.internal → GCP inbound EP
       → GCP inbound endpoint (10.100.1.2, inside your VPC)
       → GCP Cloud DNS authoritative for gcp.meridian.internal
       ← answer: 10.100.x.x (GCP private IP)
       ← on-prem resolver caches + returns to host

  GCP workload wants  meridian.internal  (on-prem zone):
  ──────────────────────────────────────────────────────
  GCP workload → 169.254.169.254 (GCP metadata DNS)
              → GCP DNS outbound policy on the VPC
              → forwarding rule: meridian.internal → 10.10.1.10
              → on-prem resolver answers from its authoritative zone
              ← answer: 10.10.x.x (on-prem private IP)
```

The traffic uses the private path (Cloud Interconnect or Site-to-Site VPN —
see N36–N38). DNS queries *never cross the internet*; they traverse the same
private backbone as the data.

**Reverse DNS (PTR records)** must be forwarded too — if not, tools like
`ssh`, `tcpdump`, and many security log enrichers fail to resolve hostnames
from IPs.

---

### The RFC 1918 + private-zone naming discipline

Internal zones **must not use real public TLDs** you don't control. Common
mistakes and their consequences:

| Zone name choice | Risk |
|-----------------|------|
| `.internal` (reserved by ICANN, 2024, for private use) | Safe; ICANN-reserved private-use TLD |
| `meridian.example` (internal) | Safe if `.example` is under your control |
| `corp.meridian.com` (internal) | Risky — if public DNS also has a `corp` record, split-horizon can silently break |
| `.local` | Reserved for mDNS (RFC 6762); conflicts with Bonjour/Avahi |
| `.corp` / `.home` / `.mail` | Never owned by ICANN; risky after ICANN new-gTLD rounds |

Best practice for Meridian: `meridian.internal` for on-prem, `gcp.meridian.internal`
for GCP private zones, `aws.meridian.internal` for AWS private zones. Never
use these suffixes in public DNS.

## Worked example

Meridian Bank's hybrid DNS for the mobile banking backend (GCP region:
`asia-south1`) reaching the core banking API at HQ-DC1.

**IP plan (from `reference/running-example.md`):**
- On-prem HQ-DC1: `10.10.0.0/16`
- GCP: `10.100.0.0/14`

**DNS servers:**
- On-prem authoritative + recursive: `10.10.1.10`, `10.10.1.11` (redundant pair)
- GCP inbound forwarding endpoint: `10.100.1.2` (GCP-managed, inside the VPC)
- GCP outbound forwarding policy targets: `10.10.1.10`, `10.10.1.11`

**Zones:**

```
  meridian.internal      → authoritative on 10.10.1.10 / .11
      core-api.meridian.internal  A  10.10.5.30    (core banking API)
      mq.meridian.internal        A  10.10.5.40    (message queue)

  gcp.meridian.internal  → authoritative in GCP Cloud DNS (private zone)
      mobile-api.gcp.meridian.internal  A  10.100.4.20  (GCP internal LB)
      analytics.gcp.meridian.internal   A  10.100.4.35
```

**Forwarding configuration:**

On-prem BIND/Windows DNS — conditional forward zone:
```
# BIND named.conf snippet (on 10.10.1.10)
zone "gcp.meridian.internal" {
    type forward;
    forward only;
    forwarders { 10.100.1.2; };   # GCP inbound endpoint
};

zone "100.10.in-addr.arpa" {     # reverse DNS for 10.100.0.0/16
    type forward;
    forward only;
    forwarders { 10.100.1.2; };
};
# NOTE: GCP here is 10.100.0.0/14 (10.100.0.0–10.103.255.255). The /16 reverse
# zone above only covers 10.100.x.x. To forward reverse DNS for the full /14 you
# need four zones — 100.10, 101.10, 102.10, and 103.10.in-addr.arpa — each
# forwarding to 10.100.1.2. The worked-example records all fall in 10.100.x.x,
# so one zone suffices for this example.
```

GCP Cloud DNS — outbound DNS policy on the VPC pointing at on-prem:
```
  Outbound server policy on vpc-meridian-prod:
    Alternative name servers for zone "meridian.internal":
      10.10.1.10  (primary)
      10.10.1.11  (secondary)
```

**Verifying the chain** [laptop — substitute your own lab IPs]:
```bash
# From an on-prem host, resolve a GCP private name
dig @10.10.1.10 mobile-api.gcp.meridian.internal

# Expected: ANSWER SECTION with 10.100.4.20
# If NXDOMAIN: forwarding rule missing or GCP private zone not created

# Verify the GCP inbound endpoint is actually reachable and answering.
# Don't use `nc -zu 10.100.1.2 53`: a UDP probe has no handshake, so a
# closed/filtered DNS port still reports "succeeded" (open|filtered) — it
# proves nothing. Send a real query instead, and/or probe TCP/53:
dig @10.100.1.2 mobile-api.gcp.meridian.internal   # expect an ANSWER, not a timeout
nc -vz 10.100.1.2 53                               # TCP/53 has a handshake, so this is meaningful

# Check reverse DNS works (needed for security log enrichment)
dig @10.10.1.10 -x 10.100.4.20
```

**Split-horizon for public access:**
```
  Public DNS (e.g. Cloud DNS public zone or registrar):
    mobile.meridian.example  CNAME  mobile-gfe.meridian.example.
    mobile-gfe.meridian.example  A  203.0.113.42   (GCP Global LB, public)

  Internal DNS (10.10.1.10 authoritative for meridian.example internal view):
    mobile.meridian.example  A  10.100.4.20         (GCP internal LB)
```

A mobile app hitting `mobile.meridian.example` from the internet → public IP →
GCP external LB → TLS termination → backend. The same name from a developer
laptop on the corporate VPN → internal resolver → 10.100.4.20 → GCP internal
LB → skips the public front door entirely.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Private authoritative DNS | BIND / Windows DNS / Infoblox | Cloud DNS private zone | Route 53 private hosted zone | Azure Private DNS zone |
| Public authoritative DNS | Same servers, or separate tier | Cloud DNS public zone | Route 53 public hosted zone | Azure DNS public zone |
| Hybrid inbound (cloud resolves on-prem) | n/a — on-prem just answers | DNS inbound endpoint (GCP DNS inbound policy; gets an IP from a subnet you choose in your VPC — that is the IP on-prem resolvers forward to) | Route 53 Resolver inbound endpoint (ENI in VPC, port 53) | Azure Private Resolver inbound endpoint |
| Hybrid outbound (cloud queries on-prem) | n/a | DNS outbound policy on VPC with alternative name servers; Cloud DNS sends these forwarded queries from the `35.199.192.0/19` source range, so on-prem firewalls must permit it | Route 53 Resolver outbound endpoint + forwarding rules | Azure Private Resolver outbound endpoint |
| Conditional forwarding rule | BIND `zone {} type forward` / Windows DNS Conditional Forwarder | Cloud DNS forwarding zone (private zone pointing at a nameserver) | Route 53 Resolver rule (FORWARD type) | Azure Private Resolver forwarding ruleset |
| Split-horizon | Two authoritative zones with same name, different views | Two Cloud DNS zones: one public, one private — same name; zone type determines which is served | Route 53: public hosted zone + private hosted zone (same name, private associated to VPC) | Azure: public DNS zone + private DNS zone (same name) |
| Reverse DNS delegation | PTR records in `in-addr.arpa` zones | PTR records in private `in-addr.arpa` zone in Cloud DNS | PTR records in Route 53 private zone for `in-addr.arpa` | (Azure: TODO) |

**GCP-specific detail:** GCP's recursive resolvers for VMs use the metadata
server (`169.254.169.254`). You cannot change the resolver IP inside a GCP VM
to `10.10.1.10` directly — instead you configure a DNS *outbound policy* on
the VPC, which tells the `169.254.169.254` resolver to forward specific zones
elsewhere. The inbound endpoint IP lives in your VPC subnet (you pick the
subnet; GCP assigns the IP from it).

**AWS-specific detail:** the Route 53 Resolver VPC default resolver is always
at `VPC-base + 2` (e.g. in `10.104.0.0/16` it's `10.104.0.2`). Inbound and
outbound endpoints are ENIs (Elastic Network Interfaces) deployed into your
subnets; forward rules are then applied to the outbound endpoint. Pricing:
$0.125/hour per ENI, minimum 2 ENIs per endpoint (one ENI per IP address you
specify, up to 6 billable), plus per-query charges.

## Do it (the exercise)

**[laptop] — Test split-horizon behavior with a local resolver**

1. Install `bind9` or use Docker:
   ```bash
   docker run --rm -it ubuntu:22.04 bash
   apt-get update -q && apt-get install -y bind9 dnsutils
   ```

2. Create a minimal split-horizon config with two views. File `/etc/bind/named.conf.local`:
   ```
   view "internal" {
       match-clients { 127.0.0.1/8; };
       zone "lab.internal" {
           type master;
           file "/etc/bind/db.lab.internal.int";
       };
   };

   view "external" {
       match-clients { any; };
       zone "lab.internal" {
           type master;
           file "/etc/bind/db.lab.internal.ext";
       };
   };
   ```

3. Create `db.lab.internal.int` (internal view):
   ```
   $TTL 60
   @  IN SOA  ns1.lab.internal. admin.lab.internal. (1 3600 900 604800 60)
   @  IN NS   ns1.lab.internal.
   ns1  IN A  127.0.0.1
   api  IN A  10.0.0.1     ; "private" answer
   ```

4. Create `db.lab.internal.ext` (external view):
   ```
   $TTL 60
   @  IN SOA  ns1.lab.internal. admin.lab.internal. (1 3600 900 604800 60)
   @  IN NS   ns1.lab.internal.
   ns1  IN A  127.0.0.1
   api  IN A  203.0.113.1  ; "public" answer (TEST-NET, safe)
   ```

5. Start BIND (`named -g` in foreground) and test both views:
   ```bash
   dig @127.0.0.1 api.lab.internal   # should return 10.0.0.1 (internal view)
   ```
   To test the external view, query from a different source IP or temporarily
   change `match-clients` to `{ none; }` on the internal view.

**[laptop] — Simulate conditional forwarding with a stub zone**

Using `systemd-resolved` or `dnsmasq` on Linux:
```bash
# dnsmasq: forward gcp.lab.internal to a specific server (e.g. 8.8.8.8 as placeholder)
# In /etc/dnsmasq.d/forwarding.conf:
server=/gcp.lab.internal/8.8.8.8

# Reload and test
sudo systemctl restart dnsmasq
dig @127.0.0.1 anything.gcp.lab.internal
# Should return NXDOMAIN from 8.8.8.8 (no real zone there) — but observe the forwarding
```

**[needs cloud account] — GCP: create a private zone and inbound endpoint**

```bash
# Create a private DNS zone for your VPC
gcloud dns managed-zones create meridian-internal \
  --dns-name="meridian.internal." \
  --description="On-prem private zone (hybrid)" \
  --visibility=private \
  --networks=vpc-meridian-prod

# Add a test record
gcloud dns record-sets create core-api.meridian.internal. \
  --zone=meridian-internal \
  --type=A \
  --ttl=300 \
  --rrdatas="10.10.5.30"

# Create an inbound DNS policy so on-prem resolvers can query GCP zones
gcloud dns policies create inbound-from-onprem \
  --description="Inbound from on-prem resolvers" \
  --networks=vpc-meridian-prod \
  --enable-inbound-forwarding
# GCP will assign an inbound endpoint IP from your VPC subnet
# Retrieve it:
gcloud compute addresses list \
  --filter='purpose="DNS_RESOLVER"' \
  --format='csv(address,region,subnetwork)'
```

**[needs cloud account] — AWS: create Route 53 Resolver inbound endpoint**

```bash
# Inbound endpoint (so on-prem → AWS private zone resolution)
aws route53resolver create-resolver-endpoint \
  --creator-request-id "meridian-inbound-$(date +%s)" \
  --name "meridian-inbound" \
  --security-group-ids sg-0abc123 \
  --direction INBOUND \
  --ip-addresses \
    SubnetId=subnet-111aaa,Ip=10.104.1.10 \
    SubnetId=subnet-222bbb,Ip=10.104.2.10

# Outbound endpoint + forward rule for on-prem zone
aws route53resolver create-resolver-endpoint \
  --creator-request-id "meridian-outbound-$(date +%s)" \
  --name "meridian-outbound" \
  --security-group-ids sg-0abc123 \
  --direction OUTBOUND \
  --ip-addresses \
    SubnetId=subnet-111aaa \
    SubnetId=subnet-222bbb

# Forward rule: meridian.internal → on-prem resolvers
aws route53resolver create-resolver-rule \
  --creator-request-id "meridian-fwd-$(date +%s)" \
  --name "forward-to-onprem" \
  --rule-type FORWARD \
  --domain-name "meridian.internal." \
  --resolver-endpoint-id <outbound-endpoint-id> \
  --target-ips Ip=10.10.1.10,Port=53 Ip=10.10.1.11,Port=53
```

## Say it back (self-check)

1. What is split-horizon DNS? Give the Meridian Bank example with the two
   different IP answers for the same hostname.
2. What does a conditional forwarding rule do, and why can't a standard
   recursive resolver handle private cloud zones without one?
3. In GCP, why can't you simply set the DNS server in `/etc/resolv.conf` on a
   VM to `10.10.1.10` and have it forward everything? What is the correct
   mechanism?
4. Name the two Route 53 Resolver endpoint types (AWS) and what each does.
5. Why must reverse DNS (PTR) zones also be forwarded in a hybrid setup?

## Talk to the IT/security head

**Ask:**

- "What DNS servers does DHCP hand out to on-prem hosts, and are cloud
  subnets using the same?" *(a mismatch is the root cause of half of all
  private-name resolution failures in hybrid environments)*
- "Do you have conditional forwarding rules for the cloud private zones, and
  are they bi-directional — on-prem-to-cloud and cloud-to-on-prem?" *(one
  direction missing means half the connections can't be initiated)*
- "Are your internal zone names safe from collision with public TLDs? Are you
  using `.internal`, `.example`, or something that could collide with a real
  public domain?" *(using `.corp` or `.home` is a latent risk after ICANN
  new-gTLD expansions)*
- "When a GCP workload resolves `core-api.meridian.internal`, what IP does it
  get? Can you show me a `dig` or Cloud DNS query log?" *(proves the config
  actually works, not just that it's documented)*
- "Is reverse DNS covered in the forwarding rules? What does SSH resolve
  `10.10.5.30` to?" *(reveals whether PTR zones are forwarded; missing reverse
  DNS breaks many security and auditing tools)*

**A good answer sounds like:** the network team can name the internal zone
names, point to forwarding rules documented in the IPAM system, confirm
bi-directional forwarding is in place, and show you a test query result.
They know which subnet/DHCP scope maps to which resolver.

**Red flags:**

- "The cloud VMs just use 8.8.8.8 for DNS." Cloud workloads using public
  resolvers cannot resolve private zone names at all — a common oversight
  when cloud subnets are stood up by app teams without network review.
- "We tested it once and it worked." DNS TTL caching can mask problems;
  the network team should have a repeatable test, not a memory.
- "We don't have split-horizon; the internal name is different from the
  public one." Workable, but means internal URLs and external URLs differ —
  a developer pain that often leads to hardcoded private IPs in code.
- Unable to state which cloud private zone names are authoritative where.
  In a mature hybrid network the DNS namespace is documented like the IP
  plan — not reconstructed from memory.

## Pitfalls & war stories

- **The 8.8.8.8 cloud subnet.** App teams spin up a GCP subnet, leave the
  DNS at Google's public resolver (`8.8.8.8`). Queries for `core-api.meridian.internal`
  return NXDOMAIN. Nobody notices until the first production cutover at midnight.
  Fix: cloud subnet DNS must point to the GCP metadata resolver (`169.254.169.254`)
  and a VPC outbound policy must forward private zones to on-prem.

- **Forgetting the reverse zone forward.** `ssh 10.10.5.30` hangs on
  hostname resolution. `tcpdump` output shows IPs, not names. The SIEM
  correlation rules that join on hostname break silently. Always test `dig -x`
  as well as forward resolution.

- **Using `.local` for internal zones.** `.local` is reserved for multicast
  DNS (mDNS, RFC 6762). On any host running Bonjour (macOS, most Linux
  desktops), queries to `.local` hit mDNS before the unicast resolver. Your
  DNS server never sees them. Use `.internal` (reserved by ICANN in 2024 for
  private use).

- **TTL too long during migration.** Setting TTL to 86400 (24 hours) on
  split-horizon records means a misbehaving resolution is cached for a day.
  During initial rollout keep TTL ≤ 300 seconds; raise it only after the
  design is proven.

- **Meridian Bank PCI scope:** if a DNS query to resolve a card-processing
  hostname crosses a network boundary that isn't logged and segmented, the
  auditor may treat the DNS traffic itself as widening the CDE. At Meridian,
  the DNS forwarding path between cloud and on-prem runs over the dedicated
  Cloud Interconnect VLAN (not the internet), and query logs are captured on
  both the on-prem resolver and the GCP Cloud DNS audit log. Document this
  for the PCI assessor.

- **Northwind M&A sprawl and DNS chaos.** After Northwind acquired Eastfield
  Foods, both used `corp.internal` as their private zone. The conditional
  forwarding rules on both sides conflicted. Resolution: rename one zone
  (`eastfield.internal`) and update conditional forwarders during a maintenance
  window. The lesson: zone namespace collisions from M&A are the DNS version
  of the IP-overlap problem (see N11).

## Going deeper (optional)

- RFC 1035 — the original DNS specification (records, wire format, resolution).
- RFC 8375 — reserves `home.arpa.` as the special-use domain for residential
  home networks (it does **not** cover `.internal`).
- `.internal` — reserved by ICANN on 29 July 2024 as a private-use TLD; there
  is no IETF RFC designating it (only an Internet-Draft exists).
- RFC 6762 — Multicast DNS (mDNS); explains why `.local` is off-limits.
- GCP Cloud DNS documentation: "Configuring DNS forwarding" and "DNS server
  policies" — explains inbound vs outbound policy, endpoint IP allocation.
  https://cloud.google.com/dns/docs/dns-overview
- AWS Route 53 Resolver documentation: "Resolving DNS queries between VPCs
  and your network."
  https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html
- Pairs with N17 (DNS resolution fundamentals) and N50 (hybrid DNS end-to-end
  architecture at scale). Cloud DNS constructs revisited in N45.

# Kata N45 — Cloud DNS: public vs private; hybrid resolution

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N17, N18, N39, N40 · **Time:** ~35 min
> **Tags:** `dns` `cloud-dns` `hybrid` `networking` `gcp` `aws` `l7-application` `fsi`

## Why it matters

Every cloud resource — a VM, a load balancer, a managed database — has an IP
address. Almost no application hard-codes IPs. Everything resolves through DNS, so
DNS becomes the first control plane of your cloud network: it determines which
IP a client reaches, which environment (prod/staging), whether resolution stays
on-net, and whether a name ever leaks to the internet. For Meridian Bank, where
core banking systems must never be reachable from the public internet, the
difference between a *public* and a *private* DNS zone is not a detail — it is a
security boundary. And when cloud workloads need to look up on-prem hostnames (or
vice versa), getting hybrid resolution wrong is the most common reason a brand-new
VPN or interconnect "doesn't work."

## The mental model

DNS recap (from N17): a client asks a *resolver* for a name → the resolver walks
the hierarchy (root → TLD → authoritative) → gets an answer → caches it for the
TTL. That walk happens whether you're on a laptop or inside a GCP VPC.

**The cloud DNS split:**

```
           ┌──────────────────────────────────────────────┐
           │              DNS Namespace                   │
           │                                              │
           │  PUBLIC zone                PRIVATE zone     │
           │  "meridian.example"         "internal.       │
           │  Answers to anyone           meridian.       │
           │  on the internet             example"        │
           │                             Answers only     │
           │                             to VPCs you      │
           │                             authorize        │
           └──────────────────────────────────────────────┘
```

**Public zone** — authoritative for names you want anyone to reach (your website,
API endpoints). Served from the cloud provider's global anycast DNS infrastructure.
External resolvers query it directly.

**Private zone** — authoritative for names that must never leave your network
(internal load balancers, managed DB endpoints, service mesh names). Served *only*
to VPCs you attach it to. The zone is invisible to the public internet; even if
someone knows the name, the public DNS hierarchy returns NXDOMAIN.

**The resolver that makes it work:**

In GCP, every VM reaches an implicit DNS resolver at the **link-local metadata
address `169.254.169.254`** (also reachable by the name `metadata.google.internal`).
This is a single, platform-wide address — *not* a per-subnet IP. There is no
`network + 2` resolver in GCP. Internally, GCP calls this the *Google-provided DNS
resolver*. It resolves: (a) private zones attached to the VPC, (b) the internal
`*.internal` names GCP generates per VM, and (c) public internet names via the
public DNS hierarchy.

AWS uses a *different* convention: every VPC has a resolver at `VPC-base + 2`
(e.g., if your VPC is `10.104.0.0/16`, the resolver is `10.104.0.2`). AWS calls
this the *VPC DNS resolver* or "Amazon-provided DNS." (AWS also exposes the same
service at the link-local `169.254.169.253`.) Route 53 Resolver adds inbound and
outbound endpoints on top for hybrid flows. The key thing to remember: **GCP =
link-local `169.254.169.254`; AWS = subnet `base + 2`.**

```
  On-prem resolver                Cloud VPC
  (10.10.0.5)                     (10.100.0.0/20 — Meridian GCP)
        │                                │
        │   "api.internal.meridian..."   │
        │──────────────────────────────▶ │  (inbound endpoint)
        │                                │
        │                         ┌──────▼─────────────────┐
        │                         │  VPC internal resolver  │
        │                         │  169.254.169.254 (GCP)  │
        │                         └──────┬─────────────────┘
        │                                │ private zone lookup
        │                                │ → 10.100.1.10
        │◀──────────────────────────────-│
```

**Hybrid resolution — two directions, two problems:**

1. **Cloud → on-prem:** A cloud workload needs to resolve `core.meridian.local`
   which lives on the on-prem DNS server at `10.10.0.5`. The cloud resolver
   doesn't know about `meridian.local` unless you tell it. You configure a
   *forwarding policy* (GCP) or an *outbound resolver rule* (AWS Route 53
   Resolver): "for `*.meridian.local`, forward to `10.10.0.5`." That forwarded
   query travels over the VPN or Interconnect.

2. **On-prem → cloud:** An on-prem application needs to reach
   `db.internal.meridian.example`, which is a GCP private zone entry for a Cloud
   SQL instance. The on-prem resolver can't query the GCP private resolver directly
   (it's VPC-internal). You need an *inbound resolver endpoint* — a real IP inside
   the VPC that accepts queries from on-prem and returns private zone answers. The
   on-prem DNS server is configured to forward `*.internal.meridian.example` to
   that endpoint IP.

This is the full hybrid picture. Both directions require: (a) the VPN/Interconnect
path to be up, (b) firewall rules allowing UDP/TCP 53 over that path, and (c) the
forwarding configuration in the DNS service. All three must be correct; one missing
piece and resolution silently falls through to NXDOMAIN or the wrong public answer.

## Worked example

Meridian Bank's GCP environment uses `10.100.0.0/14` (see `reference/running-example.md`).
The first VPC subnet for the digital banking platform is `10.100.0.0/20` (4,096
addresses). VMs in this subnet reach the GCP resolver at the link-local address
`169.254.169.254` (the same address regardless of subnet).

**Step 1 — Private zone for internal services**

Zone name: `internal.meridian.example`
Zone type: Private, attached to the `meridian-prod-vpc` VPC.

Resource records in the zone:
```
api-gw.internal.meridian.example.     A    10.100.1.10   ; internal L7 LB
db-primary.internal.meridian.example. A    10.100.2.5    ; Cloud SQL private IP
kafka.internal.meridian.example.      A    10.100.3.20   ; Kafka broker
```

A VM at `10.100.0.50` (in the same VPC) asks:
```
dig @169.254.169.254 api-gw.internal.meridian.example
```
Answer: `10.100.1.10` — served from the private zone, never visible outside.

The same query from an external resolver returns NXDOMAIN — the zone is not
published to the public DNS hierarchy.

**Step 2 — Public zone for customer-facing names**

Zone name: `meridian.example` (public)

```
www.meridian.example.   A   34.102.136.50    ; GCP Global HTTP LB anycast IP
api.meridian.example.   A   34.102.136.51
```

These are delegated from the domain registrar's NS records to the GCP Cloud DNS
name servers (e.g., `ns-cloud-a1.googledomains.com`). The bank's mobile app
resolves `api.meridian.example` from its phone → this hits the public zone and
returns the load balancer's public IP.

**Step 3 — Hybrid: on-prem to GCP private zone**

The core-banking team at HQ-DC1 (`10.10.0.0/16`) needs to call
`db-primary.internal.meridian.example` from a reporting job that runs on-prem.

Setup:
1. GCP: create an *inbound resolver endpoint* with a static IP in the
   `10.100.4.0/28` subnet (e.g., `10.100.4.5`). This IP is reachable from
   on-prem via Cloud Interconnect or VPN.
2. On-prem: configure the BIND/Windows DNS server to forward
   `internal.meridian.example` to `10.100.4.5`.
3. Firewall: allow UDP 53 and TCP 53 from `10.10.0.0/16` to `10.100.4.5`.

Query flow:
```
  Reporting job (10.10.5.20)
     │ dig db-primary.internal.meridian.example
     ▼
  HQ-DC1 resolver (10.10.0.5)
     │ sees *.internal.meridian.example → forward to 10.100.4.5
     ▼
  GCP inbound endpoint (10.100.4.5)
     │ passes to VPC resolver → private zone lookup
     ▼
  Answer: 10.100.2.5
     │
     ▼
  Reporting job connects to 10.100.2.5 (Cloud SQL private IP)
```

The traffic path for the *DNS query* follows the same Interconnect/VPN as the
*data* traffic. If the interconnect is down, DNS fails too — exposing a design
dependency worth surfacing in the architecture review.

**Step 4 — GCP to on-prem (outbound forwarding)**

A GCP microservice needs `core-api.meridian.local` — an on-prem hostname
authoritative on `10.10.0.5`.

In GCP Cloud DNS, create a *DNS peering* or *forwarding zone*:
- Zone type: Forwarding, for `meridian.local`
- Forward to: `10.10.0.5` (on-prem resolver, reachable via VPN)

Query flow:
```
  GCP microservice (10.100.0.60)
     │ dig core-api.meridian.local
     ▼
  VPC resolver (169.254.169.254)
     │ sees meridian.local → forwarding zone → send to 10.10.0.5
     ▼
  On-prem resolver (10.10.0.5)
     │ authoritative for meridian.local
     ▼
  Answer: 10.10.1.100
     │
     ▼
  Microservice connects to 10.10.1.100 over VPN
```

**TTL note:** on-prem hostnames often have long TTLs (3600s or more), set years
ago. If the on-prem IP changes during maintenance, cloud workloads may cache the
stale answer for an hour. Always confirm TTLs before a cutover.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Authoritative DNS (public zone) | BIND / AD DNS / Infoblox — you manage servers | **Cloud DNS** — managed, anycast, 100% SLA | **Route 53** — managed, anycast, 100% SLA | **Azure DNS** — managed, anycast |
| Private DNS zone (VPC-internal) | Internal BIND / AD DNS zones | **Cloud DNS private zone** — attached to one or more VPCs | **Route 53 Private Hosted Zone** — associated to VPCs | **Azure Private DNS Zone** — linked to VNets |
| VPC-internal resolver (auto) | Configured via DHCP | `169.254.169.254` (link-local metadata server / `metadata.google.internal`); called "Google-provided DNS" | `VPC-base + 2` (e.g. `10.104.0.2`); called "Amazon-provided DNS" | `168.63.129.16` — Azure-wide magic IP |
| Hybrid: on-prem → cloud private zone | N/A — can't query cloud resolver directly | **Inbound DNS policy** creates an endpoint IP in your VPC | **Route 53 Resolver inbound endpoint** — ENIs with real VPC IPs | **Azure DNS Private Resolver — inbound endpoint** |
| Hybrid: cloud → on-prem DNS | N/A | **Cloud DNS forwarding zone** — send domain queries to on-prem IP | **Route 53 Resolver outbound endpoint** + forwarding rule | **Azure DNS Private Resolver — outbound endpoint** |
| Split-horizon DNS (same name, different answers by network) | BIND views (internal vs external) | Separate public + private zones for the same domain name | Route 53 public + private hosted zone with same name | Public + private zones with same name (Azure: TODO) |
| DNS security (DNSSEC) | BIND DNSSEC signing | Supported on Cloud DNS public zones | Supported on Route 53 public zones | Supported on Azure DNS public zones |

**Key difference — GCP vs AWS private resolver:**

- **GCP:** the private zone is attached to the VPC; any VM in the VPC gets
  answers automatically. Shared VPC (see N52) allows a single private zone to
  serve multiple projects.
- **AWS:** the private hosted zone must be *associated* to each VPC that should
  resolve it. If you add a new VPC and forget the association, its workloads get
  NXDOMAIN — a common outage trigger.
- **Azure resolver IP** (`168.63.129.16`) is a platform-level anycast address,
  not a per-subnet IP. Azure Private DNS Zones are linked to VNets; the resolver
  is implied. The Private Resolver service is needed for hybrid flows (Azure: TODO
  for deep coverage).

## Do it (the exercise)

**[laptop] — Observe DNS from two namespaces**

1. Query a public zone and observe the authoritative response:
   ```bash
   dig google.com +trace
   ```
   Watch the resolver walk: root → `.com` → `google.com` NS → A record.
   Note which nameservers are authoritative (these are Google Cloud DNS servers).

2. Query a well-known public cloud zone delegation:
   ```bash
   dig NS aws.amazon.com
   dig NS googleapis.com
   ```
   These return the Route 53 / Cloud DNS nameservers that handle those zones.

3. Simulate split-horizon with `/etc/hosts` (your laptop only — safe sandbox):
   ```bash
   # Add a line to /etc/hosts (undo after the exercise):
   # 127.0.0.1  api.test.internal
   ping -c1 api.test.internal    # resolves locally, not via the internet
   ```
   This is conceptually what a private zone does: return a different answer
   depending on where the query originates.

4. Examine your current resolver chain:
   ```bash
   # Linux/macOS — see what resolver your OS uses:
   cat /etc/resolv.conf
   # macOS alternative:
   scutil --dns | head -30
   ```
   In a GCP VM you would see `nameserver 169.254.169.254` (the link-local
   metadata resolver); in an AWS VM you would see `nameserver <VPC-base+2>`.

5. Check TTL on a name you'd care about at cutover time:
   ```bash
   dig +noall +answer example.com A
   ```
   The number after the name is the remaining TTL in seconds. If you plan an IP
   change, lower the TTL 24 hours in advance (and restore after).

**[needs cloud account] — GCP Cloud DNS private zone**

1. Create a private zone (GCP Console → Network Services → Cloud DNS):
   - Zone name: `test-private`
   - DNS name: `internal.test.example`
   - Visibility: Private
   - VPC: your test VPC
2. Add an A record: `svc.internal.test.example → 10.0.0.99`
3. SSH into a GCE VM in that VPC and run:
   ```bash
   dig @169.254.169.254 svc.internal.test.example
   # Should return 10.0.0.99
   dig svc.internal.test.example   # same result via the VPC resolver
   ```
4. From your laptop (outside the VPC), try the same query to Google's public
   resolver — it should return NXDOMAIN:
   ```bash
   dig @8.8.8.8 svc.internal.test.example
   # Expected: NXDOMAIN — the private zone is invisible externally
   ```

## Say it back (self-check)

1. What is the difference between a public and a private DNS zone, and why does a
   private zone return NXDOMAIN to external resolvers?
2. What IP does the VPC resolver use in GCP versus AWS, and why are they
   different schemes? (GCP: the link-local metadata address `169.254.169.254`,
   the same everywhere; AWS: the subnet's `base + 2`, e.g. `10.104.0.2`.)
3. An on-prem server needs to resolve a GCP private zone name. What two things
   must you configure, and on which side?
4. A GCP microservice queries `core.meridian.local` — where does it go if no
   forwarding zone is configured? What happens?
5. What does it mean if a private zone is "attached" to a VPC in GCP but not
   in AWS? What operational difference does this create?

## Talk to the IT/security head

**Ask:**

- "Which DNS names are public and which are private — do you have a naming
  convention that makes the boundary obvious?"
  *A good answer:* a clear convention, e.g., `*.internal.company.com` always
  private, `*.company.com` always public; enforced at the zone level.
  *Red flag:* "they're all on the same zone" — no boundary, an auditor will note this.

- "How does an on-prem server resolve a cloud internal name, and is that path
  tested in your DR plan?"
  *A good answer:* names the inbound endpoint IP, the forwarding rule on the
  on-prem resolver, and confirms DNS resolution is part of the failover runbook.
  *Red flag:* "it just works through the VPN" with no detail — indicates the
  dependency on DNS-over-VPN is not documented or tested independently.

- "What happens to DNS when the interconnect goes down? Do workloads fail cleanly
  or do they try cached stale IPs?"
  *A good answer:* short TTLs on critical hybrid names, circuit breakers or health
  checks at the application layer, failover tested.
  *Red flag:* nobody has checked; the assumption is "the interconnect doesn't go
  down."

- "Are your Cloud DNS private zones scoped to least-privilege — which VPCs can
  resolve which zones?"
  *A good answer:* production VPCs are attached to production zones; dev/test VPCs
  cannot resolve production names. Separation is explicit.
  *Red flag:* all VPCs resolve all private zones — blast radius for a misconfigured
  dev workload extends to prod names.

- "Is DNSSEC enabled on your public zones, and are DS records delegated at the
  registrar?"
  *A good answer (FSI):* yes, with monitoring for signing key expiry. Banks that
  host payment APIs often require it.
  *Red flag:* "we haven't looked at that" — for a bank with PCI-scoped domains,
  DNSSEC is a reasonable expectation.

## Pitfalls & war stories

**"The VPN is up but nothing works"** — the three-hour outage that turns out to be
DNS. The new Cloud Interconnect passes IP traffic fine, but nobody configured the
forwarding zone. Cloud VMs can't resolve `core.meridian.local`, so they get
`NXDOMAIN`, and the application throws a connection error that looks exactly like
a network timeout. Lesson: test name resolution explicitly as a separate step
from testing IP reachability (`dig` before `curl`).

**Long TTLs at on-prem → cloud migration cutover.** The on-prem DNS entry for
`payments-api.meridian.local` has a 3600s TTL that nobody touched in five years.
The IP changes when the service moves to cloud. For an hour, half the bank's
internal clients connect to the old IP. Fix: lower the TTL to 60s at least 24
hours before cutover, then raise it back after.

**AWS VPC association amnesia.** A new VPC is stood up for a workload that needs
to call other services. The private hosted zone exists — but nobody associated it
to the new VPC. Everything resolves to NXDOMAIN. The engineer adds a public
record as a workaround, accidentally exposing an internal name. For Meridian Bank
this would be a PCI finding.

**Shared VPC + project-level DNS (GCP).** In a Shared VPC setup, DNS policy
must be set at the host project. If a service project tries to create its own
forwarding zone for the same domain, the behavior is undefined. The network team
and cloud platform team must agree on who owns DNS configuration — this is an
organizational boundary, not just a technical one (see N52).

**Data residency and DNS.** Meridian Bank's RBI data-residency requirement says
regulated customer data must not leave the country. A cloud DNS query for an
internal name resolves inside the VPC, but a public DNS query traverses the
provider's global anycast network. For private zones attached to regional VPCs, the
answer is served locally. Confirm this with your cloud account team for your
specific region and regulated workload.

**Split-brain ambiguity.** Using the same domain name (`internal.meridian.example`)
as both a public zone and a private zone is called *split-horizon DNS* (see N18).
Done intentionally, it's a valid pattern: on-prem or cloud VMs get the private
IP, internet clients get the public IP. Done accidentally (duplicate entries, wrong
zone type), it produces hard-to-debug resolution differences depending on where
the query originates. Document the intent explicitly.

## Going deeper (optional)

- RFC 1034 / RFC 1035 — the foundational DNS specifications.
- RFC 7766 — DNS transport over TCP (cloud DNS uses TCP for large responses and
  zone transfers).
- [GCP Cloud DNS overview](https://cloud.google.com/dns/docs/overview) — covers
  public/private zones, forwarding policies, inbound DNS policy.
- [AWS Route 53 Resolver](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html) — inbound/outbound endpoints and forwarding rules.
- [Azure DNS Private Resolver](https://learn.microsoft.com/en-us/azure/dns/dns-private-resolver-overview) — Azure's equivalent, added 2022.
- Pairs with N17 (DNS fundamentals), N18 (enterprise split-horizon), N39
  (VPC mental model), N44 (Private Service Connect / PrivateLink), N50
  (hybrid DNS end-to-end).
- For the compliance angle on DNS and data residency, see N29 and S32.

# Kata N46 — Cloud load balancing & global front doors

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N22, N39, N40, N41, N42, N43, N45 · **Time:** ~40 min
> **Tags:** `load-balancing` `cloud-lb` `cloud` `l4-transport` `l7-application` `networking` `high-availability` `fsi`

## Why it matters

Every cloud-hosted service Meridian Bank or Northwind exposes to the internet
passes through a load balancer — yet many architects cannot answer the question
the network or security team will immediately ask: "Is this L4 or L7? Does it
terminate TLS? Does traffic leave the cloud provider's backbone before it hits
your service?" Getting this wrong creates compliance gaps (TLS termination
outside a controlled boundary), availability gaps (single-region front door),
and cost surprises (unnecessary internet hairpins). The cloud load balancer is
also the enforcement point for WAF, DDoS protection, and SSL certificate
management. It deserves the same attention as a firewall rule.

## The mental model

### The problem that load balancing solves

A single server can fail, become overloaded, or need maintenance. To build
something reliable you run multiple identical instances and distribute traffic
across them. A load balancer sits in front, presenting *one* IP or hostname to
the client, while routing each connection or request to a backend that is
healthy.

```
 Client
   │
   │  "I want 10.100.1.1 (VIP)"
   ▼
 Load balancer (virtual IP / anycast IP)
   │                │                │
   ▼                ▼                ▼
Backend-A      Backend-B       Backend-C
10.100.2.10   10.100.2.11    10.100.2.12
```

The **virtual IP (VIP)** is what the client dials. The backends are real
servers. The load balancer continuously probes each backend with **health
checks** (TCP connect, HTTP GET, custom ping) and stops routing to any that
fail.

### L4 vs L7 — the axis that governs everything

This distinction matters more in cloud load balancing than anywhere else because
the two layers have completely different capabilities:

```
 L4 (Transport) load balancer
 ─────────────────────────────────────────────────────────
 Sees: source IP, dest IP, port, TCP/UDP connection state
 Can: distribute TCP/UDP connections; preserve client IP — natively in
      passthrough mode (e.g. GCP Passthrough NLB, AWS NLB); via PROXY protocol
      in proxy mode (which otherwise rewrites the source IP)
 Cannot: inspect HTTP headers, route by URL path, make per-request decisions
 Terminates TLS? No (unless explicitly configured as L4 TLS passthrough or proxy)
 Speed: very fast, low latency — no payload parsing

 L7 (Application) load balancer
 ─────────────────────────────────────────────────────────
 Sees: HTTP/HTTPS headers, URL paths, cookies, gRPC methods
 Can: route /api/* to one backend, /static/* to another; sticky sessions by
      cookie; header-based routing; WebSocket upgrades
 Terminates TLS? Yes — it decrypts, inspects, then optionally re-encrypts
 Can attach: WAF, DDoS protection, Cloud CDN, authentication (IAP)
 Speed: slightly higher latency than L4 due to HTTP parsing
```

The moment you want URL-path routing, WAF, CDN, or per-request auth decisions,
you need L7.

### Global anycast vs regional

On-prem load balancers have a fixed IP in a fixed data center. Cloud providers
offer **global load balancers** that use **anycast**: the same IP address is
announced from every point of presence (PoP) around the world, and the client
automatically connects to the nearest one. The traffic then travels on the
provider's private backbone (low latency, no public internet) to the backends.

```
 Client in Mumbai            Client in London
         │                         │
         │  both dial 34.120.x.x   │
         ▼                         ▼
  GCP PoP Mumbai           GCP PoP London
         │                         │
         └─────── GCP backbone ────┘
                       │
            Regional backends
           (asia-south1, europe-west2)
```

This is called a **global front door**. Traffic arrives near the user and
stays on the provider backbone all the way to the backend — no MPLS or
internet hairpin. The on-prem equivalent is an F5 or NGINX cluster, but it
is inherently regional; getting a similar global effect on-prem requires
a paid CDN or Anycast peering arrangement that most enterprises never build.

### Health checks — the mechanism that makes it work

The load balancer periodically sends probes to each backend (default often
every 5–10 seconds). If a backend fails N consecutive checks it is removed
from the pool; once it passes M consecutive checks it is re-added. Without
correct health check configuration, a load balancer is just a traffic
distributor that also forwards connections to broken backends.

## Worked example

Meridian Bank runs two services in GCP (`10.100.0.0/14` supernet, see
`reference/running-example.md`):

1. **Mobile banking API** — HTTPS, path-based routing needed (`/auth`, `/accounts`,
   `/payments` go to separate microservices). Must attach WAF (PCI-DSS).
2. **Internal admin portal** — accessed over the bank's Interconnect from HQ-DC1
   (`10.10.0.0/16`), not exposed to the internet.

### Service 1 — Global HTTPS (L7) load balancer

```
Internet clients
      │ HTTPS (443)
      ▼
 GCP Global external Application Load Balancer
   ├── anycast IP: e.g. 34.120.10.5  (single IP worldwide)
   ├── TLS terminated here  (cert managed by Certificate Manager)
   ├── Cloud Armor (WAF + DDoS) attached
   ├── URL map:
   │    /auth/*        → backend-service: auth-mig    (MIG us-central1)
   │    /accounts/*    → backend-service: accounts-mig
   │    /payments/*    → backend-service: payments-mig
   │    default        → backend-service: frontend-mig
   └── health check: HTTPS GET /healthz → HTTP 200
```

Traffic from a Mumbai client travels on GCP's backbone to the nearest PoP,
then to the us-central1 region where backends live. TLS terminates at the
load balancer — the cert is a GCP-managed certificate; the backend connection
can be HTTP (internal, inside the VPC) or re-encrypted HTTPS (required for
PCI-DSS path from LB to backend; use a backend HTTPS health check to match).

**Worked path for a PCI-compliant deployment:**

```
Client → [TLS] → Global LB (terminates TLS, Cloud Armor scans)
       → [TLS] → Backend VM in private subnet 10.100.1.0/24
                 (LB re-encrypts to backend; backend cert is self-signed or
                  from an internal CA — acceptable in GCP because traffic
                  never leaves the GCP fabric)
```

### Service 2 — Internal L7 load balancer (admin portal)

```
HQ-DC1 (10.10.0.0/16)  ──Interconnect──  GCP VPC 10.100.0.0/14
                                              │
                                    Internal Application LB
                                    IP: 10.100.4.1  (a private IP)
                                    (accessible only within VPC / Interconnect)
                                              │
                                    backend: admin-mig  10.100.4.128/25
```

No internet exposure. No anycast. The load balancer IP (`10.100.4.1`) is
routable from the on-prem side only because the Interconnect advertises
`10.100.0.0/14` back to HQ-DC1 — an architecture decision from N41/N43.

### Load balancing algorithms

| Algorithm | How it works | Best for |
|-----------|--------------|----------|
| Round-robin | Rotate through backends in order | stateless services, even load |
| Least-connections | Send to backend with fewest active connections | variable request duration |
| IP-hash / session affinity | Same client IP always hits same backend | stateful apps without external session store |
| Weighted round-robin | Heavier backends get proportionally more traffic | mixed instance sizes |

Cloud L7 LBs typically default to round-robin per-request within a backend
service, with optional cookie-based session affinity when stickiness is
required.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Global L7 HTTPS LB (anycast, WAF-capable) | F5 BIG-IP / NGINX (regional only; CDN needed for global) | **Global external Application Load Balancer** | **CloudFront + ALB** (CloudFront does global edge; ALB is regional L7) | (Azure: TODO) |
| Regional L7 HTTPS LB | F5 / NGINX in one DC | **Regional external Application Load Balancer** | **Application Load Balancer (ALB)** | **Azure Application Gateway** |
| L4 TCP/UDP LB (regional) | Cisco ACE / F5 LTM | **Regional external/internal Passthrough Network LB** | **Network Load Balancer (NLB)** | **Azure Load Balancer** |
| Internal L7 LB (private only) | Internal F5 / HAProxy | **Internal Application Load Balancer** | **Internal ALB** | **Internal Application Gateway** |
| Internal L4 LB (private only) | Internal VIP / keepalived | **Internal Passthrough Network LB** | **Internal NLB** | **Internal Azure Load Balancer** |
| WAF attach point | Inline appliance before LB | **Cloud Armor** (attached to global/regional LB) | **AWS WAF** (attached to ALB / CloudFront) | (Azure: TODO) |
| DDoS protection | Carrier-scrubbing / on-prem appliance | **Cloud Armor** (volumetric DDoS + adaptive protection) | **AWS Shield Standard/Advanced** | (Azure: TODO) |
| Managed TLS cert | Manual cert on F5 | **Certificate Manager** (auto-provisioned, auto-renewed) | **ACM (AWS Certificate Manager)** | (Azure: TODO) |
| Health check | Router-level or LB-native probe | Per-backend-service health check (HTTP/HTTPS/TCP) | Per-target-group health check | (Azure: TODO) |
| Session affinity (sticky) | Cookie insert on F5 | Cookie-based affinity on L7 LB | Sticky sessions on ALB / NLB | (Azure: TODO) |

**Key GCP-specific distinctions architects trip on:**

- GCP calls its external L7 product "Application Load Balancer" (formerly
  "HTTP(S) Load Balancing") — not to be confused with AWS ALB.
- GCP's "Passthrough Network LB" is L4 and *does not* terminate connections;
  packets are delivered directly to the backend with the original client IP
  preserved. GCP's "Proxy Network LB" (also L4, but proxies connections) is a
  different product.
- AWS splits global edge (CloudFront) from regional L7 (ALB); GCP unifies them
  in the Global Application LB (traffic enters at a PoP, stays on backbone).
- On AWS, **NLB** can preserve client IP (flow hash); **ALB** replaces the
  client IP unless you read the `X-Forwarded-For` header.

## Do it (the exercise)

### Part A — L4 vs L7 identification [laptop]

1. Imagine a load balancer that only gets `SYN` packets (no HTTP payload). What
   can it route on? Write down the fields available in the TCP/IP header.
2. Now imagine you also have the HTTP `Host:` header and the `GET /accounts/...`
   request line. What new routing decisions become possible? List three.
3. Explain in one sentence why you cannot attach a WAF to an L4 load balancer.

### Part B — Cloud LB decision tree [laptop / pen-and-paper]

For each scenario, decide: global or regional? L4 or L7? External or internal?

| Scenario | Your answer |
|----------|-------------|
| Meridian Bank mobile app, global users, HTTPS, PCI-WAF required | ? |
| Internal microservice: payments-svc calls auth-svc inside the same VPC | ? |
| UDP-based trading feed to branch offices over Interconnect | ? |
| Admin portal accessible only from HQ-DC1 over Interconnect | ? |

### Part C — Trace a request [laptop]

Run the following against GCP's public load balancer demo endpoint (or any
HTTPS site you own) and observe where TLS terminates and how headers change:

```bash
# [laptop] — Observe TLS cert issuer and SNI negotiation
curl -sv https://example.com/ 2>&1 | grep -E "subject:|issuer:|> Host:|< x-forwarded"
```

On a real GCP LB, the cert issuer would be Google Trust Services (for
GCP-managed certs) or your own CA. The `X-Forwarded-For` header carries the
original client IP added by the LB.

### Part D — Health check math [pen-and-paper]

A GCP backend health check probes every 5 seconds. A backend must fail 3
consecutive checks before being removed and pass 2 consecutive checks before
being restored.

1. What is the maximum time (seconds) before a newly-failed backend stops
   receiving traffic? (Answer: ~20 seconds. The 3 consecutive failing probes
   at 5s spacing give 3 × 5 = 15s of *probe-detection* time, but the worst case
   also includes up to one full interval (~5s) of delay between the moment the
   backend actually goes unhealthy and the next probe firing → 15 + 5 ≈ 20s.)
2. If a backend restarts and passes its first check at T=0, when does it
   re-enter the pool? (Answer: after 2 consecutive passes → at T=5 seconds.)
3. Why is this window important for Meridian Bank's PCI compliance? (Hint:
   a backend serving card transactions should be removed quickly when unhealthy;
   but re-admission should be conservative to avoid flapping.)

### Part E [needs cloud account]

In GCP, create a minimal global HTTPS load balancer:
```bash
# Create a managed instance group (2 VMs), a backend service, URL map,
# target HTTPS proxy, and forwarding rule.
# GCP official quickstart:
# https://cloud.google.com/load-balancing/docs/https/setting-up-https
```
Observe that a single anycast IP is provisioned. Run
`curl -H "Host: your-domain" https://<LB-IP>/` and watch the health check
logs in the Cloud Console.

## Say it back (self-check)

1. What is the difference between an L4 and an L7 load balancer? Give one
   thing each can do that the other cannot.
2. What does "anycast" mean for a global load balancer, and why does it reduce
   latency compared to a single-region VIP?
3. Where does TLS terminate on a GCP Global Application Load Balancer, and
   what is the security implication if you do *not* re-encrypt the backend
   connection?
4. Why is health check configuration more than just "is the server up?" —
   what operational risks does misconfiguration create?
5. For a PCI-DSS workload at Meridian Bank, which GCP load balancer type
   would you choose, and what two security services would you attach to it?

## Talk to the IT/security head

**Ask:**

- "Is this load balancer L4 or L7, and where does TLS terminate?"
  *A good answer:* names the exact product and whether TLS ends at the LB or
  passes through. If they say "it just terminates somewhere," the cert boundary
  is uncontrolled — a PCI finding.

- "If one backend fails, how quickly is it removed from the pool, and how is
  that threshold set?"
  *A good answer:* gives the probe interval and failure threshold. Red flag:
  "the default" without knowing what the default is — a silent failure can
  serve errors for 30 seconds or more before the unhealthy backend is evicted.

- "Is the load balancer IP globally anycast or a regional VIP? Who chose that
  and why?"
  *A good answer:* a deliberate choice with a latency or availability
  justification. Red flag: "it's just what the wizard picked" — the person
  doesn't own the front-door decision.

- "Does traffic from the load balancer to the backends travel on the cloud
  provider's private backbone or exit to the internet?"
  *A good answer:* on GCP, global LB → backend traffic stays on Google's
  backbone (never exits). On AWS, CloudFront → ALB traffic is also internal.
  Red flag: "I think it stays internal" — should be verified with VPC flow
  logs (see N54).

- "Is a WAF attached, and which rules are active?"
  *A good answer:* names the WAF product (Cloud Armor / AWS WAF), confirms
  rule sets (OWASP CRS, custom PCI rules), and has a process for reviewing
  false positives. Red flag: WAF is in "detect" (log-only) mode in production
  with no plan to move to "block."

**Red flags to listen for:**

- "We just used the platform default load balancer" — no deliberate L4/L7
  choice; likely no WAF.
- TLS terminates at the LB but backend traffic is plain HTTP across private
  subnets — acceptable on-prem in a locked-down DC, but must be justified
  in a PCI audit; GCP considers the VPC fabric private but the auditor may not.
- No distinction between external and internal load balancers — internet-facing
  and internal-only services sharing a config model is a segmentation risk.
- Health checks are TCP-only on an HTTP service — the server could be accepting
  TCP connections but returning 500 for every HTTP request; the check passes,
  errors go undetected.

## Pitfalls & war stories

**TLS all the way through, or not?**
The most common PCI-DSS query on load balancers: TLS terminates at the LB
(fine), but the LB-to-backend hop is plain HTTP ("it's inside the VPC, it's
safe"). An auditor will ask for evidence that no cardholder data traverses
unencrypted paths. The safer default for Meridian Bank: terminate TLS at the
LB and re-encrypt to backends using a backend HTTPS health check and a
self-signed cert on the instance. GCP supports this on both the Global and
Regional Application LB.

**Using an L4 LB when you need L7.**
A bank team deployed an NLB-equivalent (L4) in front of their API gateway
because "it's faster." Result: they couldn't attach the WAF, couldn't route
by path, and had to expose one IP per microservice. The root cause was not
knowing the distinction before choosing.

**Missing X-Forwarded-For in logs.**
On AWS ALB, the real client IP is in `X-Forwarded-For`, not the source IP
in the TCP connection (which is the ALB node's IP). Application logs that
record only `request.remoteAddr` will show ALB IPs, not client IPs — making
fraud analysis impossible. On GCP, the equivalent header is also
`X-Forwarded-For`; GCP Passthrough NLB preserves the real client IP in the
TCP source without a header.

**Session affinity (stickiness) hiding scaling problems.**
Enabling cookie-based stickiness because "the app needs it" can mask a missing
shared session store. At Northwind's e-commerce platform, aggressive stickiness
meant 80% of traffic went to two of eight backends (hot spots) while six were
idle. The right fix: move session state to a shared Redis cluster and remove
stickiness. Stickiness is a workaround, not a feature.

**Anycast IP ≠ regional failover.**
A GCP Global LB sends users to the nearest PoP, but backends are in specific
regions. If your only backend region goes down, the anycast IP still works but
returns errors. Multi-region backends (with appropriate latency-based routing
in the URL map) are required for true global failover — that is Module N9
territory (see N48, N49).

## Going deeper (optional)

- GCP Load Balancing overview: <https://cloud.google.com/load-balancing/docs/load-balancing-overview>
  (the product chooser table is worth bookmarking).
- AWS: Understanding Elastic Load Balancing: <https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html>
- RFC 7239 — Forwarded HTTP Extension (the standardized `Forwarded` header that
  supersedes the non-standard, de-facto `X-Forwarded-For`; `X-Forwarded-For`
  itself has no RFC).
- Cloud Armor overview (GCP WAF + DDoS): <https://cloud.google.com/armor/docs/cloud-armor-overview>
- Pairs with N22 (on-prem load balancing concepts), N25 (WAF and CDN), N42
  (cloud firewalls), N47 (Cloud CDN).
- For the Meridian Bank full hybrid picture, revisit N41 (route tables/egress)
  and N43 (VPC peering topology) to see how the LB VIP fits into the larger
  routing design.

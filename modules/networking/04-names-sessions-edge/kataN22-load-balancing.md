# Kata N22 — Load balancing: L4 vs L7, algorithms, health checks

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N03, N20, N21 · **Time:** ~35 min
> **Tags:** `networking` `load-balancing` `l4-transport` `l7-application` `high-availability` `cloud-lb` `fsi` `meridian-bank`

## Why it matters

No single server is reliably fast, always available, and infinitely scalable.
Load balancing — spreading traffic across a pool of servers — is how every
production system at a bank or FMCG achieves the uptime that customers and
regulators expect. When an IT head says "we have an L7 load balancer in front
of the payment gateway," that single sentence tells you where TLS terminates,
what can be inspected, how health is monitored, and who takes the hit if it
fails. Getting this wrong in a design exposes you: you may route by URL on an
L4 LB (impossible), terminate TLS in the wrong place, or miss that the "sticky
session" assumption breaks your horizontal scaling story.

## The mental model

### The core problem

```
  Client  ──────────────►  Single server  ←── fails → everyone is down
                                         ←── too slow → everyone waits
                                         ←── no capacity → everyone queues
```

The fix: put a **load balancer** (LB) in front of a **pool** (backend group)
of servers that all serve the same content or API:

```
                        ┌─────────────┐
                        │ Load        │──► Server A  10.10.1.11:8080
  Client ──────────────►│ Balancer    │──► Server B  10.10.1.12:8080
         one IP / VIP   │ 10.10.1.10  │──► Server C  10.10.1.13:8080
                        └─────────────┘
                           health-checks
                           each backend
```

The LB presents one **Virtual IP (VIP)** to the world and distributes
connections/requests across the pool. It continuously health-checks each
backend and removes dead members automatically.

### L4 vs L7 — the most important split

The key question is: *how much of the packet does the LB need to read?*

```
 OSI layer  What the LB reads          What it can do
 ─────────────────────────────────────────────────────────────────────
 L4          IP address + TCP/UDP port  Route by dest port; TCP proxy;
             (no payload)               terminate/pass-through TLS;
                                        fast, low CPU, no HTTP awareness
 ─────────────────────────────────────────────────────────────────────
 L7          Full HTTP(S) headers,      Route by URL path, hostname,
             URL, cookies, body         cookie; A/B split; auth offload;
             (payload fully parsed)     inspect / rewrite / redirect;
                                        requires TLS termination to read HTTPS
```

**Critical rule:** an L4 LB never sees the HTTP request. It cannot route
`/api` to one pool and `/web` to another — that requires L7 (see N24 for the
reverse-proxy extension of this idea). Conversely, an L7 LB must terminate
TLS to inspect plaintext — which changes where certificates live and who can
see decrypted traffic (a CISO-level decision).

### TLS termination position

```
  Option A — terminate at LB (most common)
  ─────────────────────────────────────────
  Client ──[TLS]──► LB ──[plain or re-encrypted]──► Backends
                    │
                    certificates live here; LB sees plaintext;
                    backends get plain HTTP (or new TLS "re-encryption")

  Option B — TLS pass-through (L4 LB only)
  ─────────────────────────────────────────
  Client ──[TLS]──► LB (sees only TCP) ──[TLS]──► Backends
                    no certificate on LB; L7 routing impossible;
                    each backend holds its own cert
```

For a PCI-scoped payment API, the CISO will care deeply about Option A vs B:
terminating on the LB means the LB is in scope for the cardholder data
environment (CDE). Re-encrypting backend traffic (`re-encryption` mode) is
the compromise that keeps the CDE tight without sending plaintext inside.

### Algorithms — how traffic is assigned

| Algorithm | How it works | Good for |
|-----------|-------------|----------|
| **Round-robin** | Cycle through pool in order | Uniform, stateless requests |
| **Least connections** | Send to backend with fewest active connections | Varying request cost (slow + fast jobs) |
| **IP hash** | Hash client IP → always same backend | Simple stickiness without a session table |
| **Weighted round-robin** | Round-robin weighted by server capacity | Mixed-size backends |
| **Least response time** | Pick fastest-responding backend | Latency-sensitive apps |
| **Random** | Stateless random pick | Very large pools |

### Sticky sessions (session affinity)

Some applications store user state **on the backend server** (shopping cart,
file upload in progress). If the LB sends the second request to a different
server, the state is lost.

**Sticky session** (or *session affinity*) fixes this by binding a user's
requests to the same backend — usually via a cookie the LB inserts, or by IP
hash:

```
  First request →  LB assigns Server B; inserts cookie "SERVERID=B"
  Second request → LB reads cookie → routes to Server B
```

**The architect's warning:** sticky sessions are a scaling and HA liability.
If Server B fails, all its sticky sessions are lost anyway. And a "hotspot"
user pattern will overload one server while others are idle. Best practice:
push session state to a shared store (Redis or Memcached — on GCP that is
**Memorystore**) so any backend can serve any request — then stickiness is
unnecessary. Avoid a heavyweight relational/distributed SQL database (e.g.
Cloud Spanner) as a session cache: it costs far more per read and adds latency
a session lookup does not need.

### Health checks

An LB marks a backend **healthy** or **unhealthy** by actively probing it:

```
  LB ──► GET /healthz  HTTP 200  ──► healthy, send traffic
  LB ──► GET /healthz  TCP timeout──► unhealthy, remove from pool
```

Parameters you must know:
- **Check interval** — how often to probe (e.g. every 5 s).
- **Healthy threshold** — consecutive successes to mark healthy (e.g. 2).
- **Unhealthy threshold** — consecutive failures to mark unhealthy (e.g. 3).
- **Probe type** — HTTP GET, TCP connect, or HTTPS; L7 probes catch
  app-level failures that a TCP probe misses (process listening but app crashed).

With the settings above, a backend that dies is removed after ~15 s
(3 × 5 s). Design around that window for SLA commitments.

## Worked example

Meridian Bank's mobile-banking API runs on GCP. Three instances serve the
`/api/v1` path; a legacy service on `10.10.1.20:8080` (HQ-DC1, see
`reference/running-example.md`) handles `/api/v0` for backward compatibility.

```
  Internet
     │  HTTPS :443
     ▼
  GCP External L7 LB  (Global VIP — Anycast 34.x.x.x)
     │  TLS terminated here; cert: *.meridian.example
     │
     ├── URL /api/v1/* ──► Backend service: GCP MIG (3 VMs in asia-south1)
     │                      10.100.0.11, 10.100.0.12, 10.100.0.13
     │                      health check: GET /healthz → HTTP 200
     │                      algorithm: least connections
     │
     └── URL /api/v0/* ──► NEG (Network Endpoint Group) pointing to
                           HQ-DC1  10.10.1.20:8080  via Cloud Interconnect
                           health check: TCP :8080
```

What this gives Meridian:
- **One certificate** on the LB; backends get plain HTTP over a private path.
- **Path-based routing** — impossible on an L4 LB; requires L7.
- **Auto-failover:** if `10.100.0.12` fails its healthcheck, traffic shifts
  to the other two within ~15 s (3 checks × 5 s interval).
- **On-prem backend** via a Hybrid NEG — GCP's LB can include non-GCP
  endpoints, which is how Meridian phases migration without a flag-day
  cutover.

Health-check math for PCI sign-off: "We fail over within 15 seconds of a
backend dying." That goes in the RTO / availability design document.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| L4 TCP/UDP LB | F5 BIG-IP (LTM) in TCP mode; HAProxy (tcp mode); Nginx stream | **Regional External Passthrough NLB** (formerly Network LB); also **Internal Passthrough NLB** | **Network Load Balancer (NLB)** — L4, ultra-low latency, static IP per AZ | **Azure Load Balancer** (Standard tier) |
| L7 HTTP(S) LB | F5 BIG-IP (HTTP profile); HAProxy (http mode); Nginx; Envoy | **Global External Application LB** (HTTP(S) LB); **Regional External Application LB**; also **Internal Application LB** | **Application Load Balancer (ALB)** — L7, path/host routing, WAF integration | **Azure Application Gateway** |
| Health check | LB probes `/healthz` | Health check resource (HTTP, HTTPS, TCP, SSL, gRPC) | Target group health checks (HTTP, HTTPS, TCP, gRPC) | (Azure: TODO) |
| Sticky sessions | Persistence profile; insert-cookie | `SERVERID` cookie affinity or client-IP affinity | `AWSALB` cookie (ALB); IP stickiness (NLB) | (Azure: TODO) |
| Path-based routing | VirtualServer / location blocks | URL maps (host/path rules) → backend services | Listener rules (path conditions) on ALB | (Azure: TODO) |
| TLS termination | SSL profile on F5/Nginx | HTTPS frontend; managed SSL certs via Google-managed or user-managed | ACM cert on ALB/NLB listener | (Azure: TODO) |
| Backend pool | Server pool / pool member | **Backend service** + **Instance Group** (MIG/UIG) or **NEG** | **Target Group** | (Azure: TODO) |
| On-prem backend | Native — pool member is any IP | **Hybrid NEG** (internet-facing or interconnect) | **IP + port target in Target Group** (on-prem via DX/VPN) | (Azure: TODO) |
| Global Anycast / front door | Requires CDN or GeoDNS add-on | **Global External Application LB** is Anycast by default | **Global Accelerator** (separate product) + ALB/NLB per region | (Azure: TODO) |

**GCP naming note (around 2022–2023 rebrand):** GCP renamed its LB products
over roughly 2022–2023; the SKU/naming transition spanned that window rather
than a single clean event. The old "Network Load Balancer" is now "Passthrough
NLB." The old "HTTP(S)
Load Balancer" is now "Application LB." IT heads may still use the old names —
confirm which product is actually deployed.

## Do it (the exercise)

### Part 1 — L4 vs L7 recognition [laptop]

Start a local demo with `python3` and `nginx` (no cloud needed):

```bash
# Terminal 1 — fake backend A on port 8081
python3 -m http.server 8081

# Terminal 2 — fake backend B on port 8082
python3 -m http.server 8082
```

Now use `nginx` as an L7 LB:

```nginx
# /tmp/nginx-lb.conf  (nginx must be installed)
events {}
http {
  upstream api_pool {
    least_conn;
    server 127.0.0.1:8081;
    server 127.0.0.1:8082;
  }
  server {
    listen 9090;
    location /api/ { proxy_pass http://api_pool; }
    location /      { return 404 "no route\n"; }
  }
}
```

```bash
nginx -c /tmp/nginx-lb.conf
curl -s http://localhost:9090/api/
curl -s http://localhost:9090/        # expect 404 — path not matched
```

Observe: path `/api/` routes; `/` does not. This is URL-map routing — only
possible at L7. An L4 LB (try `nginx stream {}` block) cannot do this.

### Part 2 — health check simulation [laptop]

```bash
# Kill backend A
pkill -f "http.server 8081"

# Watch: subsequent requests should only hit 8082
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9090/api/; done
```

The Nginx upstream marks a backend down after 1 failure by default (`max_fails
= 1`). In production you tune `max_fails` and `fail_timeout` to avoid
flapping.

### Part 3 — inspect a real cloud LB [needs cloud account]

On GCP, after creating an HTTP(S) Load Balancer:

```bash
# List backend services and their health
gcloud compute backend-services list --global
gcloud compute backend-services get-health <BACKEND_SERVICE_NAME> --global
```

On AWS, after creating an ALB:

```bash
# Describe target health for a target group
aws elbv2 describe-target-health --target-group-arn <ARN>
```

Observe: each target shows `healthy`, `unhealthy`, or `initial`. Map the
state to the health-check thresholds you configured.

## Say it back (self-check)

1. What is the one thing an L4 load balancer fundamentally **cannot** do that
   an L7 can — and why?
2. For HTTPS traffic, what must an L7 LB do before it can inspect a URL path?
   What are the security implications?
3. A bank's IT head asks you to explain why the payment API sometimes routes
   badly after a server restarts. You suspect sticky sessions + a weighted
   algorithm. Explain the likely cause in plain language.
4. What three parameters define how quickly an LB removes a failed backend?
   If check interval = 10 s and unhealthy threshold = 3, how long before a
   dead server stops receiving traffic?
5. Name two reasons why over-relying on sticky sessions creates both a
   performance and an availability problem.

## Talk to the IT/security head

**Ask:**

- "Is this load balancer L4 or L7, and does it terminate TLS?" — the answer
  determines where your certificates live, what can be logged/inspected, and
  whether URL-based routing is possible at all.
- "What health check does the LB use — TCP connect or HTTP probe? And what's
  the unhealthy threshold?" — a TCP check misses app-layer failures (the
  process is up but the app is deadlocked); too-loose thresholds mean a dead
  backend gets traffic for minutes.
- "Are sticky sessions in use? Where is session state stored?" — if the
  answer is "on the server," you have a latent HA problem that a failover test
  will expose.
- "Where does TLS re-encryption end — at the LB, or all the way to the
  backend? What's between the LB and the backend server?" — in a PCI/CDE
  environment, plaintext between LB and backend is a finding if that segment
  is not suitably controlled.
- "Which cloud LB SKU is this — global or regional? Does it have Anycast
  failover across regions, or is it a single-region construct?" — a regional
  ALB failing silently is not the same as a global LB.

**A good answer sounds like:**
"We use an Application LB (L7), HTTPS terminated at the LB with a
Google-managed cert; backends get plain HTTP over the private VPC path.
Health checks are HTTP GET /healthz every 10 s, threshold 2. No sticky
sessions — session tokens go into Memorystore (Redis)."

**Red flags to listen for:**
- "We have a load balancer" with no follow-up about L4/L7 — they may not know.
- Sticky sessions with no shared session store — a failover event will drop
  live users.
- TLS terminates at the LB but nobody knows what happens between LB and
  backend — likely plaintext on an uncontrolled segment.
- "We don't do health checks, we rely on the cloud's built-in monitoring" —
  monitoring ≠ automatic traffic removal; they are different systems.
- An L4 LB where URL-path routing or WAF is "coming soon" — those features
  require a different LB tier.

## Pitfalls & war stories

- **Assuming L4 can route by URL.** Teams frequently configure a Network LB
  (AWS NLB, GCP Passthrough NLB) to front a multi-path API and then wonder
  why path-based routing rules have no effect. The LB never reads the HTTP
  header — it distributes TCP connections by IP/port only.

- **PCI audit surprise on TLS termination.** A bank terminated TLS at the L7
  LB but ran plain HTTP to backends over a shared network segment inside the
  data center. The backend segment was not formally in-scope — until the QSA
  auditor pointed out that plaintext cardholder data on that segment makes it
  CDE. Re-encryption (LB to backend also TLS) fixed it, but cost a change
  window and extra certificate management.

- **Sticky sessions hiding a broken session store.** Meridian's legacy
  internet banking app was deployed with IP-hash stickiness as a "temporary"
  fix five years ago. The temporary fix never left. When a datacenter failover
  moved clients to different IPs during a DR test, all sessions were lost and
  online banking went dark for 20 minutes — a RBI-reportable incident.

- **Health check port ≠ traffic port.** The health check was configured on
  TCP :443 (always passes as long as TLS listener is up), but the app itself
  listened on :8080. When the Java process died, port 443 was still
  "healthy" (handled by a separate nginx), and traffic poured into a crashed
  backend for 3 minutes. Always probe the actual application endpoint at the
  actual application port.

- **Cloud LB global vs regional confusion.** On GCP, a **Global External
  Application LB** is Anycast across all Google edge PoPs; a **Regional
  External Application LB** is a single-region construct. They look similar in
  the console. A design assuming global failover that actually deployed a
  regional LB has no cross-region redundancy — it fails entirely if the
  region is unavailable.

## Going deeper (optional)

- RFC 7230–7235 — HTTP/1.1 spec: the payload an L7 LB parses.
- RFC 9110 — HTTP semantics (the current combined HTTP spec).
- [GCP Load Balancing overview](https://cloud.google.com/load-balancing/docs/load-balancing-overview) — the product family and decision tree.
- [AWS Elastic Load Balancing comparison](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html) — ALB vs NLB vs CLB.
- HAProxy documentation on ACLs and backends — the on-prem mental model that
  maps cleanly to every cloud LB's URL map / listener rule.
- Pairs with N24 (reverse proxy vs LB vs API gateway — the conceptual
  boundary) and N25 (WAF integration with L7 front doors).
- Revisit after N46 (cloud load balancing deep dive across GCP / AWS / Azure).

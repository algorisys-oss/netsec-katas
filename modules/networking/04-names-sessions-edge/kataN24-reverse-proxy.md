# Kata N24 — Reverse proxy: vs load balancer, vs API gateway

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N20, N21, N22, N23 · **Time:** ~35 min
> **Tags:** `reverse-proxy` `load-balancing` `api-gateway` `l7-application` `networking` `tls` `cloud` `fsi`

## Why it matters

Every modern web service sits behind at least one device that speaks on the
server's behalf — but that device might be called a reverse proxy, a load
balancer, or an API gateway, and the names are used interchangeably in
conversations where they mean very different things. The distinction matters
because each device terminates TLS at a different point, enforces different
controls, and creates a different blast radius when it fails. An architect who
can't draw the line between these three will mis-scope security reviews, design
fragile edges, and lose the IT head in the first diagram.

## The mental model

**Start from first principles: why terminate a connection early?**

A client connects to a server. Without any intermediary, the client's TCP
connection goes all the way to the server process. That works fine for one
server. It breaks for three reasons at scale:

1. **Many servers, one name** — you want `api.meridian.example` to resolve to a
   stable IP even when you have ten backend instances.
2. **TLS must terminate somewhere** — and you want that to be a dedicated,
   hardened device, not every backend app.
3. **Policy** — authentication, rate limiting, routing by URL path — you want
   this enforced centrally, not duplicated in every backend.

The solution in all three cases is a device that sits in front of the servers
and intercepts connections. That device is, at its core, a **reverse proxy**.

```
  CLIENT                 REVERSE PROXY               BACKEND SERVERS
  ──────                 ─────────────               ───────────────
  Browser ──[TLS/443]──► :443 terminate ──[HTTP/80 or mTLS]──► app-1
                          parse request               ──────────────► app-2
                          route/policy                ──────────────► app-3
```

The client never sees the backends. The reverse proxy opens a *new* connection
to whichever backend it selects. This is different from a **forward proxy**
(see N23), which sits in front of *clients* and controls their *outbound*
traffic.

---

### The three terms and what distinguishes them

**Reverse proxy** — the base mechanism. Any device that:
- terminates the client's TCP/TLS connection
- makes a new connection to a backend
- forwards the request (possibly modified)

All of the following build on this foundation.

**Load balancer** — a reverse proxy with a distribution algorithm. It holds a
*pool* of backends and distributes incoming connections across them using an
algorithm (round-robin, least-connections, IP-hash for stickiness). An L4
load balancer (TCP/UDP) never parses the HTTP payload — it just routes the raw
connection. An L7 load balancer parses the HTTP request, which makes it a true
reverse proxy: it can route `/api/accounts` to one cluster and `/api/payments`
to another, or inspect headers.

**API gateway** — a reverse proxy that adds an API management layer on top of
load balancing. Beyond routing, it enforces:
- **AuthN/AuthZ**: validate a JWT or API key before forwarding
- **Rate limiting**: 1,000 req/min per client, then reject (limits are
  tier- and endpoint-specific — the numbers vary across this kata's examples
  by design, e.g. a mobile token vs. an anonymous IP get different ceilings)
- **Request/response transformation**: rewrite paths, strip headers, add
  correlation IDs
- **Versioning**: route `/v1/` to old cluster, `/v2/` to new
- **Observability**: emit per-route latency, error-rate, usage metrics

```
  ┌───────────────────────────────────────────────────────┐
  │  API Gateway                                          │
  │  ┌──────────────────────────────────────────────────┐ │
  │  │  L7 Reverse Proxy / Load Balancer                │ │
  │  │  ┌────────────────────────────────────────────┐  │ │
  │  │  │  Base: terminate TLS, new conn to backend  │  │ │
  │  │  └────────────────────────────────────────────┘  │ │
  │  │  + route by path/header + health checks + sticky │ │
  │  └──────────────────────────────────────────────────┘ │
  │  + authn/authz + rate limit + transform + versioning  │
  └───────────────────────────────────────────────────────┘
```

The key distinction in a conversation: a load balancer asks "which backend gets
this connection?"; an API gateway asks "is this request allowed, and what does
it become before hitting the backend?"

---

### Where TLS terminates — the security pivot

The reverse proxy can terminate TLS in three configurations:

```
  1. TLS termination (most common)
     Client ──[TLS]──► Proxy ──[plaintext or HTTP]──► backends
     Proxy sees plaintext; backends don't need certs.

  2. TLS passthrough (L4)
     Client ──[TLS]──────────────────────────────────► backends
     Proxy forwards raw TCP; never sees payload; cannot route by path.

  3. TLS re-encryption (end-to-end TLS)
     Client ──[TLS]──► Proxy ──[TLS]──► backends
     Proxy sees plaintext momentarily; backends each need a cert.
     Often required to satisfy encrypt-in-transit-everywhere
     expectations in PCI-DSS CDE and regulated designs; v4.0 pushes
     strongly toward it, but internal segments may rely on documented
     compensating controls (isolated subnet, restrictive firewalling).
```

An architect must know which one is in play. Configuration 1 puts the
plaintext between proxy and backend — that segment must be protected (private
subnet, firewall rule, or mTLS). Configuration 3 is the only option that
satisfies "encrypt in transit *everywhere*" requirements.

---

### L4 vs L7 load balancers — the critical difference

An L4 load balancer routes on IP + port. It never opens the HTTP envelope:

```
  L4 LB: TCP SYN arrives on 10.100.0.5:443 → forward to 10.100.1.11:443
  Decision input: source IP, source port, dest IP, dest port, protocol
  Cannot: route /api vs /admin to different backends
  Cannot: read or modify HTTP headers
  Cannot: terminate TLS (in passthrough mode)
  Advantage: very fast, very simple
```

An L7 load balancer parses the HTTP request before routing:

```
  L7 LB: HTTP GET /api/v2/payments arrives →
    examine Host: header      → is this the right virtual host?
    examine path /api/v2/...  → route to payments cluster
    examine Cookie: session=X → if sticky, pin to same backend
  Can: rewrite paths, add headers, inspect response codes for health
```

This is why "L4 or L7?" is the first question to ask when a new load balancer
appears in a design.

## Worked example

Meridian Bank's mobile-banking backend runs on GCP in the `10.100.0.0/14`
range. The application edge for `api.meridian.example` (the mobile banking API)
is structured as follows:

```
  Internet
      │
      ▼ HTTPS :443
  ┌──────────────────────────────────────────────────────┐
  │  API Gateway / L7 Reverse Proxy                      │
  │  Public IP (assigned by GCP; not from RFC 1918)      │
  │  TLS terminates here (cert: *.meridian.example)       │
  │  JWT validation → reject if missing/expired           │
  │  Rate limit: 500 req/min per mobile client token      │
  └──────────────────────────────────────────────────────┘
      │                        │
      ▼ HTTP :8080             ▼ HTTP :8080
  10.100.1.10/32          10.100.1.11/32
  accounts-service        payments-service
  (GCP subnet             (GCP subnet
   10.100.1.0/24)          10.100.1.0/24)
```

**Routing rules** (this is L7, so path-based):

| Incoming path              | Routed to          | Backend IP     |
|----------------------------|--------------------|----------------|
| `GET /api/v2/accounts/*`   | accounts-service   | 10.100.1.10    |
| `POST /api/v2/payments/*`  | payments-service   | 10.100.1.11    |
| anything else              | 404 from gateway   | —              |

**What the network team sees at Meridian Bank:**
- Firewall rule: `internet → proxy: TCP 443 ALLOW`
- Firewall rule: `proxy → 10.100.1.0/24: TCP 8080 ALLOW`
- Firewall rule: `10.100.1.0/24 → internet: DENY` (backends have no egress)
- TLS re-encryption (option 3 above) added for PCI compliance: proxy also
  holds a client cert; backends present server certs.

**What the security team cares about:**
- Is JWT validation in the gateway, or does each backend do it separately?
  (Gateway is correct — one enforcement point, auditable)
- What logs does the gateway emit per request? (Needed for PCI log requirements)
- If the gateway is misconfigured and routes `/api/v2/admin` to the payments
  service, what's the blast radius? (Segmentation at the backend subnet limits it)

Contrast with Northwind FMCG, which has no API gateway: their e-commerce
backend routes through a plain nginx reverse proxy that does TLS termination
and round-robin across three app servers. No JWT enforcement, no rate limiting.
That means a scraped API key lets someone hammer order-status lookups
unchecked — a cost and DoS risk the IT head has not yet quantified.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| L4 load balancer | HAProxy (TCP mode), F5 LTM | Cloud Load Balancing — TCP/UDP LB (regional) | Network Load Balancer (NLB) | Azure Load Balancer (L4) |
| L7 reverse proxy / LB | nginx, HAProxy (HTTP mode), Envoy | Cloud Load Balancing — HTTP(S) LB (global or regional) | Application Load Balancer (ALB) | Azure Application Gateway |
| API gateway | Kong, Apigee (on-prem), AWS API GW (self-hosted) | Apigee (full-featured); Cloud Endpoints (lighter) | AWS API Gateway (REST / HTTP / WebSocket) | Azure API Management (APIM) |
| TLS termination | nginx/HAProxy holds the cert | Managed SSL cert on HTTPS LB; Google-managed certs | ACM cert on ALB | App Gateway + Azure-managed cert |
| mTLS to backends | nginx `proxy_ssl_certificate` | Cloud Service Mesh (formerly Traffic Director) / Envoy sidecar on GKE Enterprise (formerly Anthos) | ALB mutual auth (2023+) | App Gateway with backend mTLS |
| Web Application Firewall | ModSecurity (nginx/Apache) | Cloud Armor (attached to HTTPS LB) | AWS WAF (attached to ALB/CF) | Azure WAF (on App Gateway) |

**GCP specifics:** GCP's HTTP(S) Load Balancing is a globally distributed,
anycast reverse proxy — there is no single VM running it. Traffic from a
Mumbai client enters at GCP's Mumbai PoP and is forwarded over Google's
private backbone to the backend. The "load balancer IP" is a single anycast
VIP served from all PoPs. Apigee is the enterprise-grade API gateway;
Cloud Endpoints suits lighter gRPC/OpenAPI scenarios.

**AWS specifics:** The ALB is the standard L7 entry point for containerized
workloads (ECS, EKS). It integrates with ACM (cert management) and AWS WAF.
AWS API Gateway is fully managed and serverless; it adds request throttling,
usage plans, and AWS IAM / Cognito / Lambda authorizer hooks for AuthN.

**Azure:** Application Gateway is the L7 reverse proxy/LB with built-in WAF
option. Azure API Management is the full API gateway product. (Azure: TODO —
detail on APIM tiers and integration with Entra ID.)

## Do it (the exercise)

**[laptop]** Spin up a minimal reverse proxy with nginx and observe the
connection behaviour.

Prerequisites: Docker installed.

```bash
# 1. Start two tiny backend servers on different ports
docker run -d --name backend1 -p 8081:80 nginx
docker run -d --name backend2 -p 8082:80 nginx

# Customise their responses so you can tell them apart
docker exec backend1 sh -c 'echo "I am backend-1" > /usr/share/nginx/html/index.html'
docker exec backend2 sh -c 'echo "I am backend-2" > /usr/share/nginx/html/index.html'
```

```bash
# 2. Write a minimal nginx reverse proxy config
mkdir -p /tmp/rp-demo
cat > /tmp/rp-demo/nginx.conf << 'EOF'
events {}
http {
    upstream backends {
        server host.docker.internal:8081;
        server host.docker.internal:8082;
    }
    server {
        listen 8080;
        location / {
            proxy_pass http://backends;
            proxy_set_header X-Forwarded-For $remote_addr;
        }
        location /backend1/ {
            proxy_pass http://host.docker.internal:8081/;
        }
        location /backend2/ {
            proxy_pass http://host.docker.internal:8082/;
        }
    }
}
EOF
```

```bash
# 3. Start the reverse proxy
docker run -d --name revproxy -p 8080:8080 \
  -v /tmp/rp-demo/nginx.conf:/etc/nginx/nginx.conf:ro \
  --add-host host.docker.internal:host-gateway \
  nginx

# 4. Hit the round-robin pool — alternate responses
curl http://localhost:8080/    # should see backend-1 or backend-2
curl http://localhost:8080/    # should see the other one

# 5. Hit path-routed locations (L7 routing in action)
curl http://localhost:8080/backend1/   # always backend-1
curl http://localhost:8080/backend2/   # always backend-2
```

**What to observe:**
- Steps 4–5 show that the proxy opens *its own* connection to the backend. The
  backend's access log shows the proxy's IP, not your laptop's.
- Steps 4–5 show L7 path routing: the proxy read the URL path before deciding
  where to send the request. An L4 LB could not do this.
- `X-Forwarded-For` header carries your real IP to the backend. Check:
  ```bash
  docker logs backend1 2>&1 | tail -5
  ```

**[laptop] Inspect TLS termination:**

```bash
# See the TLS session ending at the proxy, not the backend
openssl s_client -connect api.meridian.example:443 -servername api.meridian.example \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer
```

The cert is issued to the proxy's hostname, not a backend hostname — proof
that TLS terminated at the proxy.

**[needs cloud account] GCP HTTPS Load Balancer:**
- In Cloud Console → Network Services → Load Balancing, create a HTTPS LB.
- Observe: the frontend is a single global IP; the backend is a managed
  instance group. Note where the SSL cert attaches (frontend, not backend).
- Add a path rule: `/api/*` → backend group A; `/static/*` → Cloud Storage
  bucket (different backend type — that's L7 routing to a non-server backend).

**Clean up:**
```bash
docker rm -f revproxy backend1 backend2
```

## Say it back (self-check)

1. What is the core mechanism a reverse proxy performs that an L4 load
   balancer in passthrough mode does not?
2. Name two things an API gateway adds that a plain L7 load balancer does not.
3. Where does TLS terminate in each of the three configurations (termination,
   passthrough, re-encryption)? When does PCI-DSS push toward re-encryption
   between proxy and backend, and when might a compensating control suffice?
4. Why can an L7 load balancer route `/api/accounts` to one cluster and
   `/api/payments` to another, but an L4 load balancer cannot?
5. In Meridian Bank's design above, why are backends on `10.100.1.0/24` with
   no egress to the internet, rather than publicly addressed?

## Talk to the IT/security head

**Ask:**

- "Is this load balancer L4 or L7? Does it terminate TLS, or does TLS go
  all the way to the backend?" *(This single question locates where plaintext
  lives, who holds the cert, and whether path-based routing is possible.)*
- "Where is JWT/session token validation enforced — at the gateway, or in
  every backend service individually?" *(Individual enforcement means the
  control is duplicated and inconsistent; gateway enforcement means one policy,
  one audit log.)*
- "What does the gateway log per request, and are those logs going to your
  SIEM?" *(For PCI-DSS and RBI, every API call to a CDE-adjacent service must
  be logged with timestamp, source, and action.)*
- "If the reverse proxy is compromised, what can it reach? Is it on the same
  subnet as the databases?" *(Proxy compromise should give the attacker only
  the paths the firewall allows — it should not be an open bridge to the
  data tier.)*
- "Do you use mTLS between the gateway and backends, or is the internal
  segment considered trusted?" *(In a regulated environment, "internal = trusted"
  is an assumption that fails the auditor; end-to-end TLS is expected in CDE.)*

**A good answer sounds like:** the engineer knows exactly where TLS terminates
(they can name the cert and its renewal owner); AuthN/AuthZ is enforced at the
gateway with a named policy engine; gateway logs flow to the SIEM with a named
retention period; the proxy subnet is isolated from the data tier by a named
firewall rule set.

**Red flags:**
- "The proxy and the database are on the same VLAN" — if the proxy is
  compromised, the attacker has a straight path to cardholder data.
- "Each service validates the JWT itself" — inconsistent enforcement, no
  central audit point; one service that skips validation exposes all data.
- "We trust the internal network after the proxy" — no controls between proxy
  and backend; a compromised proxy is game over for the backend tier.
- "TLS terminates at the load balancer and the backend is HTTP" with no mention
  of private subnet or firewall — plaintext running over a segment without
  compensating controls.

## Pitfalls & war stories

- **Calling everything a "load balancer."** In many shops the L7 reverse proxy
  that also does path routing, TLS termination, and header injection is called
  "the load balancer." Fine — but the architect must ask which *capabilities*
  are in use, because that determines security posture and troubleshooting path.

- **The sticky-session trap.** Session stickiness (routing a user to the same
  backend for the duration of their session) is implemented at L7 via a cookie.
  When that backend is taken down for maintenance, every pinned user's session
  breaks. Meridian Bank learned this during a card-processing maintenance window
  when 40% of active sessions dropped simultaneously. Design stateless backends
  and externalize session state (Redis, Memcached) so any backend can serve
  any user.

- **TLS re-encryption forgotten in the design.** A bank moves from on-prem
  (where the firewall vendor's product did end-to-end TLS) to GCP (where the
  HTTPS LB terminates TLS, then forwards HTTP to the backend). The compliance
  team rightly flags "no encryption between LB and backend" in the audit. Adding
  TLS re-encryption afterwards requires issuing certs to every backend instance
  and reconfiguring the LB — work nobody budgeted for.

- **API gateway as a security perimeter substitute.** An API gateway validates
  tokens and rate-limits. It does not replace a firewall. If backends are
  reachable directly (bypassing the gateway) because a firewall rule was left
  open during testing and never removed, the gateway controls are worthless.
  Verify: no traffic reaches backends except from the gateway's IP range.

- **Northwind's ungated API.** Northwind's e-commerce platform exposed an order
  lookup endpoint through a plain nginx reverse proxy with no token validation
  and no rate limiting. A competitor's bot scraped their entire product catalog
  and pricing in 48 hours by calling the endpoint 60,000 times. An API gateway
  with rate limiting (100 req/min/IP, require auth) would have stopped this at
  the edge with no backend changes.

## Going deeper (optional)

- nginx documentation — `proxy_pass`, `upstream`, `location` blocks:
  https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- RFC 7230 §5.7 — HTTP message forwarding (how proxies MUST behave):
  https://datatracker.ietf.org/doc/html/rfc7230#section-5.7
- GCP — HTTPS Load Balancing overview and URL maps (path routing):
  https://cloud.google.com/load-balancing/docs/https
- AWS — Application Load Balancer listener rules and target groups:
  https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html
- Pairs with N21 (TLS handshake and termination), N22 (LB algorithms,
  health checks, sticky sessions), N23 (forward proxy), and N25 (WAF/CDN
  on top of the reverse proxy).
- N24 concepts underpin S15 (API security: authn, rate limiting, mTLS)
  and S13 (OWASP — injection, broken auth at the API edge).

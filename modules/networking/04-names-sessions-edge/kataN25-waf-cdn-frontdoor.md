# Kata N25 — WAF, CDN, and the modern application front door

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N21, N22, N24 · **Time:** ~35 min
> **Tags:** `waf` `cdn` `l7-application` `reverse-proxy` `ddos` `security` `cloud` `networking`

## Why it matters

Every internet-facing service at Meridian Bank's digital channels or Northwind's
e-commerce platform sits behind *something* that absorbs bad traffic, accelerates
good traffic, and hides the origin servers. That "something" is a layered stack
of three constructs: a **CDN** for caching and latency, a **WAF** for HTTP attack
inspection, and a **front door** that stitches both together as a single global
entry point. When the CISO asks "what's protecting the web tier?" or the IT head
asks "why is the site slow in Singapore?", these are the constructs you need to
reason about — and they are the place where networking decisions (routing,
caching, TLS termination) and security decisions (attack filtering, rate limiting,
bot management) merge into one.

## The mental model

### The problem this solves

Putting a web server directly on the internet means:

1. Every user connects from the server's physical location — users far away
   experience high latency.
2. Every bot, scanner, and SQL-injection attempt hits your app server directly.
3. A flood of traffic (DDoS) overwhelms your origin.
4. Your origin's IP is public; direct-to-IP bypass attempts skip your controls.

The solution is to put a chain of L7 components *in front* of the origin:

```
  User
   │
   │  (public internet)
   ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  CDN edge node  (nearest PoP — caches static content)          │
 │   → TLS terminates here; user sees low latency                 │
 └────────────────────────┬────────────────────────────────────────┘
                          │ cache MISS (dynamic request)
                          ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  WAF (L7 inspection — OWASP rules, IP reputation, rate limit)  │
 │   → attack traffic dropped here; legitimate traffic passed      │
 └────────────────────────┬────────────────────────────────────────┘
                          │ clean traffic only
                          ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │  Origin (your app servers / load balancer — private IPs)       │
 │   → ideally accepts traffic ONLY from the WAF/CDN layer        │
 └─────────────────────────────────────────────────────────────────┘
```

Each layer is a **reverse proxy** (see N24): it terminates the client's TCP
connection and opens a new one upstream. The client never connects directly to
the origin.

---

### CDN — Content Delivery Network

A CDN is a globally distributed set of **Points of Presence (PoPs)** that cache
content close to users. The CDN stores a copy of your CSS, JS, images, and
increasingly API responses, then serves them from the PoP nearest the user.

Key mechanics:
- **Cache key** — typically the URL path plus selected headers. Requests that
  match the cache key are served from the edge; others are forwarded to origin.
- **TTL** — how long the CDN keeps a cached copy before re-validating (set via
  `Cache-Control: max-age=N` or CDN-level override).
- **TLS termination** — the CDN holds a certificate and terminates TLS from the
  user; origin traffic travels over a separate (ideally TLS-protected) connection
  on the internal backbone.
- **Anycast routing** — CDN providers advertise the same IP prefix from many
  PoPs; BGP routes users to the nearest PoP automatically.

**What a CDN does NOT do:** inspect HTTP payloads for attack signatures. That is
the WAF's job.

---

### WAF — Web Application Firewall

A WAF inspects HTTP request and response bodies, headers, and URLs for attack
patterns. It operates at **L7** (see N03). Contrast with a stateful firewall,
which works at L3/L4 (IPs and ports — it cannot see inside an HTTPS request).

A WAF enforces rules from sets like:
- **OWASP Core Rule Set (CRS)** — covering the OWASP Top 10 attack classes
  (SQL injection, XSS, command injection, etc.; see S13).
- **IP reputation lists** — known malicious sources, Tor exit nodes, cloud
  scraper ranges.
- **Rate limiting** — e.g. ≥ 100 requests per second from one IP → block.
- **Bot management** — distinguishing good bots (search engines) from bad bots
  (scrapers, credential stuffers).
- **Custom rules** — Meridian Bank might block any request carrying a `SELECT`
  keyword in query parameters, or block all traffic not originating from India.

WAFs operate in two modes:
- **Detection mode** — logs matches but does not block (used during tuning to
  avoid false positives before going live).
- **Prevention (blocking) mode** — drops or challenges matching requests.

**False positives are the WAF's real operational problem.** A rule written for
generic SQL injection will fire on a legitimate search query containing the word
"or". Tuning a WAF — tightening rules without blocking legitimate users — is
ongoing work.

---

### The modern "front door"

Cloud providers bundle CDN + WAF + global load balancing + DDoS absorption into
a single managed service they call a "front door" (or global external load
balancer / application delivery controller). This single entry point:

- **Anycast-routes** users to the nearest edge.
- **Terminates TLS** with a managed certificate (auto-renewed).
- **Applies WAF rules** before any traffic reaches the VPC.
- **Offloads DDoS** at the edge — volumetric floods are absorbed before they
  reach the origin's region.
- **Enforces geo-restrictions** — Meridian Bank's RBI data-residency requirement
  might mean blocking requests from outside India at the edge.

The origin should be **locked down to only accept traffic from the front door's
IP ranges** (or a static shared-secret header injected by the front door), so
attackers can't bypass the WAF by
hitting the origin IP directly. This is the most common misconfiguration.

---

## Worked example

### Meridian Bank's mobile banking front door

Meridian Bank runs its mobile banking API on GCP in `asia-south1` (Mumbai).
The origin is a cluster of backend pods behind an **internal** L4 load balancer
at `10.100.1.20` (GCP VPC range `10.100.0.0/14` — see `reference/running-example.md`).
The public entry point is `api.meridian-mobile.example`.

Traffic flow for a customer balance request:

```
  Customer phone (Mumbai)        Customer phone (Singapore)
         │                                │
         │ DNS → anycast IP 203.0.113.10  │
         │ (resolved to nearest PoP)      │
         ▼                                ▼
  CDN PoP Mumbai ─────────────────────────────── CDN PoP Singapore
  (TLS terminates; token page cached 60s)        (same; 40 ms latency)
         │  cache MISS on /balance                        │
         │  (always dynamic — do not cache PII!)          │ (cache HIT on
         ▼                                                │  /static/logo.png)
  WAF inspection layer                                    │
  ┌─────────────────────────────────────────┐             │
  │ Rule: SQLi pattern in param?   → DROP   │             │
  │ Rule: > 200 req/s from one IP? → BLOCK  │             │
  │ Rule: non-IN geolocation?      → BLOCK  │             │
  │ Rule: missing X-Origin-Token?  → BLOCK  │             │
  └───────────────┬─────────────────────────┘             │
                  │ clean, IN-origin traffic
                  ▼
  Origin: GCP asia-south1 internal LB  10.100.1.20:8443
  (accepts ONLY traffic with X-Origin-Token: <shared secret>)
```

Key configuration decisions:
- `/balance`, `/transfer` — **never cached** (dynamic, PII). `Cache-Control: no-store`.
- `/static/*` — cached at edge, TTL 3600 s. No PII. Served from PoP without
  touching the origin.
- WAF geo-block rule: source country != IN → HTTP 403. Satisfies RBI data-
  residency posture (no foreign-origin transactions).
- Origin firewall rule: allow ingress only from the Google global LB / GFE source
  ranges `130.211.0.0/22` and `35.191.0.0/16` (documented in the Cloud Load
  Balancing firewall-rules guide at `cloud.google.com/load-balancing/docs/firewall-rules`);
  deny all other ingress to port 8443.

### Northwind's e-commerce: a cost-first design

Northwind (AWS primary) uses CloudFront + AWS WAF in front of its e-commerce
site. Traffic profile: 80% product catalog pages (cacheable), 20% cart/checkout
(dynamic). The CDN cache hit rate is ~75%, meaning only 25% of requests reach
the origin — reducing origin cost and latency significantly.

Northwind's WAF includes a rate-limit rule: > 500 requests / 5 minutes from one
IP → temporary block. This is tuned to allow normal browsing (a user loads
~15–20 pages/5 min) while blocking scrapers (> 500/5 min).

---

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| CDN | Akamai, Cloudflare, Fastly (purchased separately) | Cloud CDN | CloudFront | Azure CDN / Azure Front Door (CDN profile) |
| WAF | F5 ASM, Fortiweb, ModSecurity on-premise | Cloud Armor (security policies) | AWS WAF | Azure WAF (on App Gateway or Front Door) |
| Front door / global LB | ADC (F5, Citrix ADC), reverse proxy tier | Global External Application LB + Cloud Armor | CloudFront + AWS WAF *or* AWS Shield Advanced | Azure Front Door (Premium — includes WAF) |
| DDoS protection | On-prem scrubbing center, ISP-level mitigation | Cloud Armor Adaptive Protection | AWS Shield Standard (free) / Advanced | Azure DDoS Protection |
| TLS cert management | Manual PKI / DigiCert / Let's Encrypt | Google-managed certs (auto-renewed) | ACM (AWS Certificate Manager) | App Gateway / Front Door managed certs |
| Geo-restriction | Firewall GeoIP rules | Cloud Armor geo-match rules | CloudFront geo-restriction / WAF geo rules | Azure WAF geo filter |
| Origin protection | IP allowlist on firewall | VPC firewall rules allowing only Google LB/GFE ranges (130.211.0.0/22, 35.191.0.0/16) | CloudFront custom header + ALB rule | Private Link origin in Azure Front Door |

**GCP detail:** Cloud Armor attaches to **global external Application Load
Balancers** via global security policies, and to **regional external Application
Load Balancers** via regional security policies (`gcloud compute security-policies
create ... --type=CLOUD_ARMOR --region=...`) — the regional form serves
data-sovereignty/regional use cases such as RBI data residency. The external LB IS
the front door; Cloud Armor IS the WAF sitting on it. There is no separate CDN
product you wire up — Cloud CDN is enabled per backend service.

**AWS detail:** CloudFront and AWS WAF are separate services joined by a
WebACL attached to a CloudFront distribution. CloudFront handles CDN + TLS
termination; the WebACL applies WAF rules at each CloudFront edge location.
AWS Shield Standard is on by default (no charge); Shield Advanced adds 24/7
DDoS response team and cost protection.

---

## Do it (the exercise)

### Part A — Inspect a live CDN response [laptop]

```bash
# 1. Fetch a page and look at caching headers:
curl -sI https://www.google.com | grep -iE "cache-control|age|x-cache|cf-cache|via"
# "Age: N" means content has been cached N seconds at the CDN edge.
# "x-cache: Hit from cloudfront" (or similar) confirms CDN served it.

# 2. Compare a cacheable static asset vs a dynamic API call on a site you test:
curl -sI https://www.example.com/static/logo.png | grep -i cache-control
curl -sI https://httpbin.org/get           | grep -i cache-control
# expect: static → "max-age=…"; dynamic → "no-store" or "no-cache"
```

### Part B — See WAF rules in action (OWASP test payload) [laptop]

> These commands test a public demonstration site that expects these inputs —
> do NOT run them against systems you do not own.

```bash
# A site using the OWASP Juice Shop (a deliberately vulnerable demo app):
# If you have it running locally via Docker:
docker run -d -p 3000:3000 bkimminich/juice-shop

# Try a SQL injection via URL parameter (detection, not exploitation):
curl -s "http://localhost:3000/rest/products/search?q='+OR+1=1--" \
  | head -c 200
# Without WAF: the query may return all products.

# Now put ModSecurity WAF in front and repeat:
# (advanced: see https://hub.docker.com/r/owasp/modsecurity for the Docker image)
# With WAF in blocking mode: expect HTTP 403 Forbidden.
```

### Part C — Map the front door for a system you know [laptop / paper]

1. Draw the ingress path for a web application you work with or know well:
   - Is there a CDN? How do you know? (Check `Age:` headers, `Via:`, or
     `X-Amz-Cf-Id:`.)
   - Where does TLS terminate?
   - Is there a WAF? (A `403` with a generic body on a malformed request is a hint.)
   - Can you reach the origin directly via its IP? (If yes, the WAF can be bypassed.)
2. For Meridian Bank's front door above: which request paths should never be
   cached? Write the `Cache-Control` header value and explain why.

### Part D — Review a WAF rule [needs cloud account]

In GCP (Cloud Armor) or AWS (WAF WebACL):
1. Create a security policy / WebACL with the **OWASP Core Rule Set** managed
   rule group enabled in **detection mode**.
2. Send a test request with a SQL injection payload in a query parameter.
3. View the WAF logs to confirm the rule matched.
4. Switch to **prevention mode** and confirm the request is blocked (HTTP 403).

---

## Say it back (self-check)

1. What is the difference between a CDN and a WAF — what does each inspect, and
   at which layer?
2. Why must dynamic API responses (like `/balance`) carry `Cache-Control: no-store`,
   and what could go wrong if they don't?
3. Why is it critical that the origin only accept traffic from the CDN/WAF layer
   rather than the open internet?
4. What does "WAF detection mode" mean, and why would you run it before switching
   to prevention mode?
5. A volumetric DDoS floods your origin with 10 Gbps of UDP traffic. Will a WAF
   stop it? What should stop it and why?

---

## Talk to the IT/security head

**Ask:**

- "Does the WAF sit in front of every internet-facing service, or are there
  exceptions?"
  *Good answer:* "Yes, all traffic goes through Cloud Armor / WAF before hitting
  the origin; we have an explicit inventory of public-facing services." *Red flag:*
  "Most do" — the exception is the one that gets breached.

- "Is the WAF in detection or prevention mode, and when was it last tuned?"
  *Good answer:* "Prevention mode on all production services; we review false-
  positive rate monthly and tighten rules after each release." *Red flag:*
  "Detection only" (not blocking anything) or "we haven't tuned it since go-live"
  (stale rules that may be too loose or causing hidden false positives).

- "Can the origin be reached directly, bypassing the WAF?"
  *Good answer:* "No — the origin's firewall rules only allow ingress from Cloud
  Armor / CloudFront IP ranges, verified quarterly when those ranges update."
  *Red flag:* "Theoretically no" or uncertainty — direct-origin bypass is the
  single most common WAF misconfiguration.

- "What's the CDN cache hit ratio, and are you confident no PII is being cached?"
  *Good answer:* "Hit ratio is ~70% for static; we mark all authenticated and
  dynamic endpoints no-store; we've verified this with a cache audit." *Red flag:*
  Blank stare on "cache hit ratio" — this tells you CDN is not actively managed
  and PII leakage via shared CDN cache is possible.

- "How does the WAF log feed into your SIEM, and what triggers an alert?"
  *Good answer:* WAF logs stream to the SIEM; high block-rate spikes trigger
  incident review; logs are retained for audit. *Red flag:* WAF logs not reviewed
  or not shipped — a WAF that doesn't alert is security theatre.

**Red flags to listen for:**

- "We have Cloudflare in front" with no further detail — Cloudflare / CDN ≠ WAF;
  they are different products even from the same vendor.
- WAF in detection-only mode in production "because it was causing issues" —
  means it blocked real attacks AND real users and was never tuned; now it blocks
  nothing.
- Origin IP discoverable in DNS history (`securitytrails.com`, `shodan.io`) —
  attackers use history lookups to find pre-CDN origin IPs.

---

## Pitfalls & war stories

**PII leakage through the CDN cache.** A bank deployed a CDN in front of its
mobile app. A developer added a `Cache-Control: max-age=3600` header to the
profile API endpoint for "performance." The CDN cached the response, keyed on the
URL alone. The next customer to hit the same URL received the previous customer's
account details from cache. Rule: anything that contains session state,
user-specific data, or PII is `Cache-Control: no-store`, server-side enforced,
not just "trust the dev to set the right header."

**WAF bypass via origin IP.** An FMCG deployed Cloudflare WAF. Their origin's IP
had been publicly exposed in a DNS `A` record two years earlier (before Cloudflare
was added). Attackers used historical DNS records to find and target the origin
IP directly, bypassing the WAF entirely. The WAF logged zero traffic from this
attack. Fix: rotate the origin IP on WAF adoption; enforce IP allowlisting to
CDN/WAF egress ranges only.

**False-positive whack-a-mole in FSI.** Meridian Bank's WAF was in prevention
mode with a strict OWASP CRS. A legitimate account management feature allowed
users to paste a SQL export of their own transactions (for a reconciliation
tool). The WAF's SQLi rules flagged the pasted content and blocked the feature
for all users. It took three days to diagnose because the WAF log was not in the
SIEM. Lesson: WAF tuning is an ongoing operational activity, WAF logs must feed
the SIEM, and new application features must include a WAF rule review step.

**Rate limiting asymmetry.** Northwind set a WAF rate limit of 1,000 requests per
minute per IP. A credential-stuffing attack distributed across 10,000 IPs sent 50
requests per IP per minute — well below the threshold. Rate limits alone do not
stop distributed attacks; they need IP reputation lists, CAPTCHA challenges, and
behavioural analytics layered on top.

**TLS termination gap.** A bank's CDN terminated TLS from users but passed traffic
to the origin over plain HTTP (the CDN-to-origin leg). Data was "encrypted in
transit" to the edge but traveled in cleartext from the CDN PoP to the origin
data center over a leased line. An auditor flagged it as a PCI-DSS finding. Fix:
enforce TLS on both legs (client→CDN and CDN→origin), with the origin cert
validated by the CDN.

---

## Going deeper (optional)

- OWASP Core Rule Set (CRS): `coreruleset.org` — the managed rule baseline that
  every cloud WAF product offers as a managed rule group.
- OWASP Top 10 (2021): `owasp.org/www-project-top-ten/` — the attack classes WAF
  rules target; pairs with S13.
- RFC 9111 (HTTP Caching): the authoritative specification for `Cache-Control`
  directives including `no-store`, `no-cache`, `max-age`, `private`.
- GCP Cloud Armor docs: `cloud.google.com/armor` — security policies, managed
  protection, Adaptive Protection (ML-based DDoS tuning).
- AWS WAF Developer Guide: `docs.aws.amazon.com/waf/` — WebACLs, managed rule
  groups, Shield integration.
- Pairs with S13 (OWASP Top 10 for architects) and N28 (IDS/IPS, NDR, DDoS
  protection). Cross-references N24 (reverse proxy), N21 (TLS/PKI), N22 (load
  balancing).

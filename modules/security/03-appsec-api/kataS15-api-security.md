# Kata S15 — API security: authn, rate limiting, gateways, mTLS

> **Track:** Security · **Module:** S3 Application & API security · **Prereqs:** S01, S04, N21, N24 · **Time:** ~40 min
> **Tags:** `security` `api-security` `authn` `mtls` `api-gateway` `l7-application` `oauth2` `fsi`

## Why it matters

APIs are the attack surface that replaced the perimeter. Every mobile-banking
screen, every partner integration, every microservice call is an API. At
Meridian Bank, the core banking system now exposes a REST API to the mobile
backend — and that single endpoint carries account data, transfer initiation,
and authentication tokens. A misconfigured API means an attacker can enumerate
accounts, exhaust rate limits, or impersonate another customer without ever
touching the firewall. Regulators (RBI, PCI-DSS) increasingly ask: "what is
your API inventory and how is each endpoint authenticated?" If the architect
cannot answer, the CISO will find out in an audit finding instead.

## The mental model

**The four problems every API must solve:**

```
  1. AuthN    Who is calling?          (identity — are you who you claim?)
  2. AuthZ    Are you allowed to?      (permission — can this caller do this?)
  3. Rate     How many times?          (quota — cap abuse and accidental flood)
  4. Integrity Was the message tampered? (service-to-service trust)
```

These are distinct problems people often conflate. An API can authenticate a
caller perfectly (problem 1) and still serve data to a user who shouldn't have
it (problem 2 failure). Rate limiting stops a valid caller from hammering you.
Integrity / mTLS solves the service-to-service case that JWT alone cannot.

---

### AuthN patterns (who is calling?)

There are three common patterns, roughly in order of increasing strength:

```
  Pattern         Typical caller     Token lives where?  Risk if leaked
  ─────────────────────────────────────────────────────────────────────
  API Key         a system/partner   request header       forever, until rotated
  JWT (Bearer)    a user or service  Authorization header until expiry (minutes–hours)
  mTLS cert       a service/system   TLS handshake        until cert revoked (CRL/OCSP)
```

**API key** — a static secret passed in a header, e.g.:

```
GET /v1/accounts/12345 HTTP/1.1
Host: api.meridian.example
X-API-Key: mrd_live_k3y...
```

Simple but the weakest: keys rotate infrequently, leak into logs, and carry
no expiry. Acceptable for machine-to-machine inside a trusted network zone;
never for direct internet-facing production.

**JWT (JSON Web Token, RFC 7519)** — a signed token a client gets by
authenticating once (e.g. OAuth2 / OIDC flow, see S05). Subsequent requests
carry the token; the API verifies the signature without contacting a central
store. Structure: `base64url(header).base64url(payload).signature` (JWTs use
base64url encoding, RFC 4648 §5, not standard base64).

```
  Payload example (decoded):
  {
    "sub":  "user:9912",
    "roles": ["customer"],
    "iat": 1718630400,       ← issued-at (Unix epoch)
    "exp": 1718634000,       ← expiry: 60 minutes later
    "jti": "a3f8b2c1..."     ← JWT ID for replay prevention
  }
```

The API gateway verifies the signature (using the Identity Provider's public
key), checks `exp`, checks `jti` against a replay cache (short-lived),
then passes claims downstream.

**mTLS (mutual TLS)** — both sides present X.509 certificates; each
authenticates the other during the TLS handshake (see N21). No bearer token
needed between services — the identity *is* the certificate.

```
  Client service                    API / server service
  ─────────────────────────────────────────────────────
  presents cert  ──────────────────►  verifies client cert against CA
  verifies server cert  ◄──────────  presents server cert
  TLS session established; both authenticated
```

mTLS is the right pattern for **service-to-service** calls inside a mesh or
between a partner's HSM-connected gateway and a bank's core API — exactly the
pattern Meridian uses between its GCP-hosted mobile backend and the on-prem
core banking connector. The certificate is issued by an internal CA, pinned to
the service identity, and rotated on a schedule; a leaked network credential
cannot impersonate the service without the corresponding private key.

---

### Rate limiting (how many times?)

Rate limiting is an availability and abuse control. Without it, a single
misbehaving client (or attacker) can exhaust your backend's thread pool and
cause a denial-of-service for all customers.

Common strategies:

```
  Algorithm       Behaviour                          Best for
  ────────────────────────────────────────────────────────────────────────
  Fixed window    N requests per minute per key      simple, burst-prone
  Sliding window  N requests in any rolling 60 s     fairer, more complex
  Token bucket    burst allowed up to bucket size,   APIs needing burst headroom
                  then refilled at steady rate
  Leaky bucket    strict constant drain rate          protecting fragile backends
```

Limits are typically enforced at the **API gateway** (not the backend service)
so the backend never even sees over-limit requests. Response on breach: HTTP
429 Too Many Requests with a `Retry-After` header.

---

### API gateway as the enforcement chokepoint

The API gateway (see N24, and the glossary entry) sits in front of all API
backends and centralises the controls:

```
  Internet / partner / mobile app
            │
            ▼ HTTPS (TLS terminated here)
  ┌──────────────────────────────────────────┐
  │            API GATEWAY                   │
  │  ① AuthN check  (JWT sig / API key / mTLS) │
  │  ② AuthZ check  (scope, role, resource)   │
  │  ③ Rate limit   (per key / per user)      │
  │  ④ Request transform / routing            │
  │  ⑤ Observability (logs, metrics, traces)  │
  └──────────────────────────────────────────┘
            │ plain HTTP or mTLS to backends
            ▼
     backend microservices / core connector
```

Enforcing at the gateway means **one policy, one audit log, one place to
rotate keys**. Backends trust only the gateway's internal network address and
(optionally) a gateway-issued mTLS cert — they never accept unauthenticated
requests from other paths.

OWASP API Security Top 10 (2023) lists "Broken Object Level Authorization"
(BOLA/IDOR) as the #1 API risk — verifying that the authenticated caller can
only access *their own* resources, not any arbitrary resource ID. The gateway
handles identity; per-object authorization must be enforced in the backend
service itself.

## Worked example

Meridian Bank's mobile API: GCP-hosted in `10.100.0.0/14` (GCP supernet,
`reference/running-example.md`). The mobile app calls the Account Balance API.
The on-prem core banking connector lives at `10.10.20.5` (CDE subnet,
`10.10.20.0/24`).

**The call chain and controls at each hop:**

```
  Mobile App (HTTPS, port 443)
      │
      ▼  TLS terminated; OAuth2 JWT validated
  GCP External HTTPS LB  (anycast VIP, asia-south1)
      │
      ▼  JWT forwarded as header; rate limit enforced
  Apigee API Gateway  (10.100.1.0/28 internal subnet)
      │   checks: JWT sig + exp, role=customer, rate ≤ 100 req/min/token
      │   rewrites: adds X-Authenticated-User: 9912
      │
      ▼  mTLS (GCP CA-issued certs, rotated every 90 days)
  Core Banking Connector  (GCP-side, 10.100.2.5)
      │
      ▼  Cloud Interconnect → HQ-DC1 → core at 10.10.20.5 (CDE)
  Core Banking API (on-prem, port 8443, TLS, mTLS to connector)
```

**Rate-limit configuration (Apigee example, conceptual):**

```
  Quota policy:
    allow: 100 requests per minute per OAuth2 client_id
    allow: 1000 requests per minute per service account (internal)
    response on breach: HTTP 429, Retry-After: 30
```

**mTLS cert properties:**

```
  Subject:   CN=mobile-backend-svc, O=Meridian Bank, C=IN
  Issuer:    CN=Meridian Internal CA G1
  Valid:     2026-01-01 → 2026-04-01  (90-day rotation, automated)
  Key usage: Digital Signature, Key Encipherment
  SAN:       mobile-backend-svc.internal.meridian.example
```

The core banking connector verifies this cert against the Meridian Internal CA
before allowing any request through. A compromised service that cannot present
a valid cert is rejected at the TLS handshake, before any API logic runs.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| API gateway | Kong, NGINX + plugins, MuleSoft | Apigee (fully managed) | Amazon API Gateway | Azure API Management |
| JWT validation | NGINX `lua` or Kong plugin | Apigee JWT policy; also Cloud Endpoints | API Gateway JWT authorizer; also Cognito | APIM JWT policy |
| Rate limiting | Kong rate-limit plugin, F5 | Apigee Quota policy; Cloud Armor rate rules | API Gateway usage plans; WAF rate rules | APIM rate-limit policy |
| mTLS (service-to-service) | Internal CA + NGINX / HAProxy | Certificate Authority Service + Cloud Service Mesh (Istio) | AWS Private CA + App Mesh | Azure API Management mTLS; (Azure: TODO full service mesh) |
| API key management | Vault, Kong key-auth | Apigee API products & keys | API Gateway API keys; AWS Secrets Manager rotation | APIM subscriptions |
| Observability | ELK + custom logging | Cloud Logging + Apigee Analytics; Cloud Trace | CloudWatch + API Gateway access logs | APIM built-in analytics + Azure Monitor |
| OWASP API protection | ModSecurity / OWASP CRS | Cloud Armor WAF (OWASP CRS managed ruleset) | AWS WAF managed rules (OWASP ruleset) | Azure WAF with OWASP CRS |

**Key GCP detail:** Apigee is GCP's full-lifecycle API management platform —
it handles AuthN/AuthZ, rate limiting, developer portal, monetization, and
analytics in one managed service. For lighter-weight use, Cloud Endpoints
(based on Envoy) handles JWT validation and rate limiting with less overhead.

**Key AWS detail:** Amazon API Gateway (REST and HTTP variants) handles JWT
authorization via Lambda authorizers or native JWT authorizers (Cognito or any
OIDC provider). AWS WAF can be attached for rate-based rules. For service-mesh
mTLS, App Mesh (Envoy-based) issues and rotates certificates via AWS Private CA.

## Do it (the exercise)

**[laptop]** Inspect a JWT (no account needed):

1. Get any JWT from a public demo identity provider (or use `jwt.io`'s example):
   ```bash
   # Decode a JWT without verifying the signature (to inspect structure):
   TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyOjk5MTIiLCJyb2xlcyI6WyJjdXN0b21lciJdLCJpYXQiOjE3MTg2MzA0MDAsImV4cCI6MTcxODYzNDAwMH0.SIGNATURE"
   # Split on '.', base64-decode the second segment (payload):
   echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | python3 -m json.tool
   ```
   Identify: `sub` (subject/identity), `exp` (expiry in Unix epoch), any `roles` or `scope` claims.

2. Convert the `exp` value to human-readable:
   ```bash
   date -d @1718634000        # Linux (GNU date)
   # date -r 1718634000       # macOS
   ```

3. Simulate what happens when a JWT expires: change the `exp` to a past
   timestamp in your test. Any compliant library or gateway must reject it.

**[laptop]** See mTLS in action with `openssl`:

4. Connect to a server that enforces mTLS (many public APIs do not, but you
   can test the server-side TLS with):
   ```bash
   openssl s_client -connect api.example.com:443 \
     -servername api.example.com \
     -cert client.pem -key client-key.pem 2>&1 | head -30
   ```
   Without a valid client cert the handshake returns `tlsv1 alert certificate required`.
   This is the same handshake Meridian's core connector performs — the error
   message is the control working correctly.

**[laptop]** Probe a rate-limit response:

5. Use `curl` in a loop to trigger HTTP 429 on a free test API (e.g. httpbin.org
   has a `/status/429` endpoint to simulate it):
   ```bash
   curl -i https://httpbin.org/status/429
   # Look for:  HTTP/2 429   and   Retry-After: <seconds>
   ```
   In a real gateway the `429` would carry your remaining quota headers:
   `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

**[needs cloud account]** Deploy a simple API gateway with rate limiting and
JWT validation on GCP (Cloud Endpoints + Cloud Run) or AWS (API Gateway HTTP +
JWT authorizer). Add a usage plan limiting callers to 10 req/min and observe
the 429 response.

## Say it back (self-check)

1. Name the four problems every API must solve and state which layer each is
   enforced at in Meridian's design.
2. What is the structural difference between an API key and a JWT? When would
   you choose mTLS over both?
3. A developer says "we already validate the JWT, so authorization is handled."
   What is the flaw in that reasoning? (Hint: BOLA.)
4. Why does rate limiting belong at the API gateway rather than in each backend
   service?
5. What HTTP status code signals a rate-limit breach, and which header tells
   the caller when to retry?

## Talk to the IT/security head

**Ask:**

- "Do you have a complete inventory of your external and internal APIs — every
  endpoint, every authentication mechanism?" *(good answer: yes, in an API
  catalogue or gateway; red flag: "we think so" or no gateway at all)*
- "How do service-to-service calls authenticate — shared secrets, JWTs, or
  mTLS?" *(good answer: mTLS or signed JWTs with short expiry; red flag: API
  keys hardcoded in application config)*
- "Where is rate limiting enforced, and do you have per-customer quotas on
  the mobile API?" *(good answer: at the gateway, per OAuth2 client_id, with
  alerting on spike; red flag: "the backend handles it" — meaning it doesn't)*
- "What happens when a microservice's mTLS certificate expires? Is rotation
  automated?" *(good answer: automated via service mesh / Private CA with
  < 90-day validity; red flag: manual, quarterly, or "we haven't set an expiry")*
- "How do you detect and respond to credential stuffing against the login API?"
  *(good answer: anomaly detection on 401/403 rates at the gateway, fed to SIEM;
  red flag: "we'd see it in logs" — passive, not detected in real time)*

**A good answer sounds like:** the security lead can name the gateway product,
state which AuthN mechanism each API class uses, quote a quota figure, and
describe automated cert rotation. They distinguish authentication (gateway)
from object-level authorization (backend service).

**Red flags to listen for:**
- "Our APIs are internal, so they don't need auth" — east-west API calls are
  exactly where lateral movement happens (see S01, N27).
- API keys stored in source code (found in every "accidental credential leak"
  news story; search GitHub for your own org's domain name).
- No rate limiting on authentication endpoints — credential stuffing is trivially
  easy without it.
- Certificate validity periods measured in years, rotation done manually — one
  forgotten renewal takes down a production integration.

## Pitfalls & war stories

**The missing object-level check (BOLA / IDOR):** Meridian's mobile API
correctly validates the JWT but the `/v1/accounts/{id}` endpoint returns the
account for *any* ID a caller supplies. Attacker logs in as customer 9912, then
probes `/v1/accounts/9913`, `/v1/accounts/9914`. The gateway sees a valid JWT
and passes it through. The backend must verify `JWT.sub == account.owner_id`
on every request — the gateway cannot do this because it does not understand
account ownership. PCI-DSS Req 7 (need-to-know access control) and OWASP
API-Security Top 10 item #1.

**API keys in mobile apps:** a Northwind field-sales app hardcoded an API key
in the Android APK. An attacker decompiled it with `apktool`, extracted the
key, and scripted product-price lookups at 50,000 requests per hour. With no
rate limiting, it ran for three days before someone noticed the bill. Lesson:
mobile apps must use short-lived JWTs via OAuth2 PKCE flow, not static keys.

**mTLS misconfigured to "optional":** a GCP service mesh was deployed with
`PeerAuthentication` mode `PERMISSIVE` (accepts both mTLS and plain HTTP) to
avoid breaking rollout. Six months later, an internal developer tool was still
calling the core API over plain HTTP — bypassing all service-identity controls.
`STRICT` mode from day one, with a defined migration window, is the correct
posture; permissive mode is a migration aid, not a policy.

**JWT algorithm confusion (CVE class):** early JWT libraries accepted `alg:
none` in the header, meaning a caller could strip the signature and claim any
identity. Always pin the expected algorithm (`RS256` or `ES256`) in your
validation code; never trust the `alg` field from the token itself.

**Forgotten token expiry in FSI integrations:** a bank-to-bank integration
used JWTs with `exp` set to 24 hours by mistake. When a service account's
credentials were rotated, live tokens remained valid for up to 24 hours — during
which the old (potentially compromised) identity was still trusted. Short-lived
tokens (15 minutes) reduce the blast radius of a credential leak.

## Going deeper (optional)

- OWASP API Security Top 10 (2023) — owasp.org/API-Security/editions/2023/
- RFC 7519 — JSON Web Token (JWT)
- RFC 7517 — JSON Web Key (JWK) — how public keys are published for JWT verification
- RFC 6749 — OAuth 2.0 Authorization Framework (see S05 for the flows)
- NIST SP 800-204B — Attribute-based Access Control for Microservices-based
  Applications using a Service Mesh
- GCP: Apigee documentation; Certificate Authority Service; Cloud Service Mesh
  PeerAuthentication reference
- AWS: Amazon API Gateway JWT authorizers; AWS Private CA with App Mesh
- Pairs with: S04 (AuthN/AuthZ foundations), S05 (OAuth2/OIDC), N21 (TLS/mTLS
  handshake), N24 (reverse proxy vs API gateway), S13 (OWASP Top 10 for architects)

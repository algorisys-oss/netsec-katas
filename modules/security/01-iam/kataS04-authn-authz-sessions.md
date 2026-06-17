# Kata S04 — AuthN vs AuthZ; sessions, tokens, the login you take for granted

> **Track:** Security · **Module:** S1 Identity & Access Management · **Prereqs:** S01 · **Time:** ~35 min
> **Tags:** `security` `iam` `authn` `authz` `sessions` `tokens` `first-principles` `fsi`

## Why it matters

Every access-control failure that ends up in a breach report — credential theft,
privilege escalation, session hijacking — traces back to one of these three
questions: *Who is this? What are they allowed to do? Is this session still valid?*
Architects who can't distinguish authentication from authorization routinely design
systems where the two get tangled: the app that "trusts" the user because they
logged in, without checking whether they're allowed to do *this specific thing*;
the session token that never expires; the service-to-service call that re-uses a
human credential. A CISO will probe all three. Understanding the mechanics from
first principles lets you design the right controls and defend them.

## The mental model

**Three distinct problems** — architects who conflate them cause distinct classes of
vulnerability:

```
  AuthN  (Authentication) — WHO ARE YOU?
         Prove your identity. The system checks a credential.
         "I am Priya. Here is my password / OTP / certificate."

  AuthZ  (Authorization)  — WHAT MAY YOU DO?
         Given identity is proven, what actions are permitted?
         "Priya is allowed to view balances but not approve transfers."

  Session management      — HOW LONG IS THIS VALID?
         After AuthN + AuthZ succeed, how does the system remember it?
         "Your session token expires in 15 minutes; re-authenticate then."
```

These are **sequential and independent**: passing AuthN does not imply AuthZ.
A user who logs in successfully but then accesses a resource they are not
authorized for is an **authorization failure** — a different control, a different
fix.

**AAA** — the industry shorthand (you met this in S01):

```
  Authentication → Authorization → Accounting (audit log of what happened)
```

---

### Authentication: what a "credential" actually is

Credentials fall into **three factors**. MFA means using at least two from
different categories:

```
  Something you KNOW       password, PIN, security question
  Something you HAVE       TOTP app (Google Authenticator), hardware token (YubiKey),
                           SMS OTP, smart card
  Something you ARE        fingerprint, face, voice (biometrics)
```

A password alone is one factor — all eggs in the "know" basket. A stolen password
is undetectable without a second factor. This is why every FSI security policy
mandates MFA for privileged accounts (PCI-DSS Req 8.4, RBI IT Framework §6).

---

### Authorization: the question that comes after identity

The moment AuthN succeeds, the system needs to answer: *for every resource and
every action, is this identity permitted?* Two dominant models (taught fully in S07):

```
  RBAC  Role-Based Access Control
        Identity → assigned Role → Role has Permissions
        "Priya has role 'branch-teller'; that role can view balance, not approve loan."

  ABAC  Attribute-Based Access Control
        Policy evaluated against attributes of identity, resource, environment
        "Priya (dept=retail), accessing account (branch=same-branch), during (time=business-hours)"
```

RBAC is simpler and auditable — the IT head can answer "who has what role."
ABAC is more expressive but harder to audit. Most enterprise systems layer them.

---

### Sessions: the memory of "already proved it"

HTTP is stateless — every request is forgotten. After a user authenticates, the
server needs a way to remember that without re-authenticating on every click. Two
dominant approaches:

```
  Server-side session
  ─────────────────────────────────────────────────────────
  Server stores session state in memory or a database.
  Client holds only a session ID (an opaque random string in a cookie).
  To validate: look up the ID in the session store.

       Browser          App Server        Session Store
         │   POST /login  │                    │
         │──────────────► │                    │
         │   Set-Cookie:  │  store session_id  │
         │   session=abc  │───────────────────►│
         │◄──────────────►│                    │
         │   GET /balance │  look up abc       │
         │──────────────► │───────────────────►│
         │                │  ◄── {user, roles} │
         │ 200 OK         │                    │
         │◄──────────────►│                    │

  Token-based (stateless, e.g. JWT)
  ─────────────────────────────────────────────────────────
  Server issues a signed token; client presents it on each request.
  To validate: verify signature, check claims (expiry, audience).
  No session store required — but revocation is harder.

       Browser         Auth Server         App Server
         │  POST /login  │                    │
         │──────────────►│                    │
         │  JWT: eyJ...  │  sign token        │
         │◄──────────────│                    │
         │  GET /balance │  Authorization:    │
         │    + JWT      │  Bearer eyJ...     │
         │───────────────────────────────────►│
         │               │  verify signature  │
         │  200 OK       │  ◄──────────────── │
         │◄──────────────────────────────────►│
```

**JWT (JSON Web Token)** structure — a common token format (RFC 7519):

```
  header.payload.signature      (each section is base64url-encoded)

  Header:   {"alg":"RS256","typ":"JWT"}
  Payload:  {"sub":"priya@meridian.example",
             "roles":["branch-teller"],
             "exp":1750165200,          ← expiry (Unix timestamp)
             "aud":"balance-api"}       ← intended audience
  Signature: RS256(header.payload, privateKey)
```

The app verifies the signature with the issuer's public key. A valid signature
proves the token was issued by the expected authority and has not been tampered
with. The `exp` claim provides automatic expiry. The `aud` claim prevents a token
issued for one service from being replayed against another.

**What can go wrong** — the three architectural failure modes:

```
  1. AuthN ≠ AuthZ confusion
     System logs in the user then trusts them for everything.
     Fix: AuthN and AuthZ are separate gate checks.

  2. Overly long sessions / non-expiring tokens
     A stolen token is valid indefinitely.
     Fix: short-lived tokens (15 min access token), refresh token rotation,
          absolute session timeout (bank standard: 10–15 min idle).

  3. Missing audience / scope checks
     A JWT issued for the "report API" is accepted by the "transfer API."
     Fix: always validate 'aud' and 'scope' claims.
```

## Worked example

Meridian Bank's mobile-banking backend (GCP, `10.100.0.0/14`) makes API calls to
the core-banking system in HQ-DC1 (`10.10.0.0/16`). Two authentication flows
matter here — human (customer) and machine (service-to-service):

**Flow 1: Customer logs into mobile app**

```
  Customer phone
    │  1. POST /auth/login  { username, password, OTP }
    ▼
  GCP API Gateway (asia-south1)   ← N24 reverse proxy
    │  2. Validates password hash in identity store
    │  3. Validates TOTP (second factor)
    │  4. Issues JWT (RS256, exp=15 min, aud="mobile-api")
    │  5. Issues refresh token (opaque, stored in DB, 8-hour life)
    ▼
  Customer phone holds JWT
    │  6. GET /accounts/balance   Authorization: Bearer eyJ...
    ▼
  Balance API (GCP Cloud Run)
    │  7. Verify JWT signature (public key from JWKS endpoint)
    │  8. Check exp (not expired), aud ("mobile-api" ✓)
    │  9. Check roles claim — "customer" may view balance ✓
    ▼
  Core-banking API call to 10.10.0.0/16 (over Cloud Interconnect / N38)
```

Notice: the customer **never reaches the core directly**. The API gateway
performs AuthN; the balance API performs AuthZ. Two separate gates.

**Flow 2: Service-to-service (balance API → core-banking API)**

This is machine identity — no human in the loop:

```
  Balance API (GCP Cloud Run, service account: balance-api-sa@meridian-gcp.iam.gserviceaccount.com)
    │  1. Request short-lived access token from GCP metadata server
    │  2. GCP signs token asserting identity of balance-api-sa
    │  3. POST https://core.meridian.internal/balance   Authorization: Bearer <GCP token>
    ▼
  Core API gateway (on-prem DMZ, 10.10.20.0/24 CDE boundary — N27)
    │  4. Validate token with GCP Token Introspection endpoint
    │  5. Check: is balance-api-sa authorized to call /balance? (RBAC lookup)
    │  6. Permit (read-only; no transfer endpoints accessible to this SA)
```

A service account is a non-human identity. Least-privilege means this SA has
exactly one permission: read account balance. It cannot initiate transfers, access
cardholder data directly, or create other identities. The CISO's question will be:
*what is the blast radius if this SA's credentials are stolen?*

**PCI-DSS relevance:** The CDE at `10.10.20.0/24` is the segment containing card
data (see N09, N29). The JWT `aud` check ensures mobile tokens cannot be replayed
against the CDE. Service accounts scoped to read-only balance endpoints cannot
access card PANs even if compromised. This is how token scope limits blast radius.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Identity store / directory | Active Directory / LDAP | Cloud Identity / Workspace | AWS IAM Identity Center + Managed AD | Microsoft Entra ID |
| Machine identity (service auth) | Service account / Kerberos | GCP Service Account + Workload Identity | IAM Role (instance profile / IRSA for EKS) | Managed Identity |
| Token issuer (OIDC) | Internal ADFS / IdP | Google as OIDC issuer (`accounts.google.com`) | AWS STS; Cognito for apps | Entra ID (Azure AD) |
| Session store | Redis / DB in app tier | Memorystore (Redis) | ElastiCache (Redis) | Azure Cache for Redis |
| JWT validation (public keys) | Internal JWKS endpoint | `https://www.googleapis.com/oauth2/v3/certs` | Cognito JWKS / STS OIDC doc | Entra ID JWKS (`login.microsoftonline.com`) |
| Secrets / credentials store | HashiCorp Vault / CyberArk | Secret Manager | Secrets Manager | Key Vault |
| Audit log of AuthN/AuthZ | AD audit log / SIEM | Cloud Audit Logs (Admin Activity) | CloudTrail | Entra ID Sign-in Logs + Azure Monitor |

**Key GCP-specific mechanics:**

- A GCP Service Account is both an *identity* (email address format) and a
  *resource* (who may act as it). Confusing the two is the #1 GCP IAM mistake.
- Workload Identity Federation lets workloads outside GCP (on-prem, AWS) exchange
  short-lived cloud-provider credentials for GCP tokens without storing a service
  account key file on disk — eliminating a major credential-leakage risk.
- Cloud IAP (Identity-Aware Proxy) enforces AuthN + AuthZ at the HTTPS layer
  before traffic reaches an app, implementing zero-trust access without a VPN
  (see S26, N37).

## Do it (the exercise)

**Part 1 — Decode a real JWT [laptop]**

```bash
# Generate a test JWT at https://jwt.io or use this local approach:
TOKEN=$(curl -s https://httpbin.org/bearer | python3 -c "import sys,json; print(json.load(sys.stdin).get('token','no token found'))" 2>/dev/null || echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlByaXlhIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")

# Decode the payload (middle part) without a library:
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

Look at the decoded payload. Ask yourself:
- Is there an `exp` claim? What Unix timestamp is it? Is it in the past?
- Is there an `aud` claim? What is the intended audience?
- Is there a `sub` (subject) claim? This is the identity asserted.

**Part 2 — Inspect a TLS session's auth [laptop]**

```bash
# Who does example.com authenticate as?
openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

This is **server-side AuthN**: the server proves *its* identity to you with a
certificate. The client (your browser) is not proving its identity here — that
would be mTLS (see N21, S15).

**Part 3 — Check session cookie flags [laptop]**

```bash
# Inspect what flags a real site's session cookie carries:
curl -sI https://bankofcanada.ca | grep -i 'set-cookie'
# or
curl -sI https://example.com | grep -i 'set-cookie'
```

Look for:
- `HttpOnly` — JavaScript cannot read this cookie (prevents XSS theft).
- `Secure` — Cookie is only sent over HTTPS.
- `SameSite=Strict` or `SameSite=Lax` — reduces CSRF risk.
- `Max-Age` or `Expires` — when does this session end?

A session cookie without `HttpOnly; Secure` is a configuration finding you should
flag in any design review.

**Part 4 — Paper exercise: identify the failure [paper]**

For each scenario, name whether it is an AuthN failure, AuthZ failure, or session
management failure:

1. Attacker guesses a weak password and logs in successfully.
2. Logged-in customer modifies the URL from `/account/12345/balance` to
   `/account/99999/balance` and sees someone else's data.
3. Attacker finds a JWT in a log file from six months ago and uses it successfully.
4. Service account with admin rights is used to deploy a read-only reporting job.
5. User's session is still active 24 hours after they closed their browser.

*(Answers: 1=AuthN, 2=AuthZ (IDOR), 3=session/token management, 4=AuthZ/least-privilege, 5=session management)*

## Say it back (self-check)

1. Define AuthN and AuthZ in one sentence each, and explain why a successful login
   does not automatically mean the user is authorized.
2. Name the three authentication factors and give one example of each.
3. What does a JWT `exp` claim do, and why does its absence matter?
4. What is the `aud` claim in a JWT and what attack does it prevent?
5. For a GCP workload calling an on-prem API, which identity mechanism avoids
   storing a long-lived credential file on the machine?

## Talk to the IT/security head

**Ask:**

- "Where is authentication enforced — at the app, at the API gateway, at the
  identity provider? Are there systems that enforce their own auth separately?"
  *A good answer names one centralised IdP and a clear enforcement point. Red flag:
  "each service handles it differently" — this means no central revocation, no
  central audit trail.*

- "What is the session timeout for privileged access — and is it enforced server-
  side or only client-side?"
  *Good: short timeout (10–15 min for banking), enforced server-side (session
  invalidated in the store). Red flag: "the browser closes the tab" — client-side
  only, trivially bypassed.*

- "Are service accounts scoped to least privilege? Who can create or impersonate a
  service account?"
  *Good: SA permissions are reviewed quarterly, creation is gated by IAM policy,
  no human logs in as a SA. Red flag: "we use one service account for all our
  backend jobs" — a single compromise exposes everything.*

- "How is token revocation handled? If we suspect a breach, how fast can we
  invalidate all sessions?"
  *Good: centralised session store with a revocation API; JWT access tokens are
  short-lived (≤ 15 min) so revocation via refresh token is effective. Red flag:
  long-lived JWTs with no revocation path — attackers keep access for hours.*

- "Where are credentials and secrets stored — config files, environment variables,
  or a managed secret store?"
  *Good: Secret Manager / Vault with rotation, no secrets in code or config files,
  audit log of every access. Red flag: "in the `.env` file on the server" — a path
  to plaintext credential exposure.*

**Red flags to listen for:**
- AuthN and AuthZ described as a single step ("if they're logged in, they can do
  it") — indicates missing authorization checks.
- Tokens or sessions with lifetimes measured in days — a stolen token's window of
  use is directly proportional to its lifetime.
- No central identity provider — secrets and credentials scattered across services
  mean no single place to rotate or revoke.

## Pitfalls & war stories

**The "authn = authz" assumption** is the source of IDOR (Insecure Direct Object
Reference) vulnerabilities — OWASP's Broken Access Control, the #1 finding since
2021. Customer A logs in legitimately, then modifies an account ID parameter to
reach Customer B's data. AuthN passed; AuthZ was never checked. Meridian Bank's
mobile API must validate that the authenticated user's identity matches the
requested account owner on every call — not just at login.

**Non-expiring service account keys** are endemic in GCP projects that migrated
from "just make it work" to production without a security review. A JSON key file
downloaded once and forgotten in a developer's laptop is as dangerous as a master
password. Workload Identity Federation eliminates the key file entirely — if a
customer's GCP project has `serviceAccountKeys.json` files checked into their
repo, that's a P0 finding.

**PCI-DSS Req 8.3.4** mandates that invalid authentication attempts lock the
account or introduce delay after at most 10 attempts. An FSI authentication system
without brute-force protection on the login endpoint is a compliance failure, not
just a security concern.

**The Northwind FMCG pattern** — after an M&A, the acquired "Eastfield Foods"
(see `reference/running-example.md`) has its own AD forest and its own identity
silo. Until those are federated, every cross-company service request is either
"create a second account" (two identities to manage, two to revoke) or "share a
credential" (both are bad). The integration cost of identity is systematically
underestimated in M&A due-diligence.

**Sessions that survive logout** — server-side invalidation is not automatic.
Unless the application explicitly deletes or marks the session as invalid in the
session store on logout, the session ID remains valid and can be reused. This is
measurably common in custom-built banking portals. Test it: log in, copy the
session cookie, log out, replay the cookie.

## Going deeper (optional)

- RFC 7519 — JSON Web Token (JWT) specification: claims, validation rules, signing
  algorithms.
- RFC 6749 — OAuth 2.0 Authorization Framework: the foundation that S05 builds on.
- OWASP ASVS v4.0 Chapter 3 (Session Management) and Chapter 4 (Access Control) —
  the verification requirements architects should demand apps meet.
- NIST SP 800-63B — Digital Identity Guidelines: authenticator assurance levels
  (AAL1/2/3) and the evidence base behind "MFA for privileged access."
- PCI-DSS v4.0 Requirement 8 — Identify Users and Authenticate Access: the exact
  controls mandated for any system storing or processing cardholder data.
- Pairs with N21 (TLS — how the transport layer authenticates the *server* to the
  *client*) and S05 (SSO/federation — how one AuthN event propagates across
  services via SAML/OIDC).

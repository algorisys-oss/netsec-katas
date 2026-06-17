# Kata S05 — SSO & federation: SAML, OIDC, OAuth2 — who issues what

> **Track:** Security · **Module:** S1 Identity & Access Management · **Prereqs:** S04, N21 · **Time:** ~40 min
> **Tags:** `security` `iam` `sso` `federation` `saml` `oidc` `oauth2` `tokens`

## Why it matters

Every enterprise your architects work in has solved the "one login for everything"
problem — or is still fighting it. When a bank's 12,000 staff log into their
laptop once and are then automatically authenticated to the core banking portal,
the HR system, and the GCP console, that is SSO via federation. The protocols that
make this work — SAML, OIDC, OAuth2 — are invisible when correct and catastrophic
when misconfigured (see: broken SAML assertions bypassing MFA; OAuth2 flows leaking
tokens). A CISO worrying about "identity sprawl" or "federated trust misconfiguration"
is worrying about exactly this plumbing. You need to understand who issues what,
and why that matters for your design.

## The mental model

**The problem SSO solves.** Without it, every application manages its own user
store: an employee leaves, IT must revoke 40 separate accounts. With SSO,
applications trust a central authority to vouch for users — revoking one account
cuts all access simultaneously. This is *federation*: a web of delegated trust.

**Three roles appear in every federated flow:**

```
  Identity Provider (IdP)    The authority that authenticates the user and
                             issues assertions/tokens. "I vouch for this person."
                             On-prem: Active Directory + ADFS
                             Cloud: Google Workspace / Azure Entra ID / Okta

  Service Provider (SP)      The application that wants to know who the user is.
                             It trusts the IdP rather than holding its own
                             passwords. Also called Relying Party (RP) in OIDC.

  User / Browser             The human (and their browser or app) that initiates
                             the flow and carries assertions/tokens between parties.
```

**The difference between the three protocols in one sentence each:**

- **SAML 2.0** — an XML-based SSO protocol for browser-based login. The IdP issues
  a signed XML assertion. Dominant in enterprise-to-enterprise and legacy SaaS.
  Defined in the OASIS SAML 2.0 specification (2005).

- **OIDC (OpenID Connect)** — an identity layer built on top of OAuth2. The IdP
  issues a signed JSON Web Token (JWT) called an **ID Token** that identifies the
  user. The modern choice for web and mobile apps. Defined by the OpenID Foundation
  (2014), built on RFC 6749 (OAuth2).

- **OAuth2 (RFC 6749)** — a *delegation* framework, not an authentication protocol.
  It issues **Access Tokens** that authorize a client app to call an API on the
  user's behalf. Often confused with authentication — that confusion causes bugs.

**The key mental separation:**

```
  SAML / OIDC  =  AuthN  →  "Who is this user?"   (Identity protocols)
  OAuth2       =  AuthZ  →  "What is this app allowed to do?"  (Delegation)

  OIDC wraps OAuth2: you run an OAuth2 flow AND get an ID Token (the identity part).
```

**SAML flow (the XML envelope pattern):**

```
  Browser                  SP                     IdP (e.g. Okta)
     │                     │                           │
     │─── GET /app ───────►│                           │
     │◄── 302 redirect ────│ (SP generates AuthnRequest)
     │                     │                           │
     │──────── POST AuthnRequest (XML) ───────────────►│
     │◄──────── user authenticates at IdP ─────────────│
     │◄──────── 302 redirect with SAMLResponse ─────────│
     │─── POST SAMLResponse (signed XML) ─────────────►│
     │                SP validates assertion            │
     │◄── session cookie ──│                           │
```

The SAMLResponse is a **signed XML blob** the browser carries from IdP to SP.
The SP trusts it only if the IdP's signature validates (public-key check against
a pre-registered certificate). The assertion contains: NameID (who the user is),
AttributeStatements (email, group memberships), and a validity window.

**OIDC / OAuth2 flow (the token exchange pattern):**

```
  Browser / App               Authorization Server (IdP)     Resource Server (API)
       │                               │                              │
       │─── GET /authorize?client_id&scope=openid ──►│                │
       │◄── user authenticates; consent ────────────│                │
       │◄── redirect with code (short-lived, 1-use) ─│                │
       │─── POST /token (code + client_secret) ─────►│                │
       │◄── {id_token, access_token, refresh_token} ─│                │
       │                               │                              │
       │─── GET /api/resource   Bearer: access_token ───────────────►│
       │◄── 200 OK ─────────────────────────────────────────────────│
```

Key tokens:

| Token | Format | Who reads it | Purpose |
|-------|--------|--------------|---------|
| ID Token | JWT (signed) | The client app | "Who is the user?" (identity) |
| Access Token | JWT or opaque | The resource server (API) | "What can this app do?" (authorization) |
| Refresh Token | opaque | The client (to the IdP) | Get a new access token when it expires |

**JWT anatomy** (base64url-decoded):

```
  Header.Payload.Signature

  {  "alg": "RS256", "kid": "key-id-for-rotation" }   ← header
  {  "iss": "https://accounts.google.com",             ← payload (claims)
     "sub": "1234567890",                              ← subject (user ID)
     "email": "priya@meridian.example",
     "aud": "core-banking-app",                        ← intended audience
     "exp": 1750000000,                                ← expiry (Unix timestamp)
     "iat": 1749996400  }
  <RS256 signature over header+payload>                ← signature
```

The SP/Resource Server validates: signature (against IdP's public key), `iss`,
`aud`, and `exp`. Forgetting to validate `aud` is a classic misconfiguration:
a token issued for App A can then be replayed against App B.

## Worked example

**Meridian Bank's staff SSO:** The bank's 12,000 employees authenticate once
against **Microsoft Entra ID** (their corporate IdP, synced from on-premises
Active Directory at `10.10.0.0/16` HQ-DC1). Their GCP workloads in
`10.100.0.0/14` use **Workforce Identity Federation** to accept those Entra ID
tokens without a separate Google account per employee.

```
  Meridian Bank employee (browser at 10.40.0.0/16 corp office)
       │
       │  1. Opens GCP Console — redirected to Entra ID (OIDC flow)
       │
       ▼
  Entra ID (IdP — synced from on-prem AD via Entra Connect)
       │  authenticates with corporate password + MFA (see S06)
       │  issues ID Token: { sub, email, groups: ["gcp-developers"] }
       ▼
  GCP Workforce Identity Federation pool
       │  maps "groups: gcp-developers" → IAM role "roles/editor" in project
       │  validates token: iss, aud, sig, exp — all good
       ▼
  GCP Console session — no Google account, no separate password
```

**Meridian Bank's mobile banking app (customer-facing — OAuth2/OIDC):**

The mobile app (`mobile.meridian.example`) needs to call the balance API
(`api.meridian.example/balance`) on behalf of a logged-in customer. This is
OAuth2 *delegation* — the app acts on the customer's behalf, not as the customer.

```
  Mobile app                  Meridian OIDC IdP          Balance API
       │                         (GCP Cloud Run)         (GCP, 10.100.1.0/24)
       │                               │                        │
       │── /authorize?scope=openid+balance.read ──────────────►│
       │◄── customer logs in, taps "Allow" ────────────────────│
       │◄── code=abc123 ───────────────────────────────────────│
       │── /token  code=abc123, client_id, client_secret ─────►│
       │◄── { id_token: <JWT>, access_token: <JWT> } ──────────│
       │                                                         │
       │── GET /balance   Authorization: Bearer <access_token> ─►│
       │                  API validates: sig, aud=balance-api,   │
       │                  scope=balance.read, not expired        │
       │◄── 200 { balance: "₹ 24,500" } ────────────────────────│
```

The scope `balance.read` is the OAuth2 authorization — the customer consented to
the app reading their balance, not transferring funds. A separate scope
`transfer.write` would require explicit consent. This is **the OAuth2 security
model**: narrow, explicit, revocable delegation.

**Northwind FMCG's supplier portal (SAML federation, B2B):**

Northwind's 200 suppliers need access to the procurement portal. Each supplier
has their own IdP (some are Microsoft 365, some are Google Workspace, some are
Okta). Northwind configures the portal as a **SAML SP** and trusts each
supplier's IdP:

```
  Supplier at 192.168.0.0/16 (their own network)
       │
       │  Opens portal.northwind.example
       │  Portal (SP) redirects to supplier's IdP
       │  Supplier IdP issues SAMLResponse:
       │    NameID: supplier-user@vendor.com
       │    Attribute: urn:northwind:role = "procurement-viewer"
       │  Portal accepts the signed assertion — no Northwind password needed
```

This scales to 200 suppliers without Northwind managing 200 sets of credentials.
The risk: if one supplier's IdP is compromised, that trust relationship must be
disabled immediately (see Talk to the IT/security head).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Enterprise IdP | Active Directory + ADFS | Google Workspace / Cloud Identity | IAM Identity Center (built-in or external IdP) | Entra ID (formerly Azure AD) |
| Employee SSO to cloud console | ADFS SAML/OIDC to cloud | Workforce Identity Federation (OIDC/SAML) | IAM Identity Center with external SAML IdP | Entra ID native (same tenant) |
| App-to-API OAuth2 | Custom OAuth2 server / Keycloak | Identity Platform (Firebase Auth) — OIDC/OAuth2 | Amazon Cognito — OAuth2/OIDC user pools | (Azure: TODO) |
| Workload (service) identity | Kerberos / service accounts | Workload Identity Federation (for non-GCP workloads) | IAM roles for EC2/ECS (instance profiles); OIDC federation for GitHub Actions | (Azure: TODO) |
| Service-to-service AuthZ | Kerberos / mTLS | GCP service accounts + `roles/` IAM bindings | IAM roles + STS assume-role | (Azure: TODO) |
| SAML SP configuration | ADFS relying party trust | Identity Platform SAML provider | IAM Identity Center SAML application | (Azure: TODO) |
| Token inspection / JWKS endpoint | Internal PKI / LDAP | `https://accounts.google.com/.well-known/openid-configuration` | Cognito JWKS endpoint per user pool | (Azure: TODO) |

**GCP note:** Workforce Identity Federation is GCP's mechanism to accept third-party
OIDC or SAML tokens (e.g. from Entra ID or Okta) and map them to GCP IAM
bindings without requiring a Google account. The mapping is: `principal://iam.googleapis.com/locations/global/workforcePools/<pool>/subject/<sub>`.

**AWS note:** IAM Identity Center (formerly AWS SSO) federates with external SAML
2.0 IdPs or OIDC providers. For workloads, AWS uses STS `AssumeRoleWithWebIdentity`
to exchange an OIDC token for temporary AWS credentials — the same mechanism GitHub
Actions uses to deploy without stored AWS keys.

## Do it (the exercise)

**Part 1 — decode a real JWT [laptop]**

Obtain any OIDC token from a public test IdP or Google's OAuth2 playground
(`https://developers.google.com/oauthplayground`):

```bash
# Base64url-decode the payload (middle section between the dots).
# base64url is unpadded, so pad to a multiple of 4 before decoding.
TOKEN="<paste your JWT here>"
PAYLOAD=$(echo $TOKEN | cut -d. -f2)
pad() { local s="$1"; printf '%s%s' "$s" "$(printf '%*s' $(( (4 - ${#s} % 4) % 4 )) '' | tr ' ' '=')"; }
pad "$PAYLOAD" | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -m json.tool
```

Check: `iss`, `aud`, `exp`, `sub`. Is `exp` in the future?
Convert `exp` to a human timestamp (reusing the `pad` helper above):
```bash
date -d @$(pad "$PAYLOAD" | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['exp'])")
```

**Part 2 — inspect a SAML assertion structure [laptop / paper]**

A SAML assertion is an XML document. Walk through the structure mentally:

```xml
<samlp:Response ...>
  <saml:Issuer>https://idp.northwind.example</saml:Issuer>
  <ds:Signature>...</ds:Signature>    <!-- XML signature over the assertion -->
  <saml:Assertion>
    <saml:Issuer>https://idp.northwind.example</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="emailAddress">user@vendor.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-06-17T10:00:00Z"
                     NotOnOrAfter="2026-06-17T10:10:00Z">
      <saml:AudienceRestriction>
        <saml:Audience>https://portal.northwind.example</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="urn:northwind:role">
        <saml:AttributeValue>procurement-viewer</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

Identify: the Issuer, the NameID, the validity window (`NotBefore` / `NotOnOrAfter`),
the Audience, and the attribute that maps to an application role.

**Part 3 — GCP Workforce Identity Federation walk-through [needs cloud account]**

1. In GCP IAM → Workforce Identity Pools, create a pool and an OIDC provider
   pointing to your test IdP's `issuer-uri`.
2. Configure an attribute mapping:
   `google.subject = assertion.sub`
   `attribute.groups = assertion.groups`
3. Grant an IAM binding:
   `gcloud projects add-iam-policy-binding PROJECT \
     --member="principalSet://iam.googleapis.com/.../attribute.groups/gcp-developers" \
     --role="roles/viewer"`
4. Exchange a test OIDC token for a GCP credential:
   `gcloud iam workforce-pools create-cred-config ... --output-file=creds.json`
5. Confirm the mapped principal appears in GCP audit logs (Cloud Audit Logs →
   `principalEmail` field will show the federated identity).

## Say it back (self-check)

1. What is the difference between an IdP and a Service Provider? Which one holds
   the user's password?
2. SAML and OIDC are both identity protocols. What format does each use for the
   assertion/token it issues?
3. OAuth2 is *not* an authentication protocol. What is it, and why does misusing it
   as authentication create a vulnerability?
4. Name the three fields in a JWT payload that an SP/API *must* validate and explain
   what attack skipping each one enables.
5. In Meridian Bank's setup, why does Workforce Identity Federation remove the need
   for Google accounts for staff, and what does GCP check before granting access?

## Talk to the IT/security head

**Ask:**
- "Who is your enterprise IdP, and is it the authoritative source for all access,
  including cloud consoles?" *(reveals identity sprawl — multiple IdPs, local
  cloud accounts, or service accounts with long-lived keys are the real risk)*
- "How is SSO integrated with MFA — is MFA enforced at the IdP so the SP can't
  bypass it?" *(a SP that has its own MFA bypass, or accepts SAML assertions from
  an IdP that allows MFA skip, defeats the control)*
- "What happens when an employee is terminated — how quickly are their tokens and
  sessions revoked?" *(token lifetimes matter: a 1-hour access token keeps working
  for up to an hour after revocation; a 24-hour token is a risk)*
- "Do you have a list of all SAML/OIDC trust relationships configured — every SP
  and every external IdP? When was it last audited?" *(federation sprawl is the
  new privileged access problem — an old, forgotten trust to an acquired company's
  IdP is a live attack surface)*
- "Are any cloud workloads using long-lived service account keys instead of
  Workload Identity Federation?" *(keys are a CISO's nightmare: rotatable only by
  policy, extractable, no expiry by default)*

**A good answer sounds like:** "Our IdP is Entra ID, MFA is enforced at the IdP
with Conditional Access, token lifetime policy caps access tokens at 1 hour and
we use continuous access evaluation to revoke mid-session. We audit SAML trusts
quarterly. No service account key files in our CI/CD — we moved to Workload
Identity Federation last year."

**Red flags:**
- "Each app team manages their own logins" — no central identity; revocation is
  manual, slow, and will fail during an incident.
- "We use SAML but aren't sure if MFA is enforced before the assertion is issued"
  — a critical gap: the SP has no way to verify MFA happened at the IdP without
  inspecting the `AuthnContextClassRef` in the assertion.
- "Our service accounts have keys we rotate annually" — long-lived keys are the
  risk regardless of cadence (they can be extracted and replayed until rotated);
  best practice is no long-lived keys at all (Workload/Workforce Identity
  Federation). If a rotation cadence is set, it should come from internal
  policy / a defined cryptoperiod, not from a presumed regulatory "minimum."
- Unable to enumerate all SAML/OIDC trust relationships on the spot — federation
  sprawl is an unmanaged attack surface.

## Pitfalls & war stories

- **The OAuth2-as-authentication bug.** A developer uses an OAuth2 access token
  to "authenticate" the user: "if the token is valid, let them in." But the access
  token says nothing about *who* issued it to whom. A token issued to App A can be
  replayed at App B. The fix: use the ID Token (OIDC), which has an `aud` claim
  tying it to a specific application. Validate `aud` — always.

- **The SAML NotOnOrAfter clock skew trap.** SAML assertions have a strict
  validity window (often 5–10 minutes). If the SP and IdP clocks differ by more
  than 30 seconds, assertions arrive "expired" and users can't log in — especially
  during NTP drift events. At Northwind, a plant-floor server with a drifted clock
  rejected all supplier logins for two hours before the root cause was identified.
  **Configure NTP everywhere, and build clock-skew tolerance into SAML validation.**
  The SAML 2.0 Core spec treats `NotBefore` / `NotOnOrAfter` as absolute times and
  leaves skew tolerance to implementations; a 3–5 minute allowance is common
  implementation practice (e.g. Shibboleth, ADFS).

- **Overly broad attribute mappings.** In GCP Workforce Identity Federation,
  mapping `google.groups = assertion.groups` and then granting a group
  `roles/owner` project-wide is a privileged-access explosion waiting to happen.
  Map to the narrowest IAM binding. At Meridian Bank, a misconfigured mapping
  granted all Entra ID users (including contractors) `roles/bigquery.dataViewer`
  on a project containing customer analytics — caught in a quarterly IAM review,
  not an incident (fortunately).

- **The forgotten B2B federation trust.** Northwind acquired Eastfield Foods
  (see `reference/running-example.md`). Two years later, the SAML trust to
  Eastfield's decommissioned IdP was never removed from the portal. A recycled
  Eastfield domain, picked up by an external party, could potentially be used to
  reconfigure that IdP and re-assert into Northwind's procurement portal. Trust
  relationships outlive the business relationships that created them — audit and
  expire them.

- **Token lifetime vs revocation lag.** JWTs are stateless and self-validating.
  Once issued, a resource server validates only the signature and expiry — it
  does not call back to the IdP to confirm the user's account is still active.
  A terminated employee's access token works until `exp`. Solutions: short
  lifetimes (e.g. 15 minutes for sensitive APIs), token introspection endpoints, or
  GCP/AWS continuous access evaluation. At Meridian Bank, capping access-token
  lifetime at 15 minutes for sensitive APIs is an internal design choice, not a
  regulatory mandate. (Note: PCI-DSS's 15-minute rule — v4.0 Req 8.2.8 — is an
  *idle session timeout* requiring re-authentication after inactivity, not an
  OAuth2 access-token TTL; don't conflate the two.)

## Going deeper (optional)

- SAML 2.0 Core specification — OASIS, 2005. The canonical reference for assertion
  structure and bindings.
- RFC 6749 — OAuth2 Authorization Framework. The base spec; pairs with RFC 6750
  (Bearer Token Usage).
- OpenID Connect Core 1.0 — openid.net/specs/openid-connect-core-1_0.html
- RFC 7519 — JSON Web Token (JWT). The format of ID Tokens and most access tokens.
- RFC 7517 — JSON Web Key (JWK). The format of public-key sets at the JWKS endpoint.
- NIST SP 800-63B — Digital Identity Guidelines: the US federal standard for
  assurance levels, directly referenced by RBI-style audit frameworks.
- GCP Workforce Identity Federation docs — cloud.google.com/iam/docs/workforce-identity-federation
- AWS IAM Identity Center — docs.aws.amazon.com/singlesignon
- Pairs with: S04 (AuthN vs AuthZ, sessions), S06 (MFA enforcement at IdP), S07
  (RBAC/ABAC — how group claims map to roles), N21 (TLS — the channel that
  protects token transmission).

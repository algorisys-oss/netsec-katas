# Kata N21 — TLS/SSL: handshake, certs, PKI, mTLS, termination

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N03, N20 · **Time:** ~40 min
> **Tags:** `tls` `pki` `certificates` `mtls` `encryption-in-transit` `l7-application` `security` `networking`

## Why it matters

Every HTTPS request your mobile-banking app makes, every API call between
microservices, every cloud-to-on-prem connection rides on TLS. When the IT head
asks "is it encrypted in transit?" they mean TLS — and they are really asking
three separate questions: *is it encrypted?* (confidentiality), *can I verify
who I'm talking to?* (authentication), and *could anyone tamper with it?*
(integrity). A misplaced termination point, an expired certificate, or a missing
chain trust can silently break any of those three. Knowing how TLS actually works
lets you ask the right design question before the auditor does.

Pairs with S09 (crypto primitives), S10 (PKI deep dive), and S15 (API security /
mTLS). The certificate concepts introduced here are used in N22–N24 (load
balancers and proxies) and in S05 (SSO / OIDC federation).

## The mental model

### What TLS does (and doesn't do)

TLS sits on top of TCP (port 443 for HTTPS; see N20 for the TCP handshake that
comes first). It gives you three properties:

```
  Confidentiality  →  session data is encrypted; observers see ciphertext
  Integrity        →  any tampering is detected (HMAC / AEAD tag)
  Authentication   →  the server proves it holds the private key for a cert
                       signed by a CA your browser trusts
```

TLS does **not** authenticate the client by default — that requires mTLS (below).

### Certificates and the chain of trust

A certificate is a signed statement: "I, a Certificate Authority (CA), assert
that the public key in this document belongs to the domain `api.meridian.example`."

```
  ROOT CA  (self-signed; pre-installed in OS/browser trust stores)
     └── signs ──▶  INTERMEDIATE CA  (issued by Root, not used daily)
                          └── signs ──▶  LEAF / SERVER CERT
                                          subject: api.meridian.example
                                          public key: (RSA-4096 or EC P-256)
                                          SANs: api.meridian.example
                                          validity: not before / not after
                                          serial number, signature algorithm, OCSP URL
```

The browser/client walks the chain from the leaf up to a trusted root. If any
link is broken — expired, revoked, wrong hostname in Subject Alternative Name —
the connection fails with a certificate error.

A certificate is NOT the private key. The private key stays on the server and
never leaves. The cert is public; the key is secret.

### The TLS 1.3 handshake (what actually happens)

TLS 1.3 (RFC 8446, current standard; TLS 1.2 still widely deployed) completes
in **1 RTT** before any application data flows. Here is what happens after the
TCP 3-way handshake completes (see N20):

```
  Client                                               Server
    │                                                    │
    │── ClientHello ──────────────────────────────────▶  │
    │   (supported cipher suites, TLS 1.3, key_share,   │
    │    random nonce, SNI: api.meridian.example)         │
    │                                                    │
    │  ◀──────────────────── ServerHello ────────────────│
    │                        (chosen cipher, key_share,  │
    │                         random nonce)              │
    │  ◀──────────────────── {Certificate} ─────────────│
    │                        (leaf cert + intermediates) │
    │  ◀──────────────────── {CertificateVerify} ────────│
    │                        (signature over handshake   │
    │                         transcript, proves priv-key│
    │                         ownership)                 │
    │  ◀──────────────────── {Finished} ─────────────────│
    │                                                    │
    │── Finished ─────────────────────────────────────▶  │
    │                                                    │
    │══════════════ Application data (encrypted) ═══════ │
```

Key things to notice:

1. **Key exchange** uses ephemeral Diffie-Hellman (ECDHE). Neither party sends
   the session key over the wire — both sides independently compute the same
   shared secret from each other's public key shares. This gives **forward
   secrecy**: even if the server's private key is later stolen, past sessions
   cannot be decrypted.

2. **SNI (Server Name Indication)** in ClientHello tells a shared-IP server
   (e.g. a load balancer) which certificate to present. Without SNI, one IP
   can only serve one cert. With SNI, a single load balancer IP can serve
   thousands of domains.

3. The certificate **proves identity** via the CA's signature; the
   CertificateVerify message proves **private key possession** by signing the
   handshake transcript. The client doesn't just trust the cert — it verifies
   the server can sign with the corresponding private key.

4. Everything in `{}` is already encrypted with the derived handshake keys.

5. **TLS 1.2** required 2 RTT before data; TLS 1.3 cut that to 1 RTT (and
   optionally 0-RTT for reconnects, with replay-attack caveats). Always ask
   which version is in use; TLS 1.0 and 1.1 are deprecated (RFC 8996).

### mTLS — mutual TLS

In standard TLS only the server authenticates. In **mTLS** (mutual TLS) the
client also presents a certificate during the handshake. Schematic (TLS 1.3:
the server's `CertificateRequest`, `Certificate`, `CertificateVerify` and
`Finished` all travel in one encrypted flight after `ServerHello` + `key_share`,
as in the 1-RTT diagram above):

```
  Client                                            Server
    │── ClientHello (key_share) ──────────────────▶  │
    │  ◀── ServerHello (key_share) + {Cert} + ────── │
    │      {CertificateRequest} + {CertificateVerify}│  ← server asks client for cert
    │      + {Finished}                              │     (all one encrypted flight)
    │── {Certificate (client cert)} ───────────────▶ │
    │── {CertificateVerify} ───────────────────────▶ │
    │── {Finished} ────────────────────────────────▶ │
```

(`{}` = encrypted under the derived handshake keys.)

The server now knows *which service or user* is connecting, not just that the
connection is encrypted. mTLS is the standard for service-to-service
authentication inside a cluster (see S15) and is required for some PCI-DSS
control paths.

### TLS termination points — the architect's decision

Where TLS ends matters enormously. Three patterns:

```
  Pattern A — Terminate at the edge (most common)
  Internet → [Load Balancer / CDN edge — TLS terminates here]
             → backend servers on plain HTTP (or re-encrypted)

  Pattern B — End-to-end TLS (re-encrypt at every hop)
  Internet → [LB — TLS terminates + re-encrypts] → [backend — TLS terminates]
             (two separate TLS sessions; each hop verified independently)

  Pattern C — TLS passthrough (LB forwards without decrypting)
  Internet → [LB — forwards TCP blindly] → [backend — TLS terminates]
             (LB cannot inspect HTTP, cannot inject headers, cannot load-balance by URL)
```

**The security question:** between the termination point and the backend, who
can see plaintext? Pattern A with unencrypted backend traffic is acceptable
only if the path is within a tightly controlled, verified private network.
PCI DSS Requirement 4.2.1 mandates "strong cryptography" for cardholder data
transmitted *over open, public networks* — it does not, by its text, require
re-encryption of internal traffic on a trusted data-center network. That said,
re-encrypting internal CDE traffic (Pattern B) is widely recommended as
defense-in-depth and good practice, and many FSI security teams require it for
cardholder data even inside the DC.

## Worked example

### Meridian Bank: mobile-banking API call

Meridian's mobile app calls `https://api.meridian.example` — hosted on GCP in
`10.100.0.0/14` (see `reference/running-example.md`). The cert chain:

```
  DigiCert Global Root CA  (pre-trusted in Android/iOS/browsers)
    └── DigiCert TLS RSA SHA256 2020 CA1  (intermediate, 2-year validity)
          └── *.meridian.example  (wildcard leaf, 1-year validity)
                subject: CN=*.meridian.example
                SANs:    DNS:*.meridian.example, DNS:meridian.example
                validity: 2025-03-01 to 2026-03-01
                signature: sha256WithRSAEncryption
                key: EC P-256 (preferred — smaller, faster than RSA-4096)
```

The wildcard `*.meridian.example` covers `api.meridian.example` and
`mobile.meridian.example` but **not** `api.payments.meridian.example` (wildcards
cover exactly one label).

Inspecting it on the command line [laptop]:

```bash
openssl s_client -connect api.meridian.example:443 \
                 -servername api.meridian.example </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

Expected output shape (real domain will differ):
```
subject=CN = *.meridian.example
issuer=C = US, O = DigiCert Inc, CN = DigiCert TLS RSA SHA256 2020 CA1
notBefore=Mar  1 00:00:00 2025 GMT
notAfter =Mar  1 23:59:59 2026 GMT
X509v3 Subject Alternative Name:
    DNS:*.meridian.example, DNS:meridian.example
```

### Certificate revocation

If Meridian's private key is compromised, the cert must be revoked. Two
mechanisms:

- **CRL** (Certificate Revocation List, RFC 5280) — the CA publishes a signed
  list of revoked serial numbers. Clients download the list; it can be stale.
- **OCSP** (Online Certificate Status Protocol, RFC 6960) — client queries the
  CA's OCSP responder in real time for a single cert's status. Adds latency.
- **OCSP Stapling** — the server fetches its own OCSP response and staples it to
  the TLS handshake. The client gets revocation status with zero extra latency;
  the OCSP responder is not queried per-connection. Best current practice.

### Internal PKI for service-to-service (mTLS at Meridian)

Between Meridian's microservices — say `payments-service` calling
`ledger-service`, both inside `10.100.0.0/14` on GCP — Meridian should not rely
on public CAs. Instead:

```
  Meridian Internal Root CA  (offline, HSM-backed; never on a server)
    └── Meridian Issuing CA  (online; issues short-lived service certs)
          ├── payments-service.internal.meridian.example (SPIFFE-format SVID)
          └── ledger-service.internal.meridian.example
```

Short-lived certificates (24 h or less) reduce the value of revocation lists
because certs expire before an attacker can abuse a stolen key. This is the model
used by service meshes (Istio, Linkerd) and GCP Certificate Authority Service.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem / self-managed | GCP | AWS | Azure |
|---------|----------------------|-----|-----|-------|
| Public cert for HTTPS | Buy from DigiCert, Let's Encrypt ACME | **Google-managed SSL certs** (auto-provisioned on Cloud LB, free) | **AWS Certificate Manager (ACM)** — free, auto-renews on ALB/CloudFront | **Azure App Service Managed Certificate** / App Gateway cert (Azure: TODO) |
| Private / internal CA | On-prem PKI (ADCS, EJBCA) | **Certificate Authority Service (CAS)** — managed private CA, hierarchy supported | **AWS Private CA** (ACM PCA) — managed private CA | **Azure Private CA** via App Service or DigiCert integration (Azure: TODO) |
| mTLS enforcement | Hardware LB (F5, A10), nginx, Envoy | Cloud LB → backend mTLS; **Cloud Service Mesh** / **Traffic Director** | ALB mutual TLS (GA since 2023); **API Gateway** mTLS | **API Management** mutual cert auth; App Gateway (Azure: TODO) |
| TLS termination at edge | HAProxy, nginx, F5 in DMZ | Cloud HTTPS Load Balancer (global anycast, L7) | Application Load Balancer (ALB); CloudFront | Azure Application Gateway / Front Door (Azure: TODO) |
| TLS passthrough | L4 device (TCP LB) | **Cloud TCP/SSL Proxy** (SSL Proxy for TCP 443) | **Network Load Balancer (NLB)** TCP passthrough | Azure Load Balancer L4 (Azure: TODO) |
| Certificate lifecycle / auto-renewal | Manual (cron + certbot) or ACME | Google-managed certs auto-renew; CAS issues short-lived certs | ACM auto-renews; ACM PCA for private | (Azure: TODO) |
| Cipher policy / TLS version control | Cipher string on nginx/F5 | **SSL Policy** on Cloud LB (MODERN / RESTRICTED / COMPATIBLE) | **Security Policy** on ALB/CloudFront | (Azure: TODO) |

**Key GCP point:** Google-managed SSL certificates on Cloud HTTPS Load Balancer
provision and renew automatically via Google's own ACME-like process — no
certificate management operations, no renewal incidents. The cert is tied to the
load balancer, not the VM, so rotation is invisible to the backend.

**Key AWS point:** ACM certificates cannot be exported (the private key is never
accessible). They can only be used on AWS services (ALB, CloudFront, API Gateway,
etc.). For on-prem termination endpoints you still need a cert from a public CA
or your own PKI.

## Do it (the exercise)

### Step 1 — inspect a real certificate [laptop]

```bash
# Inspect the TLS cert and chain for any HTTPS site
openssl s_client -connect example.com:443 \
                 -servername example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep -E "Subject:|Issuer:|Not (Before|After)|DNS:"
```

Answer these questions from the output:
- Who is the issuer (CA)?
- Is there a SAN for the domain? Wildcards?
- How many days until expiry?
- What is the signature algorithm?

### Step 2 — walk the full chain [laptop]

```bash
openssl s_client -connect example.com:443 \
                 -servername example.com \
                 -showcerts </dev/null 2>/dev/null \
  | grep -E "^(subject|issuer)="
```

You should see the leaf cert and one or two intermediates. Identify which is the
root (issuer = subject).

### Step 3 — check TLS version and cipher [laptop]

```bash
# Test what TLS versions a server will accept
openssl s_client -connect example.com:443 \
                 -servername example.com \
                 -tls1_2 </dev/null 2>/dev/null | grep "Protocol  :"

openssl s_client -connect example.com:443 \
                 -servername example.com \
                 -tls1_3 </dev/null 2>/dev/null | grep "Protocol  :"
```

A modern server should accept TLS 1.3 and ideally reject TLS 1.1 (deprecated,
RFC 8996). The cipher for TLS 1.3 will be one of TLS_AES_128_GCM_SHA256,
TLS_AES_256_GCM_SHA384, or TLS_CHACHA20_POLY1305_SHA256 — all AEAD ciphers.

### Step 4 — check OCSP stapling [laptop]

```bash
openssl s_client -connect example.com:443 \
                 -servername example.com \
                 -status </dev/null 2>/dev/null \
  | grep -A3 "OCSP response"
```

Look for `OCSP Response Status: successful` and `Cert Status: good`. If you see
`no response sent`, OCSP stapling is not configured — note this as a gap.

### Step 5 — paper exercise: map the termination points

Draw (on paper) the path for a request from a Meridian mobile app to the
core banking API in HQ-DC1 (`10.10.0.0/16`). Mark:
- Where does TLS terminate at each hop?
- Is there a new TLS session opened for the next hop?
- Who can see plaintext at each termination point?

## Say it back (self-check)

1. In a TLS 1.3 handshake, which side initiates, and what is agreed in the first
   round-trip before any application data flows?
2. What does forward secrecy mean, and which key-exchange mechanism provides it?
3. A wildcard cert `*.meridian.example` — name two hostnames it covers and one it
   does not.
4. What is the difference between Pattern A (terminate at LB, plain to backend)
   and Pattern B (re-encrypt) in terms of compliance risk?
5. What does mTLS add that standard TLS does not, and when would you require it?

## Talk to the IT/security head

**Ask:**

- "Where does TLS terminate — at the load balancer, at the application, or
  both?" *(determines who sees plaintext and what can be inspected at each hop)*
  A good answer names the exact device and whether traffic is re-encrypted or
  left plain between the LB and the backend.

- "How are certificates issued, rotated, and who is alerted when one is about
  to expire?" *(expired certs are a top-10 cause of outage; good shops have
  automated renewal and a 30-day expiry alert)*
  Red flag: "We renew them manually when someone notices." That means an outage
  every 1–2 years on average.

- "Do you run an internal CA for service-to-service traffic, or are you using
  public certs internally?" *(using public certs internally leaks host names to
  CT logs; an internal CA is the right answer for private services)*

- "Is TLS 1.0 or 1.1 still permitted anywhere?" *(both are deprecated by
  RFC 8996; early TLS (1.0/1.1) has been prohibited by PCI DSS since the 2018
  migration deadline (v3.1/3.2) and remains banned in v4.0; check for legacy
  clients that haven't been upgraded)*
  Red flag: "We have some older systems that need TLS 1.0." That is a
  PCI DSS finding and a risk item.

- "For the connection from GCP to HQ-DC1, is the traffic re-encrypted inside
  the Cloud Interconnect / VPN tunnel, or is the interconnect itself the only
  protection?" *(defense in depth: the network link is one layer; TLS provides
  the layer above it)*

**Red flags to listen for:**

- "All traffic is encrypted" with no specifics on termination points — this is
  usually Pattern A with plain HTTP between the LB and the backend, which may
  fail a PCI audit.
- Self-signed certs in production with no revocation path.
- Certificate expiry alerts going to a shared mailbox nobody reads.
- No SNI enforcement — all backends sharing an IP with a catch-all cert.

## Pitfalls & war stories

**Expired certificates cause more outages than most attacks.** Google, LinkedIn,
and payment processors have all had public cert-expiry incidents. The fix is
automated renewal (Let's Encrypt / ACM / Google-managed) and expiry monitoring
with ≥ 30-day lead time. At Meridian-style FSI clients, a 30-day change-control
lead time means a cert must trigger an alert at 60 days to be safe.

**Termination at the CDN but plain HTTP to the origin.** A common pattern: the
public site shows a green padlock, but the path from CDN edge to the origin server
runs plain HTTP. PCI-DSS Requirement 4.2.1 does not care where the green padlock
lives — it cares where cardholder data travels. If the CDN-to-origin path is
unencrypted, Meridian's CDE is exposed, even though browsers show HTTPS.

**Wildcard certs and blast radius.** A single `*.meridian.example` wildcard cert,
if its private key is compromised, can impersonate *any* subdomain. For high-risk
services (the PCI CDE, the admin console), a dedicated per-hostname cert limits
blast radius. Many FSI security teams now forbid wildcards in PCI scope entirely.

**Internal services on public CAs leak hostnames to Certificate Transparency logs.**
Every certificate issued by a public CA is logged to CT logs (RFC 6962) and is
publicly searchable. If `ledger.internal.meridian.example` appears in a CT log,
an attacker learns Meridian's internal service topology. Use an internal CA for
internal services.

**mTLS complexity: who manages client certs?** mTLS is elegant in theory and
operationally complex in practice. Every service needs a client cert, those certs
must be rotated, and the CA that issues them must be trusted by every mTLS
server. In microservices this is typically handled by a service mesh (Istio,
Linkerd) that injects certs via the control plane — but that adds its own
operational overhead the platform team must be ready to own.

**TLS version drift in FMCG environments.** Northwind's plant-floor systems and
older barcode scanners may run embedded OS with TLS 1.0 clients hardcoded. When
the corporate IT team disables TLS 1.0 on the WMS API (to pass a PCI scan), the
plant stops processing shipments. Always audit TLS client versions at OT/IT
boundaries before enforcing TLS version policy.

## Going deeper (optional)

- **RFC 8446** — TLS 1.3 specification (readable introduction in Appendix A).
- **RFC 8996** — Deprecation of TLS 1.0 and 1.1.
- **RFC 6960** — OCSP; **RFC 6066** — OCSP stapling via the `status_request`
  TLS extension (the standard single-cert mechanism referenced by TLS 1.3);
  **RFC 6961** — `status_request_v2`, the less-deployed multiple-certificate
  status variant.
- **RFC 5280** — X.509 certificate and CRL profile.
- **RFC 6962** — Certificate Transparency; the CT log explorer: https://crt.sh
- **NIST SP 800-52 Rev. 2** — Guidelines for TLS implementations (US Gov/FIPS).
- **PCI-DSS v4.0 Requirement 4.2** — TLS requirements for cardholder data in transit.
- GCP: [Certificate Authority Service docs](https://cloud.google.com/certificate-authority-service)
- AWS: [ACM documentation](https://docs.aws.amazon.com/acm/latest/userguide/)
- Deepens into: S09 (crypto primitives — symmetric, asymmetric, ECDHE), S10
  (PKI and cert lifecycle in detail), S15 (mTLS in API security), N22
  (load-balancer TLS offload), N24 (reverse proxies and re-encryption).

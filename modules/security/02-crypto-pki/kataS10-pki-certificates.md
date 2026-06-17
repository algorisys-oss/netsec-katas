# Kata S10 — PKI & certificates deep dive: chains, CAs, revocation, rotation

> **Track:** Security · **Module:** S2 Cryptography, PKI & key management · **Prereqs:** S09, N21 · **Time:** ~40 min
> **Tags:** `security` `pki` `certificates` `revocation` `key-management` `l7-application` `fsi` `meridian-bank`

## Why it matters

Every TLS session Meridian Bank's mobile app makes, every mTLS call between
microservices, every code-signing check in the CI pipeline — all of them rest on
one question the OS or library asks silently: *do I trust the entity that signed
this certificate, and is that certificate still valid?* When the chain of trust
breaks — an expired cert, a revoked CA, a rotation that missed one service — the
result is either a hard outage (the app refuses to connect) or a silent security
failure (a fake cert is trusted). At a bank, either outcome triggers an incident.
The architect who can reason about certificate chains, CA hierarchies, and rotation
cadence can prevent both kinds of failure before they reach production.

## The mental model

### What a certificate actually is

A certificate (X.509 format, defined in RFC 5280) is a **signed statement** from
a trusted authority: *"I, the CA, attest that the public key in this document
belongs to the entity named here."*

It contains:
- The **subject** — who the cert was issued to (e.g. `CN=mobile.meridian.example`)
- The **public key** of the subject (the key the server will use)
- The **issuer** — the CA that signed this cert
- **Validity period** — `Not Before` / `Not After` timestamps
- The **signature** — the CA's signature over the above, made with the CA's private key
- **Extensions** — Subject Alternative Names (SANs), key usage, CRL/OCSP endpoints

A relying party (browser, OS, service mesh) only needs the CA's public key to
verify the signature. That key is distributed as the **CA certificate** — either
shipped with the OS/browser, or installed by an enterprise admin.

### The chain of trust (certificate hierarchy)

No production CA signs end-entity certs directly from a root. The hierarchy has
three tiers:

```
  Root CA
  ┌────────────────────────────────────────────┐
  │  Self-signed. Offline, air-gapped, HSM.    │
  │  Valid 20–25 years. Distributed via OS/    │
  │  browser trust stores. Signs only          │
  │  Intermediate CA certs.                    │
  └──────────────────┬─────────────────────────┘
                     │ signs
                     ▼
  Intermediate CA (Issuing CA)
  ┌────────────────────────────────────────────┐
  │  Online (or near-line). Signs end-entity   │
  │  certs daily. Valid 3–5 years.             │
  │  If compromised, root can revoke it.       │
  │  Meridian Bank: one per trust domain       │
  │  (public-web CA, internal-services CA).    │
  └──────────────────┬─────────────────────────┘
                     │ signs
                     ▼
  End-entity certificate (leaf cert)
  ┌────────────────────────────────────────────┐
  │  The cert a TLS server presents.           │
  │  Valid 90 days (Let's Encrypt) to 1 year   │
  │  (public CAs max since 2020).              │
  │  Subject: the hostname or service name.    │
  └────────────────────────────────────────────┘
```

The server presents both its leaf cert **and** the intermediate cert(s) in the
TLS handshake — together called the **certificate chain**. The client validates
it upward to a root it already trusts.

Why the three-tier split? The root is the crown jewel. Keeping it **offline**
means a compromise of the issuing CA can be contained: revoke the intermediate,
issue a new one, re-issue leaf certs — without touching the root.

### Trust stores

A trust store is a bundle of trusted Root CA certificates. There are several:

```
  OS trust store      — Windows Cert Store, macOS Keychain, Linux /etc/ssl/certs/
  Browser trust store — Chromium/Firefox each maintain their own (differ from OS)
  JVM trust store     — cacerts file (Java apps use this, not the OS store)
  Container image     — inherits from the base image (must be updated!)
  Service mesh CA     — Istio/Envoy use a custom mesh-internal root
```

The enterprise PKI implication: when Meridian Bank deploys an internal CA, the
root must be **pushed to every trust store** where services will rely on it —
OS, JVM, container images, monitoring agents. Forgetting one is the most common
cause of "curl works, the Java app doesn't" tickets.

### Revocation: when a cert must be killed before expiry

Revocation is needed when a cert's private key is compromised, an employee leaves,
or the cert was misissued. Two mechanisms exist:

**CRL (Certificate Revocation List)** — RFC 5280
- The CA periodically publishes a signed list of revoked serial numbers.
- Clients download the full list (can be MB-scale for busy CAs).
- Stale: the CRL is cached and may be minutes-to-hours old at check time.
- URL included in cert: `CRL Distribution Points` extension.

**OCSP (Online Certificate Status Protocol)** — RFC 6960
- Client sends a single serial number query to the CA's OCSP responder.
- Gets a signed `good` / `revoked` / `unknown` response in real time.
- Adds a network round-trip to every new TLS handshake (latency concern).
- OCSP Stapling eliminates this: the server pre-fetches the OCSP response and
  attaches it to the TLS handshake — client gets revocation status with no
  extra round-trip.

```
  Without stapling:                With OCSP Stapling:
  Client ──TLS──► Server           Client ──TLS──► Server
  Client ──OCSP query──► CA        (OCSP response already attached)
  Client ◄── OCSP response ── CA   Client validates instantly
  (adds 50–200 ms per handshake)   (zero extra RTT)
```

**Soft-fail vs hard-fail**: if the OCSP responder is unreachable, most browsers
*soft-fail* (allow the connection anyway). A bank doing high-assurance mTLS
should configure *hard-fail* to block on OCSP errors.

**Certificate Transparency (CT)** — RFC 6962
Not revocation, but detection: every publicly-trusted CA must submit issued certs
to public append-only CT logs (search at `crt.sh`). Domain owners monitor these
logs to catch misissued or unauthorized certs for their domain. Meridian Bank
should have CT monitoring alerts for any cert issued against `*.meridian.example`.

### Certificate rotation

Certs expire. Rotation must be automated and tested — manual rotation at scale
is a human error waiting to happen, and an expired cert causes an immediate
hard-fail outage.

```
  Rotation timeline for a 1-year cert (best practice):

  Issue date          90-day warning   30-day warning   Expiry
  │                        │                │             │
  ├────────────────────────┼────────────────┼─────────────┤
  Automate renewal here ──►│ Hard alert      │ Escalate    │ Outage
  (at 2/3 of lifetime)
```

Rotation gotchas:
- **Pinned certificates** (mobile apps that hardcode a cert fingerprint) break on
  rotation unless the app also ships the new fingerprint. Use **public key
  pinning** (pin the CA or intermediate public key, not the leaf cert) to survive
  leaf rotation.
- **Service restarts needed**: some services (nginx, older Java apps) require a
  restart to pick up a new cert from disk. Kubernetes cert-manager + reload
  sidecars handle this automatically.
- **mTLS clients** carry their own client certs — both sides of the mutual
  authentication must be rotated in a coordinated window.

## Worked example

Meridian Bank's mobile banking backend sits in GCP (`10.100.0.0/14`). The
architecture has two certificate trust domains:

```
  ┌─────────────────────────────────────────────────────────────┐
  │               Meridian Bank Certificate Hierarchy            │
  │                                                             │
  │  [Meridian Root CA] — air-gapped HSM, offline               │
  │         │ signs                                             │
  │  [Meridian Public Web CA]   [Meridian Internal Services CA] │
  │  (for internet-facing TLS)  (for mTLS between GCP services) │
  │         │                            │                      │
  │  mobile.meridian.example    api.internal.meridian.example   │
  │  (90-day, auto-renewed via  (90-day, cert-manager in GKE)   │
  │   GCP Certificate Manager)                                  │
  └─────────────────────────────────────────────────────────────┘
```

**Scenario: the mobile app connects to the backend.**

The TLS handshake (see N21) goes:

1. Client sends `ClientHello` with SNI `mobile.meridian.example`.
2. Server responds with:
   - Leaf cert (subject: `mobile.meridian.example`, issued by Meridian Public Web CA)
   - Intermediate cert (Meridian Public Web CA)
   - (Root CA is *not* sent — the client must already have it in its OS trust store)
3. Client walks the chain: leaf ← signed by → Intermediate ← signed by → Root.
4. Client checks `Not After` on each cert. Checks OCSP or CRL status of the leaf.
5. Client verifies the SANs include `mobile.meridian.example`. Done.

**Inspecting the real chain on a laptop [laptop]:**

```bash
# Show the full chain for a real site
openssl s_client -connect mobile.meridian.example:443 \
  -servername mobile.meridian.example \
  -showcerts </dev/null 2>/dev/null \
  | awk '/BEGIN CERT/,/END CERT/' \
  | csplit --quiet --prefix cert- - '/END CERTIFICATE/+1' '{*}'
# Then inspect each:
openssl x509 -noout -subject -issuer -dates -in cert-00

# Or check revocation via OCSP (use a real public cert for practice):
openssl s_client -connect example.com:443 -servername example.com \
  </dev/null 2>/dev/null \
  | openssl x509 -noout -ocsp_uri
# Should print something like: http://ocsp.digicert.com
```

**Meridian Bank's internal service CA registration in GKE:**

Meridian uses cert-manager (a Kubernetes operator) with a ClusterIssuer pointing
to their internal CA. When a new microservice pod starts, cert-manager:
1. Generates a fresh RSA-2048 or ECDSA-P256 key pair in-pod.
2. Creates a Certificate Signing Request (CSR, a PKCS#10 blob) and wraps it in a
   cert-manager `CertificateRequest` resource pointed at the ClusterIssuer.
3. The internal CA signs and returns the cert (valid 90 days).
4. cert-manager mounts the cert and key as a Kubernetes Secret.
5. Renews automatically at 2/3 of lifetime (day 60).

No engineer manually touches the cert. Zero-day rotation lag.

**Checking your trust store for an internal CA (Linux) [laptop]:**

```bash
# List CAs in the system trust store
ls /etc/ssl/certs/ | head -20

# Add an internal CA root (Debian/Ubuntu):
sudo cp meridian-root-ca.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates

# Verify the cert chain yourself:
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted meridian-issuing-ca.crt leaf.crt
# Output: leaf.crt: OK
```

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Public TLS cert issuance | Let's Encrypt, DigiCert, Entrust | **GCP Certificate Manager** (managed certs for Cloud LB and Cloud Run; auto-renew) | **AWS Certificate Manager (ACM)** (free certs for ALB/CloudFront; auto-renew) | (Azure: TODO) |
| Internal/private CA | Microsoft Active Directory CS, HashiCorp Vault | **Certificate Authority Service** (managed private CA hierarchy; signs CSRs via API; integrated with cert-manager) | **AWS Private CA** (managed private CA; integrated with ACM) | (Azure: TODO) |
| OCSP / CRL hosting | Self-hosted or outsourced | Hosted by GCP CA Service automatically | Hosted by AWS Private CA automatically | (Azure: TODO) |
| Certificate rotation automation | cert-manager (k8s), cron scripts | cert-manager + Workload Identity; or GCP-managed TLS (zero-touch) | cert-manager + ACM; ACM auto-rotates for ALB/CloudFront | (Azure: TODO) |
| CT log monitoring | Manual / crt.sh alerts | GCP Certificate Manager CT monitoring; third-party (Cert Spotter) | No native; use Cert Spotter or similar | (Azure: TODO) |
| HSM-backed root CA | Thales / Entrust HSM, air-gapped | Cloud HSM (FIPS 140-2 Level 3) backing CA Service | AWS CloudHSM or ACM Private CA with HSM option | (Azure: TODO) |
| Trust store distribution | Group Policy (Windows), Puppet/Ansible | OS image baking; config management | EC2 image baking; SSM | (Azure: TODO) |

**Key GCP → AWS comparison:**
- GCP Certificate Manager manages both **Google-managed certs** (fully automatic,
  zero-touch) and **self-managed certs** (you supply the PEM). AWS ACM is similar
  but ACM certs cannot be exported — you cannot take them to another system.
- Both clouds charge a **per-CA-month fee plus a per-cert fee** — the structure is
  the same, only the numbers differ. GCP CA Service has tiers (DevOps tier ~$2/CA/month
  with cheaper per-cert issuance; Enterprise tier ~$20/CA/month + ~$1/cert). AWS Private
  CA is ~$400/CA/month plus **tiered** per-cert pricing (~$0.75 only for the first
  band, dropping at higher volumes). Cost matters: Meridian Bank issuing 5,000
  microservice certs/day would model both — and check the current pricing pages,
  since the per-cert tiers swing the math at that volume.

## Do it (the exercise)

### Part 1 — inspect a certificate chain [laptop]

```bash
# Using openssl (macOS/Linux — openssl must be installed):
openssl s_client -connect google.com:443 -servername google.com \
  -verify_return_error </dev/null 2>/dev/null \
  | openssl x509 -noout -text \
  | grep -A2 "Issuer:\|Subject:\|Not After\|DNS:"
```

Identify:
- The **leaf cert** subject and SANs
- The **issuer** (which intermediate CA?)
- The `Not After` date — how many days remain?
- The `CRL Distribution Points` or `OCSP` URL

### Part 2 — walk the chain manually [laptop]

```bash
# Save all certs in the chain to separate files
openssl s_client -connect google.com:443 -showcerts </dev/null 2>/dev/null \
  | grep -c "BEGIN CERTIFICATE"
# Count how many certs the server sends (usually 2: leaf + intermediate)

# Check OCSP status of the leaf. Derive the OCSP URL FROM THE CERT — do not
# hardcode it, and many modern certs (incl. Google's) no longer carry an OCSP
# URI at all, in which case -ocsp_uri prints nothing and you rely on CRL instead.
LEAF=$(openssl s_client -connect google.com:443 -servername google.com \
    </dev/null 2>/dev/null | openssl x509)
OCSP_URL=$(echo "$LEAF" | openssl x509 -noout -ocsp_uri)
echo "OCSP URL from cert: ${OCSP_URL:-<none — cert has no OCSP, use CRL>}"

# Only run the OCSP query if the cert actually advertises a responder:
if [ -n "$OCSP_URL" ]; then
  openssl ocsp \
    -issuer <(openssl s_client -connect google.com:443 -showcerts \
        </dev/null 2>/dev/null \
        | awk '/BEGIN/{c++} c==2{print} /END/{if(c==2) exit}') \
    -cert <(echo "$LEAF") \
    -url "$OCSP_URL" \
    -resp_text | grep -E "This Update|Cert Status"
fi
```

### Part 3 — design exercise [paper]

For Meridian Bank's hybrid environment, draw:

1. The **CA hierarchy** (root → intermediate(s) → leaf) for:
   - Internet-facing mobile TLS (uses a public CA)
   - Internal GCP microservice mTLS (uses GCP CA Service)
   - On-prem core banking TLS termination (uses on-prem internal CA)
2. Identify which **trust store** must contain which CA root.
3. Mark the **rotation cadence** for each leaf cert type.
4. Where would you place CT monitoring alerts? (Hint: internet-facing domain only.)

### Part 4 — verify trust store [laptop]

```bash
# Two correct ways to ask "does my system trust this CA?"

# (a) Test trust by verifying a LEAF/INTERMEDIATE against the system bundle.
#     This is what "trusted" actually means: a chain to a trusted root.
#     (Grab a live leaf+intermediate first.)
openssl s_client -connect google.com:443 -servername google.com -showcerts \
  </dev/null 2>/dev/null | awk '/BEGIN CERT/,/END CERT/' > /tmp/chain.pem
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt /tmp/chain.pem \
  && echo "Trusted" || echo "Not in trust store"
# NOTE: do NOT run `openssl verify` on a self-signed ROOT to test trust — for a
# root it commonly returns "self signed certificate" (non-zero) even when the
# root IS in the store, which mislabels a trusted root as untrusted.

# (b) Test ROOT MEMBERSHIP directly: is the root present in the trust store?
#     Check by subject hash symlink (the form update-ca-certificates creates):
ROOT=/etc/ssl/certs/DigiCert_Global_Root_G2.pem
if [ -e "$ROOT" ] || \
   [ -e "/etc/ssl/certs/$(openssl x509 -noout -subject_hash -in "$ROOT").0" ]; then
  echo "Root present in trust store"
else
  echo "Root not in trust store"
fi
```

## Say it back (self-check)

1. Name the three tiers of a standard PKI hierarchy. Why is the root kept offline?
2. What does a leaf certificate actually attest, and who checks the signature?
3. Explain the difference between CRL and OCSP. What problem does OCSP Stapling
   solve, and why does a bank doing hard-fail mTLS care about the difference?
4. If a microservice running in a container fails to connect after a cert rotation,
   what are the three most likely causes?
5. What is Certificate Transparency and why should Meridian Bank monitor it even
   if they did not cause the cert to be issued?

## Talk to the IT/security head

**Ask:**

- "Who owns the internal CA — the security team, network team, or a third-party
  PKI vendor? And who is authorized to issue new intermediate CAs?"
  *A good answer: security team owns the root and policy; a named PKI admin owns
  issuance; the process is documented and audited. Red flag: "the network team
  configured it years ago, nobody has touched it."*

- "What is the rotation cadence for internal service certs, and is it automated
  or manual? Who gets paged when one expires?"
  *A good answer: cert-manager or a similar tool automates issuance and renewal;
  alerts fire at 30 and 7 days; the on-call SRE owns the alert. Red flag: "we
  rotate them once a year" with no automation — that is a 3 a.m. outage waiting.*

- "How do you distribute the internal root CA to new services — images, config
  management, or something else? How long does it take from 'new service' to
  'trusts the internal CA'?"
  *A good answer: baked into the base image or injected via Kubernetes ConfigMap;
  measured in seconds at pod start. Red flag: manual steps, or "developers handle
  it themselves."*

- "If a private key for an internet-facing cert were compromised today, what is
  the revocation playbook — who revokes, how fast does it propagate, and how do
  you know clients are honouring revocation?"
  *A good answer: named runbook, OCSP responder with short response window (hours),
  re-issuance from the issuing CA without touching root. Red flag: "we'd just
  wait for the cert to expire" — that is PCI-DSS non-compliant.*

- "Do you have Certificate Transparency monitoring in place for your public domain?
  Have you ever discovered an unauthorized cert through it?"
  *A good answer: yes, with alerts integrated into the SIEM. Red flag: blank look —
  many banks have this gap.*

**Red flags to listen for:**
- A single-tier CA (root directly issues leaf certs) — the root is exposed daily.
- Certs valid for more than 1 year on internet-facing services (public CAs no
  longer allow this since 2020; internal CAs that do have missed the memo).
- No CRL or OCSP configured — revocation is theoretical, not enforced.
- Trust stores managed by individual developers, not by central config management.
- The phrase "the cert is self-signed, it's internal" without explaining how
  trust is distributed — self-signed without a trust store entry is just broken.

## Pitfalls & war stories

**The expired intermediate CA.** A bank's internal issuing CA expired on a Sunday.
Every internal service that validated the full chain started rejecting connections
at midnight. The root was fine; the leaf certs were fine; nobody had tracked the
intermediate's `Not After`. Fix: monitor every cert in the chain, not just the leaf.

**The Java app that trusted nothing.** Meridian Bank adds a new issuing CA. The
mobile app, the API gateway (nginx), and the monitoring agents all pick it up
automatically. The core-banking adapter written in Java does not — because Java
uses its own `cacerts` file, updated separately. The Java team had no idea the
enterprise PKI had changed. Fix: include the JVM trust store in the CA
distribution runbook from day one.

**cert-manager succeeds, service still breaks.** cert-manager renews the cert
and writes a new Secret to Kubernetes. The service pod does not reload — it holds
the old cert in memory. Clients see the expired cert. Fix: use the cert-manager
`csi-driver` or a reload sidecar (e.g. `stakater/Reloader`) that signals the
service process when the Secret changes.

**Pinned cert, silent rotation.** Northwind's B2B partner integration pinned the
leaf cert fingerprint of an EDI server. Northwind rotated the cert on schedule.
The partner's integration broke silently (no alert, just failed orders). Fix:
negotiate to pin the issuing CA's public key instead of the leaf fingerprint, so
leaf rotation is transparent.

**The PCI audit finding.** A PCI QSA inspects the CDE at `10.10.20.0/24` and
finds that the internal CA root is installed in the `admin` user's personal
cert store rather than the system trust store. Any service running as a different
user sees untrusted certs. The QSA logs a finding under PCI-DSS Requirement 4.2
(strong cryptography in transit). Fix: system-level trust store deployment,
validated by config management.

## Going deeper (optional)

- **RFC 5280** — Internet X.509 Certificate and CRL profile; the definitive
  reference for certificate fields, extensions, and path validation algorithm.
- **RFC 6960** — OCSP protocol specification.
- **RFC 6962** — Certificate Transparency v1; describes CT log structure and
  monitoring obligations.
- **RFC 8555** — ACME protocol (the protocol Let's Encrypt uses); understanding
  it explains how automated cert issuance works end-to-end.
- **GCP Certificate Authority Service** — https://cloud.google.com/certificate-authority-service/docs
- **AWS Private CA** — https://docs.aws.amazon.com/privateca/
- **cert-manager** — https://cert-manager.io/docs/ (the Kubernetes PKI workhorse)
- **crt.sh** — https://crt.sh/ — search CT logs for any domain to see all issued
  certs; use `?q=%.meridian.example` to see certs for all subdomains.
- Pairs with **N21** (TLS handshake mechanics), **S09** (the asymmetric crypto
  primitives underpinning all of this), and **S11** (KMS and HSM for protecting
  the private keys these certs reference).

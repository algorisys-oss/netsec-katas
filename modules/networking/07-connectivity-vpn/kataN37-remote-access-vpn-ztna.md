# Kata N37 — Remote-access / client VPN; SSL-VPN; ZTNA as successor

> **Track:** Networking · **Module:** N7 Connectivity: VPN & hybrid · **Prereqs:** N21, N26, N36 · **Time:** ~35 min
> **Tags:** `vpn` `remote-access` `ssl-vpn` `ztna` `zero-trust` `security` `networking` `fsi`

## Why it matters

Every Meridian Bank analyst working from home, and every Northwind field rep on a
hotel network, needs access to internal systems. For twenty years the answer was a
**client VPN**: install software, connect, and your laptop is logically on the
corporate network. That model worked — and also created an attack vector so severe
that it drives many of today's largest ransomware breaches. The IT head and CISO
at any regulated firm now have strong opinions on whether to keep the VPN, replace
it, or run both in parallel. You need to understand what a client VPN actually does,
where the SSL-VPN variant improved it, and what **ZTNA** (Zero Trust Network Access)
changes at the architectural level — or your hybrid-access design conversation will
stall in the first five minutes.

## The mental model

### What a traditional remote-access VPN does

The goal is simple: a remote device needs to reach private resources (10.x addresses)
that the internet cannot route to. A VPN solves this by building an **encrypted
tunnel** from the device to a VPN gateway at the network edge, then routing private
traffic through that tunnel.

```
 Remote device                 VPN gateway             Internal resource
 (home / hotel)                (edge, 203.0.113.5)     (10.10.5.20)
       │                              │                       │
       │──── TLS or IPsec tunnel ────▶│                       │
       │     (encrypted, over internet│                       │
       │      to public IP of gateway)│                       │
       │                              │──── plain IP ────────▶│
       │                              │     (10.10.5.20:443)  │
```

Once the tunnel is up, the remote device gets a **virtual IP** from a pool inside
the corporate network (e.g. 10.40.200.0/24 in Meridian's corp-office range) and
can reach anything the network policy allows — often the whole 10.0.0.0/8 supernet.

**That last sentence is the architectural problem.**

### IPsec-based VPN vs SSL-VPN — what changed

Early remote-access VPNs used **IPsec** in a client mode (Cisco AnyConnect, Juniper
Pulse). IPsec at L3/L4 requires a dedicated UDP port (IKE: UDP 500, NAT-T: UDP 4500)
and is often blocked by hotels, cafes, and corporate firewalls.

**SSL-VPN** (sometimes called "TLS-VPN") was invented to solve the firewall-traversal
problem: run the tunnel over HTTPS (TCP 443 or UDP 443 with DTLS), which almost
nothing blocks. Examples: Cisco AnyConnect in TLS mode, Palo Alto GlobalProtect,
Fortinet FortiClient, Pulse Secure.

```
Protocol comparison:

  Feature              IPsec VPN            SSL-VPN (TLS mode)
  ─────────────────────────────────────────────────────────────────
  Transport            UDP 500/4500         TCP/UDP 443 (HTTPS)
  Firewall traversal   Often blocked        Almost never blocked
  Client config        Complex, OS-level    Browser or lightweight client
  Performance          Generally faster     Good; DTLS comparable
  Split tunneling      Yes (policy-driven)  Yes (policy-driven)
  Auth options         Pre-shared key, cert Cert + SAML/MFA integration
```

Both terminate at a **VPN concentrator / gateway** at the enterprise edge and assign
the client a routed IP from an internal pool.

### The structural problem: "implicit trust on the LAN"

Once a VPN client connects and gets `10.40.200.15`, it has **network-level access**
to whatever the routing table allows. The VPN gateway is a binary gate: connected =
trusted. This is the **implicit trust model** — "you're on the network, you're in."

In a flat or loosely segmented network this means:
- A compromised remote device has a live IP on the internal LAN.
- Lateral movement from one compromised host to another is easy.
- A stolen VPN credential (phishing, credential stuffing) gives the attacker
  exactly the same foothold as a legitimate employee.

This is why VPN concentrators became a top-5 initial-access target for ransomware
groups from 2020 onward. The vulnerability isn't just the software bugs (though
those matter) — it's the architecture.

### ZTNA: what it changes

**Zero Trust Network Access (ZTNA)** moves the control from network-level (you get
an IP) to **application-level** (you get a proxied session to a specific app). The
principle: *verify identity and device context on every request, grant the minimum
access needed, and never put the client on the network itself.*

```
 VPN model:                        ZTNA model:
 ─────────────────────────────     ─────────────────────────────────────
 Client → VPN gateway → network    Client → ZTNA proxy → specific app
 Result: IP on the LAN             Result: HTTPS session to app URL only
 Trust: network-location based     Trust: identity + device posture based
 Lateral movement: easy            Lateral movement: none (no network IP)
 Revocation: kill the tunnel       Revocation: per-session, per-app, instant
```

A ZTNA session looks like this:

```
 Remote device                 ZTNA proxy / broker         App (e.g. core-api)
 (posture checked: OS         (cloud or on-prem edge)      (10.10.5.20:8443,
  patched, MDM enrolled,                                    NOT exposed to net)
  MFA passed)                        │
       │──── HTTPS to broker URL ───▶│
       │     (auth + posture check)   │
       │                              │──── connector ──────▶│
       │◀─── proxied app session ────│     (outbound only    │
       │     (URL: core-api.internal) │      from DMZ/DC)    │
```

Key architectural difference: the **application is never exposed to the internet**.
The connector (an outbound agent in the data center or cloud) calls out to the
broker; the broker never opens an inbound hole. This "inside-out" connectivity model
is sometimes called **reverse-tunnel** or **software-defined perimeter (SDP)**.

### Split tunneling (know this before any discussion)

Both VPN and ZTNA must decide: does **all** traffic route through the enterprise, or
only traffic to private resources?

```
  Full tunnel:      ALL traffic → VPN/ZTNA gateway → internet (and internal)
                    Pro: inspect everything. Con: becomes the internet bottleneck.

  Split tunnel:     Private traffic → VPN/ZTNA tunnel
                    Internet traffic → direct (local breakout)
                    Pro: performance. Con: you can't inspect internet traffic.
```

In FSI, many compliance teams default to full tunnel for PCI-scoped users because
split tunneling means the client machine has simultaneous routes to untrusted
internet and trusted CDE — a flat violation of the segmentation requirement.

## Worked example

**Meridian Bank — remote analyst accessing core banking API**

Meridian's estate:
- HQ-DC1 internal range: `10.10.0.0/16`
- Corp-office range: `10.40.0.0/16`
- VPN client pool (legacy): `10.40.200.0/24` (254 addresses for remote users)
- VPN gateway (public): `203.0.113.5` (a documentation-range IP used for illustration)

**Legacy SSL-VPN flow:**

```
 Analyst laptop (home)
 gets VPN IP: 10.40.200.47
                   │
   split-tunnel policy: 10.0.0.0/8 → tunnel, rest → local
                   │
   ─── TLS/DTLS to 203.0.113.5:443 ──▶ VPN concentrator (HQ-DC1 DMZ)
                                              │
                                    routes to 10.10.5.0/24
                                    (core banking API subnet)
                                              │
                                         core-api:8443
```

The analyst gets access to `10.10.5.0/24`. But the VPN policy allows `10.0.0.0/8`,
so a compromised laptop at `10.40.200.47` could also reach `10.10.50.0/24` (card
processing), `10.10.100.0/24` (SWIFT gateway), and DC2's replication interfaces at
`10.20.0.0/16`. That is the blast radius of a single stolen credential.

**ZTNA target state for the same analyst:**

```
 Analyst laptop
 (MDM: enrolled, OS: patched, MFA: passed)
       │
       ├── ZTNA broker (cloud or co-lo): identity check via IdP (SAML/OIDC)
       │   device posture: cert present? OS ≥ required build? no jailbreak?
       │
       ├── Policy: analyst role → allow core-api.meridian.internal only
       │
       ▼
  Proxied HTTPS session to https://core-api.meridian.internal/v1/balances
  (Analyst never gets an IP on 10.10.0.0/16)
  (core-api is not exposed to internet — outbound connector only)
```

The card-processing subnet and SWIFT gateway are not reachable, even from a
compromised device — there's no network path to them.

**Northwind field rep — split-tunnel trade-off**

Northwind runs AWS primary. Field reps need the WMS (Warehouse Management System)
at `10.50.10.0/24` but also need YouTube for sales demos. Full tunnel via HQ kills
video performance for 3,000 reps; split tunnel means internet traffic bypasses
controls. Northwind's answer: SSL-VPN with split tunnel + cloud-based SWG (Secure
Web Gateway) on the laptop for internet traffic — a common SASE pattern (see S27).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Remote-access VPN gateway | Cisco ASA / Palo Alto / Fortinet concentrator at edge | Cloud VPN (HA VPN) — designed for site-to-site; not a client VPN product | AWS Client VPN (OpenVPN-based, managed) | Azure VPN Gateway (IKEv2/SSTP/OpenVPN) |
| SSL-VPN / client VPN | Cisco AnyConnect, Palo Alto GlobalProtect, Fortinet FortiClient | No native client VPN; use BeyondCorp or third-party | AWS Client VPN (port 443, OpenVPN protocol) | Azure VPN Gateway P2S (Point-to-Site); SSTP/IKEv2 |
| ZTNA broker / controller | Palo Alto Prisma Access, Zscaler ZPA, Cloudflare Access, Netskope | Google BeyondCorp Enterprise (IAP / Identity-Aware Proxy) | AWS Verified Access (identity-aware, per-app) | Azure AD Application Proxy / (Azure: TODO for Entra ZTNA) |
| Identity-aware proxy | Reverse proxy with authN gate (often on-prem F5 / Nginx + IdP) | Cloud IAP (Identity-Aware Proxy) — adds identity gate to any GCP workload | AWS Verified Access; or ALB + Cognito | Azure AD App Proxy; Entra ID (Azure: TODO) |
| Device posture check | MDM (Intune/Jamf) + NAC (Cisco ISE) | BeyondCorp Enterprise device trust | AWS Verified Access + device signals | (Azure: TODO) |
| SASE (network + security converged) | Not applicable — on-prem is inherently split | Partial (BeyondCorp + Cloud Armor + Cloud SWG) | Not a single product; compose with Verified Access + WAF | (Azure: TODO) |

**GCP — BeyondCorp Enterprise / Identity-Aware Proxy:**
GCP's native ZTNA story is **BeyondCorp Enterprise** (the commercial product) built
on the research published by Google in 2014. Under the hood the key component is
**Cloud IAP (Identity-Aware Proxy)** — a managed reverse proxy that sits in front of
any GCP workload (App Engine, GCE, GKE, Cloud Run) and requires both IdP
authentication and optionally device posture before proxying a session. If you are
running workloads in GCP and want ZTNA-style access, enabling Cloud IAP is typically
the first step: no VPN client, no IP assignment, no tunnel.

**AWS — AWS Verified Access:**
Launched 2023. An application-level proxy that integrates with AWS IAM Identity
Center (SSO), third-party IdPs, and device-posture providers (CrowdStrike, Jamf,
Okta Device Trust). Like Cloud IAP, it proxies application traffic — the application
does not need a public IP. Requires an **AWS Verified Access endpoint** per
application and a **Verified Access group** with the trust policy.

## Do it (the exercise)

**Part 1 — Explore an SSL-VPN handshake [laptop]**

Most SSL-VPNs present a web portal before launching the client tunnel. You can
observe the TLS handshake:

```bash
# Substitute a real VPN gateway hostname if you have one; otherwise use
# any HTTPS host to observe the TLS cert:
openssl s_client -connect vpn.example.com:443 -servername vpn.example.com \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Look for: who issued the cert, whether it's a public CA or an internal CA
(common for enterprise VPNs), and when it expires. An internal/corporate CA means
you are trusting the enterprise PKI — see N21.

**Part 2 — Trace split-tunnel routing [laptop]**

When connected to any VPN (corporate or personal), compare:

```bash
ip route show          # Linux: full routing table
route print            # Windows: same
netstat -rn            # macOS/BSD
```

Find the route(s) added by the VPN client. Are only specific CIDRs routed via the
tunnel interface (split tunnel), or is `0.0.0.0/0` sent through it (full tunnel)?

```bash
# On Linux, check the VPN interface:
ip addr show           # find tun0 or similar
ip route show dev tun0 # routes via that interface only
```

**Part 3 — Reason through the blast-radius difference [paper / laptop]**

Given Meridian Bank's IP plan:
- VPN client pool: `10.40.200.0/24`
- Corp offices: `10.40.0.0/16`
- HQ-DC1: `10.10.0.0/16`
- PCI cardholder subnet: `10.10.50.0/24`
- SWIFT gateway: `10.10.100.0/24`

If VPN policy is "send all `10.0.0.0/8` through the tunnel," answer:
1. How many host addresses are reachable from a compromised VPN client?
2. Which of those subnets are in PCI scope?
3. If ZTNA replaces this and grants the analyst access only to
   `core-api.meridian.internal` (proxied), what is the new blast radius?

(Answers: 1. roughly 16.7 million addresses across the entire `10.0.0.0/8`
 are routable to the client (a /8 is partitioned into many subnets, each
 consuming its own network + broadcast address, so the true usable-host
 count is somewhat lower than the flat 2^24 − 2 = 16,777,214 — but the
 order of magnitude is the point);
 2. At least `10.10.50.0/24`; 3. Exactly one application URL — no network IP at all.)

**Part 4 — Explore GCP Cloud IAP [needs cloud account]**

```bash
# Assuming you have a GCP project and gcloud CLI configured:
gcloud services enable iap.googleapis.com

# Enable IAP on a backend service (e.g. a GCE instance or App Engine):
gcloud compute backend-services update MY_BACKEND \
  --global \
  --iap=enabled

# Grant a user IAP-secured Web App User role:
gcloud projects add-iam-policy-binding MY_PROJECT \
  --member="user:analyst@meridian.example" \
  --role="roles/iap.httpsResourceAccessor"
```

After this, the app requires Google identity authentication before any HTTP
request reaches the backend — no VPN client, no assigned IP.

## Say it back (self-check)

1. What IP does a VPN client receive, and why does that create an implicit-trust
   problem that ZTNA avoids?
2. What made SSL-VPN easier to deploy in hostile networks compared to IPsec client VPN?
3. Describe split tunneling: what traffic takes which path, and why does it concern
   a PCI compliance team?
4. In a ZTNA architecture, how does the application avoid being exposed to the
   internet — what is the "inside-out" connector model?
5. What is Google Cloud IAP and how does it implement the ZTNA principle for
   GCP-hosted workloads?

## Talk to the IT/security head

**Ask:**

- "Is remote access full-tunnel or split-tunnel, and is that intentional from a
  compliance standpoint?"
  *Good answer:* a deliberate, documented policy — full tunnel for PCI-scoped users,
  split tunnel with SWG for others; they can explain why.
  *Red flag:* "whatever the VPN came configured with" — this is an unexamined
  compliance risk.

- "When a remote-access VPN credential is compromised, how quickly can you revoke
  access and how far could the attacker have moved in the meantime?"
  *Good answer:* named revocation procedure, session kill capability, and
  segmentation that limits blast radius even after compromise.
  *Red flag:* "we'd catch it in the SIEM eventually" with no answer on lateral
  movement — the gap between credential theft and detection is where ransomware
  deploys.

- "What is your roadmap from VPN to ZTNA — or have you already begun the
  transition?"
  *Good answer:* a phased plan (ZTNA for new apps first, VPN maintained for legacy
  systems needing IP-level access); they know which apps can't move yet and why.
  *Red flag:* "we plan to rip out VPN this quarter" with no answer on legacy
  protocols — some systems (RDP, SMB, proprietary banking protocols) require
  network-level access that ZTNA proxying does not support.

- "Does your VPN gateway have a current patch — and how quickly can you patch it
  if a critical CVE drops?"
  *Good answer:* VPN gateway is in the regular patching cadence with a short
  window; there is a tested rollback procedure.
  *Red flag:* "we can't easily patch it because it disrupts remote workers" — this
  is exactly the posture that leads to months-long exposure on high-severity CVEs
  (as happened with Pulse Secure, Fortinet, and Citrix gateways between 2019–2024).

- "Which applications are still VPN-only because they use non-HTTP protocols, and
  what is the plan for those?"
  *Good answer:* an inventory with named timelines or acceptance of residual VPN.
  *Red flag:* no inventory — they don't know what depends on IP-level tunnel access.

## Pitfalls & war stories

**VPN concentrator CVEs are not like other CVEs.** Between 2019 and 2024, critical
unauthenticated remote-code-execution vulnerabilities were found in Pulse Secure
(CVE-2019-11510), Fortinet SSL-VPN (CVE-2022-40684, CVE-2023-27997), and Citrix
NetScaler (CVE-2023-3519 unauthenticated RCE; and separately CVE-2023-4966
"CitrixBleed", a session-token memory over-read mass-exploited by LockBit in
late 2023). In each case the VPN gateway sits on the
internet edge by design, must accept unauthenticated packets to begin the handshake,
and is often difficult to patch without a maintenance window. Many banks were
compromised on gateways left unpatched for weeks. The CISO's fear here is real
and specific.

**"ZTNA solves everything" is vendor marketing.** ZTNA proxies work well for HTTP/S
applications. They do not work transparently for:
- **RDP** (TCP 3389) — still needs a gateway (often an RDP-specific ZTNA extension
  or a Bastion host).
- **SMB** (TCP 445) — file shares; rarely supported natively.
- **Database protocols** (PostgreSQL: TCP 5432, Oracle: TCP 1521, MSSQL: TCP 1433)
  — some ZTNA vendors support TCP tunneling; others don't.
- Legacy banking protocols (ISO 8583 over proprietary TCP, TIBCO messaging, etc.)
  — plan for VPN residue.

**Meridian Bank FSI trap — PCI split-tunnel rule.** PCI-DSS v4.0 requirement 1.3.2
requires that inbound traffic to the CDE be restricted to what is necessary. If
a split-tunnel VPN client is simultaneously on the internet and routed to the CDE,
the QSA (Qualified Security Assessor) may argue the client is an internet-connected
device in the CDE path — a scoping problem. Full tunnel (or ZTNA with posture check)
is the safer answer for PCI-scoped roles.

**Northwind FMCG trap — 3,000 devices, one concentrator.** When Northwind ran a
full-tunnel SSL-VPN for field reps, the VPN concentrator became the internet
bottleneck for 3,000 concurrent users. Bandwidth and CPU on the gateway, not the
WAN links, became the constraint. The fix was split tunnel + cloud-based SWG — but
that required a re-assessment of what the CISO was willing to trade.

**Split tunnel + local admin = attack surface.** If a laptop with split tunnel
has a local admin account and a compromised browser (e.g. drive-by download), the
attacker has a foothold with a simultaneous route to the VPN tunnel. The VPN
doesn't know the device is compromised. Device-posture checking (MDM enrollment,
certificate, OS build version) is the partial mitigation — but it is checked at
tunnel-up time, not continuously. ZTNA with continuous posture checking changes
this.

## Going deeper (optional)

- RFC 4301 — Security Architecture for the Internet Protocol (IPsec framework).
- RFC 8446 — TLS 1.3 (the transport for SSL-VPN and ZTNA proxy sessions).
- NIST SP 800-77 Rev. 1 — Guide to IPsec VPNs.
- NIST SP 800-207 — Zero Trust Architecture (the definitive reference for what
  "Zero Trust" actually means architecturally).
- Google BeyondCorp research papers (2014–2018, published in USENIX ;login:) —
  the origin of the modern ZTNA model; free and highly readable.
- Pairs with N36 (site-to-site IPsec VPN), N26 (firewalls), and S26–S27
  (Zero Trust principles and SASE).
- Cross-track: S07 (least-privilege access) and S04 (identity/sessions) underpin
  the ZTNA policy model.

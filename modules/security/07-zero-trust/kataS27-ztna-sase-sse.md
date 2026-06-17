# Kata S27 — ZTNA, SASE, SSE: the convergence of network + security

> **Track:** Security · **Module:** S7 Zero Trust & modern access · **Prereqs:** S26, N37, N33 · **Time:** ~40 min
> **Tags:** `zero-trust` `ztna` `sase` `sse` `security` `cloud` `hybrid` `fsi`

## Why it matters

Traditional perimeter security assumed that once you were on the corporate
network you were trusted. Remote work, SaaS, cloud-hosted apps, and contractors
with their own devices shattered that assumption. The question architects now face
is: *how do you replace the perimeter when the perimeter is everywhere?* ZTNA,
SASE, and SSE are the market's answer — but they are often marketed as magic
acronyms. The CISO asking you "does this fit our SASE journey?" and the IT head
asking "what replaces the VPN concentrator?" are asking the same architectural
question. If you cannot distinguish SASE from SSE from ZTNA, you cannot answer
either of them credibly.

## The mental model

### 1. The problem: the perimeter dissolved

The classic castle-and-moat model placed all resources inside the network. Users
outside tunnelled in via VPN, landed on the flat internal network, and (critically)
*could reach far more than their job required* once inside:

```
  [User]--VPN tunnel-->[Corp Network]---> everything inside
                         ^^^^^^^^^^^^
                         flat, lateral movement possible
```

Three shifts broke this:

- **Apps moved to SaaS / cloud.** Traffic now goes *out* to the internet, not in
  to the data center. Hairpinning that via HQ adds latency and costs bandwidth.
- **Users moved out.** Remote workers, contractors, and mobile users are always
  "outside." Treating them all as untrusted until VPN kills productivity.
- **Threats moved inside.** Ransomware, insider threats, and supply-chain
  compromises show that being on the internal network is not evidence of being
  trustworthy.

### 2. ZTNA — the access model

**Zero Trust Network Access** is an architecture, not a product. It replaces
network-layer access (VPN: "you get a routable IP on the network") with
application-layer, identity-gated proxied sessions:

```
  User  -->  ZTNA broker (cloud or on-prem)
                  |-- verify: identity (IdP/MFA)
                  |-- verify: device posture (MDM check, patch level, cert)
                  |-- grant: ONE application session only
                  v
             App backend (cloud or on-prem)
             ^^ user never gets a routable IP on the network ^^
```

Key properties of ZTNA:

| Property | VPN (old) | ZTNA (new) |
|----------|-----------|------------|
| What the user gets | A routable IP on the network | A proxied session to one app |
| Lateral movement risk | High (can reach everything on subnet) | Eliminated (no network access) |
| App visibility to user | All apps on the VPN range | Only explicitly authorized apps |
| Auth model | Network credential (pre-shared, cert) | Identity + device posture per session |
| Split tunneling risk | Yes — CDE and internet simultaneous | App scope controls this by design |

ZTNA is taught conceptually in S26; this kata shows how it is delivered.

### 3. SSE — the security-services stack

**Security Service Edge** (Gartner, 2021) names the cloud-delivered security
functions that enforce policy when traffic goes *outbound* from the user to the
internet or SaaS, and *inbound* from the internet to apps. SSE bundles:

```
  SSE = ZTNA  +  SWG  +  CASB  [+  FWaaS]
          |        |       |         |
          |        |       |         +-- cloud firewall (L4/L7) for other traffic
          |        |       +----------- SaaS app visibility, DLP, shadow IT
          |        +------------------- Secure Web Gateway (forward proxy +
          |                              URL filter + TLS inspect + malware scan)
          +---------------------------- per-app access (replaces client VPN)
```

**SWG (Secure Web Gateway):** the cloud-hosted evolution of a corporate forward
proxy. All user internet traffic is routed to the SWG, which does URL
categorisation, TLS inspection, DLP scanning, and malware detection (see N23).

**CASB (Cloud Access Security Broker):** sits between users and SaaS (Microsoft
365, Salesforce, etc.), providing visibility into data flows, shadow IT discovery,
and policy enforcement (e.g. block uploading confidential files to personal
Dropbox).

**FWaaS (Firewall-as-a-Service):** a cloud-hosted L4/L7 firewall for non-HTTP
traffic from branch offices or data centers that still needs egress control.

### 4. SASE — network + security converged

**Secure Access Service Edge** (Gartner, 2019) adds the *network* underlay to
SSE:

```
  SASE = SSE (security functions)
       + SD-WAN (network transport / branch connectivity)
       + Cloud-native delivery from globally distributed PoPs
```

The architectural intent: the same cloud PoP that provides SD-WAN connectivity
to a branch also enforces all security policies for that branch's traffic — no
hairpin to HQ, security policy travels with the traffic.

```
  Branch (SD-WAN CPE)  ──────────►  SASE PoP (nearest)
  Remote user          ──────────►  SASE PoP (nearest)
                                         |
                                    [ZTNA | SWG | CASB | FWaaS]
                                         |
                               ┌─────────┴──────────┐
                            Cloud apps           On-prem via
                            (SaaS, IaaS)         private tunnel
```

### 5. The relationship diagram

```
  ┌─────────────────────────────────────────────────┐
  │                   SASE                          │
  │  ┌──────────────────────────────────────────┐   │
  │  │                SSE                       │   │
  │  │   ZTNA    SWG    CASB    FWaaS           │   │   <- security
  │  └──────────────────────────────────────────┘   │
  │  SD-WAN  (branch connectivity + transport)      │   <- network
  └─────────────────────────────────────────────────┘
```

SSE ⊂ SASE. A vendor selling "SSE" covers the security services but not
SD-WAN (the network underlay). A vendor selling "SASE" covers both. An
organization with an existing SD-WAN investment often adds SSE on top rather
than replacing its WAN.

## Worked example

### Meridian Bank: replacing the client VPN for remote bankers

Meridian Bank's HQ-DC1 (10.10.0.0/16) hosts the core banking system. The CDE
sits at 10.10.20.0/24 (PCI scope). Remote relationship managers need to access
the internal CRM at 10.10.5.100:443 and a cloud-hosted analytics dashboard in
GCP (10.100.0.0/14 range). The old SSL-VPN concentrator at HQ-DC1:

- Assigned each user a 10.10.200.x/24 address on the flat network.
- Split tunneling was disabled (compliance) — all traffic via HQ, including
  Microsoft 365 email.
- With 800 concurrent remote users, the concentrator was the latency bottleneck
  and a high-value attack target.

**With ZTNA (SSE from a vendor like Zscaler Private Access or Cloudflare Access):**

```
  Remote RM's laptop
    │
    │ agent connects to nearest ZTNA PoP (e.g., Mumbai)
    ▼
  ZTNA PoP
    ├── IdP check: Meridian's Azure AD / Google Workspace (SAML/OIDC)
    ├── device posture: MDM-enrolled, disk encrypted, OS patched ≤ 30 days
    └── on pass:
          App A (CRM, 10.10.5.100:443)  → private tunnel to HQ-DC1 connector
          App B (analytics, GCP)        → private tunnel to GCP connector
          App C (M365)                  → direct breakout via SWG
    ^^^ user gets NO IP on 10.10.x.x; cannot reach 10.10.20.0/24 CDE at all ^^^
```

**Connector pattern:** a lightweight software "connector" is installed inside
each environment (HQ-DC1, GCP VPC). The connector initiates an *outbound*
encrypted tunnel to the ZTNA broker's PoP — so no inbound firewall hole is
required at HQ-DC1. The attack surface of the VPN concentrator is eliminated.

**What changes for the Meridian network team:**
- The SSL-VPN concentrator is decommissioned.
- HQ-DC1 firewall rule: permit outbound HTTPS (TCP 443) from the connector host
  to the vendor's PoP IP ranges. Inbound rule for VPN users: removed.
- PCI DSS Req 1.3 (segmentation between untrusted networks and the CDE — the
  prohibition on direct routes from untrusted networks into the CDE; renumbered
  to ~Req 1.4.x in PCI-DSS v4.0) is easier to satisfy: no user IP lands in the
  CDE subnet; the connector is placed in a non-CDE zone with a tightly scoped
  firewall rule to reach only the CRM server on TCP 443.

### Northwind FMCG: SASE for 3,000 branch retail points

Northwind's 3,000 retail/field points all need:
- Internet breakout for Microsoft 365.
- Access to the ERP hosted on AWS (Northwind's primary cloud).
- Security policy enforcement without a security appliance at each site.

SD-WAN CPEs at each site already route traffic to regional hubs. Northwind
overlays an SSE service on the existing SD-WAN:

```
  Retail site CPE  ──[internet underlay]──►  SSE PoP
                                              ├── SWG: M365 direct, malware scan
                                              ├── FWaaS: other egress L4 rules
                                              └── ZTNA: ERP on AWS (private)
```

Cost impact: the regional security appliances (one per 250 sites) are replaced
by the cloud-delivered SSE subscription. Northwind avoids hardware refresh on a
3-year cycle and gets uniform policy across all 3,000 sites from day 1.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| ZTNA (per-app access) | Citrix Access Gateway, BIG-IP APM (on-prem ZTNA) | Cloud IAP (Identity-Aware Proxy) — per-app, no VPN needed | AWS Verified Access (per-app, identity + device-posture gated) | (Azure: TODO — Entra Application Proxy covers internal apps) |
| SWG (internet egress control) | Squid / Bluecoat / Zscaler appliance | Secure Web Proxy (SWP) — native forward proxy / SWG (third-party such as Palo Alto / Zscaler also common) | AWS Network Firewall (+ Gateway LB for SWG appliance) | (Azure: TODO — Defender for Cloud Apps + Firewall Premium) |
| CASB | Symantec, McAfee, Netskope on-prem | Google Workspace DLP / CASB (built-in); Palo Alto NGFW for third-party SaaS | Amazon Macie (data); AWS Security Hub; third-party CASB | (Azure: TODO — Microsoft Defender for Cloud Apps) |
| SASE (full stack) | HQ data center as hub (legacy) | BeyondCorp Enterprise (Google's ZTNA + Chrome Enterprise) | No single AWS-native SASE; AWS partners with Palo Alto Prisma, Zscaler | (Azure: TODO — Microsoft Entra + Defender stack loosely equivalent) |
| Identity-Aware Proxy | BIG-IP APM / F5 | Cloud IAP — full ZTNA for GCP-hosted apps | AWS Verified Access | (Azure: TODO) |
| FWaaS | Branch firewall (Fortinet, Palo Alto physical) | Cloud NGFW (Cloud Next Generation Firewall; legacy: VPC firewall rules) | AWS Network Firewall (per-VPC or centralized) | (Azure: TODO — Azure Firewall) |

**GCP-native path for Meridian Bank:**
Meridian's GCP-hosted services (digital banking, analytics in 10.100.0.0/14) can
be ZTNA-protected using **Cloud IAP** without any agent: Cloud IAP intercepts
HTTPS, challenges Google Workspace / SAML IdP, checks IAM conditions, and
proxies to the backend Cloud Run or GKE service. No VPN needed for GCP apps.
For the on-prem CRM (HQ-DC1), a third-party ZTNA broker (Zscaler, Cloudflare,
Palo Alto Prisma) with a connector is the practical path today.

## Do it (the exercise)

**Part 1 — map the flows [laptop / paper]**

Draw the Meridian Bank remote RM scenario on paper:

1. Label three flows: (a) user → CRM at HQ-DC1, (b) user → GCP analytics,
   (c) user → Microsoft 365.
2. For each flow, mark where authentication happens, where TLS terminates, and
   whether the flow touches the ZTNA broker.
3. Identify which flow was hairpinned in the old VPN design and is now broken out
   at the ZTNA PoP.

**Part 2 — ZTNA policy exercise [laptop / paper]**

Write the ZTNA access policy (plain English) for:
- A Meridian Bank relationship manager: needs CRM + M365. Must NOT reach CDE.
- A Meridian Bank security analyst: needs SIEM + CRM + read-only access to one
  CDE audit log endpoint (10.10.20.50:443). Device must be MDM-enrolled.
- A third-party auditor (contractor): needs read-only access to the audit log
  endpoint only. Device posture: must have a valid certificate issued by Meridian's
  PKI. Duration: 30-day time-bound grant.

**Part 3 — GCP Cloud IAP demo [needs cloud account]**

1. Deploy a minimal Cloud Run service (or GCE VM with nginx) in GCP.
2. Enable Cloud IAP on it and remove any public internet-facing rule.
3. Grant yourself `roles/iap.httpsResourceAccessor` on the resource.
4. Access it via `https://IAP_URL`. Observe the Google login redirect.
5. Revoke the IAM binding and confirm access is immediately denied — no
   firewall rule change required.

Note what this achieves: the service is reachable only to authenticated, IAM-
authorized identities; no VPN; no inbound firewall hole beyond HTTPS to IAP's
managed frontend.

**Part 4 — SWG TLS inspection thought experiment [laptop]**

Your corporate SWG does TLS inspection for all user internet traffic. Verify
what this means in practice:

```bash
# On a laptop on a corporate network with TLS inspection, inspect the cert chain:
openssl s_client -connect www.google.com:443 -servername www.google.com \
    </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject

# If TLS inspection is active, the issuer will be your INTERNAL CA, not Google's CA.
# If not inspected, issuer will be: O = Google Trust Services
```

What you see tells you whether your corporate SWG is intercepting the session.
Ask yourself: what data would the SWG's operator be able to read?

## Say it back (self-check)

1. What is the fundamental difference between a VPN and ZTNA in terms of what the
   user gets access to?
2. Draw the SSE acronym expansion and name what each component does in one sentence.
3. How does SASE differ from SSE — what does it add and why does that matter for a
   branch-heavy FMCG?
4. Why does the ZTNA connector pattern (outbound tunnel from inside) improve the
   on-prem security posture compared to an open inbound VPN listener?
5. A user with ZTNA access to App A gets compromised. Why can the attacker not
   pivot to App B or the rest of the internal network?

## Talk to the IT/security head

**Ask:**

- "Do you have ZTNA in place, or are users still getting a routable IP when they
  remote in?" *(reveals lateral movement exposure; a key PCI-DSS and RBI concern)*
- "For your branch offices, where does security policy get enforced — at the branch
  appliance, at HQ, or at a cloud PoP? How many branches still have local security
  hardware?" *(maps the SASE gap and hardware refresh cost)*
- "When a contractor or auditor needs temporary access, what do they get — a VPN
  credential tied to a subnet, or a scoped per-app grant with a time limit?"
  *(contractor access is the most common lateral movement path in FSI)*
- "Does your SWG do TLS inspection? If yes, which categories are excluded and is
  the internal CA deployed on all managed devices?" *(TLS inspection blind spots are
  a data-exfiltration route; gaps in CA deployment mean inspection silently fails)*
- "Where is your ZTNA broker — cloud-hosted or on-prem? If on-prem, who protects
  it, and is it in scope for your DR plan?" *(on-prem brokers recreate the single
  point of failure that SASE was meant to remove)*

**A good answer sounds like:**

- "Remote access is ZTNA; users get per-app access with device posture checks
  against our MDM. VPN concentrators were decommissioned last year."
- "Branch security policy is enforced at the cloud PoP — we have a 200-site SASE
  rollout 60% complete; remaining sites still go through HQ."
- "Contractor access is time-bound, per-app, and requires a Meridian-issued cert
  on the device."

**Red flags:**

- "Everyone on VPN can reach the whole 10.10.0.0/16" — flat network + VPN =
  lateral movement waiting to happen; in a PCI environment this is a control gap.
- "We have SD-WAN but security still goes through HQ" — the network was modernized
  but security policy was not; a common half-migration that increases latency
  without reducing attack surface.
- "The VPN concentrator is in scope for RBI but we don't have an HA pair" — a
  single point of failure for all remote access; a CAB-worthy DR concern.
- No visibility into what contractors accessed — a PCI-DSS Req 8 and Req 10 gap.
- "TLS inspection is on but we haven't updated the CA bundle on mobile devices" —
  TLS inspection is silently bypassed on those devices; a false sense of control.

## Pitfalls & war stories

**"We bought SASE" ≠ SASE is implemented.** Vendors sell licenses; the migration
is the hard part. Enterprises typically run parallel-mode (old VPN + new ZTNA) for
12–18 months. During this period, the attack surface is *larger*, not smaller.

**Connector misconfiguration.** The ZTNA connector inside HQ-DC1 needs outbound
HTTPS to the vendor's PoP IPs. When the outbound proxy at HQ uses TLS inspection,
the connector's TLS to the PoP gets bumped — and the connector may reject the
re-signed cert, silently failing to register. Test connector connectivity before
committing to the architecture.

**CASB shadow IT discovery is politically sensitive.** When a CASB first scans
traffic it reveals which business units are using unsanctioned SaaS. At Northwind-
class FMCGs, procurement teams or plant managers often have personal Dropbox or
WhatsApp for business data. Surfacing this is valuable but needs CISO + HR
alignment before the data is acted on.

**Split tunneling and PCI compliance.** ZTNA's per-app model eliminates the
classic split-tunneling concern (user simultaneously on CDE and internet) *only if
the ZTNA policy correctly excludes CDE-bound apps from any unmanaged device*. A
misconfigured policy that allows an unmanaged personal device to reach CDE apps
recreates the split-tunneling risk inside the ZTNA model.

**On-prem "ZTNA" is not SASE.** Some vendors sell on-prem ZTNA gateways.
These are better than VPNs for access control but reintroduce a hardware choke
point, a DR dependency, and do not solve the branch-to-internet hairpin problem
that SASE was designed to eliminate.

**FSI audit trail:** RBI IT Framework requires logging every remote access session
(user, timestamp, resource accessed, source device). ZTNA brokers generate this
naturally; ensure the logs are shipped to the SIEM (see S20) and retained per
applicable RBI / IT Act requirements (commonly several years; the exact period
varies by data type and by the relevant RBI direction — e.g. the Cyber Security
Framework and IT Governance Master Direction — so confirm the figure with the
compliance team rather than assuming a single number).

## Going deeper (optional)

- Gartner "The Future of Network Security Is in the Cloud" (2019) — the original
  SASE paper; read it to understand the framing, then apply scepticism to the
  vendor interpretations.
- NIST SP 800-207 (Zero Trust Architecture, 2020) — the authoritative, vendor-
  neutral ZT reference; defines tenets, not products.
- RFC 7235 (HTTP Authentication framework) and OpenID Connect Core 1.0 — the
  underlying identity protocols that every ZTNA broker uses for AuthN.
- Cloudflare Zero Trust, Zscaler ZPA, Palo Alto Prisma Access, and Google
  BeyondCorp Enterprise — the four dominant SASE/SSE vendors; read their reference
  architectures to see how each implements the connector model differently.
- Pairs tightly with S26 (Zero Trust principles), N37 (client VPN → ZTNA
  transition), N33 (SD-WAN underlay that SASE rides on), and S20 (SIEM for
  ZTNA session logs).

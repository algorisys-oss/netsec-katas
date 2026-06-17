# Kata S26 — Zero Trust principles — what it really changes

> **Track:** Security · **Module:** S7 Zero Trust & modern access · **Prereqs:** S01, N27, N37 · **Time:** ~35 min
> **Tags:** `zero-trust` `security` `segmentation` `least-privilege` `identity-aware-proxy` `micro-segmentation` `mental-model` `fsi`

## Why it matters

"We're moving to Zero Trust" is the sentence you will hear from every CISO in
2024–2026. What it actually means — and whether the design on the table delivers
it — is something most architects can't pin down precisely. Zero Trust is not a
product or a perimeter replacement; it is a **change in what you trust as a
premise**. If you can articulate that change, you can evaluate any vendor's
"Zero Trust" claim, spot the gaps in your client's current architecture, and have
the conversation that converts a CISO's aspiration into a concrete design decision.
It directly reshapes how Meridian Bank's branches connect to core systems, how
remote workforce VPN is replaced, and how east-west lateral movement — the primary
vector in modern bank breaches — is contained. (See N27 for segmentation context;
N37 for the VPN-to-ZTNA migration.)

## The mental model

### What the old model assumed

Every traditional perimeter network was built on one premise:

```
  OUTSIDE the perimeter → UNTRUSTED
  INSIDE  the perimeter → TRUSTED
```

Once you were inside the corporate network — a branch, a VPN tunnel, a partner
MPLS link — you were largely trusted. Firewalls defended the edge;
east-west traffic inside the "trusted" zone moved freely.

At Meridian Bank, that looked like this:

```
  Internet
      │
  [Perimeter FW]   ← the wall
      │
  ┌───┴────────────────────────────────────────┐
  │  "trusted" zone                            │
  │                                            │
  │  HQ-DC1 (10.10.0.0/16)                    │
  │   ├── Teller app servers                   │
  │   ├── Core banking (10.10.20.0/24 CDE)     │
  │   └── Staff desktops (10.40.0.0/16)        │
  │                                            │
  │  Branches (10.30.0.0/16) ─── MPLS ────────┤
  │  Remote users ─────── VPN ────────────────┤
  └────────────────────────────────────────────┘
```

The problem: **a compromised branch laptop** is inside the perimeter. It can
reach the CDE at `10.10.20.0/24` without a single additional authentication step.
That is how ransomware spreads from the branch floor to the core.

### The Zero Trust premise change

Zero Trust (ZT) — articulated as a framework in NIST SP 800-207 (2020) — makes
exactly one change to the premise:

```
  NETWORK LOCATION = ZERO TRUST
```

Being inside the network grants nothing. Every access request is evaluated:

```
  ALLOW only if:
    1. Identity verified      (who are you — user, device, service account)
    2. Device health known    (is this device managed and uncompromised?)
    3. Context appropriate    (right time, right location, right risk level)
    4. Least-privilege scope  (this identity to this resource, nothing else)
    5. Session continuity     (re-verify continuously, not just at login)
```

This is the **control plane** (verify) separated from the **data plane** (allow).
A policy engine decides; a policy enforcement point acts.

### The seven ZT tenets (NIST SP 800-207, §2.1)

NIST SP 800-207 enumerates **seven** basic tenets. Learn them as stated — a CISO
will know there are seven, and miscounting them undermines the whole conversation.

| # | NIST tenet (paraphrased from §2.1) | What it means in practice |
|---|-------------------------------------|--------------------------|
| 1 | All data sources and computing services are considered resources. | Everything — a database on the internal LAN, an API, a SaaS app, a script on a device — is a resource subject to access control. There is no "just internal infrastructure" that escapes policy. |
| 2 | All communication is secured regardless of network location. | Encrypt and authenticate every session — even inside the data center. Being on the LAN earns no trust. mTLS between services (see N21). |
| 3 | Access to individual enterprise resources is granted on a per-session basis. | A teller gets access to the one app they need for this session, not a subnet. Access is evaluated each session and expires. |
| 4 | Access to resources is determined by dynamic policy. | Policy engine considers identity + device state + behavioral/risk signals — not just VLAN membership. Policy is data-driven, not static ACLs. |
| 5 | The enterprise monitors and measures the integrity and security posture of all owned and associated assets. | Device/asset health is continuously assessed — no asset is implicitly trusted; a drifting or compromised device loses access. |
| 6 | All resource authentication and authorization are dynamic and strictly enforced before access is allowed. | Authn/authz is a constant cycle — verify, evaluate, grant, re-evaluate. Access is enforced *before* the connection reaches the resource, every time. |
| 7 | The enterprise collects as much information as possible about assets, infrastructure, and communications, and uses it to improve its security posture. | The policy is only as good as the signals fed into it; telemetry, logging, and detection are inputs to better policy, not optional extras. |

> Distilled for everyday use, these seven collapse to a five-line mental model:
> all resources are access-controlled (1), all comms secured (2), per-session
> least privilege (3), dynamic policy (4+6), and telemetry-driven posture (5+7).
> Use the five-line version to *explain* ZT quickly — but quote the seven when you
> need to be precise with a CISO or auditor.

### The architecture shift

```
TRADITIONAL PERIMETER MODEL
─────────────────────────────
User/Device ──── Network ──→ Resource
  (once connected, trusted)

ZERO TRUST MODEL
─────────────────────────────
User/Device ──→ [Policy Engine] ──→ [Policy Enforcement Point] ──→ Resource
                      ↑
              identity store
              device posture
              behavioral signals
              risk scoring
```

The **Policy Engine (PE)** is the brain: it evaluates the request against policy.
The **Policy Enforcement Point (PEP)** is the gate: it proxies or gates the
session only if the PE says yes. The resource sees only clean, authorized sessions
— it never sees anonymous network packets arriving from "the trusted zone."

In cloud implementations the PEP is often an identity-aware reverse proxy
(a ZTNA gateway) or a service mesh sidecar enforcing mTLS.

## Worked example

### Meridian Bank: branch teller to core banking

Before ZT, a teller at branch `10.30.5.0/24` (Mumbai) could reach core banking
at `10.10.20.0/24` (HQ-DC1) via MPLS — by IP address, no additional
authentication. The firewall allows `10.30.0.0/16 → 10.10.20.0/24` on TCP 443.

After applying ZT principles:

```
Step 1 — Teller device boots
         Device health check: is it managed? Latest EDR signature? No local
         admin? → posture score: 85/100 (PASS)

Step 2 — Teller authenticates
         SSO via corporate IdP → MFA via FIDO2 token → short-lived JWT
         (identity token, 8-hour lifetime)

Step 3 — Teller opens core-banking app
         Request hits Policy Enforcement Point (ZTNA gateway)
         PE evaluates:
           identity=teller-007, role=retail-teller, branch=mumbai
           device_score=85 (managed, healthy)
           time=09:17 IST (within business hours)
           risk_signal=low (no anomalous logins today)
         → ALLOW: proxied session to 10.10.20.15:443 (teller app API only)

Step 4 — Session active
         PEP re-checks posture every 15 min (continuous verification)
         Teller cannot reach any other IP in 10.10.20.0/24
         — not the DB tier, not the card-processing subnet

Step 5 — Anomaly: teller tries to open a second session to a different internal
         server at 10.10.20.50 that is not in their entitlement
         PE: DENY — not in entitlement set for retail-teller role
         Alert raised in SIEM
```

This is the blast radius reduction (see N01): even if teller-007's credential is
stolen, the attacker can access one proxied endpoint — not the entire CDE subnet.

### What ZT does NOT change

- The underlying IP network still exists. Packets still flow between IPs.
- The MPLS or VPN circuit still carries the traffic (the underlay).
- Firewalls still exist — ZT adds a control layer; it does not rip out the
  existing network perimeter. It makes the perimeter less relied-upon.

Zero Trust is an **access control posture**, not a network topology replacement.
You can have a Zero Trust posture while still running MPLS branches. What changes
is that the MPLS path alone does not grant access to anything.

### Northwind FMCG contrast

Northwind's 3,000 retail points all land on `192.168.0.0/16` sprawl (see
running-example.md). Their ZT challenge is different: they cannot easily issue
certificates to every point-of-sale terminal, and device posture checking requires
an MDM they haven't deployed. Their CISO's realistic ZT entry point is:

1. ZTNA for the 200 warehouse staff with corporate laptops — replace SSL-VPN.
2. Micro-segmentation at the plant OT/IT boundary — deny east-west by default
   between IT and OT subnets; allow only specific historian-to-ERP flows.
3. Full device-posture ZT for retail terminals: phased roadmap, 18–24 months.

This is the architectural honesty ZT requires: it is a **journey, not a
checkbox**. A CISO who says "we've done Zero Trust" without a phased model is
waving a flag.

## Cloud / vendor mapping (when applicable)

| ZT concept | On-prem | GCP | AWS | Azure |
|------------|---------|-----|-----|-------|
| Policy Enforcement Point | NGFW inline / NAC | Cloud IAP / BeyondCorp Enterprise | AWS Verified Access | (Azure: TODO) |
| Identity store | Active Directory / LDAP | Google Workspace / Cloud Identity | AWS IAM Identity Center / Okta | (Azure: TODO — Entra ID) |
| Device posture | MDM (Intune, Jamf) | Endpoint Verification / Chrome Device Trust | AWS Systems Manager Fleet Manager | (Azure: TODO) |
| Per-session least privilege | NAC + VLAN assignment | IAP TCP forwarding; per-resource IAM conditions | Verified Access per-app policies | (Azure: TODO) |
| Micro-segmentation | Internal firewall / NGFW | GCP Firewall Policies (hierarchical) + VPC Service Controls | Security Groups per ENI + AWS Network Firewall | (Azure: TODO — NSG + Azure Firewall) |
| Continuous verification | SIEM + NAC re-auth | IAP re-auth + Chronicle signals | Verified Access + GuardDuty risk signals | (Azure: TODO) |
| Service-to-service ZT | mTLS (certificate-based) | Cloud Service Mesh + Workload Identity (Federation for GKE) | VPC Lattice / ECS Service Connect + IAM roles (App Mesh is retiring in 2026 — avoid for new builds) | (Azure: TODO) |

**GCP BeyondCorp Enterprise** is the most complete managed PEP: it proxies access
to internal web apps, enforces device posture, integrates with Cloud Identity, and
feeds signals to Chronicle (SIEM). It is the model for understanding any ZT vendor
product because Google invented the concept (the 2014 BeyondCorp paper is the
founding document).

**AWS Verified Access** (GA 2023) provides per-application VPN-free access with
IAM Identity Center and device trust integrations. Evaluated per request; no
corporate VPN required for web-based internal apps.

## Do it (the exercise)

**1. Map your client's current model [laptop / paper]**

Draw the access path for one internal app (e.g. Meridian's core banking API).
For each hop, write:
- What proves the accessor is authorized? (IP range? Credential? Certificate?)
- What is the blast radius if that proof is stolen?

If "IP range" is the answer at any hop, that hop is not Zero Trust.

**2. Identify the three ZT gaps [paper]**

Using the seven NIST tenets, score your client's current design 0/1 per
tenet. A score of 2-3/7 is typical for a mature FSI with good perimeter
controls but flat internal routing.

**3. Inspect an IAP-style proxy in action [laptop]**

GCP Cloud IAP wraps an internal HTTP service behind an identity check. If you
have a GCP project, deploy a minimal test:

```bash
# [needs cloud account]
# Enable IAP on a Cloud Run service and attempt to access it without a token
curl https://my-internal-service-xxxx-uc.a.run.app/
# → 401 Unauthorized (IAP blocks unauthenticated access)

# Now access it with a valid Google identity token
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     https://my-internal-service-xxxx-uc.a.run.app/
# → 200 OK — the PEP verified identity before forwarding
```

This is the PEP in action: the backend never sees the unauthenticated request;
it only sees requests the policy engine has validated.

**4. Read the founding paper [laptop]**

Skim the 2014 Google BeyondCorp paper abstract and the 3-page NIST SP 800-207
executive summary. Note the specific definition: "a collection of concepts and
ideas designed to move the defenses from static network perimeters to focus on
users, assets, and resources." No product names in the definition — that is
intentional.

## Say it back (self-check)

1. State the single premise change that defines Zero Trust vs the perimeter model.
   Why does being on the corporate network grant nothing in ZT?
2. Name the seven NIST SP 800-207 tenets. For each, give a one-line example
   from Meridian Bank's branch teller scenario.
3. What is the difference between the Policy Engine and the Policy Enforcement
   Point? Which decides, and which acts?
4. "We have a ZTNA product — we're Zero Trust." Why is this incomplete?
5. Why does Zero Trust not eliminate the need for network segmentation and firewalls?

## Talk to the IT/security head

**Ask:**

- "What currently grants access to your most sensitive internal system — a
  network path, a credential, a device certificate, or all three? If someone
  compromises a laptop on your branch MPLS, what can they reach?"
- "Which of the NIST ZT principles do you currently satisfy end to end? Where
  are the gaps, and what is the roadmap to close them?"
- "How are you handling device posture today — do you have an MDM on every
  endpoint class, including third-party and contractor devices? That's the
  input ZT needs."
- "Is your ZTNA rollout replacing VPN, adding a control layer alongside it,
  or both? What happens to legacy apps that can't be proxied?"
- "What telemetry feeds your policy engine? If an account shows anomalous
  behavior mid-session, how quickly does the PEP revoke the session?"

**A good answer sounds like:** the CISO can state which resources are behind
a ZT control layer and which are not, with a dated roadmap for the remainder.
They can name the policy signals (identity, device, behavior) and the systems
that supply them. They treat ZT as a capability to be measured, not a label to
be worn.

**Red flags:**
- "We bought [vendor] — we're Zero Trust now." Product purchase ≠ architecture
  change. Ask what the product enforces and what it doesn't.
- Cannot identify the blast radius from a single compromised credential.
  That is the core ZT question — if they haven't answered it, the gap is real.
- "We have strong perimeter firewalls" as a ZT substitute. Perimeter ≠ ZT.
  The perimeter defends against external ingress; ZT defends against lateral
  movement after ingress — different threats, different controls.
- No phased maturity model. ZT is a multi-year program; a single project plan
  is a red flag that scope is undersized.

## Pitfalls & war stories

**"Zero Trust" is used to mean four different things.** In one meeting it means
ZTNA (replacing VPN); in the next, micro-segmentation; in the next, IAM
least-privilege; in the next, the full NIST model. Align on definition first,
or you'll spend a review debating which layer is "really" Zero Trust.

**Ignoring legacy apps.** Meridian Bank's core banking system is a 1990s
mainframe with no API — it doesn't know what an identity token is. ZT for legacy
means a proxy in front that enforces identity, not a rearchitected backend. The
"proxied session" pattern is the practical answer. Don't let perfect be the enemy
of "wrapped with a PEP."

**Device posture without MDM coverage = gap.** ZT device checks require a signal.
If Northwind has 3,000 POS terminals not enrolled in MDM, the device posture
check either covers a tiny fraction of the estate or is bypassed for POS. The
CISO needs to know this and own the risk explicitly.

**VPN + ZTNA in parallel = two security models.** Many organizations run both
during migration. The VPN path still grants broad network access — so any user
who can still use VPN has not actually been Zero-Trust'd. The migration plan must
include a VPN sunset date, or the old perimeter-trust model persists in parallel.

**FSI-specific:** PCI-DSS Requirement 7 (restrict access to system components
and cardholder data by business need to know) and Requirement 8 (identify users
and authenticate access to system components) map directly to ZT principles 3
and 4. Framing your ZT design in these terms lands with the compliance team, not
just the CISO. This is the architectural translation the architect provides.

## Going deeper (optional)

- **NIST SP 800-207** (2020) — Zero Trust Architecture. The definitive framework.
  Free PDF at nist.gov. Read the executive summary and Section 2 before any
  vendor conversation.
- **Google BeyondCorp (2014)** — "BeyondCorp: A New Approach to Enterprise
  Security," by Ward et al. The origin paper. Short and concrete — worth reading.
- **CISA Zero Trust Maturity Model v2.0 (2023)** — A five-pillar maturity model
  (Identity, Devices, Networks, Applications, Data) useful for scoring current
  state and roadmapping.
- Pairs with **N27** (segmentation + micro-segmentation — the network layer ZT
  relies on) and **N37** (ZTNA as the VPN successor — the access mechanism).
- Deepened in **S27** (ZTNA, SASE, SSE) and **S28** (micro-segmentation and
  identity-aware proxy in practice).

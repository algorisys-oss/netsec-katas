# Kata S03 — Threat modeling for architects (STRIDE, attack surface, trust boundaries)

> **Track:** Security · **Module:** S0 Security foundations · **Prereqs:** S01, S02 · **Time:** ~40 min
> **Tags:** `security` `first-principles` `mental-model` `architecture-review` `fsi` `meridian-bank` `risk-management` `conversation`

## Why it matters

Threat modeling is the moment a design goes from "I think this is safe" to "I can
show you why it is safe — or where it isn't." Without it, architects hand CISOs
decisions they cannot evaluate and reviews become gut-feel exercises. With it, you
walk into a design review with a map of your own attack surface, structured
evidence of which risks you accepted, and a credible answer to "what can go wrong?"
Regulators at FSI clients increasingly expect threat models as design artifacts —
not because they are bureaucratic, but because they force the right questions before
code ships.

## The mental model

**1. What threat modeling produces**

Three outputs:
1. A list of **trust boundaries** — where security zones change.
2. A list of **threats** against each component and crossing.
3. A prioritized list of **mitigations** and accepted residual risks.

The inputs are a data-flow diagram (DFD) and a structured threat taxonomy —
the most common being STRIDE.

**2. Trust boundaries — the organizing concept**

A trust boundary is the line where the security zone or trust level changes. Every
packet that crosses a boundary is a candidate threat.

```
  Internet          Perimeter        Internal zone         CDE
  (untrusted)    (semi-trusted)     (corp-trusted)     (PCI-scoped)
       │               │                  │                 │
  [Client]──HTTPS──[WAF/LB]────[App server]───DB call───[Core DB]
       │               │                  │                 │
       └───────────────┴──────────────────┴─────────────────┘
                  ↑ boundary        ↑ boundary        ↑ boundary
```

If a component sits entirely inside one trust zone, a threat hitting it stays
inside that zone. If a component straddles a boundary (like an API gateway that
accepts internet traffic and talks directly to the CDE), it is the highest-risk
component in the design. Name your boundaries before you name your threats.

**3. Attack surface**

The attack surface is the total set of paths through which a threat can interact
with the system. It expands every time you:
- Open a new network port or firewall rule.
- Add a user role or API credential.
- Accept data from an external source (even a trusted partner).
- Expose a management interface.

Reducing attack surface (closing ports, removing roles, restricting inputs) is the
cheapest category of control because it makes threats structurally impossible,
not just guarded against.

**4. STRIDE — a threat taxonomy**

Microsoft's STRIDE (defined by Loren Kohnfelder and Praerit Garg, 1999) gives six
threat categories, each targeting a security property. Map it to the CIA triad
(S01) and then to what you'd actually see in an FSI design:

```
  Letter   Threat              Violated property   FSI/FMCG example
  ────────────────────────────────────────────────────────────────────
  S  Spoofing         Identity            An API caller claims to be the
                      (Authentication)    core banking system — is it?
  T  Tampering        Integrity           A transfer amount modified in transit
                      (Integrity)         or in a message queue.
  R  Repudiation      Non-repudiation     A trader claims they didn't initiate
                      (Accountability)    that fx order — no signed audit log.
  I  Information      Confidentiality     Card PANs returned in a debug log or
     Disclosure       (Confidentiality)   error response.
  D  Denial of        Availability        Volumetric DDoS on the mobile-banking
     Service          (Availability)      login endpoint; or a runaway service
                                          consuming all DB connections.
  E  Elevation of     Authorization       A read-only API role exploits a bug
     Privilege        (Authorization)     to write or delete records.
```

STRIDE is not exhaustive — use it as a prompt, not a checklist. Every "S" question
opens the authentication design; every "E" question opens the IAM design (S04, S07).

**5. The four-step process (on paper, 30 minutes)**

```
  Step 1 — Diagram       Draw the data flow: actors, processes, data stores,
                         data flows. Mark trust boundaries as dashed lines.
  Step 2 — Enumerate     For each boundary crossing and component, apply
                         STRIDE: ask each of the six questions.
  Step 3 — Rate          For each threat, estimate risk = likelihood × impact
                         (S01). High, medium, or low is enough; you don't
                         need numbers.
  Step 4 — Mitigate      For each threat: mitigate (add a control), transfer
                         (insurance, vendor SLA), accept (document residual
                         risk). Not every threat is worth mitigating.
```

## Worked example

**Meridian Bank — mobile-banking backend on GCP**

Meridian is adding a GCP-hosted mobile API (serving the mobile app) that reads
account data from the core banking system in HQ-DC1 (`10.10.0.0/16`). The GCP
VPC uses `10.100.0.0/14` (non-overlapping, as per `reference/running-example.md`).

**Data flow (simplified DFD):**

```
  [Mobile client]                  (Internet — untrusted)
       │
       │  HTTPS 443
       ▼
  [Cloud Armor + HTTPS LB]         ┐ trust boundary 1: internet → GCP edge
       │                           │
       │  HTTPS (internal)         │ GCP VPC 10.100.0.0/14
       ▼                           │
  [Mobile API service]             │
       │                           │
       │  gRPC / mTLS              │
       ▼                           │
  [Internal API gateway]           │
       │                           ┘
       │                           ┐ trust boundary 2: GCP → on-prem
       │  Cloud Interconnect       │
       ▼                           │
  [Core banking adapter]  10.10.10.0/24 (HQ-DC1 internal)
       │                           │
       │  SQL / proprietary        ┘
       ▼
  [Core DB]  10.10.20.0/24  (CDE — PCI scope)
                                   ← trust boundary 3: internal → CDE
```

**STRIDE applied at boundary 1 (mobile client → Cloud Armor/LB):**

| Threat | Specific scenario | Risk | Mitigation |
|--------|-------------------|------|------------|
| Spoofing | Attacker replays a stolen session token | High | Short-lived JWTs (15 min expiry), refresh-token rotation, device binding |
| Tampering | Man-in-the-middle alters a balance query response | Medium | TLS enforced; HSTS preloaded; certificate pinning in mobile app |
| Repudiation | Customer disputes a transfer; no reliable log | High | Signed, tamper-evident audit log in Cloud Logging; non-repudiation controls at API level |
| Information Disclosure | Error response includes internal stack trace or PAN fragment | High | Sanitised error responses; no PII in logs; DLP scan on log pipelines |
| Denial of Service | Credential-stuffing bot floods the login endpoint | High | Cloud Armor rate limiting, reCAPTCHA Enterprise, progressive delays |
| Elevation of Privilege | Read-only token used to invoke a write endpoint | Medium | Scoped OAuth2 tokens per operation; server-side authZ check every request |

**STRIDE at boundary 3 (internal server → CDE `10.10.20.0/24`):**

| Threat | Specific scenario | Risk | Mitigation |
|--------|-------------------|------|------------|
| Spoofing | Rogue internal VM claims to be the API adapter | High | mTLS (client cert) on all CDE connections; firewall rule: source must be `10.10.10.0/24` only |
| Tampering | SQL injection through the adapter | Critical | Parameterised queries only; WAF on the internal path; code review |
| Information Disclosure | DB error reveals schema or raw card data in adapter logs | High | Tokenise PANs (see S18) before they leave the CDE; log masking |
| Elevation of Privilege | Adapter DB credential has DBA rights | High | Least-privilege DB role: SELECT on account views only; no DDL rights |

**Risk accepted (documented residual risk):**
- The Cloud Interconnect path between GCP and HQ-DC1 is not MACsec-encrypted
  on the Meridian side; traffic is encrypted at L7 (TLS/gRPC). Risk accepted by
  CISO 2024-Q3 — physical circuit is in a dedicated cage; MACsec review in 2025.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Threat modeling tool | Whiteboard / Microsoft Threat Modeling Tool | No native tool; use OWASP Threat Dragon or drawing in Draw.io | No native tool; AWS recommends STRIDE or PASTA in design docs | (Azure: TODO — Microsoft Threat Modeling Tool is Windows-native) |
| DFD data store | Any DB, file share, tape | Cloud SQL, Spanner, GCS, Bigtable | RDS, DynamoDB, S3 | (Azure: TODO) |
| Trust boundary enforcement | Firewall zone, VLAN, ACL | VPC firewall rules, VPC Service Controls, Cloud Armor | Security Groups, NACLs, WAF (AWS WAF) | (Azure: TODO) |
| Attack surface reduction | Close ports, least-privilege ACLs | Org Policy (deny public IPs, restrict regions), least-privilege IAM | SCP (deny non-approved actions), Security Groups default-deny | (Azure: TODO) |
| Audit log (non-repudiation) | SIEM, syslog + digital signing | Cloud Audit Logs (immutable, queryable in BigQuery) | AWS CloudTrail (S3, tamper-evident digest files) | (Azure: TODO) |
| Runtime threat detection | IDS/IPS, SIEM correlation | Security Command Center + Cloud IDS (Palo Alto-backed) | GuardDuty (ML-based threat detection) | (Azure: TODO) |

GCP note: **VPC Service Controls** create an API-level perimeter that limits which
identities and resources can call GCP services — it is the closest cloud equivalent
to "you cannot exfiltrate this data store even if IAM is misconfigured."

AWS note: **Service Control Policies (SCPs)** deny actions org-wide regardless of
what IAM roles grant — the equivalent governance-fence primitive.

## Do it (the exercise)

**Part A — draw the DFD [laptop / paper, ~15 min]**

1. Pick a system you know (or use the Meridian mobile backend above). On paper or
   in a text editor, sketch these four elements:
   - **Actors** (external: mobile client, partner API, branch teller)
   - **Processes** (the services/apps that transform data)
   - **Data stores** (databases, queues, caches)
   - **Data flows** (arrows with the protocol and direction)

2. Draw dashed lines where trust changes. Label each boundary (e.g.,
   "internet → DMZ", "DMZ → internal", "internal → CDE").

3. Shade any process or flow that straddles two trust zones — that is your
   highest-risk component list.

**Part B — STRIDE pass [paper, ~15 min]**

1. Pick the two boundary crossings that carry the most sensitive data.
2. For each crossing, write one threat per STRIDE letter (six rows).
3. For each threat, write: *likelihood* (low/med/high), *impact* (low/med/high),
   *current control* (if any), *gap* (if none or weak).
4. Circle the three highest-risk threats. These are your top-of-backlog findings.

**Part C — validate trust enforcement [laptop]**

Check that your own machine's firewall denies by default:

```bash
# Linux: list active iptables rules (or nft rules)
sudo iptables -L -n -v --line-numbers   # should end with a DROP or REJECT default

# macOS: list pf rules
sudo pfctl -s rules 2>/dev/null | head -20
```

If the default policy is ACCEPT on all chains, the host has no host-based
default-deny — a finding worth noting in any cloud VM baseline review.

**Part D — attack surface count [laptop / paper]**

List every open port on a local VM or container:

```bash
# Linux — show all listening sockets
ss -tlnp    # TCP listen, numeric, with process names
ss -ulnp    # UDP listen
```

Each line is one attack surface entry. Ask: does the design need this port open?
What protocol, from which source IP, for which identity?

## Say it back (self-check)

1. What is a trust boundary, and why do you draw them before enumerating threats?
2. Expand STRIDE and name the violated security property for each letter.
3. What is attack surface and name three actions that reduce it structurally (not
   just guard against it)?
4. In the four-step threat modeling process, what is the difference between
   "mitigate" and "accept" — and what does "accept" require you to produce?
5. Where in a Meridian-Bank-style design would you expect an "Elevation of
   Privilege" threat to be highest risk, and why?

## Talk to the IT/security head

**Ask:**

- "Do you have a threat model for this system — can I see it?" *(A good answer is
  a living document with named threats, risk ratings, and dated mitigation decisions.
  No answer means threat modeling hasn't happened.)*
- "Where are the trust boundaries in this design and who enforces each one?" *(The
  CISO should be able to name a control — firewall rule set, API gateway policy,
  VPC Service Control — for every boundary. "It's all on the same network" is the
  worst answer.)*
- "What's in your accepted-risk register for this system?" *(Every mature design
  has accepted risks. A security team that claims zero accepted risks either hasn't
  modeled threats or is not telling you.)*
- "What did your last threat model change about the design?" *(If the answer is
  "nothing," the model was probably produced as an artifact rather than as a design
  input — check when it was written relative to when the design was finalized.)*
- "How does a threat to the mobile channel reach the CDE, and what stops it at
  each hop?" *(This is a depth-probe: a good CISO can trace the path and name a
  control at each trust boundary.)*

**A good answer sounds like:** named boundaries with named controls, a written
risk register, and a threat model that demonstrably changed something about the
design ("we added mTLS on the adapter hop after the model flagged spoofing on the
internal leg").

**Red flags:**
- "We did a pentest last year" (pentest ≠ threat model; pentest is verification,
  threat model is design).
- Trust boundaries exist only at the perimeter ("we have a firewall"); no
  mention of internal segmentation (see N27).
- "Our cloud is secure by default" — cloud default-deny applies to inbound
  connections, not to lateral movement once inside, and not to over-permissioned
  IAM roles.
- Accepted risks are undocumented: "we decided not to bother with X" with no
  written risk acceptance. In FSI this is an audit finding.

## Pitfalls & war stories

- **Threat modeling after the design is done.** The value is in shaping the design.
  A threat model produced at the end of a project to satisfy a gating checklist
  finds findings nobody has budget to fix. Push for it during design, not during
  review.

- **Treating STRIDE as a compliance box.** STRIDE is a prompt, not a certificate.
  Filling in six rows per component and calling it done is worse than a good
  whiteboard conversation — it produces paper safety.

- **Missing internal trust boundaries at Meridian-style clients.** Banks have
  rigorous internet perimeters but often have flat internal networks where any
  server in the "trusted" zone can reach the CDE on port 1521. The interesting
  threats are inside. See N27 (segmentation) and N29 (PCI compliance).

- **Not documenting accepted risk.** At Northwind (FMCG), cost pressure leads to
  pragmatic shortcuts — e.g., leaving plant-floor OT on the same segment as IT
  because isolation is expensive. If that risk is not in writing with a date and an
  owner, the security team is carrying a hidden liability.

- **Conflating threat models with vulnerability scans.** A vuln scan finds known
  weaknesses in existing software. A threat model reasons about design-level attack
  paths that do not yet have a CVE. Both are necessary; neither replaces the other.

- **Forgetting Repudiation in FSI.** For a trading desk or a core banking system,
  "we can't prove who authorized that transaction" is a regulatory and legal
  problem, not just a security one. Audit log integrity (tamper-evident, signed,
  centralized) must appear in every FSI threat model.

## Going deeper (optional)

- Shostack, A. (2014) *Threat Modeling: Designing for Security* — the canonical
  reference; Chapters 1–4 cover the ground in this kata.
- OWASP Threat Dragon — open-source, browser-based DFD and threat-enumeration tool
  (no account needed): https://www.threatdragon.com
- Microsoft STRIDE original paper — Kohnfelder & Garg (1999), available via
  Microsoft Research.
- NIST SP 800-154 *Guide to Data-Centric System Threat Modeling* — aligns threat
  modeling to NIST CSF; relevant for FSI clients on RBI/NIST frameworks.
- PASTA (Process for Attack Simulation and Threat Analysis) — a risk-centric
  alternative to STRIDE used in some FSI shops; goes deeper on business impact
  before threat enumeration.
- Pairs with: S01 (CIA / risk mindset), S02 (who's who in security), S04 (IAM —
  every STRIDE 'S' and 'E' opens the IAM design), N27 (segmentation — trust
  boundary enforcement), N29 (PCI-DSS — shapes the CDE boundary).

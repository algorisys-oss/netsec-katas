# plan.md — NetSec Katas Curriculum

**Mission:** equip solution/enterprise architects and client-facing technical
staff to have credible, efficient conversations with **IT heads, network teams,
and CISOs/security teams** at banks, financial institutions, and large FMCGs —
spanning **networking** (packet → on-prem → GCP/AWS/Azure) and **information
security** (mindset → IAM → crypto → appsec → secops → GRC → cloud security).

**Two tracks, interleaved:** `N` = Networking, `S` = Information Security.
Numbering is global **within each track**; prereqs cite kata ids (`N08`, `S03`).

**Status legend:** `[ ]` not started · `[~]` drafting · `[x]` done · `(Azure: TODO)`

---

## How to use this plan

- Within a track, work modules **in order**; each builds on the last.
- The two tracks interleave — suggested cadence: alternate a networking module
  with the security module that depends on it (see **Suggested interleave**).
- Each kata follows the template in `CLAUDE.md`.
- The **running example** (Meridian Bank + Northwind FMCG) threads through every
  module — see `reference/running-example.md`.

## Build order (scaffolding — do first)

- [x] `reference/running-example.md` — Meridian Bank + Northwind FMCG.
- [x] `reference/lab-setup.md` — laptop toolchain (containers, CLI tools).
- [~] `reference/glossary.md` — terms, linked on first use (starter created).
- [~] `reference/cheatsheet-cidr.md` — subnet/CIDR ready-reckoner (created).
- [ ] `reference/cheatsheet-ports.md` — common ports & protocols.
- [ ] `reference/cheatsheet-cloud-map.md` — GCP↔AWS↔Azure↔on-prem construct map.
- [ ] `reference/cheatsheet-frameworks.md` — NIST CSF / ISO 27001 / PCI-DSS map.

---

# TRACK N — NETWORKING

## Module N0 — Why networking matters to an architect
- [x] N01 — The architect's stake in the network (latency, cost, blast radius,
      compliance, the conversations you'll have)
- [x] N02 — Who's who: IT head, network team, CISO — what they own, fear, measure

## Module N1 — Packets & the layered model
- [x] N03 — OSI vs TCP/IP: what each layer actually does
- [x] N04 — Encapsulation: follow one packet down the stack and back up
- [x] N05 — Ethernet, MAC, ARP, switching (the local segment)
- [x] N06 — Tools: `ping`, `traceroute`/`mtr`, `tcpdump`/Wireshark basics

## Module N2 — IP addressing & subnetting
- [ ] N07 — IPv4, classes (historical), private ranges (RFC 1918)
- [ ] N08 — CIDR & subnet masks: the math, by hand
- [ ] N09 — Subnetting & VLSM: carve an address plan for Meridian Bank
- [ ] N10 — IPv6 essentials
- [ ] N11 — IP planning at enterprise scale: overlap, RFC 6598, M&A pain

## Module N3 — Routing & switching
- [ ] N12 — Routing tables & the default gateway
- [ ] N13 — Static vs dynamic routing; intro to OSPF
- [ ] N14 — BGP: the protocol that runs the internet (and your cloud edge)
- [ ] N15 — VLANs & segmentation; trunking; the L2/L3 boundary
- [ ] N16 — NAT & PAT; why it shapes cloud egress

## Module N4 — Names, sessions & the application edge
- [ ] N17 — DNS deep dive: resolution path, record types, TTL, caching
- [ ] N18 — DNS in the enterprise: split-horizon, conditional forwarding, hybrid
- [ ] N19 — DHCP & IPAM
- [ ] N20 — TCP vs UDP, the 3-way handshake, ports, connection state
- [ ] N21 — TLS/SSL: handshake, certs, PKI, mTLS, termination  → pairs with S04
- [ ] N22 — Load balancing: L4 vs L7, algorithms, health checks, sticky sessions
- [ ] N23 — **Forward proxy**: corporate egress control, PAC files
- [ ] N24 — **Reverse proxy**: vs load balancer, vs API gateway
- [ ] N25 — WAF, CDN, and the modern application front door  → pairs with S05

## Module N5 — Network security & perimeter
- [ ] N26 — Firewalls: stateful vs stateless; rule design; default-deny
- [ ] N27 — DMZ, segmentation, micro-segmentation, east-west vs north-south
- [ ] N28 — IDS/IPS, NDR, DDoS protection
- [ ] N29 — PCI-DSS / RBI / data-residency: how compliance shapes the network

## Module N6 — On-premise enterprise & data center networking
- [ ] N30 — Data center topology: 3-tier vs spine-leaf; oversubscription
- [ ] N31 — High availability: redundancy, HSRP/VRRP, link aggregation
- [ ] N32 — WAN building blocks: leased lines, MPLS, broadband, 4G/5G backup
- [ ] N33 — SD-WAN: why FMCGs love it; how it changes the branch
- [ ] N34 — QoS: prioritizing voice/trading/critical traffic
- [ ] N35 — Network management: monitoring, NetFlow, change-control culture

## Module N7 — Connectivity: VPN & hybrid links
- [ ] N36 — IPsec & site-to-site VPN
- [ ] N37 — Remote-access / client VPN; SSL-VPN; ZTNA as successor → pairs with S07
- [ ] N38 — Dedicated interconnect: Cloud Interconnect / Direct Connect / ExpressRoute

## Module N8 — Cloud networking foundations (GCP → AWS → Azure)
- [ ] N39 — The VPC mental model: GCP (global) vs AWS (regional) vs Azure VNet
- [ ] N40 — Subnets, regions, zones, cloud IP planning
- [ ] N41 — Route tables, internet/NAT gateways, egress design
- [ ] N42 — Cloud firewalls: GCP rules / AWS SG+NACL / Azure NSG
- [ ] N43 — VPC peering & topology at scale
- [ ] N44 — Private connectivity: Private Service Connect / PrivateLink / Private Endpoint
- [ ] N45 — Cloud DNS: Cloud DNS / Route 53 / Azure DNS; public vs private; hybrid
- [ ] N46 — Cloud load balancing & global front doors
- [ ] N47 — Cloud CDN & edge

## Module N9 — Hybrid & multi-cloud architecture
- [ ] N48 — Hub-and-spoke / Transit Gateway / NCC / Azure Virtual WAN
- [ ] N49 — Landing zones & network foundations
- [ ] N50 — Hybrid DNS resolution end-to-end
- [ ] N51 — Multi-cloud connectivity & the egress-cost trap
- [ ] N52 — Shared VPC / centralized vs decentralized network ownership

## Module N10 — Observability, performance & troubleshooting
- [ ] N53 — Latency, bandwidth, throughput, jitter, packet loss — the numbers
- [ ] N54 — Flow logs & packet mirroring across clouds
- [ ] N55 — A structured troubleshooting playbook (layer-by-layer)

## Module N11 — Networking conversation mastery (capstone)
- [ ] N56 — Design-review playbook: the questions that expose risk
- [ ] N57 — Costing a network design (egress, interconnect, LB, NAT, IPs)
- [ ] N58 — Reading an architecture diagram & spotting what's missing
- [ ] N59 — Capstone: design Meridian Bank's hybrid GCP+AWS network & defend it

---

# TRACK S — INFORMATION SECURITY

## Module S0 — Security foundations & the CISO's world
- [x] S01 — The security mindset: CIA triad, threat/vuln/risk, defense in depth
- [ ] S02 — Who's who in security: CISO, SOC, GRC, red/blue/purple; what they own
- [ ] S03 — Threat modeling for architects (STRIDE, attack surface, trust boundaries)

## Module S1 — Identity & Access Management
- [ ] S04 — AuthN vs AuthZ; sessions, tokens, the login you take for granted
- [ ] S05 — SSO & federation: SAML, OIDC, OAuth2 — who issues what  → uses N21
- [ ] S06 — MFA, passwordless, FIDO2/passkeys
- [ ] S07 — RBAC vs ABAC; least privilege; PAM; joiner-mover-leaver
- [ ] S08 — Directory services & cloud IAM (Entra ID / AWS IAM / GCP IAM)

## Module S2 — Cryptography, PKI & key management
- [ ] S09 — Crypto primitives: symmetric, asymmetric, hashing, signing  → uses N21
- [ ] S10 — PKI & certificates deep dive: chains, CAs, revocation, rotation
- [ ] S11 — Key management & secrets: KMS, HSM, Vault, envelope encryption
- [ ] S12 — Encryption at rest vs in transit vs in use; CMEK/BYOK

## Module S3 — Application & API security
- [ ] S13 — OWASP Top 10 for architects (what each really means in a design)
- [ ] S14 — Secure SDLC: SAST, DAST, SCA, threat modeling in the pipeline
- [ ] S15 — API security: authn, rate limiting, gateways, mTLS  → uses N24
- [ ] S16 — Software supply chain: dependencies, SBOM, signing, provenance

## Module S4 — Data security & privacy
- [ ] S17 — Data classification & handling; DLP
- [ ] S18 — Tokenization & masking (PCI cardholder data in practice)  → uses N29
- [ ] S19 — Privacy & regulation: GDPR / DPDP / data residency for architects

## Module S5 — Security operations
- [ ] S20 — Logging, telemetry & the SIEM; what to collect and why
- [ ] S21 — Detection engineering, threat intel, SOAR, the SOC workflow
- [ ] S22 — Vulnerability management & patching at enterprise scale

## Module S6 — Resilience & incident response
- [ ] S23 — IR lifecycle (NIST): prepare → detect → contain → eradicate → recover
- [ ] S24 — Ransomware, BCP/DR, backups, tabletop exercises
- [ ] S25 — Forensics basics & chain of custody (what architects must preserve)

## Module S7 — Zero Trust & modern access
- [ ] S26 — Zero Trust principles — what it really changes  → pairs with N27/N37
- [ ] S27 — ZTNA, SASE, SSE: the convergence of network + security
- [ ] S28 — Microsegmentation & identity-aware proxy in practice

## Module S8 — Governance, risk & compliance
- [ ] S29 — Frameworks map: NIST CSF, ISO 27001, SOC 2, CIS, PCI-DSS, RBI
- [ ] S30 — Risk management: appetite, registers, treatment, residual risk
- [ ] S31 — Third-party / supply-chain risk & audits
- [ ] S32 — Security in the cloud shared-responsibility model

## Module S9 — Cloud security posture (GCP → AWS → Azure)
- [ ] S33 — Cloud IAM deep dive & the over-permissioned-role problem
- [ ] S34 — CSPM / CWPP / CNAPP: posture management explained
- [ ] S35 — Cloud network security: GCP/AWS/Azure controls  → uses N42
- [ ] S36 — Logging & detection in cloud (Security Command Center / GuardDuty / Defender)
- [ ] S37 — Encryption & key management in cloud (Cloud KMS / AWS KMS / Key Vault)

## Module S10 — Security conversation mastery (capstone)
- [ ] S38 — Security design-review playbook: the questions that expose risk
- [ ] S39 — Talking compliance & risk with a CISO without overpromising
- [ ] S40 — Capstone: security architecture for Meridian Bank's hybrid platform;
      defend it to the (simulated) CISO and auditor

---

## Suggested interleave (one efficient learning path)

1. N0–N3 (foundations) → **subnet & route fluently**
2. S0 (security mindset, threat modeling)
3. N4 (DNS/TLS/proxy/LB) → S1 (IAM) → S2 (crypto/PKI) — they reinforce each other
4. N5 (network security) → S7 (Zero Trust)
5. N6–N7 (on-prem + connectivity)
6. S3–S6 (appsec, data, secops, IR)
7. N8–N9 (cloud + hybrid networking) → S8–S9 (GRC + cloud posture)
8. N10–N11 and S10 capstones

## Milestones

- **M1 — Foundations solid:** N0–N3 + S0. Subnet by hand, read a routing table,
  threat-model a design. *Won't be lost in any networking/security meeting.*
- **M2 — Edge & identity fluent:** N4–N5 + S1–S2. Proxies, LB, TLS, IAM, crypto.
  *Can design and defend the application edge and how identity flows.*
- **M3 — On-prem + connectivity + Zero Trust:** N6–N7 + S7. *Speaks the IT head's
  and CISO's native language.*
- **M4 — Secure cloud networking:** N8–N9 + S8–S9 (GCP+AWS). *Maps requirements
  to cloud constructs and controls; names trade-offs.*
- **M5 — Architect-grade:** capstones + Azure backfill. *Leads hybrid/multi-cloud
  secure network design conversations end to end.*

## Open decisions (resolved / pending)

- ✅ **Lab depth:** laptop + paper first; cloud steps marked `[needs cloud account]`.
- ✅ **Scope:** networking spine + full information-security track (this plan).
- ✅ **Name:** `netsec-katas`.
- ⬜ **Azure timing:** backfill continuously vs one pass after Module N8/S9.
- ⬜ **Pacing & format:** one kata/day vs batch by module; ASCII-only vs Mermaid.

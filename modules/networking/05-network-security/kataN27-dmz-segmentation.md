# Kata N27 — DMZ, segmentation, micro-segmentation, east-west vs north-south

> **Track:** Networking · **Module:** N5 Network security & perimeter · **Prereqs:** N03, N15, N26, S01 · **Time:** ~40 min
> **Tags:** `segmentation` `micro-segmentation` `dmz` `north-south` `east-west` `firewall` `defense-in-depth` `fsi`

## Why it matters

"Just open a port" is the request that erodes every bank's security posture one
exception at a time. The IT head and CISO think in **zones** — collections of
hosts with similar trust levels, separated by firewalls and controlled paths.
When you understand how zone architecture works — and the difference between
traffic that crosses a perimeter (north-south) and traffic that moves *within*
the network (east-west) — you can challenge a flat design, ask whether
micro-segmentation is in scope, and explain to the CISO why a cloud workload
that bypasses the DMZ is a risk, not just a convenience.

This kata is cross-referenced in S26 (Zero Trust) and S28 (micro-segmentation in
practice). Pairs tightly with N26 (firewalls) and N29 (PCI-DSS/CDE design).

## The mental model

### Zones and the trust ladder

The fundamental idea: **group hosts by trust level, put a controlled chokepoint
between every level, and default to deny**. This is defense in depth (S01) applied
to network topology.

```
INTERNET (untrusted)
        │
        ▼  [perimeter firewall / NGFW]
  ┌─────────────────────────────┐
  │          DMZ                │  ← internet-facing servers only
  │  (semi-trusted)             │    web front-ends, API gateways,
  │  10.10.5.0/24               │    reverse proxies, mail relay
  └─────────────────────────────┘
        │
        ▼  [internal firewall]
  ┌─────────────────────────────┐
  │   APPLICATION ZONE          │  ← app servers, middleware
  │   (trusted)                 │    no direct internet access
  │   10.10.10.0/24             │
  └─────────────────────────────┘
        │
        ▼  [data firewall / strict ACL]
  ┌─────────────────────────────┐
  │   DATA / CDE ZONE           │  ← databases, core banking,
  │   (high-trust)              │    cardholder data environment
  │   10.10.20.0/24             │    PCI-DSS scope
  └─────────────────────────────┘
        │
        ▼  [management firewall / jump host only]
  ┌─────────────────────────────┐
  │   MANAGEMENT ZONE           │  ← privileged access workstations,
  │   (highest-trust)           │    jump hosts, SIEM collectors
  │   10.10.30.0/24             │
  └─────────────────────────────┘
```

**A DMZ** (Demilitarized Zone) is the first semi-trusted zone — it exists so
internet-facing services can receive public traffic without ever touching
internal systems directly. A compromised DMZ host cannot directly reach the
database; it must be allowed through the internal firewall, which is logged
and denied by default.

The original on-prem DMZ used **two physical firewalls** (one to the internet,
one to the internal network). The term persists; the topology is now often
software-defined VLANs or cloud security groups, but the *concept* is identical.

### North-south vs east-west traffic

```
                      INTERNET
                         │
              ┌──────────┴──────────┐
              │   north-south       │  ← traffic crossing the perimeter
              │   (client ↔ server) │     high scrutiny, inspected at NGFW/WAF
              └──────────┬──────────┘
                         │
          ┌──────────────▼──────────────┐
          │      INTERNAL NETWORK       │
          │   ┌───────┐   ┌───────┐     │
          │   │ SVC A │◄──► SVC B │     │  ← east-west
          │   └───────┘   └───────┘     │     (server ↔ server, lateral)
          │       │           │         │
          │   ┌───▼───────────▼───┐     │
          │   │     DATABASE      │     │
          └───┴───────────────────┴─────┘
```

**North-south** is what traditional perimeter security controls: traffic entering
or leaving the network boundary. Firewalls, WAFs, DDoS scrubbers (N28) — all
placed here.

**East-west** is *lateral* movement between services inside the network. This is
how ransomware spreads and how attackers pivot after an initial breach. In a
flat network (one big subnet, no internal firewalls), east-west is completely
unchecked. This is the dominant risk in modern enterprise networks and the
primary motivation for micro-segmentation.

### Micro-segmentation

Traditional segmentation used VLANs and firewall zones — coarse-grained, based
on *subnets*. A web server and an internal management tool on the same VLAN can
talk freely.

**Micro-segmentation** enforces policy at the **workload level** — each VM, pod,
or container gets its own identity and policy, regardless of where it sits in
the IP plan:

```
  Traditional (subnet-level):          Micro-segmented (workload-level):

  VLAN 10 (10.10.10.0/24)             web-server  →  [deny]   →  db
  ┌────────────────────────┐           web-server  →  [allow]  →  app-api
  │ web  app  db  mgmt     │           app-api     →  [allow]  →  db:5432
  │  ↔    ↔   ↔    ↔       │           mgmt        →  [allow]  →  db:22
  └────────────────────────┘           (all other east-west denied by default)
    All peers can reach each other
```

Micro-segmentation requires an enforcement mechanism — on-prem it is typically
a distributed firewall (VMware NSX, Illumio) or host-based policy; in cloud it
is **security groups / VPC firewall rules** applied per VM, or a service mesh
with mTLS (N21). The PCI-DSS CDE segmentation requirement (N29) is one driver:
you must prove that only specific services can reach the cardholder data
environment.

## Worked example

### Meridian Bank — HQ-DC1 zone architecture

Meridian Bank's HQ-DC1 uses `10.10.0.0/16`. The network team has carved zones:

```
Zone             Subnet            Hosts
─────────────────────────────────────────────────────────────
DMZ              10.10.5.0/24      Reverse proxy, API gateway
                                   to mobile banking GCP
App zone         10.10.10.0/24     Core banking app servers
CDE / data zone  10.10.20.0/24     Card processing DB, HSM
Management zone  10.10.30.0/24     Jump hosts, SIEM, PAM
```

The MPLS-connected branches sit on `10.30.0.0/16` (see `reference/running-example.md`).
Branch traffic toward the core passes through an internal firewall before
reaching `10.10.10.0/24` — branches are treated as **semi-trusted**, not fully
trusted, even on the MPLS.

A mobile-banking request arriving from GCP (`10.100.0.0/14`) hits the reverse
proxy in the DMZ (`10.10.5.10`). The proxy is allowed to talk to the app zone
(`10.10.10.0/24`) on port 8443 only. The app servers can talk to the CDE
(`10.10.20.0/24`) on port 5432 (PostgreSQL) only. Nothing in the DMZ can
directly address the CDE — the firewall rule does not exist and cannot be
added without a CAB-approved change.

```
  GCP (10.100.0.0/14)
       │
       │  [Cloud Interconnect / IPsec VPN]
       │
       ▼
  10.10.5.10  (reverse proxy, DMZ)
       │  TCP 8443 only → app zone
       ▼
  10.10.10.20 (core banking app server)
       │  TCP 5432 only → CDE
       ▼
  10.10.20.5  (card DB) — PCI CDE scope
```

If the reverse proxy at `10.10.5.10` were compromised, the attacker could try
to pivot. Without micro-segmentation, any host in the DMZ (`10.10.5.0/24`)
could attempt to reach any host in the app zone. With workload-level policy
(micro-segmentation), only the exact VM `10.10.5.10` is allowed outbound to
`10.10.10.20:8443`. Every other peer in `10.10.5.0/24` is denied east-west
to the app zone.

### Northwind — flat plant network risk

Northwind's Plant 2 originally ran all OT and IT traffic on one flat VLAN
(`10.50.2.0/24`). A supplier-introduced malware on a corporate laptop (also on
`10.50.2.x`) was able to reach the plant historian and SCADA HMI on the same
subnet with no firewall in path. OT/IT separation (a DMZ between corporate and
plant-floor) would have stopped east-west spread. Northwind's remediation was
a dedicated OT zone (`10.50.100.0/24`) with a firewall allowing only the plant
data collector (`10.50.2.50`) to talk to the historian (`10.50.100.10`) on TCP
port 102 (Siemens S7 protocol — not allowed from any other host).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Zone / segment | VLAN + firewall | VPC subnet + firewall rules | VPC subnet + security group/NACL | VNet subnet + NSG |
| DMZ | Dedicated VLAN + perimeter FW | Separate subnet in VPC; separate VPC with firewall rules; or perimeter VPC in hub-and-spoke | Public subnet with internet gateway; separate VPC; perimeter with Firewall Manager | DMZ subnet or separate VNet; (Azure: TODO) |
| North-south control | Perimeter NGFW | Cloud Armor + external LB; Cloud NGFW | AWS WAF + ALB; AWS Network Firewall | (Azure: TODO) |
| East-west control | Internal firewall; host-based distributed FW | VPC firewall rules (stateful, applied per NIC); hierarchical policies | Security groups (stateful, per ENI); NACLs (stateless, per subnet) | (Azure: TODO) |
| Micro-segmentation | Illumio, VMware NSX, iptables/nftables per host | Per-VM firewall rules + tags; service mesh (Anthos/Istio) | Per-instance security groups; AWS Security Groups are already workload-scoped | (Azure: TODO) |
| CDE isolation (PCI) | Separate VLAN/FW zone; quarterly penetration test | Separate VPC with no external peering; VPC Service Controls for API isolation | Dedicated account or VPC; AWS Security Hub PCI standard | (Azure: TODO) |
| East-west visibility | Netflow/IPFIX + SIEM | VPC Flow Logs (per NIC, 5-tuple) | VPC Flow Logs | (Azure: TODO) |

**GCP note:** GCP VPC firewall rules are **stateful** and applied per VM network
interface, which gives natural workload-level policy without additional software.
Hierarchical Firewall Policies (applied at organization or folder level) enforce
baseline rules that cannot be overridden by project-level rules — useful for
mandating "never open SSH from 0.0.0.0/0" across all projects.

**AWS note:** Security Groups are **stateful** and can reference *other security
groups* as sources (not just CIDRs). This is the idiomatic way to express
micro-segmentation: "allow port 5432 only from the app-server security group."
NACLs are **stateless** and apply at the subnet level — useful as a second layer
but require explicit rules for both directions.

## Do it (the exercise)

### Part 1 — draw the zone architecture [laptop / paper]

1. On paper, draw a four-zone diagram for Meridian Bank's HQ-DC1:
   - DMZ (`10.10.5.0/24`), App zone (`10.10.10.0/24`),
     CDE/data zone (`10.10.20.0/24`), Management zone (`10.10.30.0/24`).
   - Add a perimeter firewall between internet and DMZ,
     an internal firewall between DMZ and App zone,
     and a data firewall between App zone and CDE.
   - Label each firewall with the rules you would allow (source, dest, port).

2. Add the GCP landing zone (`10.100.0.0/14`) connected via VPN to the DMZ.
   Write the firewall rule: `source=10.100.0.0/14 dest=10.10.5.0/24 port=443`.
   (443 is the GCP→DMZ ingress port; the DMZ→app hop uses a separate port,
   TCP 8443, as in the worked example above.)

3. Question: why does the rule terminate at the DMZ and not allow GCP to reach
   `10.10.10.0/24` directly? Write the answer in one sentence.

### Part 2 — identify north-south vs east-west [laptop / paper]

For each traffic flow below, label it **north-south** or **east-west** and name
the control that should govern it:

| Flow | N-S or E-W? | Control |
|------|------------|---------|
| Mobile user (internet) → API gateway in DMZ | ? | ? |
| API gateway → app server (within data center) | ? | ? |
| App server → card database | ? | ? |
| Branch laptop → core banking API | ? | ? |
| Compromised web server → management zone jump host | ? | ? |

### Part 3 — cloud micro-segmentation [needs cloud account]

In a GCP project (free tier works):

1. Create two VM instances: `vm-web` and `vm-db` in the same VPC subnet.
2. Create a firewall rule that denies all ingress between instances by default
   (lower priority number = higher priority in GCP, e.g. priority 65534 allow
   from network, priority 1000 deny from internal CIDR — note that GCP's
   **implied deny** at priority 65535 already blocks everything not explicitly
   allowed, so simply removing the default allow-internal rule achieves this).
3. Create a targeted rule: allow TCP port 5432 from `vm-web` to `vm-db` using
   **network tags** (`allow-db-access` on web, `db-server` on db).
4. SSH into `vm-web` and confirm:
   ```bash
   # Should succeed (port 5432 allowed):
   nc -zv <vm-db-internal-ip> 5432
   # Should fail (port 22 not allowed east-west):
   nc -zv <vm-db-internal-ip> 22
   ```
5. This is workload-level micro-segmentation in GCP: the rule follows the tag,
   not the subnet.

## Say it back (self-check)

1. What is a DMZ, and why does it need a firewall on *both* sides (internet side
   and internal side)?
2. Define north-south traffic and east-west traffic. Which one does traditional
   perimeter security control poorly, and why?
3. What is micro-segmentation, and how does it differ from subnet/VLAN-level
   segmentation?
4. In AWS, what is the difference between a Security Group and a NACL? Which is
   stateful, which is stateless, and at which level does each apply?
5. Why does PCI-DSS require CDE segmentation, and what counts as a "segmentation
   control" in practice?

## Talk to the IT/security head

**Ask:**

- "Can you walk me through your zone architecture? How many zones do you have,
  what's in each, and what sits between them?"

  *A good answer names at least: DMZ, internal app zone, data/CDE zone, and
  management zone, with different firewalls or firewall rule sets between each.
  They state who approves rules crossing each boundary. Red flag: "we have a
  perimeter firewall" — a single perimeter with nothing internal.*

- "How is east-west traffic controlled inside the data center today? Do you have
  internal firewalls or is it a flat network?"

  *A good answer: internal firewalls or distributed host-level policy; they can
  name the zones and the controls between them. Red flag: "everything inside
  is trusted" — attacker pivot paradise.*

- "If a host in the DMZ were compromised, what stops it reaching the database?"

  *A good answer: an internal firewall rule that denies DMZ-to-CDE directly; the
  compromised host would need to somehow traverse the app zone firewall too. Red
  flag: silence, or "we'd detect it quickly" — detection is not prevention.*

- "Is your CDE physically (VLAN) segmented or just logically separated in
  firewall rules? Has that been validated by a QSA?"

  *Relevant at any bank with PCI scope. A good answer: VLAN + firewall rule +
  penetration-test-validated. Red flag: "the DBA has a separate password" — that
  is not network segmentation.*

- "How is east-west traffic in your cloud VPCs controlled — security groups,
  firewall policies, or both? Are you relying on the implicit deny?"

  *Cloud teams often leave the default VPC "allow all internal" rule in place,
  which eliminates east-west control. A good answer cites explicit workload-level
  rules or tags-based policy.*

**Red flags to listen for:**

- "Flat network internally" — no east-west control, one breach = full lateral
  spread.
- "We trust our internal network" — the pre-2017 mindset; contradicts Zero Trust
  (S26) and is inconsistent with PCI-DSS segmentation requirements.
- "The firewall is at the edge" — perimeter-only security; no internal zones.
- "We'll just monitor for unusual traffic" — detection does not replace
  segmentation; by the time SIEM alerts, lateral movement may already be complete.

## Pitfalls & war stories

- **The "internal is trusted" flat network.** Many legacy bank data centers
  were built when the threat model was "bad things come from the internet." A
  single phishing email + lateral movement on a flat `10.10.0.0/16` can reach
  the core banking database in minutes. PCI-DSS 4.0 explicitly requires
  segmentation to be validated, not assumed.

- **DMZ misconfigured to pass-through.** A well-known failure pattern: the
  perimeter firewall correctly blocks direct internet → internal traffic, but a
  rule allows DMZ → internal on "any port" because "the app needs it." The DMZ
  becomes a staging post rather than a chokepoint.

- **Cloud VPC default allow-internal rule.** AWS default VPCs (whose default
  security group allows all traffic between instances using that SG) and GCP
  VPCs with the default `allow-internal` rule permit all east-west between
  instances in the same VPC. In a production environment,
  delete or replace this rule with explicit workload-scoped rules. Many cloud
  architecture reviews find this rule still in place years after the initial
  build.

- **Micro-segmentation without logging.** Deploying per-VM rules without enabling
  VPC Flow Logs (GCP) or VPC Flow Logs (AWS) means you can deny traffic but
  cannot prove you did — a PCI/RBI audit finding in the making.

- **Northwind OT/IT flat network.** Operational technology (plant-floor SCADA,
  PLCs) on the same VLAN as corporate IT is a recurring FMCG risk. The
  segmentation fix (a DMZ between OT and IT, allowing only historian protocols
  on named ports) is simple in concept and complex in practice because OT teams
  fear that any network change could halt production. The architect's role is to
  frame the risk, not impose the change. See N29 for the compliance angle.

- **"We have a next-gen firewall" ≠ micro-segmentation.** An NGFW at the
  perimeter controls north-south. East-west between servers in the same VLAN
  never crosses the NGFW. You need internal controls for east-west, whether
  that is internal VLAN firewalls, distributed host policy, or cloud security
  groups.

## Going deeper (optional)

- NIST SP 800-125B — *Secure Virtual Network Configuration for Virtual Machine
  (VM) Protection* — covers hypervisor-level micro-segmentation concepts.
- PCI-DSS v4.0 requirement 1 — network security controls and CDE segmentation
  (validation requirements, penetration testing of segmentation controls).
- RFC 4364 — BGP/MPLS IP VPNs — relevant when MPLS is used to achieve L3
  segmentation between zones in the WAN.
- Pairs with N26 (stateful firewalls) for how the chokepoints work, N29
  (PCI/RBI) for why segmentation is mandated, S26 (Zero Trust) for the next
  evolution of east-west control, and S28 (micro-segmentation & IAP in practice).

# Glossary

Plain-language definitions, architect-oriented. Link the **first use** of a term
in any kata to its entry here. Grow this as katas are written. Keep alphabetical.

> Format: **Term** (layer/area) — one-line definition. *Where it's taught:* kata id.

- **ABAC** (security/IAM) — Attribute-Based Access Control: access decided by
  attributes (role, dept, time, resource tags). *S07.*
- **ARP** (L2) — Address Resolution Protocol: finds the MAC for a known IP on the
  local segment. *N05.*
- **BGP** (L3) — Border Gateway Protocol: routing protocol that exchanges routes
  between networks; runs the internet and your cloud edge. *N14.*
- **Blast radius** — how far an attacker or failure can spread from one
  compromised point; limited by segmentation. *N01, N27.*
- **Broadcast domain** (L2) — the set of hosts an Ethernet broadcast (e.g. ARP)
  reaches; one switch/VLAN = one domain; routers and VLANs bound it. *N05, N15.*
- **CAB** (process) — Change Advisory Board: the body that authorizes network/
  infra changes and their windows in regulated shops. *N02.*
- **CIA triad** (security) — Confidentiality, Integrity, Availability: the three
  properties security protects. *S01.*
- **CIDR** (L3) — Classless Inter-Domain Routing: `a.b.c.d/n` notation; `/n` =
  number of network bits. *N08.*
- **CDE** (compliance) — Cardholder Data Environment: the PCI-DSS-scoped segment
  holding card data; must be isolated. *N29, S18.*
- **Default gateway** (L3) — the router a host sends traffic to when the
  destination isn't on its local subnet. *N12.*
- **Defense in depth** (security) — layering independent controls so one failure
  isn't fatal. *S01.*
- **DMZ** (security/network) — a semi-trusted zone between the internet and
  internal networks for internet-facing services. *N27.*
- **DNS** (L7) — Domain Name System: resolves hostnames to IPs. *N17.*
- **Egress** (cloud/cost) — outbound data transfer; often the surprise line item
  in cloud bills. *N01, N51.*
- **Encapsulation** (all layers) — wrapping each layer's data in the next layer's
  header/trailer going down the stack; reversed (decapsulation) going up. *N04.*
- **Forward proxy** (L7) — sits in front of *clients*, controlling/observing their
  outbound traffic. *N23.*
- **IAM** (security) — Identity & Access Management: managing who can do what. *S04–S08.*
- **MAC address** (L2) — hardware address unique to a NIC; local-segment scope;
  rewritten at each hop. *N03, N05.*
- **mTLS** (security/L6) — mutual TLS: both client and server present certificates.
  *N21, S15.*
- **MSS** (L4) — Maximum Segment Size: largest TCP payload per segment;
  ≈ MTU − IP − TCP headers (1460 over a 1500 MTU). *N04.*
- **MTU** (L2/L3) — Maximum Transmission Unit: largest payload a link carries in
  one frame (typically 1500 bytes Ethernet); tunnels lower it. *N04.*
- **NAT** (L3) — Network Address Translation: rewrites IPs (typically private↔
  public). *N16.*
- **NSG / Security Group / firewall rule** (cloud) — cloud-native packet filters;
  models differ per cloud. *N42.*
- **OSI model** — 7-layer reference model for networking. *N03.*
- **PKI** (security) — Public Key Infrastructure: CAs, certificates, and trust
  chains. *N21, S10.*
- **RBAC** (security/IAM) — Role-Based Access Control: access via assigned roles. *S07.*
- **Reverse proxy** (L7) — sits in front of *servers*, terminating client
  connections; basis of LBs, WAFs, API gateways. *N24.*
- **Risk** (security) — likelihood × impact; what security actually prioritizes.
  *S01.*
- **Segmentation** (network/security) — dividing a network into isolated zones to
  limit blast radius. *N27.*
- **Segregation of duties** (security/process) — splitting a sensitive action
  across people so no one both performs and approves it (e.g. NetOps builds, the
  CAB approves a firewall change). *N02.*
- **SD-WAN** (WAN) — software-defined WAN; cheaper, policy-driven branch
  connectivity. *N33.*
- **Subnet** (L3) — a sub-division of an IP network sharing a routing prefix. *N09.*
- **TLS** (L6) — Transport Layer Security: encrypts and authenticates sessions.
  *N21.*
- **traceroute** (tool/L3) — maps the routers on a path by sending packets with
  increasing TTL and reading the ICMP "time exceeded" replies. *N06.*
- **TTL** (L3) — Time To Live: a hop counter in the IP header; decremented by each
  router, the packet is dropped at 0 (basis of traceroute). *N06.*
- **VLAN** (L2) — Virtual LAN: logical L2 segmentation over shared switches. *N15.*
- **VPC / VNet** (cloud L3) — Virtual Private Cloud (GCP/AWS) / Virtual Network
  (Azure): your private cloud network. *N39.*
- **WAF** (L7/security) — Web Application Firewall: inspects HTTP for attacks. *N25.*
- **Zero Trust** (security) — never trust by location; verify identity and context
  on every request. *S26, N27.*

# Kata N36 — IPsec & site-to-site VPN

> **Track:** Networking · **Module:** N7 Connectivity: VPN & hybrid · **Prereqs:** N03, N16, N26, N32 · **Time:** ~40 min
> **Tags:** `networking` `vpn` `ipsec` `site-to-site` `hybrid` `on-prem` `security` `l3-network`

## Why it matters

When Meridian Bank's IT head says "the cloud must connect back to HQ like it's
just another branch," they mean a **site-to-site VPN** — an encrypted tunnel
that joins two private networks over the public internet. Before dedicated
interconnect (N38) is affordable or installed, IPsec is the de-facto backbone
of every hybrid design, and it still underpins SD-WAN overlays (N33), B2B
partner links, and cloud-to-on-prem connectivity. Understanding the two-phase
negotiation lets you diagnose failures, challenge cipher choices, and ask the
question that exposes risk in a design review.

## The mental model

### What IPsec actually is

IPsec is not one protocol — it is a **framework** of three pieces:

```
  IKE  (Internet Key Exchange)  — negotiates and manages keys; UDP 500 / 4500
  ESP  (Encapsulating Security  — encrypts + authenticates payload; IP proto 50
        Payload)
  AH   (Authentication Header)  — authenticates only (no encryption); IP proto 51
                                   (breaks NAT; rarely used today)
```

In practice: **ESP in tunnel mode**, negotiated by **IKEv2**. That's the
standard for all new deployments (IKEv1, RFC 2409, is legacy and weaker).

### The two-phase handshake

```
  PHASE 1 — IKE SA (a secure channel for key exchange)
  ──────────────────────────────────────────────────────
  1. Peers exchange cipher proposals: encryption / integrity / DH group / PRF.
  2. Agreed proposal → Diffie-Hellman exchange: shared key material, no key on wire.
  3. Peers authenticate: pre-shared key (PSK) or X.509 certificate.
  → Result: an encrypted channel used only for Phase 2.

  PHASE 2 — IPsec SA (Child SA in IKEv2, encrypts real traffic)
  ──────────────────────────────────────────────────────────────
  Inside the Phase-1 channel:
  1. Negotiate the ESP data-plane transform (e.g. AES-256-GCM — an AEAD cipher
     that does its own integrity, so no separate HMAC is needed).
  2. Agree traffic selectors: which src/dst subnets this tunnel carries.
  3. Install a pair of SAs (one each direction); data flows.
```

IKEv2 (RFC 7296) merges these into fewer round-trips. The concepts still hold.

### Tunnel mode vs transport mode

```
  Tunnel mode:    [outer IP | ESP hdr | inner IP | payload | ESP trailer | auth]
  Transport mode: [original IP | ESP hdr | payload | ESP trailer | auth]
```

**Tunnel mode** wraps the entire original packet — the VPN gateways are the
outer IPs; inner IPs are private. Always use tunnel mode for site-to-site VPN.

### NAT traversal and key facts

- Behind a NAT device? Peers negotiate **NAT-T**: ESP is wrapped in **UDP 4500**
  so the NAT box can track sessions. IKE starts on UDP 500, switches to 4500.
- **Perfect Forward Secrecy (PFS):** Phase 2 does a fresh DH exchange on every
  re-key. Compromising one session key exposes nothing before or after. Always
  enable PFS for FSI/PCI workloads.
- **Dead Peer Detection (DPD):** keepalive messages detect a silent tunnel
  failure and trigger failover. Without DPD, a dead tunnel can blackhole traffic
  for hours with no alarm.

## Worked example

**Meridian Bank HQ-DC1 → GCP (primary hybrid link, pre-interconnect)**

```
  HQ-DC1                                        GCP VPC (Meridian)
  10.10.0.0/16                                  10.100.0.0/14

  [app server]──[VPN GW]════════ internet ════[Cloud VPN GW]──[cloud workload]
               203.0.113.1    (encrypted ESP)   35.220.x.x
```

| Parameter | Value |
|-----------|-------|
| On-prem LAN | `10.10.0.0/16` (HQ-DC1) |
| Cloud LAN | `10.100.0.0/14` (GCP VPC) |
| On-prem VPN public IP | `203.0.113.1` (documentation range) |
| IKE version | IKEv2 |
| Phase 1 cipher | AES-256-GCM / SHA-256 / DH group 20 (ECDH P-384) |
| Phase 2 cipher | AES-256-GCM (AEAD, integrity null) / PFS group 20 |
| Auth method | Pre-shared key (PSK) — rotated every 90 days per PCI policy |
| Traffic selectors | local `10.10.0.0/16` ↔ remote `10.100.0.0/14` |
| DPD | enabled, 30 s interval, 3 retries |

These two ranges are deliberately non-overlapping (see `reference/running-example.md`
and N11). Had Meridian used `10.0.0.0/8` on both sides, routing inside the
tunnel would be ambiguous and traffic would not flow.

**Firewall rules required on HQ-DC1's perimeter:**

```
  Allow outbound UDP 500  (IKE negotiation)
  Allow outbound UDP 4500 (NAT-T / IKE after NAT detection)
  Allow outbound IP proto 50 (ESP) — if no NAT between peers
  Allow matching inbound return traffic
```

**Why the tunnel is UP but traffic doesn't flow** (most common failure): the
IPsec SA negotiated, but a route on one side points the traffic to the wrong
interface, or the traffic selector doesn't match the actual src/dst. Both the
on-prem router *and* GCP must have routes for the remote prefix pointing into
the tunnel. Check routes before calling the tunnel broken.

**HA pattern — GCP requires two tunnels for its 99.99% SLA:**

```
  HQ-DC1: primary VPN GW   (203.0.113.1) ══╗
                                             ╠═══ GCP HA VPN (2 Google IPs)
  HQ-DC1: secondary VPN GW (203.0.113.2) ══╝
```

AWS Site-to-Site VPN automatically provides two tunnel endpoints per connection.
Always terminate both; if one drops, DPD triggers failover to the other.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| VPN gateway | Cisco ASA / Palo Alto / pfSense / strongSwan | HA VPN (production) or Classic VPN | Site-to-Site VPN via Virtual Private Gateway | (Azure: TODO) |
| HA model | VRRP/HSRP pair (N31) | 2 tunnels required, 99.99% SLA | 2 tunnel endpoints per connection, 99.95% SLA | (Azure: TODO) |
| Routing | Static or BGP | Static routes *or* Cloud Router (BGP, IKEv2) | Static routes *or* BGP via Virtual Private Gateway | (Azure: TODO) |
| Max throughput (per tunnel) | Hardware-bound | ~3 Gbps | ~1.25 Gbps | (Azure: TODO) |
| Monitoring | syslog / SNMP / NetFlow | Cloud Logging + Cloud Monitoring (VPN metrics) | CloudWatch VPN metrics; VPC Flow Logs | (Azure: TODO) |

GCP **Cloud Router** enables BGP over the tunnel — new subnets and failover
routes propagate automatically. Prefer BGP over static routes at Meridian scale
(220 branches, cloud, DR). AWS's equivalent is BGP on the Virtual Private Gateway.

Per-tunnel figures above are *per tunnel*; aggregate throughput scales with
ECMP across multiple tunnels (GCP spreads traffic over its two HA-VPN tunnels;
AWS reaches ~10 Gbps by terminating multiple VPN tunnels on a Transit Gateway
rather than a single Virtual Private Gateway). When sustained throughput exceeds
~500 Mbps or SLA requirements tighten, the answer is **dedicated interconnect**
(N38), not a faster VPN.

## Do it (the exercise)

### A — Observe the Linux IPsec subsystem [laptop]

On Linux (or WSL):
```bash
sudo ip xfrm state    # installed IPsec SAs: src/dst, SPI, cipher, mode
sudo ip xfrm policy   # traffic selectors: what enters the tunnel
sudo ss -unp 'sport = :500 or sport = :4500'   # IKE / NAT-T sockets
```

Even with no active tunnel, these commands show the data structures IPsec
uses. With a tunnel running, you'll see one `state` entry per direction, and
the `policy` entry matching your traffic selector.

### B — Test MTU behaviour [laptop]

IPsec tunnel mode adds ~50–80 bytes overhead, lowering the effective MTU to
~1420–1450 bytes on a standard 1500 MTU link:
```bash
ping -M do -s 1400 <remote-host>   # Linux: do-not-fragment + 1400-byte payload
# Expect reply → path handles the size.
ping -M do -s 1450 <remote-host>
# If this fails, fragmentation or PMTUD is broken.
```

### C — Design exercise [paper]

Draw the site-to-site VPN for Meridian Bank:
- HQ-DC1 (`10.10.0.0/16`) ↔ GCP (`10.100.0.0/14`)
- DC2-DR (`10.20.0.0/16`) ↔ GCP (same VPC, for failover)

Answer: which IPs are tunnel endpoints? Which static routes on each side? Which
CAB process gates a PSK rotation? (See N02.)

### D — Cloud console check [needs cloud account]

```bash
# GCP
gcloud compute vpn-tunnels list
gcloud compute vpn-tunnels describe <name> --region=<region>
# Look for: detailedStatus ESTABLISHED vs WAITING_FOR_FULL_CONFIG

# AWS
aws ec2 describe-vpn-connections --output table
# Look for: State=available, both tunnels' Status=UP
```

## Say it back (self-check)

1. Name the three components of the IPsec framework and the port/protocol each
   uses.
2. What does Phase 1 produce and what does Phase 2 produce?
3. Why is tunnel mode used for site-to-site VPN rather than transport mode?
4. What is PFS and why does a bank's security team require it?
5. The tunnel shows ESTABLISHED but traffic doesn't flow — what is the first
   thing to check on each side?

## Talk to the IT/security head

**Ask:**
- "Are you running IKEv1 or IKEv2, and what cipher suite is negotiated in
  Phase 1 and Phase 2?" *(expect IKEv2 / AES-256-GCM / DH group 14 or higher;
  IKEv1 + 3DES + DH group 2 are deprecated by NIST SP 800-77r1)*
- "How is the pre-shared key stored and what is the rotation schedule?" *(PSK
  in plain-text config files is a PCI finding; expect a secrets manager and a
  CAB-gated rotation process)*
- "Is DPD enabled, and has failover actually been tested end-to-end?"
  *(an untested failover is no failover)*
- "Do you have HA VPN / dual tunnels, and what is the measured SLA?" *(a single
  Classic VPN tunnel has no HA SLA — unacceptable for core banking)*

**A good answer sounds like:** IKEv2 with named ciphers, PSK in a vault with
quarterly rotation, DPD on with a documented failover test, HA VPN (two
tunnels), BGP for route propagation via Cloud Router / VGW.

**Red flags:**
- "Single tunnel, no HA — it's been fine." No SLA, no failover.
- "PSK is in the config file." PCI/RBI finding.
- "IKEv1 — haven't migrated." Deprecated by NIST SP 800-77r1; migrate to IKEv2.
- "Static routes, we update them by hand." Brittle at scale; migration to BGP
  is a design conversation.
- "We've never tested failover." The tunnel may silently be broken.

## Pitfalls & war stories

**The silent blackhole.** DPD disabled, primary tunnel goes down, failover
never triggers. Meridian Bank's core-banking sync appeared healthy on the
dashboard (the VPN gateway showed "up") while DB replication quietly fell 4
hours behind. DPD would have detected the dead peer in 90 seconds. Enable it.

**Address overlap kills hybrid.** Northwind FMCG acquired Eastfield Foods —
both used `10.50.0.0/16`. Site-to-site VPN between those two sites requires
NATting inside the tunnel, which breaks application protocols that embed IPs
in the payload. Re-addressing is the right fix (N11); plan IP space before
merging networks.

**MTU causing large-but-not-small failures.** HTTP works (small packets). A
file transfer or database bulk load hangs. IPsec overhead shrinks the effective
MTU. TCP MSS clamping usually saves TCP; UDP protocols (NFS, iSCSI) and
custom apps are not saved. Test with a large ICMP do-not-fragment ping before
declaring the tunnel production-ready.

**PCI and shared tunnel scope.** Running PCI CDE traffic and non-CDE traffic
over the same IPsec tunnel can collapse the segmentation that PCI-DSS requires.
An auditor may require separate tunnel instances or separate gateways. Raise
this in design, not in the audit finding.

## Going deeper (optional)

- RFC 7296 — IKEv2 specification.
- RFC 4301 — IPsec architecture (SAs, SPD, SAD).
- RFC 3948 — UDP encapsulation of IPsec ESP (NAT-T).
- NIST SP 800-77 Rev. 1 — Guide to IPsec VPNs (deprecates IKEv1, 3DES, and
  DH group 2; basis for migrating to IKEv2).
- GCP: "HA VPN topologies" in the official Cloud VPN documentation.
- AWS: "AWS Site-to-Site VPN" in the VPN user guide.
- Follows N32 (WAN); leads to N37 (remote-access VPN) and N38 (dedicated
  interconnect — the step up when IPsec bandwidth or SLA isn't enough).
- Pairs with N29 (PCI-DSS / RBI compliance shaping VPN design) and S12
  (encryption in transit).

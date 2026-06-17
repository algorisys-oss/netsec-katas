# Kata N19 — DHCP & IPAM

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N07, N08, N09, N17, N18 · **Time:** ~35 min
> **Tags:** `networking` `dhcp` `ipam` `l3-network` `on-prem` `hybrid` `meridian-bank` `fsi`

## Why it matters

Every device that joins a network needs an IP address, a subnet mask, a default
gateway, and a DNS server. DHCP (Dynamic Host Configuration Protocol) hands all
of that out automatically — and if it breaks, *nothing* can talk. At enterprise
scale, managing which address goes where, detecting conflicts, tracking leases,
and proving address ownership to an auditor requires a discipline called **IP
Address Management (IPAM)**. For architects: when a bank's branch network silently
hands out the wrong gateway, all branch traffic loops and the IT head gets paged at
2 a.m. When cloud VMs pick up the wrong DNS server from a DHCP option set, every
hostname resolution fails silently. DHCP is unglamorous, auditable, and the thing
that gets blamed last — after DNS, after routing, after "the app."

## The mental model

### The problem DHCP solves

Before DHCP, an admin manually assigned each host an IP address. That doesn't
scale past a few dozen devices. The alternative — let every host pick its own IP —
produces conflicts. DHCP is the standardized protocol (RFC 2131) that lets a
central server hand out configuration *on demand* to any host that asks.

### The DORA handshake (four UDP messages)

DHCP uses UDP, port **67** (server) / port **68** (client). The client has no IP
yet, so it *broadcasts*:

```
  Client                                  DHCP Server
    │                                           │
    │──── DISCOVER (broadcast, src 0.0.0.0) ───►│  "Anyone out there? I need an IP."
    │                                           │
    │◄─── OFFER (server proposes) ──────────────│  "Here's 10.10.50.15/24, GW .1, DNS .5"
    │                                           │
    │──── REQUEST (broadcast, client accepts) ──►│  "I'll take that offer from you."
    │                                           │
    │◄─── ACK (lease confirmed) ────────────────│  "It's yours for 8 hours. Renew at 4."
    │                                           │
```

Why broadcast? The client doesn't know the server's IP yet, so it can't unicast.
The OFFER (and ACK) is broadcast only when the client sets the *broadcast flag*
(the 'B' bit) in the DISCOVER — per RFC 2131 §4.1. Many clients set it, which is
why you commonly see broadcast OFFERs. When the flag is clear (and giaddr/ciaddr
are zero), the server *unicasts* the OFFER/ACK to the client's hardware (MAC)
address and the offered `yiaddr` — it can address the frame to the client's MAC
even though the client has no configured IP yet. Either way the reply stays on
the local segment — which is why each subnet
needs either a DHCP server reachable directly, or a **DHCP relay agent** (IP
Helper on Cisco, `ip helper-address`) forwarding the broadcast as unicast to a
central server.

### What a DHCP lease contains

```
  Lease from Meridian HQ DHCP server for a workstation on 10.10.50.0/24:

  IP address        : 10.10.50.15
  Subnet mask       : 255.255.255.0   (/24)
  Default gateway   : 10.10.50.1
  DNS servers       : 10.10.0.5, 10.10.0.6   (internal resolvers — see N17, N18)
  Lease duration    : 28800 seconds (8 hours)
  Lease renewal T1  : 14400 s (50% mark — try to renew with same server)
  Lease renewal T2  : 25200 s (87.5% mark — broadcast to any server)
  Domain search     : meridian.example corp.meridian.example
```

Every field matters architecturally:
- **Gateway wrong** → host can't leave the subnet.
- **DNS wrong** → hostnames fail; see N17 for the cascade effect.
- **Lease too short** → churn, address exhaustion, log noise.
- **Lease too long** → stale leases waste address space; decommissioned VMs hold
  addresses; auditor can't match a lease to a live host.

### DHCP relay — the bridge for centralized DHCP

In any enterprise with more than one subnet, the DHCP server lives in a central
location. Broadcasts don't cross router boundaries. The fix: configure a **DHCP
relay agent** on each subnet's router interface. The relay catches the broadcast
DISCOVER, adds the client's subnet identity (the **giaddr** — gateway IP address
field), and forwards it as unicast to the DHCP server. The server sees the
giaddr, picks the right scope, and unicasts the reply to the relay, which
re-broadcasts it to the client.

```
  Branch subnet         Branch router          HQ DHCP server
  10.30.1.0/24          (DHCP relay on         10.10.0.10
                          gi0/0: 10.30.1.1)
       │                       │                      │
       │── DISCOVER (bcast) ──►│                      │
       │                       │─── DISCOVER (ucast, giaddr=10.30.1.1) ──►│
       │                       │◄── OFFER (ucast) ────────────────────────│
       │◄── OFFER (bcast) ─────│                      │
       │                       │                      │
```

### IPAM — the discipline above DHCP

DHCP assigns addresses dynamically. **IPAM** (IP Address Management) is the
management layer that tracks:
- Which subnets exist, their ranges, their purpose, their VLAN, their site.
- Which addresses are assigned (static), leased (DHCP), or reserved.
- DNS records that should match (forward + reverse) — "DDI" = DNS + DHCP + IPAM.
- Historical lease logs: who held 10.10.50.15 at 14:23 on 2025-11-04? (forensics)

Without IPAM you have a spreadsheet. A spreadsheet doesn't catch overlaps, doesn't
alert on exhaustion, and can't answer the auditor's "who owned that IP during the
incident?" in under a minute.

## Worked example

Meridian Bank's HQ-DC1 manages DHCP centrally for all subnets. The branch network
`10.30.0.0/16` is divided into one /24 per branch (220 branches, so .0–.219 are
allocated; see N09 for how this carving was done).

**Branch 7 scope** in the central DHCP server:

```
  Scope name   : Branch-007-Patna
  Network      : 10.30.7.0/24
  Range        : 10.30.7.10 – 10.30.7.200   (191 leases available)
  Exclusions   : 10.30.7.1 – 10.30.7.9      (static: router .1, APs .2–.5, printers .6–.9)
  Gateway      : 10.30.7.1
  DNS          : 10.10.0.5, 10.10.0.6       (HQ resolvers, split-horizon aware — N18)
  Domain       : branches.meridian.example
  Lease time   : 86400 s (24 h — suitable for a branch, devices mostly stay)
```

When a teller's laptop boots:
1. It sends DHCP DISCOVER broadcast on `10.30.7.0/24`.
2. The branch router's DHCP relay (`ip helper-address 10.10.0.10`) forwards it to
   HQ.
3. The HQ DHCP server matches giaddr `10.30.7.1` to the Branch-007-Patna scope.
4. It issues `10.30.7.42` from the dynamic range. ACK arrives back via relay.
5. The IPAM system logs: `10.30.7.42 | lease start 2025-11-04 08:12:11 |
   MAC 00:1a:2b:3c:4d:5e | Branch-007-Patna`.

**Address exhaustion test (do the math):**
- /24 = 256 addresses. Exclude .0 (network), .255 (broadcast), .1–.9 (static) =
  245 addresses in play. Dynamic range .10–.200 = 191 leases.
- Branch has ~60 teller devices + 30 customer tablets in queue + 10 staff phones.
  Peak: ~100 concurrent. 191 leases >> 100. Safe.
- But if a corporate PC mistakenly connects and holds its 24-hour lease even after
  leaving, the lease stays "used" until expiry. IPAM dashboards surface exhaustion
  before it hits zero.

**Northwind contrast:** Northwind's ~3,000 retail/field points each use a local
consumer-grade router defaulting to `192.168.0.0/24` — the classic sprawl problem.
After an acquisition, a DC scanner at "Eastfield Foods" gets `192.168.0.100` and
so does a Northwind scanner at a different site. No conflict on the wire (they're
separate segments), but the IPAM has no visibility into either, can't route between
them without NAT, and the helpdesk can't tell from a ticket which `192.168.0.100`
is which. That's the M&A IPAM problem (see N11).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| DHCP for VMs | DHCP server + relay agent, managed by NetOps | Automatic — GCP assigns IP via its internal DHCP-like mechanism; no config surface exposed to users | **DHCP option sets** — attached per VPC, define DNS servers and domain name; subnet handles allocation | Built-in; DHCP options configurable at VNet level via custom DNS settings; (Azure: TODO for DHCP option sets detail) |
| Static private IP | Reserved in DHCP, set per host NIC | Fixed internal IP: choose "Static" for a VM's NIC at creation | Elastic IP (public) or fixed private IP at ENI level ("Assign private IPv4 address") | Static private IP on NIC; static public IP via Public IP resource |
| DNS server injected | DHCP option: DNS server IP(s) | Custom DNS via Cloud DNS or per-VM metadata; override on VPC's custom DNS setting | DHCP option set: `domain-name-servers`; default is `AmazonProvidedDNS` (169.254.169.253) | Custom DNS in VNet settings; default Azure DNS (`168.63.129.16`) |
| Lease management | DHCP server lease database | No concept of leases; GCP manages internally | No exposed lease concept; IP held as long as ENI is allocated | No exposed lease concept |
| IPAM (tracking, planning) | Dedicated IPAM software (Infoblox, BlueCat, phpIPAM) | Manual tagging + org-level address planning; Network Intelligence Center for monitoring | **Amazon VPC IP Address Manager (IPAM)** — native service; tracks allocations across accounts/regions, enforces pools | **Azure Virtual Network Manager (IPAM feature)** — native pool/allocation tracking; 3rd-party IPAM integrates via API |
| DDI (DNS + DHCP + IPAM) | Infoblox DDI is the FSI gold standard | Split across Cloud DNS + metadata + manual tracking | Route 53 (DNS) + DHCP option sets + VPC IPAM — no fully integrated DDI | Azure DNS + built-in DHCP + nascent IPAM — (Azure: TODO) |

**GCP note:** inside a GCP VPC, each VM's DHCP configuration is handled by the
hypervisor's network layer (called the "metadata server" at `169.254.169.254`).
This is the same IP that serves instance metadata. You never configure a DHCP
scope in GCP — but you *do* control DNS (via Cloud DNS policies on the VPC) and
static/ephemeral IP assignment.

**AWS note:** the key lever architects touch is the **DHCP option set**. Every VPC
gets one; you can override `domain-name-servers` (e.g. point to your Route 53
Resolver or on-prem DNS forwarder for hybrid — see N18, N45) and `domain-name`.
Changing the DHCP option set affects all *new* leases; existing instances don't
re-DHCP until restarted or forced.

## Do it (the exercise)

### On your laptop [laptop]

1. **See your own DHCP lease:**
   ```bash
   # Linux
   ip addr show          # your IP and prefix
   ip route show         # default gateway
   cat /etc/resolv.conf  # DNS injected by DHCP (or systemd-resolved)
   # On many systems: check the lease file
   ls /var/lib/dhcp/dhclient.leases 2>/dev/null || \
     ls /var/lib/NetworkManager/dhclient-*.lease 2>/dev/null
   ```
   ```bash
   # macOS
   ipconfig getpacket en0     # shows the full DHCP packet fields your NIC received
   ```
   Identify: your assigned IP, subnet mask, gateway, DNS server(s), lease
   expiry time, and domain search list.

2. **Scope sizing exercise (pen and paper):**
   You're carving a DHCP scope for Meridian Bank's corp office A (`10.40.0.0/16`
   allocated to corp offices total). Office A has:
   - 300 staff laptops (rotate in/out during the day)
   - 20 printers (static)
   - 10 VoIP phones (static)
   - 5 network devices (static, excluded)

   a. Pick a subnet size (/24 or /23) that fits with room to grow.
   b. Designate static exclusion range, dynamic range, and reserved buffer.
   c. Choose an appropriate lease duration (8 h vs 24 h — and why?).

   Suggested answer: a /23 (`10.40.0.0/23`, 512 addresses) gives 510 usable.
   Reserve .1–.40 as static exclusions (GW .1, printers .10–.29, phones .30–.39,
   infra .40). Dynamic range 10.40.0.41–10.40.1.254 (470 leases). Lease = 8 h (short, because
   laptops join/leave frequently and you want addresses reclaimed daily).

3. **DHCP relay check [laptop]:**
   If you have a Linux host on a segmented network (or a VM), observe DHCP relay
   traffic:
   ```bash
   sudo tcpdump -i eth0 -n port 67 or port 68
   # On another terminal, force a DHCP renew:
   sudo dhclient -r eth0 && sudo dhclient eth0
   ```
   Watch for the DISCOVER → OFFER → REQUEST → ACK sequence. Note source/dest IPs
   and ports for each message.

### Cloud account steps [needs cloud account]

4. **AWS — inspect a DHCP option set:**
   ```bash
   aws ec2 describe-dhcp-options --region ap-south-1
   # Find your VPC's attached option set:
   aws ec2 describe-vpcs --query 'Vpcs[*].{VpcId:VpcId,DhcpOptionsId:DhcpOptionsId}'
   ```
   Identify what DNS server is configured. Is it `AmazonProvidedDNS` or a custom
   resolver? What domain name is injected?

5. **AWS VPC IPAM — explore allocations [needs cloud account]:**
   In the AWS Console → VPC → IP Address Manager: see how pools are organized by
   region and account. Note the "compliance" view showing allocated vs available.

## Say it back (self-check)

1. Name the four messages in the DHCP DORA handshake and why DISCOVER is
   broadcast — and what determines whether the OFFER is broadcast or unicast.
2. What is a DHCP relay agent and why is one needed for centralized DHCP across
   multiple subnets?
3. What does the `giaddr` field tell the DHCP server, and what does the server do
   with it?
4. Name three things that go wrong if the DHCP lease time is too long vs too short
   for an enterprise network.
5. How does AWS let you inject a custom DNS server into VMs without touching the
   VM's OS config? What is the equivalent control surface in GCP?

## Talk to the IT/security head

**Ask:**
- "Where does your DHCP server live, and do branches use relay agents or local
  DHCP?" *(A centralized answer is operationally tighter but adds a dependency on
  WAN; local DHCP at branches is more resilient but harder to audit.)*
- "What IPAM tool are you running? Can it tell me who held IP `10.30.7.42` on
  November 4th at 14:23?" *(This is the forensics question. If they can't answer
  in under a minute, incident response will be painful.)*
- "Are your DHCP lease logs ingested into the SIEM? How long are they retained?"
  *(Lease logs are a tier-one source for lateral movement detection: new MAC on a
  subnet, IP hopping, DHCP exhaustion as a DoS indicator.)*
- "How do you detect and alert on unauthorized DHCP servers (rogue DHCP) on the
  network?" *(A rogue DHCP server can hand out a malicious gateway or DNS server
  to every new device on a segment — man-in-the-middle with no malware.)*
- "When we migrate a workload to cloud, how do we ensure VMs in the VPC get the
  right DNS server — your internal resolver, not the cloud default?" *(The answer
  is DHCP option sets in AWS or Cloud DNS policies in GCP.)*

**A good answer sounds like:** named IPAM software (Infoblox, BlueCat, or a cloud-
native equivalent), retention of lease logs beyond 90 days (for forensics), rogue
DHCP detection on the LAN (802.1X or DHCP snooping), and a clear answer on what
the cloud VPCs are using for DNS.

**Red flags:**
- "We track IPs in a spreadsheet." → No historical lookup, no conflict detection,
  no exhaustion alerting. Incident response will be slow and painful.
- "I don't know what rogue DHCP is." → One misconfigured device or attacker can
  redirect every new connection on a segment with no firewall change required.
- "Lease logs? Those aren't kept." → Forensic dead end; PCI-DSS Requirement 10
  (log retention) may be violated if DHCP logs aren't covered.
- Cloud VMs using `AmazonProvidedDNS` or GCP's default when hybrid DNS was
  intended → split-horizon resolution breaks, internal names fail, cloud apps
  can't reach on-prem services by name (see N18).

## Pitfalls & war stories

- **The "ghost lease" problem.** A VM is decommissioned but its DHCP lease is still
  active for another 23 hours. The IP gets re-assigned to a new VM which picks it
  up at next renewal — but the old VM's DNS record hasn't been cleaned up. Two
  different things answer to the same hostname for a window. This is why DDI
  (DHCP-triggered DNS updates) matters and why lease duration must be calibrated
  to device lifecycle.

- **Rogue DHCP at Northwind.** An SD-WAN appliance was shipped pre-configured with
  a DHCP server on its LAN port. When plugged in at a distribution center, it
  started answering DHCP requests before the legitimate central server did (it was
  local, lower latency). On a `192.168.0.0/24` site, fifty barcode scanners got
  gateway `192.168.0.1` (the appliance) instead of the real distribution-center
  gateway `192.168.0.254`. Scanning traffic silently dropped. Root
  cause took four hours to find because "the network was up" — every device had an
  IP, just the wrong one.

- **AWS DHCP option set gotcha.** A team updated the VPC's DHCP option set to point
  to the new Route 53 Resolver endpoint. All running instances kept the old DNS
  until restarted or forced to renew. The half-rebooted instances resolved
  differently from the un-rebooted ones. Debugging "intermittent DNS failures" took
  two days; the fix was `sudo dhclient -r && sudo dhclient` on each instance (or
  a rolling restart).

- **PCI-DSS scope creep via DHCP.** A branch printer was added to the same /24 as
  card terminals because "there was space." The DHCP server had no VLAN awareness;
  the printer was technically on the CDE segment and therefore in PCI scope. The
  auditor found it. The fix was a separate DHCP scope on a separate VLAN for
  non-CDE devices — a lesson in IPAM governance, not just addressing.

- **Lease exhaustion under load.** During a Northwind distribution center's peak
  season, a large number of temporary scanner devices were deployed — more than
  the /24 DHCP scope had room for after subtracting stale leases. Devices booted
  and showed "limited connectivity" (169.254.x.x APIPA address). Increasing lease
  count required a subnet expansion that needed a change window. The lesson:
  monitor DHCP pool utilization proactively; alert at 80%.

## Going deeper (optional)

- RFC 2131 — *Dynamic Host Configuration Protocol* (the full DHCP spec; worth
  reading §1–2 for the state machine and packet format).
- RFC 3046 — *DHCP Relay Agent Information Option* (how giaddr and option 82
  are used for circuit identification in enterprise networks).
- RFC 6842 — *Client Identifier Option in DHCP Server Replies* (relevant when
  you need to track leases by client-id vs MAC).
- Infoblox DDI architecture white-papers — the FSI standard for DDI at scale.
- AWS VPC IPAM documentation — `docs.aws.amazon.com/vpc/latest/ipam/` — for the
  AWS-native approach across multi-account environments.
- DHCP snooping (Cisco IOS: `ip dhcp snooping`) — the L2 switch feature that
  blocks rogue DHCP servers by marking ports as trusted/untrusted. Revisit in N26
  (firewalls) and N29 (PCI-DSS network controls).
- Pairs with: N17 (DNS resolution), N18 (enterprise/hybrid DNS), N09 (subnetting
  and address planning), N11 (M&A address sprawl), N26 (firewall rules that gate
  DHCP relay traffic).

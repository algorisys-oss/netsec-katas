# Kata N16 — NAT & PAT; why it shapes cloud egress

> **Track:** Networking · **Module:** N3 Routing & switching · **Prereqs:** N12, N13, N15 · **Time:** ~35 min
> **Tags:** `networking` `nat` `l3-network` `egress` `cloud` `nat-gateway` `rfc1918` `firewall`

## Why it matters

Private RFC 1918 addresses (see N07) are not routable on the internet. NAT —
Network Address Translation — is the mechanism that lets millions of internal
hosts share a handful of public IPs. Every enterprise internet breakout uses it,
every cloud VPC uses it for outbound traffic, and the cost model of cloud egress
is shaped directly by where NAT lives in your design. When an IT head says "our
internet gateway is NATting everything" or a cloud engineer says "spin up a Cloud
NAT," they are solving the same problem. If you don't understand what the NAT
table is and what breaks when it fills up or mis-fires, you will not be able to
diagnose connectivity failures or challenge an egress-cost conversation.

## The mental model

### Why NAT exists at all

RFC 1918 reserves three ranges for private use — `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16` — and every ISP drops them at the border. A host with address
`10.10.1.5` cannot reach `8.8.8.8` unless something on the way rewrites that
source IP to a publicly routable address. That rewrite is NAT.

```
  INSIDE (private)              BORDER DEVICE            OUTSIDE (internet)
  ─────────────────             ─────────────            ──────────────────
  10.10.1.5:54321   ──────▶   NAT rewrites src    ──▶   203.0.113.10:54321
                               src: 10.10.1.5        public IP assigned to org
                               →   203.0.113.10

  Reply arrives at 203.0.113.10:54321
  NAT looks up table, rewrites dst back to 10.10.1.5:54321   ◀──────────
```

The NAT device keeps a **translation table** mapping every active flow:

```
  Private endpoint          Public endpoint         Protocol  State
  ─────────────────────     ───────────────────     ────────  ─────
  10.10.1.5:54321     ↔     203.0.113.10:54321      TCP       ESTABLISHED
  10.10.1.8:49200     ↔     203.0.113.10:49200      TCP       ESTABLISHED
  10.10.2.20:52100    ↔     203.0.113.10:52100      TCP       SYN_SENT
```

### NAT vs PAT — the distinction that matters

**NAT (one-to-one):** one private IP maps to one public IP. Used when a server
needs to be *reached from the internet* — it gets a fixed public IP. Less common
now that cloud load balancers handle inbound.

**PAT (Port Address Translation), also called NAPT or IP masquerade:** many
private IPs share **one** (or a few) public IPs, differentiated by port number.
This is what your home router does. It's what enterprise internet breakouts do.
It's what cloud NAT gateways do for outbound traffic. When people say "NAT" in
the context of enterprise internet egress they almost always mean PAT.

```
  10.10.1.5:54321  ┐
  10.10.1.8:49200  ├──▶  203.0.113.10:{unique ports}  ──▶  internet
  10.10.2.20:52100 ┘
         many hosts          one public IP
```

The distinguishing mechanism: the NAT device tracks the **5-tuple**
(src IP, src port, dst IP, dst port, protocol) so it can reverse the mapping
when the reply arrives.

### What NAT hides and what it breaks

NAT is an **address-space firewall by accident**: unsolicited inbound packets
have no entry in the table, so they are silently dropped. This provides a weak
form of protection, but it is *not* a security control — a proper stateful
firewall (see N26) is needed.

Things NAT breaks:
- **Protocols that embed IP in the payload** — FTP (active mode), SIP/VoIP.
  Application-layer gateway (ALG) helpers patch the payload; they add complexity
  and are often disabled in cloud.
- **IPsec** — two distinct failure modes. With **AH** (Authentication Header),
  the IP header is covered by the integrity check (ICV), so NAT rewriting the
  source IP breaks that ICV — and AH cannot be made NAT-traversable, since NAT-T
  encapsulates ESP, not AH. With **ESP** (Encapsulating Security Payload), the
  transport-layer checksum is encrypted, so NAT cannot recompute it and the
  receiver's checksum validation fails. The fix is **ESP** (typically tunnel
  mode) with **NAT-T** (RFC 3948), which UDP-encapsulates ESP on UDP/4500.
- **End-to-end reachability** — a NATted host can initiate but cannot be
  directly reached. This shapes where you put load balancers and APIs.
- **Troubleshooting** — flow logs on a NATted path show only the public IP;
  correlating back to the internal host requires the NAT log itself.

### Hairpin NAT (a bank's private gotcha)

When an internal host tries to reach a service by its **public** IP even though
both are inside the same network, the packet hits the NAT device, gets translated
to the public IP, and — if the firewall doesn't route it back — the response
travels the long way out and in. Banks with rigid firewall segmentation hit this
constantly. The fix is split-horizon DNS (see N18) so internal hosts resolve
to the private IP directly.

## Worked example

Meridian Bank's HQ-DC1 sits on `10.10.0.0/16`. The bank has been allocated one
public IP block: `203.0.113.0/28` (14 usable addresses — a realistic small
enterprise allocation; `203.0.113.0/24` is IANA documentation space, safe to
use here).

Three subnets need internet access:
- `10.10.1.0/24` — application servers (servers initiate, e.g. OCSP checks, APIs)
- `10.10.2.0/24` — staff desktops
- `10.10.20.0/24` — PCI CDE (cardholder environment — **must NOT traverse the
  same NAT path as staff**, per PCI-DSS segmentation)

The IT head's solution:

```
  Subnet             NAT public IP    Purpose
  ─────────────────  ───────────────  ─────────────────────────────────────
  10.10.1.0/24  ──▶  203.0.113.1      app servers → internet (PAT, shared)
  10.10.2.0/24  ──▶  203.0.113.2      staff egress (PAT, shared)
  10.10.20.0/24 ──▶  203.0.113.3      CDE dedicated NAT IP — for allow-listing
                                       at payment processors; PCI-required
```

Why the CDE gets its own IP: PCI-DSS requires that the CDE's egress path be
distinct and auditable. Payment processors accept outbound connections only from
allow-listed IPs. That IP cannot be shared with staff desktops or app servers.

### Verifying NAT from the outside [laptop]

From your laptop (which is itself NATted by your ISP or home router):

```bash
# See what public IP your machine appears to have (via NAT)
curl -s https://ifconfig.me

# Compare with your actual internal IP — they will differ
ip addr show | grep 'inet '       # Linux
ipconfig | grep 'IPv4'            # Windows
```

The gap between what you see internally and what `ifconfig.me` returns is your
NAT translation in action.

### Tracing NAT state with conntrack (Linux) [laptop — but read the note]

On a Linux host (works inside a container or VM):

```bash
# Install conntrack if not present
# Ubuntu/Debian: apt-get install conntrack
# Then observe active NAT translations:
sudo conntrack -L -n          # show NAT entries only
```

**Note:** the sample line below is *synthetic*, matching the Meridian worked
example, and shows what the **NAT gateway / router itself** sees — its own
post-NAT public source IP (`203.0.113.1`). A laptop behind your ISP or home
router is an *ordinary host*, not the NAT device: its local conntrack table
tracks connections but will **not** show your post-NAT public IP, because that
translation happens upstream on the router. To see a translation like this you
must run `conntrack` on the box performing the NAT.

```
# tcp 6 86341 ESTABLISHED src=10.10.1.5 dst=8.8.8.8 sport=54321 dport=443 \
#     src=8.8.8.8 dst=203.0.113.1 sport=443 dport=54321 [ASSURED]
# Read (on the NAT device): inside 10.10.1.5:54321 → 8.8.8.8:443 appears as
#     203.0.113.1:54321 outside
```

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Outbound NAT for private instances | PAT on firewall / router | **Cloud NAT** (managed, per-region, per-router) | **NAT Gateway** (managed, per-AZ) | (Azure: TODO) |
| NAT IP address pool | Static public IPs on the firewall | Cloud NAT can auto-allocate or use reserved static external IPs | Elastic IPs assigned to NAT Gateway | (Azure: TODO) |
| NAT for inbound (1:1, server-facing) | DNAT / static NAT on firewall | Cloud Load Balancing (not Cloud NAT) / GCE instance external IP | Elastic IP on EC2, ALB/NLB for inbound | (Azure: TODO) |
| NAT logging / audit trail | Firewall syslog, netflow | Cloud NAT logs → Cloud Logging (toggle per Cloud NAT) | VPC Flow Logs capture post-NAT; NAT Gateway has CloudWatch metrics | (Azure: TODO) |
| Port exhaustion limit | Limited by public IP count × 65535 ports | Default 64,512 ports per IP; can add IPs or enable Dynamic Port Alloc. | 55,000 simultaneous connections per IP per unique destination (dest IP+port+protocol); add IPs (up to 8) to scale | (Azure: TODO) |
| NAT in PCI / regulated scope | Separate NAT IP per segment | Separate Cloud NAT per VPC / subnet if strict isolation needed | Separate NAT Gateway per subnet for CDE isolation | (Azure: TODO) |

### GCP Cloud NAT specifics

Cloud NAT is **regional** and attached to a **Cloud Router**. It is not a VM or
appliance — it is managed Google infrastructure. Private instances with no external
IP can reach the internet outbound; inbound connections are not allowed through
Cloud NAT (Cloud NAT is egress-only).

```
  Private VM (10.100.1.5)
        │
        ▼
  Cloud Router (us-central1)
        │ Cloud NAT attached here
        ▼
  Google Edge  →  internet
  (source appears as a Cloud NAT external IP)
```

Configure via CLI [needs cloud account]:

```bash
# Create a Cloud Router (prerequisite)
gcloud compute routers create meridian-nat-router \
  --network=meridian-vpc \
  --region=asia-south1

# Attach Cloud NAT to it
gcloud compute routers nats create meridian-cloud-nat \
  --router=meridian-nat-router \
  --region=asia-south1 \
  --auto-allocate-nat-external-ips \
  --nat-all-subnet-ip-ranges

# Enable logging (important for audit/PCI)
gcloud compute routers nats update meridian-cloud-nat \
  --router=meridian-nat-router \
  --region=asia-south1 \
  --enable-logging
```

### AWS NAT Gateway specifics

AWS NAT Gateway lives in a **public subnet** (one with a route to an Internet
Gateway). Private subnets route `0.0.0.0/0` to the NAT Gateway. One NAT Gateway
per AZ is best practice — a single NAT Gateway is a single-AZ dependency.

```
  Private subnet (10.104.2.0/24) in ap-south-1a
        │  route: 0.0.0.0/0 → nat-gw-id
        ▼
  NAT Gateway (in public subnet, ap-south-1a)
        │  has an Elastic IP
        ▼
  Internet Gateway → internet
```

Cost watch: AWS NAT Gateway charges **$0.045/hr** (us-east-1 rate; verify
current pricing) plus **$0.045 per GB** of data processed. For Northwind
distributing large firmware updates to 3,000 retail sites, that per-GB charge
adds up fast — this is a real cost conversation to have with the IT head.

## Do it (the exercise)

### Part 1 — NAT table intuition [laptop]

1. On your laptop, find your internal IP and compare with your public IP:
   ```bash
   # internal
   ip addr show | grep 'inet '     # Linux/Mac alternative: ifconfig
   # public (what the internet sees)
   curl -s https://ifconfig.me && echo
   ```
   Write down both. The difference is your home/office router's PAT translation.

2. Open three browser tabs to three different sites. Then on Linux:
   ```bash
   # See active TCP connections with source ports — each tab gets a unique port
   ss -tn state established | grep ':443'
   ```
   Each connection to port 443 uses a different local source port. That port
   is how PAT (and the NAT table at your router) tells the flows apart.

### Part 2 — Meridian Bank address plan exercise [laptop / paper]

Meridian Bank's GCP project for its new digital channel uses `10.100.0.0/14`
(from `reference/running-example.md`). The app team has deployed private VMs in
`10.100.1.0/24` (asia-south1). They need outbound HTTPS to a payment processor
API at `198.51.100.10`.

On paper:
1. Without Cloud NAT, what happens when a VM at `10.100.1.5` sends a packet to
   `198.51.100.10`? (Hint: `10.x` is RFC 1918; the internet will not route it
   back.)
2. After enabling Cloud NAT with auto-allocated external IP `34.93.5.20`:
   - What does the source IP look like to `198.51.100.10`?
   - What entry does the Cloud NAT table hold?
3. The payment processor requires allow-listing a fixed IP. Should you use
   auto-allocated or a **reserved static external IP**? Why?

### Part 3 — Spot the egress cost trap [needs cloud account]

In a GCP or AWS console, locate the NAT gateway or Cloud NAT in a project you
have access to. Check:
- How many bytes have been NATted in the last 7 days?
- At $0.045/GB (AWS) or GCP's egress rates, what is the monthly cost estimate?
- Is there a way to route traffic to GCP/Google APIs through Private Google Access
  instead (bypassing NAT entirely for Google destinations)?

## Say it back (self-check)

1. What problem does NAT solve, and why do RFC 1918 addresses require it?
2. Explain the difference between NAT (one-to-one) and PAT (many-to-one). Which
   does an enterprise internet gateway almost always use?
3. What does the NAT table contain, and what happens to an unsolicited inbound
   packet that has no entry in it?
4. Why does PCI-DSS often require the CDE to NAT through a **dedicated** public IP
   rather than a shared one?
5. On GCP, what is Cloud NAT attached to, and why can't an external host initiate
   a connection to a private VM through Cloud NAT?

## Talk to the IT/security head

**Ask:**
- "How many public IPs does our NAT pool have, and is the CDE on a dedicated IP
  or shared with other traffic?"
  *Good answer:* the IT head knows the pool, knows which IP is allow-listed at
  payment processors, and can confirm the CDE is isolated. *Red flag:* "it all
  goes through the same firewall IP" — that may violate PCI-DSS segmentation if
  CDE and staff traffic share the NAT.
- "Are you logging NAT translations, and for how long are those logs retained?"
  *Good answer:* logs go to SIEM with 90-day hot / 1-year cold retention (PCI
  requires 12 months). *Red flag:* no NAT logging, or logs not correlated with
  internal IPs — makes incident forensics impossible.
- "For the cloud workloads, is outbound traffic through Cloud NAT / NAT Gateway,
  or do some instances have direct external IPs?"
  *Good answer:* private instances only, no external IPs on VMs, all egress
  through Cloud NAT with logging enabled. *Red flag:* "some VMs have public IPs
  for convenience" — each is a direct inbound attack surface and audit risk.
- "What's your NAT port exhaustion headroom? Have you ever hit SNAT exhaustion
  during peak load?"
  *Good answer:* they monitor NAT allocation metrics and have auto-scaling or
  multiple IPs. *Red flag:* blank looks — SNAT exhaustion causes silent connection
  drops that manifest as application timeouts, hard to diagnose.
- "Have you mapped which egress traffic actually needs internet vs could go via
  Private Google Access or VPC endpoints to AWS services — to save cost and
  reduce attack surface?"
  *Good answer:* yes, they use Private Google Access for Google API calls and VPC
  Endpoints for AWS services; NAT is only for true internet destinations.

## Pitfalls & war stories

**The Northwind M&A overlap + NAT patch-job.** When Northwind acquired Eastfield
Foods (both on `10.50.0.0/16` — see `reference/running-example.md`), the quick
fix was to NAT one side's traffic through a different IP range so they could talk
without re-IP-ing. This works short-term but creates double-NATted paths, kills
proper logging, and makes `traceroute` output nearly unreadable. The IT head
eventually had to re-IP Eastfield to clean it up (see N11).

**CDE shared-NAT audit finding.** At a bank similar to Meridian, the CDE hosts
NATted through the same IP as staff desktops because the firewall had a single
PAT rule for `10.x.x.x → one public IP`. The auditor asked: "Can you prove that
no non-CDE traffic shares this egress IP?" The answer was no. PCI finding, 90 days
to remediate. Separate NAT IPs per segment cost almost nothing; the remediation
cost tens of thousands.

**NAT logging off by default.** Both GCP Cloud NAT and AWS NAT Gateway require
you to explicitly enable logging. Default installs often have it off. When an
incident requires "which internal IP made connection X at 14:23:07," the answer
may be "we can't tell" — a forensics gap. Always enable NAT logging on day one
and route it to the SIEM.

**SNAT port exhaustion under load.** A fintech running batch payment jobs had all
workers on a single Cloud NAT with one IP. Under end-of-day batch load, they
exhausted the ~64,000-port limit and connections started silently failing. Fix:
enable Dynamic Port Allocation in Cloud NAT, or add more NAT IPs. This is the
conversation where the IT head needs to know max concurrent connections, not just
bandwidth.

**Forgetting NAT on the path breaks IPsec.** Meridian's branch VPN used IPsec
with **AH**, which covers the IP header in its integrity check (ICV). An
intermediate NAT device rewrote the source IP, broke the ICV, and the packets
were silently dropped. The fix is *not* "AH plus NAT-T" — NAT-T (RFC 3948)
UDP-encapsulates **ESP**, not AH, so it cannot rescue an AH flow at all. The
remediation was to move the tunnel to **ESP (tunnel mode) with NAT-T on
UDP/4500**, which survives NAT because the encrypted payload is wrapped in UDP.
The network team knew; the architect who designed the branch had assumed IPsec
"just works" through NAT. It does not — and AH in particular cannot be made to.

## Going deeper (optional)

- RFC 3022 — *Traditional IP Network Address Translator (Traditional NAT)*:
  the canonical definition of Basic NAT and NAPT (PAT).
- RFC 2663 — *IP Network Address Translator (NAT) Terminology and Considerations*:
  the vocabulary (Basic NAT, NAPT, ALG).
- RFC 4787 — *Network Address Translation (NAT) Behavioral Requirements for
  Unicast UDP*: defines connection-tracking behavior that affects STUN/WebRTC.
- GCP Cloud NAT documentation: <https://cloud.google.com/nat/docs/overview>
- AWS NAT Gateway documentation:
  <https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html>
- Pairs with N26 (stateful firewalls) and N41 (cloud route tables & egress design).
  Revisit cost implications in N57 (costing a network design).

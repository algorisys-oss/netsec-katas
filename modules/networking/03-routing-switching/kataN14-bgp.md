# Kata N14 — BGP: the protocol that runs the internet (and your cloud edge)

> **Track:** Networking · **Module:** N3 Routing & switching · **Prereqs:** N12, N13 · **Time:** ~40 min
> **Tags:** `networking` `bgp` `routing` `l3-network` `wan` `hybrid` `cloud` `fsi`

## Why it matters

BGP — Border Gateway Protocol — is how every network on earth announces reachability
to every other. Your cloud VPC connects to the internet via BGP. Meridian Bank's
MPLS WAN uses BGP between sites. The Dedicated Interconnect into GCP speaks BGP
underneath. When an ISP fails and traffic re-routes in minutes, BGP moved it. An
architect who can't read a BGP design can't ask: "what happens if we lose this
interconnect?", "why does traffic prefer one cloud region over another?", or "could
a route misconfiguration take down our internet path?" This kata gives you those
questions.

## The mental model

### Interior vs exterior routing (see N13)

OSPF fills the routing table *inside* a single network. BGP fills it *between*
networks. The boundary is the **Autonomous System (AS)** — a network under one
administrative policy (a company, a cloud provider, an ISP). Each AS has an
**ASN** (AS Number):

- Public ASNs: 1–64511 (within the 16-bit range; Google = AS15169, AWS = AS16509).
  4-byte ASNs (RFC 6793) extend the public space up to 4199999999.
- **Private ASNs: 64512–65534** — used on private interconnects and enterprise
  WANs, just as RFC 1918 addresses are used for private IPs

```
          Meridian Bank  (private ASN 65001)
       ┌──────────────────────────────────────┐
       │                                      │  eBGP  ┌──────────────┐
       │  [Core]──[Edge-A]────────────────────├────────►│ ISP-A AS1111 │
       │     │     [Edge-B]────────────────────├────────►│ ISP-B AS2222 │
       │   OSPF                               │  eBGP  └──────────────┘
       │  (interior)   [Interconnect-GW]───────├────────► Google AS15169
       └──────────────────────────────────────┘   (private session)
```

- **eBGP (external BGP):** between *different* ASes — your edge to your ISP,
  or your enterprise to Google. This is what "the internet" is: tens of thousands
  of eBGP sessions exchanging prefix advertisements.
- **iBGP (internal BGP):** between routers *inside* the same AS — so every
  internal router knows what the edge learned without OSPF carrying that data.

### What BGP exchanges

BGP peers exchange **prefix advertisements** — "I can reach `10.100.0.0/14` via
me." Each advertisement carries **path attributes**:

| Attribute | What it is | Why architects care |
|-----------|------------|---------------------|
| **AS_PATH** | Ordered list of ASNs the route has crossed | Loop prevention; longer = less preferred; prepend to de-prefer a path |
| **NEXT_HOP** | IP to forward to next | Misconfigured = blackhole |
| **LOCAL_PREF** | 0–4294967295, higher preferred (iBGP only) | "Prefer this exit" — the dial for primary/backup |
| **MED** | Multi-Exit Discriminator: hint to the *other* AS about preferred entry | Cloud interconnects expose this; lower = preferred |
| **COMMUNITY** | 32-bit policy tag | Signal to peers — e.g. "don't export this route" |

**Path selection (simplified):** highest LOCAL_PREF wins → shortest AS_PATH →
lowest MED → eBGP over iBGP → lowest router-ID. In practice, LOCAL_PREF is the
dial you turn to say "prefer the Dedicated Interconnect over the backup VPN."

### BGP convergence and security

BGP is **deliberately slow** — stability over speed at internet scale (900 000+
prefixes). Default hold timer is 90 seconds. **BFD (Bidirectional Forwarding
Detection, RFC 5881)** runs alongside BGP to detect link failures in < 1 second,
then triggers BGP withdrawal — critical for production interconnects.

**Route hijack and RPKI:** BGP trusts its peers. A misconfigured or malicious
advertisement of a more-specific prefix can attract traffic meant for someone else.
**RPKI (Resource Public Key Infrastructure, RFC 6480)** cryptographically ties ASNs
to IP prefixes; routers enforce ROV (Route Origin Validation) to reject unsigned or
mismatched advertisements. For a financial institution with an internet edge, RPKI
enforcement is a baseline control.

## Worked example

Meridian Bank HQ-DC1 (`10.10.0.0/16`) has two paths to GCP (`10.100.0.0/14`):

```
  Primary:  Dedicated Interconnect  10 Gbps — LOCAL_PREF 200 on CPE
  Backup:   IPsec VPN over internet  1 Gbps  — LOCAL_PREF 100 on CPE
```

- The CPE router sets LOCAL_PREF 200 on routes learned via the interconnect; all
  interior routers (iBGP) prefer that exit automatically.
- GCP's Cloud Router advertises `10.100.0.0/14` inbound; Meridian's CPE
  advertises `10.10.0.0/16` and `10.20.0.0/16` outbound — only those two
  prefixes (filtered via prefix-list), not `10.0.0.0/8`.
- On the on-prem CPE side, BFD detects the interconnect failure sub-second; on
  the GCP-managed side, Cloud Router's BFD minimum interval is 1000 ms and its
  minimum detect multiplier is 5, so the GCP side detects the failure in ~5 seconds.
  Either way BGP then withdraws the LOCAL_PREF 200 routes and traffic falls back
  to the VPN path (LOCAL_PREF 100).

**Non-overlapping IP ranges matter here.** Because Meridian uses `10.10.0.0/16`
on-prem and `10.100.0.0/14` in GCP, BGP can advertise both without ambiguity.
If they overlapped, the router would receive the same prefix from both sides and
have no basis to pick correctly — traffic would blackhole (see `running-example.md`
and N11 for the Northwind/Eastfield overlap story).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Private interconnect | MPLS / leased line | Cloud Interconnect (Dedicated or Partner) | AWS Direct Connect | (Azure: TODO) |
| BGP speaker | CPE router you own | Cloud Router (managed; no router VM) | Virtual Private Gateway or Transit Gateway | (Azure: TODO) |
| ASN on cloud side | Carrier ASN | AS15169 public, or private ASN per VLAN attachment | Private VGW default 64512 (since 2018; AS7224 is the legacy default, still used on public VIFs), or customer-chosen private ASN | (Azure: TODO) |
| Route propagation | Redistribute BGP → OSPF on CPE | Cloud Router auto-populates VPC route table | BGP routes propagate to VGW / TGW route table | (Azure: TODO) |
| Path preference (outbound from on-prem) | LOCAL_PREF on CPE | Set LOCAL_PREF on your CPE; Cloud Router does not expose LOCAL_PREF | Set LOCAL_PREF on customer router | (Azure: TODO) |
| Path preference (inbound to cloud) | MED, AS_PATH prepend | Cloud Router honours MED; lower = preferred entry | AWS honours MED and AS_PATH length | (Azure: TODO) |
| Fast failover | BFD alongside BGP | BFD on Cloud Router (min 1000 ms interval) | BFD on Direct Connect hosted connections | (Azure: TODO) |
| Route filtering | Prefix-lists / route-maps | Custom route advertisements on Cloud Router | Route policies on Direct Connect | (Azure: TODO) |

**GCP note:** Cloud Router is regional — one per region per interconnect. If
Meridian uses `us-central1` and `us-east1`, it needs a Cloud Router in each.

**AWS note:** A Direct Connect Gateway lets one DX connection reach multiple
VPCs/regions — the on-prem equivalent of one MPLS CE router reaching many sites.

## Do it (the exercise)

### 1. Read real BGP prefix announcements [laptop]

```bash
# Public RIPE stat API — no account needed
curl -s "https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS15169" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for p in d['data']['prefixes'][:8]:
    print(p['prefix'])
"
```

You'll see prefixes Google announces globally (e.g. `8.8.8.0/24`,
`142.250.0.0/15`). These are exactly what every internet router uses to route
traffic to Google.

### 2. Trace AS hops to a destination [laptop]

```bash
mtr --report --report-cycles 3 --aslookup 8.8.8.8
# or, if --aslookup is unavailable:
traceroute -A 8.8.8.8
```

Read the AS column. Each change is an eBGP boundary. Hops within one ASN are
iBGP (internal). Count how many ASes the packet crosses before reaching AS15169.

### 3. Check RPKI validity [laptop]

```bash
# RIPE Stat public RPKI validation API — no auth
curl -s "https://stat.ripe.net/data/rpki-validation/data.json?resource=AS15169&prefix=8.8.8.0/24" \
  | python3 -m json.tool
```

Look for `"status": "valid"` (and the matching ROA under `validating_roas`). An
`"invalid"` means the advertisement doesn't match the ROA — a router with ROV
enforced would drop it.

### 4. Paper exercise — path design [paper]

Meridian Bank has the primary interconnect and backup VPN above. Assign
LOCAL_PREF values so that:
- Traffic to GCP (`10.100.0.0/14`) prefers the interconnect; VPN takes over on
  failure.
- Inbound GCP traffic re-enters via HQ-DC1 (`10.10.0.0/16`) rather than DC2
  (`10.20.0.0/16`).

Write the LOCAL_PREF values and identify which BGP path selection step enforces
each preference. (Answer: interconnect = 200, VPN = 100; LOCAL_PREF is step 1.)

## Say it back (self-check)

1. What is an Autonomous System? What do private ASNs (64512–65534) have in common
   with RFC 1918 private IPs?
2. Distinguish eBGP from iBGP, and name one place each appears in a hybrid
   enterprise architecture.
3. If Meridian wants to prefer the Dedicated Interconnect over the backup VPN,
   which BGP attribute does the network team set, and on which device?
4. Why does default BGP convergence take up to 90 seconds, and what mechanism
   makes failover sub-second in production?
5. What does RPKI protect against, and why does it matter for a bank?

## Talk to the IT/security head

**Ask:**

- "What prefixes does Meridian advertise to Google via the interconnect — is there
  a prefix-list, or does it advertise a supernet?"
  *Good answer:* specific prefixes only (`10.10.0.0/16`, `10.20.0.0/16`), filtered
  by a prefix-list on the CPE — never `0.0.0.0/0` or the full `10.0.0.0/8`.
  *Red flag:* "we advertise everything" — a Cloud Router misconfiguration could then
  inject a default route into on-prem and redirect all internet traffic through GCP.

- "How long does failover from the interconnect to the VPN take, and when was it
  last tested?"
  *Good answer:* BFD enabled, < 1 second detection, BGP withdrawal in seconds,
  tested in the last change window with a documented RTO.
  *Red flag:* "it should be automatic, we've never needed to test it."

- "Is RPKI origin validation enforced at the internet edge?"
  *Good answer for a bank:* yes — ROV drops invalid advertisements at the border
  router.
  *Red flag:* no awareness of RPKI for an institution with an internet-facing
  presence — this is a baseline IP-hijacking defence.

- "Who owns the BGP configuration on the CPE — NetOps or the cloud team?"
  *Good answer:* named owner, change-control process through the CAB (see N02).
  *Red flag:* unclear ownership — a BGP misconfiguration can take down internet
  access; it must be gated by the same CAB process as any other routing change.

## Pitfalls & war stories

- **Advertising too broadly.** Permitting `10.0.0.0/8` toward GCP instead of
  specific subnets causes cloud route tables to send traffic destined for
  cloud-internal addresses back to on-prem — a silent blackhole. Use a prefix-list.

- **LOCAL_PREF vs MED confusion.** LOCAL_PREF is an *internal* signal — your CPE
  sets it, your iBGP peers read it, it never leaves your AS. MED is a hint *to the
  other AS* about which entry point to prefer. You can't set LOCAL_PREF on Cloud
  Router; influence inbound GCP path selection via MED or AS_PATH prepending.

- **BFD not enabled.** Default BGP hold timer is 90 seconds. Enable BFD on
  production interconnects — without it, a link failure causes a 90-second
  blackhole, which violates core-banking SLAs.

- **Cloud Router is regional (GCP).** Architects drawing "one interconnect" forget
  that a Cloud Router is per-region. Meridian's DR region (`us-east1`) needs its
  own Cloud Router and VLAN attachment.

- **M&A address overlap.** Northwind and Eastfield Foods both used `10.50.0.0/16`.
  When Northwind interconnected the two networks post-acquisition, both sides
  advertised the same prefix; half the merged company became unreachable. IP
  overlap audit belongs in M&A day-one scope (see N11).

## Going deeper (optional)

- RFC 4271 — BGP-4 specification.
- RFC 6480 — RPKI architecture overview.
- RFC 5881 — BFD for IPv4/IPv6 (single-hop).
- GCP: Cloud Router overview — `cloud.google.com/network-connectivity/docs/router`
- AWS: Direct Connect routing and BGP — `docs.aws.amazon.com/directconnect/latest/UserGuide/routing-and-bgp.html`
- Cloudflare RPKI portal: `rpki.cloudflare.com` — shows global ROV adoption status.
- Pairs with N36 (IPsec/VPN, the BGP backup path), N38 (dedicated interconnect
  deep dive), and N41 (how VPC route tables consume BGP-learned routes).

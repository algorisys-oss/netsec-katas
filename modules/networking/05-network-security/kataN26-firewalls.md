# Kata N26 — Firewalls: stateful vs stateless; rule design; default-deny

> **Track:** Networking · **Module:** N5 Network security & perimeter · **Prereqs:** N03, N15, N20 · **Time:** ~40 min
> **Tags:** `firewall` `stateful-firewall` `segmentation` `security` `l4-transport` `defense-in-depth` `fsi` `meridian-bank`

## Why it matters

A firewall is the single most common point of friction in any design that crosses
network boundaries — and at a bank or FMCG, *everything* crosses a boundary. The
conversation that blocks a project isn't usually "can your app do X?" — it's "the
firewall team won't open that port." If you can't speak firewall — stateful vs
stateless, rule anatomy, default-deny posture — you'll either wait three weeks for
a change you can't articulate, or you'll ask for far too much access and light up
the CISO's risk register. Understanding firewalls lets you scope the request right
the first time, challenge an over-permissive rule, and explain to the IT head why
a shortcut is dangerous.

## The mental model

### What a firewall actually does

A firewall is a **packet filter with a policy**: for every packet arriving on an
interface, it evaluates a list of rules (the *rule base*) and decides to
**permit** or **deny** the packet. Rules match on some combination of:

```
  Source IP / range       e.g. 10.10.1.0/24
  Destination IP / range  e.g. 10.100.2.5/32
  Protocol                TCP, UDP, ICMP
  Source port             usually "any" for clients (ephemeral)
  Destination port        e.g. 443, 5432
  Direction               inbound / outbound
```

Rules are evaluated **top to bottom, first match wins**. What happens when no
rule matches is the central design decision: **default-deny** (drop everything
not explicitly permitted — the FSI default) vs **default-allow** (pass everything
not explicitly denied — occasionally seen in development, never in production FSI).

```
  Rule list (top → bottom, first match wins)
  ──────────────────────────────────────────
  1. permit  10.10.1.0/24  → 10.100.2.5/32  TCP 443
  2. permit  10.10.1.0/24  → 10.100.2.5/32  TCP 80
  3. deny    any           → any             any        ← implicit or explicit default-deny
```

### Stateless vs stateful — the core distinction

**Stateless firewall** (also called a *packet filter*): each packet is evaluated
in isolation. The firewall doesn't remember anything about previous packets.

```
  Client 10.10.1.5  ──►  SYN → dest 10.100.2.5:443   → rule matches, PERMIT
                    ◄──  SYN-ACK ← source 10.100.2.5:443  → needs a separate PERMIT rule
                    ──►  ACK → dest 10.100.2.5:443   → needs a separate PERMIT rule
```

To allow TCP with a stateless filter, you must explicitly permit *return traffic*,
typically all high-numbered (ephemeral) source ports (1024–65535) from the server
back to the client. This means writing: "permit TCP from 10.100.2.5 port 443 to
any port 1024-65535" — which is broad and error-prone.

**Stateful firewall**: the firewall maintains a **connection tracking table**
(also called a *session table* or *state table*). When a client initiates a TCP
connection and the SYN is permitted, the firewall creates an entry:

```
  State table entry:
  Proto  Src IP          Src port  Dst IP         Dst port  State
  TCP    10.10.1.5       52341     10.100.2.5     443       ESTABLISHED

  Return packet: src=10.100.2.5:443 dst=10.10.1.5:52341
   → matches state table → PERMIT (no explicit return rule needed)
```

Return packets are automatically permitted if they match an established session
tracked in the state table. You only write rules for *initiated* traffic. For UDP
(connectionless), stateful firewalls typically set a short idle timeout (often
tens of seconds; vendor- and protocol-dependent) after
the last packet — any reply within that window is considered "return traffic."

**ICMP** responses (e.g. ping reply) are similarly tracked: permit an ICMP echo
request outbound, and the echo-reply back in is automatically allowed.

```
  Stateless              Stateful
  ─────────────────────  ──────────────────────────────────
  No memory              Session/state table
  Every packet isolated  Understands connection context
  Must permit returns    Returns automatic from state
  Simpler, faster        Slightly more resource use
  AWS NACLs (by default) AWS Security Groups, GCP firewall rules,
                         most enterprise HW firewalls
```

### Default-deny and rule ordering

The safe baseline for any production network is **default-deny** (sometimes called
"implicit deny"): the last rule in every firewall policy is a catch-all `deny any
any`. Everything not explicitly permitted is dropped. This is also called a
*whitelist* model (contrast with a *blacklist* that only blocks known-bad).

In FSI this is not optional — PCI-DSS v4.0 mandates restricting traffic to only
that which is necessary and **specifically denying all other traffic**: Req 1.3.1
for inbound traffic to the CDE and Req 1.3.2 for outbound traffic from the CDE
(Req 1.4.1 covers the Internet↔CDE boundary specifically). In v4.0, Req 1.2.1
governs configuration standards for network security control (NSC) rulesets; the
deny-all language lived under Req 1.2.1 in the older v3.2.1. RBI guidelines echo
this. The auditor
will ask for evidence that the default is deny.

**Rule order matters because evaluation stops at first match.** A common mistake:
putting a broad `permit any` rule early in the list accidentally allows traffic
the later specific `deny` rules were meant to block.

```
  BAD ordering:
  1. permit  any → 10.10.0.0/16  any        ← matches everything going to HQ-DC1
  2. deny    any → 10.10.20.0/24 any        ← NEVER reached; rule above already matched

  GOOD ordering (specific before general):
  1. deny    any → 10.10.20.0/24 any        ← CDE segment blocked first
  2. permit  any → 10.10.0.0/16  TCP 443    ← then allow specific traffic to the rest
  3. deny    any → any            any        ← default-deny
```

### Stateful firewall and protocol awareness

Most modern enterprise firewalls (Palo Alto, Cisco ASA/Firepower, Fortinet, cloud
virtual firewalls) are also **application-aware** or **next-generation firewalls
(NGFW)**. They inspect above L4 — recognizing that something on port 80 isn't HTTP,
or blocking TLS to a category of destination. For architects: understand that an
NGFW blurs the L4/L7 boundary, which is why "open port 443" at a bank can trigger
a discussion about *which* applications are permitted through, not just the port.

## Worked example

### Meridian Bank: the GCP mobile backend

The Meridian Bank mobile backend lives in GCP (`10.100.0.0/14`, see
`reference/running-example.md`). Specifically, the application tier is in
`10.100.2.0/24`. Core banking lives at HQ-DC1 on `10.10.0.0/16`; the PCI
cardholder data environment (CDE) sits in `10.10.20.0/24`.

The requirement: mobile app servers (in GCP, `10.100.2.0/24`) must query the
core banking API (at `10.10.1.20`, port 8443/TCP) but must **never** reach the
CDE directly.

Here is the firewall rule base on the HQ-DC1 perimeter firewall (edge of
`10.10.0.0/16`):

```
  Rule  Action  Protocol  Source           Dest             Dst Port  Comment
  ────  ──────  ────────  ───────────────  ───────────────  ────────  ─────────────────────
   1    DENY    any       10.100.0.0/14    10.10.20.0/24    any       Block cloud→CDE
   2    PERMIT  TCP       10.100.2.0/24    10.10.1.20/32    8443      Cloud app→core API
   3    DENY    any       any              any              any       Default deny
```

Rule 1 is specific and comes first — it blocks *any* GCP-originated traffic from
reaching the CDE segment, regardless of later rules. Rule 2 opens the narrowest
possible path: only the app tier (`10.100.2.0/24`, not the whole GCP block), only
to the exact server (`/32`), only on the one port (8443). Rule 3 is the
default-deny.

The firewall is **stateful**, so when `10.100.2.5` sends a TCP SYN to
`10.10.1.20:8443`, the state table is updated. The response from `10.10.1.20` on
an ephemeral source port back to `10.100.2.5` is automatically permitted — no
return rule needed.

**What this looks like in a change request:**

```
  Requester: Digital banking team
  Change: Open path for mobile backend to reach core API
  Protocol: TCP
  Source: 10.100.2.0/24 (GCP app tier)
  Destination: 10.10.1.20/32 (core banking API server)
  Port: 8443
  Direction: outbound from GCP; return traffic via state
  Justification: PCI-scoped traffic; CDE excluded by rule 1
  Approver: CISO / CAB
```

This is the format the network team needs. "Open a port between cloud and
on-prem" will be rejected or delayed — it's too vague to approve safely.

### Northwind FMCG: plant isolation

Northwind's manufacturing plants (OT/IT separation) use a simple **stateless**
packet filter at the plant edge because the legacy OT controllers cannot tolerate
the latency of a stateful session lookup, and bidirectional traffic is explicit
and predictable (SCADA polling, not arbitrary TCP connections).

```
  Rule  Action  Protocol  Source           Dest             Src Port  Dst Port
  ────  ──────  ────────  ───────────────  ───────────────  ────────  ────────
   1    PERMIT  TCP       10.50.0.0/16     10.50.1.0/24     any       102      (Siemens S7)
   2    PERMIT  TCP       10.50.1.0/24     10.50.0.0/16     102       1024:65535  (return)
   3    DENY    any       any              any              any       any
```

Notice rule 2 is an **explicit return rule** — required because the stateless
filter doesn't track sessions. The broad return port range (1024:65535) is a
known downside of stateless firewalls. This is acceptable here because the source
is tightly scoped to `10.50.1.0/24` (plant controllers only) and the destination
is the corporate SCADA supervisory network.

> Note: the OT/IT split shown here (`10.50.1.0/24` controllers vs the rest of
> `10.50.0.0/16` as the SCADA supervisory network) is **illustrative** — it is
> not in `reference/running-example.md`, which only records `10.50.0.0/16` as
> "Original Northwind" without an OT subnet plan. The S7comm direction is
> modelled correctly (the supervisory master initiates; the controllers are the
> S7 servers listening on TCP 102).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| **Stateful packet filter** | Hardware firewall (Palo Alto, Cisco ASA, Fortinet) | VPC Firewall Rules (stateful by default) | Security Groups (stateful) | (Azure: TODO) |
| **Stateless packet filter** | ACL on a router / L3 switch | — (GCP has no native stateless packet filter at VPC level; use hierarchical FW policy for deny-first ordering) | Network ACLs (stateless; both directions needed) | (Azure: TODO) |
| **Default-deny posture** | Implicit deny at end of ACL; explicit in NGFW | Implied deny — all traffic blocked unless a rule permits it | Security Group: default deny all inbound; NACLs: default deny via explicit rule | (Azure: TODO) |
| **Rule evaluation order** | Top-down, first match | Priority number (lower = evaluated first); implied deny at end | Security Groups: all rules evaluated (union); NACLs: top-down, first match | (Azure: TODO) |
| **Connection tracking** | NGFW/stateful FW session table | Implicit in VPC FW rules (established/related traffic auto-permitted) | Security Group tracks state; NACL does not | (Azure: TODO) |
| **Next-gen / L7 awareness** | NGFW (Palo Alto NGFW, Cisco FTD, Fortinet FortiGate) | Cloud NGFW (managed NGFW-as-a-service with Palo Alto, Preview/GA varies by region) | AWS Network Firewall (stateful, Suricata-based) | (Azure: TODO) |
| **Centralized policy** | Firewall management plane (Panorama, Cisco FMC) | Hierarchical Firewall Policies (org/folder/project scope) | AWS Firewall Manager | (Azure: TODO) |

**Important GCP vs AWS difference to know:**

AWS has **two distinct layers** — Security Groups (stateful, per resource) and
Network ACLs (stateless, per subnet). Both can apply to the same traffic. An
architect who moves from on-prem to AWS must understand that a packet must pass
*both* the NACL (subnet boundary) and the Security Group (instance boundary).
Forgetting the NACL when a Security Group rule looks correct is a classic AWS
debugging trap.

GCP VPC Firewall Rules are all stateful and operate at the VPC level (not subnet);
rules can target instances by network tag or service account, not just CIDR — a
more granular model than traditional on-prem ACLs.

## Do it (the exercise)

### Part 1 — Rule design on paper [laptop / paper]

Take the Meridian Bank scenario above. Add a new requirement:

> A monitoring server at `10.40.5.10` (corp offices) needs to reach the GCP app
> tier (`10.100.2.0/24`) on TCP port 9100 to scrape metrics. No other corp-office
> traffic should reach GCP.

1. Write the firewall rule(s) to allow this. Insert them at the correct position
   in the rule base (before or after existing rules? why?).
2. State whether each rule you wrote would also be needed on a **stateless** filter.
   What extra rule would you need?
3. Identify the single rule in the existing base that provides the most protection
   for the CDE. What would break if it were removed?

### Part 2 — Test your local firewall [laptop]

On Linux, `nftables` (or the older `iptables`) is the kernel-level stateful
packet filter. Inspect the current rules without changing anything:

```bash
# Requires sudo; read-only inspection
sudo nft list ruleset 2>/dev/null || sudo iptables -L -n -v --line-numbers
```

Identify:
- Is there a default policy of ACCEPT or DROP on the INPUT chain? (That's your
  default-permit or default-deny posture for inbound traffic.)
- List one rule and state: what source, destination, and port does it match?

On macOS, the equivalent is `pf` (Packet Filter):

```bash
sudo pfctl -sr   # show current rules (read-only)
```

### Part 3 — Simulate a stateful vs stateless difference [laptop]

Use `iptables` in a container or VM to see the difference (this creates and
immediately removes temporary rules — it does not persist):

```bash
# Run in a Docker container to avoid touching your host
docker run --rm -it --cap-add NET_ADMIN ubuntu:22.04 bash

# Inside the container:
apt-get update -qq && apt-get install -y -qq iptables curl

# Default policy: ACCEPT (default-permit — observe what's allowed)
iptables -L INPUT -n --line-numbers

# Add a stateful rule: allow ESTABLISHED,RELATED return traffic
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -P INPUT DROP    # now default-deny for anything else

# Verify: can you still reach out (outbound is separate — OUTPUT chain)?
curl -s --max-time 3 http://example.com | head -1

# What happens to unsolicited inbound? (In this container context it's
# simulated — but the rule logic is real.)
iptables -L INPUT -n --line-numbers
iptables -P INPUT ACCEPT  # reset before exiting
exit
```

Key observation: the `--ctstate ESTABLISHED,RELATED` rule is the stateful
behaviour — it allows return traffic for connections your host *initiated*,
without needing an explicit return rule per port.

`[needs cloud account]` — To verify GCP Firewall Rules: in GCP Console →
VPC network → Firewall → observe that all rules show "Stateful" and that an
implied deny appears at priority 65535. Notice rules target network tags, not
just CIDRs.

## Say it back (self-check)

1. Explain the difference between a stateful and stateless firewall using the
   phrase "connection tracking table."
2. Why does a stateless firewall need explicit return rules, and what makes that
   risky?
3. What is default-deny? Which PCI-DSS requirement mandates it? (v4.0 Req 1.3.1/1.3.2)
4. In the Meridian Bank rule base, why must Rule 1 (deny cloud→CDE) come before
   Rule 2 (permit cloud→core API)?
5. In AWS, what is the difference between a Security Group and a Network ACL?
   Which is stateful?

## Talk to the IT/security head

**Ask:**

- "Are your perimeter firewalls stateful or stateless — and do you use NGFWs with
  application awareness?" *(determines whether 'open port 443' means all HTTPS or
  can be restricted to specific apps)*
- "What is the default policy on each zone boundary — explicit deny-all, or is
  there inherited permit?" *(reveals whether default-deny is actually enforced or
  assumed)*
- "How is your firewall rule base reviewed? Is there an annual cull of stale rules?"
  *(stale rules — 'firewall rule debt' — are a common audit finding and a real
  attack surface)*
- "Do you enforce least-privilege on source IPs, or do rules commonly reference
  broad ranges like /8 or /16?" *(identifies over-permissive rules that widen
  blast radius)*
- "When we request a new firewall rule, what's the typical CAB lead time and what
  justification do you need?" *(practical: how to scope your change request so it
  isn't sent back)*

**A good answer sounds like:**

"Our perimeter and inter-zone firewalls are stateful NGFWs with application
identification. Default policy is deny-all on every interface. Rule requests go
through the CAB with a business justification, source/dest/port, and a named
owner. We do a quarterly rule review and age out anything with no hits in 90 days."

**Red flags to listen for:**

- "We have a firewall" said as if that ends the conversation — no zone detail,
  no default posture stated. Often means flat network with a single perimeter.
- "We just open the port, the app team asks and we do it" — no CAB, no security
  review, no justification required. Rule base is probably a mess.
- "The default is allow; we only block known bad" — blacklist model in an FSI
  context is a serious posture problem (and likely an audit finding).
- Long pause when asked about rule review frequency — means stale rules, which
  means uncharted open paths.
- Confusion about which team owns the rule base. In a bank, if NetOps and Security
  both say "we do," it likely means neither does it consistently.

## Pitfalls & war stories

**The "any-any" shortcut.** Under delivery pressure, someone adds `permit any any
TCP 443` to unblock a stuck workstream. Six months later, 40 services are using
that path and nobody can remove the rule without an outage. This is how the
PCI-DSS scope explodes: once that rule exists, every server that can reach
destination 443 is potentially in scope.

**Forgetting return traffic on stateless filters.** A classic: a stateless ACL
on a router allows TCP from the app server to the database (port 5432), but the
return path (source 5432, random high dst port) is never opened. The connection
times out, not refused. Hours of debugging follow before someone remembers the
filter is stateless.

**AWS NACL vs Security Group confusion.** A common AWS mistake: the Security
Group allows inbound on port 443, the NACL denies it (or vice versa). Because
NACLs are evaluated first (at the subnet boundary), an inbound-allow Security
Group rule never fires. Especially common when NACLs are added later by a
different team. See N42 for the cloud firewall deep dive.

**Over-broad source CIDRs.** "The app team said their servers are in 10.100.0.0/14,
so I permitted the whole /14." That's 262,144 addresses. One compromised VM
anywhere in that block can now reach the core API. Always request the specific
subnet — for Meridian Bank, `10.100.2.0/24` not `10.100.0.0/14`.

**Rule base ordering surprises.** An engineer adds a well-intentioned
`deny 10.100.0.0/14 → 10.10.20.0/24` (block cloud→CDE) at the *bottom* of the
rule base, after a `permit 10.100.0.0/14 → 10.10.0.0/16 any` that already covers
the CDE subnet. The deny is never evaluated. The firewall passed traffic to the
CDE for months before an audit caught it.

**NGFW application-ID surprises.** The network team permits `application: web-
browsing` on port 443, believing this covers the banking API. The NGFW identifies
the API's TLS traffic as "unknown-application" and drops it. The fix is to
explicitly permit the application by signature or port — but the architect never
knew the NGFW was classifying traffic at L7.

## Going deeper (optional)

- PCI-DSS v4.0 Requirement 1 ("Install and maintain network security controls") —
  the exact control language your FSI customer's auditor will cite.
- RFC 9293 (TCP, which obsoletes RFC 793) — understand the SYN/SYN-ACK/ACK
  handshake that stateful tracking is built on; pairs with N20.
- Pairs with N27 (DMZ and segmentation) where firewall rule design is applied
  across multiple security zones.
- Pairs with S01 (defense in depth) — the firewall is one layer, never the only one.
- N42 covers cloud-native firewall constructs (GCP VPC Firewall Rules, AWS Security
  Groups + NACLs, Azure NSG) in depth.
- Palo Alto "App-ID and Content-ID" whitepaper — how NGFWs identify applications
  independent of port, useful background for FSI NGFW conversations.

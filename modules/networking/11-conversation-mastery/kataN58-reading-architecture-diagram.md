# Kata N58 — Reading an architecture diagram & spotting what's missing

> **Track:** Networking · **Module:** N11 Conversation mastery · **Prereqs:** N01, N03, N26, N27, N39, N42, N56 · **Time:** ~35 min
> **Tags:** `networking` `architecture-review` `conversation` `mental-model` `security` `hybrid` `fsi` `meridian-bank`

## Why it matters

Architects are handed diagrams constantly: a vendor's slide deck, a team's Confluence
page, an RFP attachment. The diagram is never complete. It is a *communication
artifact*, not a ground truth — and what it leaves out tells you as much as what it
shows. At a bank or FMCG, the missing control, the absent trust boundary, or the
unlabelled path between two zones is exactly where auditors find findings and where
incidents begin. If you can read a diagram systematically and ask the three questions
that surface the gap, you become the architect who prevents the problem rather than
the one who inherits it.

## The mental model

### What a diagram is (and isn't)

A network or architecture diagram is a *projection* — a slice of reality chosen by
its author to answer one question. It almost never shows:

- **all the traffic flows** (only the happy path)
- **the trust boundaries** (assumed, not drawn)
- **the security controls** (firewalls labelled but rule bases omitted)
- **the management/out-of-band plane** (how you reach a device if the data path is down)
- **the failure modes** (what happens when a link or zone disappears)
- **the compliance scope** (which zone is PCI/CDE? which is out of scope?)

Your job in a review is to read the diagram with *five overlapping lenses*:

```
  Lens 1 — Traffic flows    Where does data go? What crosses zone boundaries?
  Lens 2 — Trust boundaries  Which zones exist? What enforces the boundary?
  Lens 3 — Blast radius      If one zone is compromised, what else can it reach?
  Lens 4 — Management plane  How do humans reach devices? Is that path separate?
  Lens 5 — Compliance scope  Which components touch regulated data?
```

Apply them in order. Each lens takes 60–90 seconds on a real diagram; together they
produce a list of questions that make you look prepared, not adversarial.

### The seven things most diagrams omit

```
  ┌──────────────────────────────────────────────────────┐
  │  WHAT'S ON THE DIAGRAM    WHAT'S MISSING             │
  ├──────────────────────────────────────────────────────┤
  │  Boxes (servers, VMs)     WHAT THEY RUN              │
  │  Lines (connections)      DIRECTION, PORT, PROTOCOL  │
  │  Firewalls                WHAT THE RULES ACTUALLY DO │
  │  "Cloud" blob             WHICH REGION, WHICH VPC    │
  │  "Internet"               WHO CONTROLS THE EDGE?     │
  │  Redundancy arrows        FAILOVER LOGIC & RTO/RPO   │
  │  Data labels              CLASSIFICATION, RESIDENCY  │
  └──────────────────────────────────────────────────────┘
```

The instant you can name what's missing, you can ask the question. The question
surfaces the risk. The risk has an owner. That is the conversation.

### A reading protocol (use this every time)

```
  Step 1 — Orient (30 s)
    Find: where's the internet edge? where's the data? where are the users?

  Step 2 — Trace flows (2 min)
    Pick the most important data flow (e.g. customer → app → database).
    Walk every hop. Name the protocol and port at each boundary.
    Mark every hop you CAN'T name — those are questions.

  Step 3 — Find the trust boundaries (1 min)
    Draw a mental fence around each zone. What enforces it?
    No fence drawn = no fence exists? Ask.

  Step 4 — Apply blast radius (1 min)
    Pick the most exposed component. Compromise it.
    What can an attacker reach from there, with which protocol?

  Step 5 — Check the management plane (30 s)
    How do admins reach the firewalls, routers, cloud consoles?
    Is that path on the diagram? Is it separate from the data plane?

  Step 6 — Compliance scope (30 s)
    Which boxes touch regulated data? Are they labelled? Are they isolated?
```

Total time: ~6 minutes of silent reading before you say anything. Then you have a
concrete set of questions — grouped by the six lenses above — rather than a vague
opinion.

## Worked example

Meridian Bank's network team hands you this diagram before a design review for the
new GCP mobile-banking deployment:

```
  INTERNET
      │
  [Cloud LB]  203.0.113.10  (external VIP)
      │
  [App servers]  10.100.1.0/24  (GCP, us-south1)
      │
  [Firewall]
      │
  [Core banking DB]  10.10.20.0/24  (HQ-DC1, CDE subnet)
      │
  [Branch network]   10.30.0.0/16
```

Apply the protocol:

**Step 1 — Orient.**
Internet → Cloud LB → App servers (GCP, 10.100.1.0/24) → Firewall → Core DB
(HQ-DC1, 10.10.20.0/24). Branches also reach the Core DB. Three zones, but only
one firewall drawn.

**Step 2 — Trace the customer flow.**

```
  Customer mobile app
      │  HTTPS (port 443) — TLS? What cert? Terminated where?
  Cloud LB (203.0.113.10 external VIP)
      │  ??? port, ??? protocol
  App servers (10.100.1.0/24)
      │  ??? port — SQL? REST? What protocol crosses the firewall?
  Firewall
      │  ??? rule — who approved it? source/dest/port?
  Core banking DB (10.10.20.0/24)
```

Three "???" hops. Each is a question. Likely questions:
1. Where does TLS terminate — at the Cloud LB or at the app server?
2. What protocol and port runs from app servers to the Core DB across that firewall?
3. Is the interconnect between GCP (10.100.0.0/14) and HQ-DC1 (10.10.0.0/16) a
   Cloud Interconnect / Dedicated Interconnect or a VPN over the internet?
   (See N38 — the answer determines latency, cost, and whether the path is
   encrypted in transit.)

**Step 3 — Trust boundaries.**

The diagram shows one firewall between cloud and core. Questions:
- Is there a firewall between the Cloud LB and the app servers (north-south within
  GCP)? GCP firewall rules or Cloud Armor?
- Is the branch network (10.30.0.0/16) able to reach the Core DB directly, bypassing
  the firewall? The line from Branch to Core DB on the diagram suggests yes.

**Step 4 — Blast radius.**

The app servers (10.100.1.0/24) are internet-facing via the Cloud LB. If an app
server is compromised:
- Can it reach the Core DB directly (what are the firewall rules by source IP)?
- Can it reach the branch network (10.30.0.0/16)?
- Can it exfiltrate to the internet directly, or is egress controlled?

The diagram does not show a NAT gateway, so it is unclear whether app servers have
a route to the internet. If they do — and the diagram doesn't show that — you have
an unlabelled exfiltration path.

**Step 5 — Management plane.**

The diagram shows no management access. Questions:
- How do engineers SSH or console into the app servers? Is there a bastion host or
  IAP (Identity-Aware Proxy)? Is that path through the same firewall as the data
  plane?
- How is the Core DB managed? Direct access from HQ-DC1 admin network, or also
  reachable from GCP?

**Step 6 — Compliance scope.**

The Core DB sits in the segmented CDE subnet (10.10.20.0/24) within HQ-DC1 (see
running-example.md) — note that HQ-DC1 as a whole is *not* the CDE; only this
segmented /24 is. Questions:
- Is the app server zone in PCI scope? If it processes or transmits card data, it
  may be. The diagram doesn't say.
- Is the branch network (10.30.0.0/16) ever in CDE scope? Branches that process
  card payments would be.
- Does the GCP region (us-south1) satisfy data-residency requirements for Meridian
  Bank's jurisdiction?

### What the six steps produce

After six minutes you have twelve concrete questions grouped by lens. That is a
more useful contribution than any architectural opinion you could offer before
reading the diagram carefully.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Traffic inspection at the edge | Perimeter firewall / IPS | Cloud Armor + Cloud NGFW | AWS Network Firewall + WAF | Azure Firewall + Front Door WAF (Azure: TODO) |
| Intra-zone traffic control | L3 ACLs, micro-seg switches | VPC firewall rules (stateful) | Security Groups (per-ENI) | NSG (Azure: TODO) |
| Secure admin access (management plane) | Jump host / bastion | IAP (Identity-Aware Proxy) TCP forwarding | EC2 Instance Connect / AWS SSM Session Manager | Azure Bastion (Azure: TODO) |
| Connectivity HQ→Cloud | MPLS / leased line | Cloud Interconnect (Dedicated or Partner) | AWS Direct Connect | Azure ExpressRoute (Azure: TODO) |
| Egress control (prevent exfiltration) | Proxy / firewall default-deny outbound | Cloud NAT + VPC firewall default-deny egress | NAT Gateway + SG egress rules | Azure NAT Gateway + NSG (Azure: TODO) |
| Compliance scoping | Network diagram + PCI ROC | VPC / subnet labelling + SCC compliance view | AWS Config + VPC tagging | Microsoft Defender for Cloud (Azure: TODO) |

For Northwind FMCG the same table applies, but replace "Cloud Interconnect" with
SD-WAN (see N33) for the thousands of retail/field points — dedicated interconnect
at that scale is cost-prohibitive.

## Do it (the exercise)

**Part A — read a real diagram [laptop]**

1. Open any network or cloud architecture diagram you have access to: a vendor
   whitepaper, an internal Confluence page, or the Meridian Bank diagram in the
   worked example above (draw it on paper).
2. Apply the six-step protocol, timed: set a 6-minute timer. Produce:
   - The main traffic flow traced hop-by-hop, with protocol/port named or marked "?".
   - The trust boundaries identified and whether each has an enforcing mechanism named.
   - The blast radius from the most exposed component.
   - Any missing management-plane path.
   - The compliance scope, identified or missing.
3. Write down every "?" you produced. Each one is a question for the design review.

**Part B — apply the checklist to a real cloud diagram [laptop / needs cloud account]**

If you have a GCP or AWS account, export a VPC topology diagram from the console:
- GCP: Network Topology view in **Network Intelligence Center** → export or
  screenshot.
- AWS: **Reachability Analyzer** or the VPC resource map (AWS Console → VPC →
  Your VPC → Resource map tab).

Apply the protocol. Does the console diagram show:
- Which subnets have a default route to the internet (internet gateway attached)?
- Which subnets have egress-only (NAT gateway) vs full internet routes?
- Management-plane access paths?

Flag anything the diagram does not answer.

**Part C — present your findings (pair exercise)**

If working with a colleague: one person presents a diagram cold; the other has
3 minutes to apply the protocol silently, then asks their five best questions. The
presenter answers. After five minutes, swap.

## Say it back (self-check)

1. Name the five lenses. For each, state the one question it generates most often.
2. What does "management plane" mean, and why is it commonly missing from
   architecture diagrams?
3. A diagram shows a firewall between two zones. What does the diagram NOT yet tell
   you about that firewall?
4. At Meridian Bank, if an app server in GCP (10.100.1.0/24) is compromised, which
   other subnets in the running example could an attacker potentially reach? What
   would need to be true for the Core DB (10.10.20.0/24) to be reachable?
5. Why might the branch network (10.30.0.0/16) be in PCI-CDE scope at Meridian Bank,
   even though it doesn't host the Core DB?

## Talk to the IT/security head

**Questions to ask — and what good answers sound like:**

**Q1: "Walk me through the main traffic flow. What protocol and port does each hop use?"**
Good answer: the engineer traces the path confidently, names protocols and ports,
and identifies where encryption terminates (e.g., "TLS terminates at the Cloud LB,
then we use mTLS between the LB and app servers on port 8443").
Red flag: "it all goes through the firewall" — no ports, no protocols named. The
rule base is probably ad hoc and undocumented.

**Q2: "What enforces the boundary between the app zone and the core banking zone?"**
Good answer: "A stateful firewall with a specific allow list: source 10.100.1.0/24,
dest 10.10.20.0/24, port 5432 (Postgres), approved in CAB change #4471." They know
the rule.
Red flag: "the firewall is there" with no detail on *what rules*. A firewall with
no rules (or default-allow) is decoration.

**Q3: "How do your engineers access the GCP app servers and the HQ-DC1 core DB for
administration? Is that path on this diagram?"**
Good answer: "We use IAP TCP forwarding for GCP — no public SSH ports open. For
HQ-DC1 we have a dedicated admin VLAN (10.10.99.0/24) that reaches the DB subnet,
logged and monitored. Yes, it's on the full diagram, this one is simplified."
Red flag: "SSH is open on port 22 to 0.0.0.0/0" or blank silence. The management
plane is the most-exploited path and the first thing a good CISO will check.

**Q4: "Which components in this diagram are in PCI-CDE scope, and how is that
boundary maintained?"**
Good answer: "The Core DB and the payment processing app server are in CDE scope.
They're in an isolated subnet with a separate firewall policy. The GCP mobile
app is explicitly out of CDE scope — it never sees raw card data, only tokenized
references. The scope reduction is documented in our ROC."
Red flag: "I think everything is in scope" (over-scoping = expensive) or "I'm not
sure" (un-scoped CDE = audit finding).

**Q5: "If the Cloud LB or a GCP app server were compromised tomorrow, what can that
attacker reach that isn't on this diagram?"**
Good answer: the team has done a blast-radius exercise and can answer from a
documented threat model (see S03). They name the controls that stop lateral movement.
Red flag: silence, surprise, or "we'd just restore from backup" — no isolation
thinking, no segmentation response.

**Red flags to listen for across the whole review:**
- The presenter cannot trace their own diagram's main flow.
- Zones exist on the diagram but are separated only by "the firewall" with no named
  rules or change record.
- No management plane visible and no admission that it's on a different diagram.
- Compliance scope is "everything" or "I'd need to check."
- The word "trust" used without a mechanism: "we trust the internal network."

## Pitfalls & war stories

**"The diagram is current" assumption.** Diagrams drift. The firewall on the diagram
may have three extra rules added in an emergency change last quarter. Always ask:
"When was this last updated, and is there a config backup we could check?" At
Meridian Bank, an auditor found six undocumented firewall rules during a PCI
assessment — they were "temporary" changes from 18 months earlier.

**Trusting the label, not the control.** A box labelled "DMZ" is not a DMZ unless
something enforces the boundary. Ask what the enforcing mechanism is. A VLAN
without an ACL between it and the core is a flat network with a label.

**The cloud-to-on-prem path is always underspecified.** In every bank engagement,
the hybrid link (VPN or Interconnect) is drawn as a single line. That line carries
all traffic — admin, app, monitoring, backup. Ask: "Is there any QoS or traffic
shaping on that link? What happens when a backup job saturates it during trading
hours?"

**Management plane as an afterthought at Northwind FMCG.** With 3,000 sites and
an SD-WAN overlay, the management plane (the SD-WAN controller's access to every
branch CPE) is effectively internet-facing. If that control plane is compromised,
an attacker can reroute traffic from all 3,000 branches. This path is almost never
on the "architecture" diagram shown in a sales cycle — ask for it explicitly.

**Over-reliance on perimeter firewalls.** A diagram that shows a heavy perimeter
and nothing between internal zones ("flat inside") is the most common FSI finding.
The phrase to listen for: "once you're inside, you're trusted." That is not a
design; it is an incident waiting to happen. Pairs with N27 (segmentation) and S26
(Zero Trust).

**Missing egress control in cloud.** Many cloud diagrams show inbound controls
(Cloud LB, WAF, Security Groups) but omit outbound. An internet-routable app server
that can make arbitrary outbound connections is an exfiltration path. Ask: "What
controls outbound traffic from the app servers?" If the answer is "nothing, it goes
through the NAT gateway to the internet," follow up: "Is egress filtered by
destination IP or domain?"

## Going deeper (optional)

- Pairs with N56 (design-review playbook — the questions that expose risk) and N57
  (costing a network design). Together these three katas form the capstone
  conversation toolkit.
- Cross-track: S03 (threat modeling — STRIDE, trust boundaries, attack surface)
  teaches the security side of trust-boundary analysis that feeds directly into
  Lens 2 and Lens 3 in this kata.
- For compliance-scoping discipline: PCI-DSS v4.0 Requirement 12.5.2 (PCI DSS
  scope documented and confirmed at least once every 12 months) and Requirement
  1.2.4 (an accurate data-flow diagram for all account data flows) are the specific
  obligations that make Lens 5 non-optional at Meridian Bank.
- AWS Well-Architected Framework (Security Pillar) and Google Cloud Architecture
  Framework (Security chapter) both include diagram-review checklists — useful as
  a cross-check after you develop your own instinct.

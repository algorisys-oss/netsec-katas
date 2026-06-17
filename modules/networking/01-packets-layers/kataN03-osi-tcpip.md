# Kata N03 — OSI vs TCP/IP: what each layer actually does

> **Track:** Networking · **Module:** N1 Packets & layers · **Prereqs:** N01 · **Time:** ~30 min

## Why it matters

When a network engineer says "that's a layer 7 problem, not layer 3," they are
locating the fault — and the team that owns it. The layered model is the shared
vocabulary of every networking and security conversation. Firewalls, load
balancers, and proxies are all defined by *which layer they operate at*. If you
can place a device or a problem on the right layer, you can follow any design
discussion and ask the question that matters.

## The mental model

Two models. **OSI** (7 layers) is the teaching/reference model everyone *names*.
**TCP/IP** (4 layers) is what the internet actually *runs*. Map them:

```
 OSI (reference)              TCP/IP (real)        Example things here
 ───────────────────────────────────────────────────────────────────────
 7 Application  ┐
 6 Presentation ├─ Application │ Application      HTTP, DNS, TLS*, gRPC
 5 Session      ┘                                 (*TLS spans 5-6 in practice)
 ───────────────────────────────────────────────────────────────────────
 4 Transport    ── Transport   │ Transport        TCP, UDP, ports
 ───────────────────────────────────────────────────────────────────────
 3 Network      ── Internet    │ Internet         IP, ICMP, routing, NAT
 ───────────────────────────────────────────────────────────────────────
 2 Data Link    ┐
 1 Physical     ┴─ Link        │ Link/Network     Ethernet, MAC, ARP, Wi-Fi, cables
```

The mnemonic (7→1): **A**ll **P**eople **S**eem **T**o **N**eed **D**ata
**P**rocessing.

**The addressing ladder** — each layer has its own "address," and this is the key
insight architects miss:

| Layer | Address | Scope | Set/changed by |
|-------|---------|-------|----------------|
| 7 App | URL / hostname | global, human | DNS resolves it (see N17) |
| 4 Transport | **port** | per-host service | the app (80, 443, 5432…) |
| 3 Network | **IP address** | end-to-end, routable | subnet/DHCP (see N07–N09) |
| 2 Link | **MAC address** | local segment only | burned into the NIC |

A packet keeps the *same* source/dest IP end-to-end, but the source/dest **MAC
changes at every hop** (each router rewrites it). That single fact explains
routing, ARP, and half of all "why can't these two talk" problems.

## Worked example

You open `https://mobile.meridian.example` on your phone. Where each layer acts:

- **L7** — your browser speaks HTTP; the hostname is resolved by **DNS** to an IP.
- **L6/5** — **TLS** encrypts the session and authenticates the server's cert.
- **L4** — **TCP** opens a connection to **port 443**, guaranteeing ordered delivery.
- **L3** — **IP** routes packets across many networks; the dest IP is constant.
- **L2** — **Ethernet/Wi-Fi** moves each packet to the *next hop*; MAC rewritten
  at every router.
- **L1** — actual radio/fiber/copper signals.

Now map the **devices** the IT head will mention to their layer:

| Device | Layer | What it decides on |
|--------|-------|--------------------|
| Switch | L2 | MAC addresses (local) |
| Router | L3 | IP addresses (between networks) |
| Stateful firewall | L3–L4 | IPs + ports + connection state |
| Load balancer (L4) | L4 | IP + port, no payload inspection |
| Load balancer / reverse proxy (L7) | L7 | URLs, headers, cookies |
| WAF | L7 | HTTP payload (attack patterns) |

## Do it (the exercise) [laptop]

1. Run a request and name the layer for each observable fact:
   ```bash
   curl -v https://example.com 2>&1 | sed -n '1,20p'
   ```
   - `Trying 93.184.x.x:443` → which layer is the IP? the port?
   - `TLS handshake / certificate` → which layer(s)?
   - `GET / HTTP/2` → which layer?
2. See L2 vs L3 addressing on your own machine:
   ```bash
   ip neigh        # ARP/neighbor table: IP ↔ MAC mappings (Linux)
   ip route        # L3: where packets go next
   ip link         # L2: your MAC addresses
   ```
   Confirm: your default gateway has an IP (L3) *and* a MAC (L2) in `ip neigh`.
3. Classify five devices/services from a system you know onto the layer table above.

## Say it back (self-check)

1. Map the 7 OSI layers onto the 4 TCP/IP layers.
2. Which layer uses ports? Which uses IP addresses? Which uses MAC addresses?
3. What stays constant end-to-end — the IP or the MAC — and what changes per hop?
4. At which layer(s) does a stateful firewall operate vs an L7 reverse proxy?
5. Why do engineers say TLS "spans layers 5–6" rather than sitting cleanly on one?

## Talk to the IT/security head

**Ask:**
- "Is this load balancer L4 or L7? Does it terminate TLS?" *(decides where certs
  live and what can be inspected)*
- "Where in the path does payload inspection happen — and at which layer?"
- "Is segmentation enforced at L2 (VLANs), L3 (routing/firewall), or L7 (identity)?"

**A good answer sounds like:** the engineer naturally locates things by layer
("the WAF is L7 in front, the firewall is L3/4 between zones, switching is L2
within the rack").

**Red flags:** layer terms used as vague hand-waving, or inability to say where
TLS terminates — that gap usually hides a security or troubleshooting problem.

## Pitfalls & war stories

- Confusing a **switch** (L2) with a **router** (L3) in a diagram — they solve
  different problems; mislabeling misleads the whole design.
- Assuming an L4 load balancer can route by URL path. It can't — it never sees the
  HTTP request. That requires L7 (see N22, N24).
- Forgetting that TLS termination point determines *who can see plaintext* — a
  security decision dressed as a networking one.

## Going deeper (optional)

- RFC 1122 (host requirements) for the TCP/IP layering as actually specified.
- Revisit after N04 (encapsulation) to see the layers as nested envelopes.

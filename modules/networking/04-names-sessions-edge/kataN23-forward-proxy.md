# Kata N23 — Forward proxy: corporate egress control, PAC files

> **Track:** Networking · **Module:** N4 Names, sessions & the app edge · **Prereqs:** N03, N17, N20, N21 · **Time:** ~35 min
> **Tags:** `networking` `forward-proxy` `proxy` `l7-application` `security` `egress` `fsi` `on-prem`

## Why it matters

Every workstation in Meridian Bank's corp offices makes hundreds of outbound
HTTPS connections a day — to SaaS tools, update servers, cloud APIs, and the
open internet. Left uncontrolled, that is a blind spot: sensitive data could
leave, malware could call home, and the audit trail would be empty. A **forward
proxy** is the enterprise's answer: a choke point through which all user-to-
internet traffic is funnelled, inspected, logged, and optionally blocked. For an
architect it matters because almost every enterprise client has one (or thinks
they have one), and it shapes DNS resolution, TLS behaviour, cloud SDK config,
and egress cost — none of which are obvious until the first deploy breaks.

## The mental model

### What a forward proxy is

A proxy is a **middleman** that the *client* deliberately contacts instead of
the real server. The client sends its request to the proxy; the proxy fetches
the content on the client's behalf and returns it. The server sees the proxy's
IP, not the user's IP.

```
  WITHOUT proxy                        WITH forward proxy
  ──────────────                       ──────────────────
  Laptop ──── internet ──── SaaS       Laptop ──── Proxy ──── internet ──── SaaS
   src IP = 10.40.1.20                  src IP = proxy IP     server sees proxy IP
   no visibility at corp                corp logs all requests
```

The defining characteristic: **the client knows about and sends traffic to the
proxy**. This distinguishes it from a transparent proxy (the network silently
intercepts — same function, invisible to the client) and a reverse proxy (the
client talks to it thinking it's the server — see N24).

### Three ways the client finds the proxy

1. **Manual / per-app config** — set `HTTP_PROXY` and `HTTPS_PROXY` env vars or
   OS proxy settings. Every app must respect them; many don't.
2. **Proxy Auto-Config (PAC file)** — the client fetches a small JavaScript file
   (`proxy.pac`) from a well-known URL and executes it per request. The function
   returns either `DIRECT` (bypass proxy) or `PROXY host:port`. This is the
   enterprise standard for split routing.
3. **Web Proxy Auto-Discovery (WPAD)** — the client searches for the PAC URL
   automatically via DNS (`wpad.<domain>`) or DHCP option 252. Convenient but
   requires careful DNS hygiene to avoid WPAD hijack attacks.

### How HTTPS traffic flows through a forward proxy

HTTP is easy — the proxy reads the URL directly. HTTPS requires a **CONNECT
tunnel**:

```
  Client                       Proxy                   SaaS server
    │                            │                           │
    │── CONNECT api.saas.com:443 ──>│                           │
    │                            │── TCP connect to api.saas.com:443 ──>│
    │<──────── 200 Connection Established ────────│                     │
    │<════════════ TLS handshake through tunnel ═════════════>│
    │<════════════ HTTPS request / response ══════════════════>│
```

In this mode the proxy is a **TCP relay** — it sees the destination hostname
from the CONNECT line but NOT the encrypted payload. It can log *that* a
connection was made but not *what* was exchanged.

### TLS inspection (SSL bumping)

Some enterprises break open TLS to inspect HTTPS content. The proxy:
1. Intercepts the CONNECT, terminates TLS with a **proxy CA cert** issued to the
   target domain (e.g. `api.saas.com`) signed by an internal CA.
2. Re-originates a new TLS connection to the real server.
3. Inspects (and can block/log) the decrypted payload.

This requires pushing the internal CA cert to every client as a trusted root — a
managed-device requirement. It also breaks certificate pinning (mobile apps, some
SDKs). The CISO loves the visibility; the developer hates the breakage.

### PAC file anatomy

A `proxy.pac` file is a JavaScript file with a single function:

```javascript
function FindProxyForURL(url, host) {
    // Bypass proxy for internal destinations
    if (isInNet(host, "10.0.0.0", "255.0.0.0"))    { return "DIRECT"; }
    if (isInNet(host, "172.16.0.0", "255.240.0.0")) { return "DIRECT"; }
    if (isInNet(host, "192.168.0.0", "255.255.0.0")){ return "DIRECT"; }
    if (dnsDomainIs(host, ".meridian.internal"))     { return "DIRECT"; }

    // Force specific domains through proxy
    return "PROXY proxy.meridian.internal:8080; DIRECT";
}
```

The `;` fallback chain means: try the proxy, and if unreachable fall back to
`DIRECT`. The IT head will debate that fallback — security wants `DIRECT` removed
so traffic is blocked if the proxy is down; availability wants it left so work
doesn't stop.

## Worked example

Meridian Bank's corp offices (`10.40.0.0/16`) run a Squid proxy cluster at
`10.40.254.10` and `10.40.254.11`, port `3128`. Staff laptops get the PAC URL
via DHCP option 252:

```
  DHCP server → option 252 → http://wpad.meridian.internal/proxy.pac
```

A simplified Meridian PAC file:

```javascript
function FindProxyForURL(url, host) {
    // RFC 1918 ranges — always direct (internal)
    if (isInNet(host, "10.0.0.0",   "255.0.0.0"))    { return "DIRECT"; }
    if (isInNet(host, "172.16.0.0", "255.240.0.0"))   { return "DIRECT"; }
    if (isInNet(host, "192.168.0.0","255.255.0.0"))   { return "DIRECT"; }

    // Meridian internal domains — direct
    if (dnsDomainIs(host, ".meridian.internal"))       { return "DIRECT"; }
    if (dnsDomainIs(host, ".meridian.example"))        { return "DIRECT"; }

    // Cloud-hosted Meridian services — direct via VPN (GCP 10.100.0.0/14 and AWS 10.104.0.0/14)
    if (isInNet(host, "10.100.0.0", "255.252.0.0"))   { return "DIRECT"; }
    if (isInNet(host, "10.104.0.0", "255.252.0.0"))   { return "DIRECT"; }

    // Everything else → proxy (no DIRECT fallback — security requirement)
    return "PROXY 10.40.254.10:3128; PROXY 10.40.254.11:3128";
}
```

**What this achieves:**

- All internet traffic (including SaaS) goes through the proxy pair — Squid logs
  the destination hostname, categories the domain (using a URL database), and
  blocks known-bad categories (malware C2, gambling).
- Internal traffic and cloud-hybrid traffic bypasses the proxy — avoids a
  hairpin path from corp to GCP via the proxy when the traffic should ride
  Cloud Interconnect directly.
- No `DIRECT` fallback on the last return — if both proxy nodes are down, traffic
  is blocked rather than leaking uninspected. The IT head has a monitoring alert
  on proxy availability as a result.

**Tracing a request — laptop browser, `api.github.com:443`:**

```
1. Browser calls FindProxyForURL("https://api.github.com/...", "api.github.com")
2. api.github.com not in RFC 1918, not .meridian.internal → returns PROXY 10.40.254.10:3128
3. Browser opens TCP to 10.40.254.10:3128
4. Browser sends: CONNECT api.github.com:443 HTTP/1.1
5. Proxy resolves api.github.com via its own DNS (10.10.5.1 — Meridian's DNS resolver)
6. Proxy opens TCP to 140.82.121.6:443 (GitHub's IP)
7. Proxy replies: HTTP/1.1 200 Connection Established
8. Browser completes TLS handshake with api.github.com through the tunnel
9. Proxy logs: 2026-06-17 09:14:32 user=rajesh@meridian dst=api.github.com:443 bytes=4821 ALLOWED
```

The proxy never decrypts the HTTPS payload (no TLS inspection deployed here) but
it logs the destination, the username (authenticated via Kerberos/NTLM to Active
Directory), the byte count, and the verdict.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Forward proxy software | Squid, Zscaler, Blue Coat | N/A — clients configure Cloud NAT + Secure Web Proxy | N/A — clients configure NAT + AWS Network Firewall or marketplace proxy | (Azure: TODO) |
| Managed cloud egress proxy / SWG | Zscaler, Forcepoint (CASB/SWG) | **Secure Web Proxy** (regional, Envoy-based explicit proxy; PAC-free — clients point to the SWP endpoint directly) | **AWS Network Firewall** with domain allowlisting (L7 SNI filtering) or marketplace SWG | (Azure: TODO) |
| PAC file hosting | IIS / Apache / DHCP WPAD | GCS bucket over HTTPS or internal HTTPS LB | S3 bucket over HTTPS or internal ALB | (Azure: TODO) |
| URL categorization / content filtering | Squid + SquidGuard / BlueCoat | **Chrome Enterprise** policies + Secure Web Proxy URL lists | AWS Network Firewall domain lists | (Azure: TODO) |
| TLS inspection (SSL bump) | Squid with CA cert / Forcepoint | Secure Web Proxy supports TLS inspection (Preview) | AWS Network Firewall supports native TLS inspection for ingress and egress (egress TLS decryption GA Dec 2023) — no third-party NVA required for basic TLS inspection | (Azure: TODO) |
| Identity-aware proxy egress (ZTNA) | Zscaler ZIA, Netskope | Beyond Corp / **Chrome Enterprise Premium** (Google's ZTNA/SWG offering) | AWS Verified Access (inbound); Zscaler/Netskope on top for egress | (Azure: TODO) |

**Note on "cloud-native" forward proxy:** in a cloud VPC, workloads that need
internet access generally use a **Cloud NAT gateway** (stateful outbound NAT, no
inspection) or a dedicated egress proxy VM/NVA in a hub VPC. The trend in
enterprise cloud is to route cloud-workload internet traffic through the same SWG
(Secure Web Gateway) used for on-prem — Zscaler and Netskope both support this
via IPsec tunnel or GRE from the VPC.

## Do it (the exercise)

**Part 1 — test your own PAC logic [laptop]**

You can run a PAC file in Node.js or in any browser:

```bash
# Save the Meridian PAC as test.pac, then test it with pac-resolver
npm install -g pac-resolver pac-proxy-agent 2>/dev/null || true
node - <<'EOF'
const { createPacResolver } = require('pac-resolver');
const fs = require('fs');
const pac = createPacResolver(fs.readFileSync('test.pac', 'utf8'));
async function test() {
    console.log(await pac('https://api.github.com/'));
    console.log(await pac('https://intranet.meridian.internal/'));
    console.log(await pac('http://10.40.10.5/app'));
}
test();
EOF
```

Expected output:
```
PROXY 10.40.254.10:3128; PROXY 10.40.254.11:3128
DIRECT
DIRECT
```

**Part 2 — observe a proxy CONNECT tunnel [laptop]**

If you have Squid running locally (Docker):

```bash
docker run -d --name squid -p 3128:3128 ubuntu/squid:latest
# Confirm it's up
curl -x http://localhost:3128 -v http://httpbin.org/headers 2>&1 | grep -E '< HTTP|X-Forwarded'
```

Notice `X-Forwarded-For` header carries your real IP — Squid adds it by default
(configurable). A privacy-mode proxy removes it; a transparent one may not add it.

**Part 3 — observe the CONNECT method [laptop]**

```bash
# Manually send a CONNECT and see the 200
curl -x http://localhost:3128 -v https://example.com 2>&1 | grep -E 'CONNECT|200 Conn'
```

You should see:
```
> CONNECT example.com:443 HTTP/1.1
< HTTP/1.1 200 Connection established
```

That is the tunnel being opened before TLS. Everything after that line is
encrypted from Squid's perspective (no TLS inspection in default config).

**Part 4 — GCP Secure Web Proxy (conceptual) [needs cloud account]**

In GCP Console → Network Security → Secure Web Proxy:
1. Create a SWP instance in your VPC's region.
2. Set up a `GatewaySecurityPolicy` with `GatewaySecurityPolicyRule` resources
   (allow/deny rules via `basicProfile` ALLOW or DENY).
3. Point a test VM's proxy env vars to the SWP gateway endpoint on its configured
   port (commonly 443): `http://<swp-ip>:443` (use whatever port the gateway was
   created with).
4. Observe the SWP access logs in Cloud Logging — they show source IP, URL,
   matched rule, and verdict (similar to Squid's access log).

## Say it back (self-check)

1. What makes a proxy "forward" — where does it sit relative to the client and
   the server, and who initiates the connection to it?
2. What is the HTTP CONNECT method for, and what can a non-inspecting proxy see
   about the tunnelled HTTPS session?
3. Describe how a browser finds a PAC file via WPAD. What DNS record or DHCP
   option is involved?
4. In the Meridian PAC file above, why is the internal GCP range
   (`10.100.0.0/14`) returned as `DIRECT` rather than going through the proxy?
5. What is TLS inspection (SSL bumping), what does it require of the client
   estate, and name one class of thing it breaks?

## Talk to the IT/security head

**Ask:**

- "Do you have a forward proxy or SWG for internet egress, and is it mandatory
  (no DIRECT fallback) or best-effort?"
  *Good answer:* mandatory — named product, both HA nodes, monitored. If DIRECT
  fallback is enabled, ask what controls exist on that path.
  *Red flag:* "most traffic goes through it" — partial coverage is no coverage
  for DLP or security.

- "Do you do TLS inspection? On what categories of traffic?"
  *Good answer:* yes, on non-banking SaaS categories, with the internal CA
  deployed to all managed endpoints; banking/financial domains are excluded. They
  know which certificate pinning exceptions they maintain.
  *Red flag:* "we inspect everything" without mention of pinning exceptions —
  means mobile apps and some APIs are silently broken and the team may not know.

- "How do cloud workloads in GCP/AWS route to the internet — through the on-prem
  proxy, a cloud NAT, or something else?"
  *Good answer:* a clear egress design per workload tier — internet-facing
  workloads use Cloud NAT with logging; access to sanctioned SaaS from cloud
  goes through a centralised SWG or Zscaler.
  *Red flag:* "cloud workloads go direct" — no visibility on what cloud services
  call out to the internet; audit and data-exfiltration blind spot.

- "Who approves changes to the PAC file, and how often is the URL blocklist
  updated?"
  *Good answer:* PAC changes go through change control (the CAB — see N02);
  blocklist updates are automated from the vendor feed daily.
  *Red flag:* PAC file last modified years ago, or one person owns it without
  change process — single point of failure and a stale policy.

- "If an app requires bypassing the proxy, what's the process?"
  *Good answer:* formal exception request, CISO sign-off, time-limited,
  logged separately.
  *Red flag:* developers are told to set `NO_PROXY` in their apps and ship —
  uncontrolled egress bypass.

## Pitfalls & war stories

**The cloud SDK proxy problem.** The AWS CLI, GCP SDK (`gcloud`), and most
cloud SDKs respect `HTTP_PROXY` / `HTTPS_PROXY` environment variables — but only
if you set them. Developers on Meridian's corp network frequently find the SDK
fails (`connection refused`, `SSL certificate error`) because the proxy env vars
are set globally on the OS but the CI/CD pipeline doesn't inherit them. The fix
is one line of shell config, but it takes a day to diagnose because no one
thinks "proxy" when they see a TLS error in a pipeline.

**TLS inspection breaks certificate pinning.** Mobile banking apps and some
payment gateways pin their server certificate (or CA). When TLS inspection
generates a fake cert signed by the internal CA, the pin check fails and the app
refuses to connect. This is especially painful when Meridian is testing its own
mobile app from a corp network — the bank's proxy is blocking the bank's app.
Solution: add the destination to the TLS-inspection bypass list by domain.

**The PAC `DIRECT` fallback debate.** In a Meridian-style PCI environment,
leaving `DIRECT` as a fallback means that when the proxy goes down, all traffic
bypasses inspection and control — a compliance event. Security wants `DIRECT`
removed; availability says removing it means a proxy failure silently breaks
internet for everyone. The right answer: proxy HA with fast failover, alerting,
and no `DIRECT` fallback. The IT head has to commit to the proxy's availability
as a dependency.

**WPAD DNS hijack.** If an attacker (or a rogue device) serves a `wpad.<domain>`
DNS response, they control where all client browsers proxy to. This is a known
attack in open Wi-Fi. Enterprises that use WPAD should register `wpad.<domain>`
in their internal DNS and block external resolution of `wpad` records. The DNS
team often doesn't know the risk exists.

**Northwind's M&A proxy sprawl.** After acquiring Eastfield Foods, Northwind
found three different proxy configurations in use — some on Zscaler, some on an
old Blue Coat appliance, some with no proxy at all. Merging them revealed
conflicting PAC files, overlapping IP ranges in bypass rules (the `10.50.0.0/16`
overlap from running-example.md surfaced here), and a URL blocklist that
contradicted the Northwind policy. Proxy consolidation is a common post-M&A
workstream that the network team underestimates.

**Proxy auth causes app failures.** Enterprise proxies often require
authentication (Kerberos, NTLM, or basic). Service accounts and containerised
workloads don't always support proxy auth, so connections fail silently. When
deploying containers or microservices in a corp network that has a mandatory
authenticated proxy, the architect must identify which workloads need proxy
credentials or need to be placed on a VLAN with a different (auth-free) egress
path.

## Going deeper (optional)

- RFC 7235 §3.2 — `407 Proxy Authentication Required` and how proxy auth works
  at the HTTP layer.
- RFC 7231 §4.3.6 — the `CONNECT` method spec (originally defined in RFC 2817).
- [Proxy Auto-Config (PAC) — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file) — the full PAC JavaScript API.
- Squid access log format: `http://www.squid-cache.org/Doc/config/logformat/` — how
  to read what the proxy actually records.
- Pairs with **N24** (reverse proxy — the other side of the proxy picture) and
  **N25** (WAF/CDN — the internet-edge equivalent).
- Revisit with **S27** (ZTNA/SASE) — modern SWG collapses forward proxy, CASB,
  and ZTNA into one cloud service, replacing on-prem Squid clusters.

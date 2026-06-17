# Kata N55 — A structured troubleshooting playbook (layer-by-layer)

> **Track:** Networking · **Module:** N10 Observability & troubleshooting · **Prereqs:** N03, N06, N12, N17, N20, N53 · **Time:** ~40 min
> **Tags:** `networking` `troubleshooting` `mental-model` `tooling` `first-principles` `fsi` `meridian-bank`

## Why it matters

"The app is down" is not a problem statement — it is the starting gun for a
structured investigation. An architect who reacts by guessing at the application
layer, while the actual break is a failed BGP route or a stale DNS entry, wastes
hours and erodes credibility. At Meridian Bank, where a payment outage is a
regulatory event, a methodical 15-minute triage is worth far more than a frantic
all-hands. This kata gives you the **one consistent mental algorithm**: start at
Layer 1 and work up. Done correctly, every step either rules out a layer or
isolates it — and you stop when you find the break.

## The mental model

**The OSI stack as a diagnostic checklist.** Every networking problem lives at
exactly one layer. Find that layer by ruling out those below it.

```
  Layer  │ Question to answer            │ Tool (laptop / on-host)
  ───────┼───────────────────────────────┼───────────────────────────────────
  1 Phy  │ Is the link up?               │ ip link; NIC lights; cable check
  2 Link │ Can I reach the next hop?     │ ip neigh; arping; switch port
  3 Net  │ Is the route there? IP reachable? │ ip route; ping; traceroute/mtr
  4 Tran │ Is the port open/listening?   │ nc / ncat; curl to port
  7 App  │ Is the service responding?    │ curl -v; dig; openssl s_client
  ───────┼───────────────────────────────┼───────────────────────────────────
  Infra  │ DNS resolving correctly?      │ dig +short; systemd-resolve
         │ TLS cert valid / not expired? │ openssl s_client; curl -v
         │ Firewall / ACL dropping?      │ traceroute delta; flow logs
         │ Clock/auth drift?             │ date; ntpdate -q; klist
```

**The algorithm:**

```
  START
    │
    ├─ Step 1: Define the symptoms.
    │   What is broken, from where, for whom, since when?
    │   Reproducible? Intermittent? Partial?
    │
    ├─ Step 2: L1 — Is the physical link up?
    │   Host NIC shows link; no errors; cable / SFP / port light.
    │
    ├─ Step 3: L2 — Can I reach the next hop (gateway)?
    │   ping the default gateway IP.  If no reply → L2/L1 problem.
    │
    ├─ Step 4: L3 — Is the route correct? Can I reach the far IP?
    │   ip route get <dest>.  ping <dest IP>.
    │   If no route → missing route or wrong gateway.
    │   If route present but ping fails → firewall, ACL, routing loop.
    │
    ├─ Step 5: L3 ext — Trace the path.
    │   traceroute / mtr to <dest>.  Where does it stop?
    │   Compare from source host vs from a bastion closer to dest.
    │
    ├─ Step 6: L4 — Is the port reachable?
    │   nc -zv <dest> <port>.  timeout vs refused vs open.
    │   refused = host alive, nothing listening.
    │   timeout = firewall/ACL dropping.
    │
    ├─ Step 7: DNS — Is the name resolving correctly?
    │   dig +short <name>.  Is it the right IP? TTL stale?
    │   Resolve from the same host that is failing.
    │
    ├─ Step 8: L7 / App — Is the service itself healthy?
    │   curl -v https://<name>:<port>/healthz
    │   TLS cert valid? HTTP status 2xx/3xx or 5xx?
    │   App error in logs.
    │
    └─ STOP when you find the layer where it breaks.
       Everything above that layer is not the problem.
```

**Two principles that save time:**

1. **Binary elimination.** Each step either rules a layer *in* or *out*. If L3
   ping succeeds, you are done investigating routing — move up.
2. **Test from the right vantage point.** A ping that succeeds from the bastion
   but fails from the app server tells you the problem is on the app server's
   path, not the destination. Always test from the *failing process*, not the
   nearest convenient host.

## Worked example

**Scenario:** Meridian Bank's mobile-banking backend in GCP
(`10.100.1.10/24`, region `asia-south1`) cannot reach the core-banking API at
HQ-DC1 (`10.10.50.20`, port 8443). Ops says "the app is throwing connection
timeouts since 14:23."

Walk through the playbook:

```
  App server (GCP):  10.100.1.10
  Core-banking API:  10.10.50.20:8443    (HQ-DC1, behind on-prem firewall)
  Default gateway:   10.100.1.1          (GCP subnet gateway)
  Cloud Interconnect / VPN terminates on-prem at: 10.10.0.1
```

**Step 1 — Define the symptoms**

- Reproducible: yes, 100% failure.
- From: all pods on the GCP subnet `10.100.1.0/24`.
- Since: 14:23 (check change log — was there a firewall change or BGP
  maintenance window around that time?).

**Step 2 — L1 physical**

GCP VM has a virtual NIC that is always "up" if the VM is running. Skip
hardware checks; confirm the VM is running in Cloud Console.

**Step 3 — L2 / default gateway** [laptop: requires SSH to GCP VM]

```bash
# On the GCP VM (10.100.1.10):
ping -c 3 10.100.1.1
```

Expected: replies. If no reply, the subnet gateway itself is misconfigured —
check the GCP VPC subnet and route table.

```
PING 10.100.1.1: 3 packets transmitted, 3 received, 0% packet loss
rtt min/avg/max = 0.4/0.5/0.6 ms        ← L1/L2 clear
```

**Step 4 — L3 routing** [laptop: SSH to GCP VM]

```bash
ip route get 10.10.50.20
```

Expected output if routing table is correct:
```
10.10.50.20 via 10.100.1.1 dev ens4 src 10.100.1.10
```

If this returns `RTNETLINK answers: Network is unreachable`, the cloud route
table has no entry for `10.10.0.0/16` — the Interconnect/VPN advertisement
may have been withdrawn (BGP flap, see N14/N36).

```bash
ping -c 3 10.10.50.20
```

Assume: **no reply** — first sign of a real break.

**Step 5 — Trace the path** [laptop: SSH to GCP VM]

```bash
traceroute -n 10.10.50.20
```

```
traceroute to 10.10.50.20, 30 hops max
 1  10.100.1.1      0.5 ms   0.5 ms   0.5 ms    ← GCP gateway: OK
 2  169.254.0.1     1.2 ms   1.1 ms   1.2 ms    ← Interconnect/VPN hop: OK
 3  10.10.0.1       4.1 ms   4.0 ms   4.2 ms    ← on-prem CPE: reached
 4  * * *                                         ← STOPS HERE
 5  * * *
```

The packet reaches the on-prem Customer Premises Equipment (CPE) at `10.10.0.1`
but gets no further. The break is **between the CPE and the core-banking server**
— at L3 or blocked by an on-prem firewall/ACL. This tells the network team
exactly where to look: the HQ-DC1 routing table or the inter-zone firewall rule
between the interconnect DMZ and the `10.10.50.0/24` subnet.

**Step 6 — L4 port check**

With L3 broken, port check will also fail — but note the distinction:

```bash
nc -zv -w5 10.10.50.20 8443
```

```
nc: connect to 10.10.50.20 port 8443 (tcp) timed out
```

`timed out` (vs `Connection refused`) confirms a firewall is silently dropping
the packet, not that no process is listening. This is the key: *timeout = ACL
drop; refused = service not running*.

**Step 7 — DNS** (parallel check, not the cause here)

```bash
dig +short mobile-api.core.meridian.internal
```

```
10.10.50.20
```

DNS is fine — the name resolves to the correct IP. Rules out a DNS/split-
horizon problem (see N18, N50).

**Step 8 — Diagnosis**

Root cause: an on-prem firewall rule change at 14:20 tightened the inter-zone
policy between the Interconnect DMZ (`10.10.0.0/24`) and the Core zone
(`10.10.50.0/24`) and dropped the `10.100.0.0/14` source range (the GCP
supernet). The IT head's change log had the answer. **Resolution:** re-add the
GCP CIDR as a permitted source for port 8443 in the on-prem firewall (with
proper CAB sign-off per N02).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| L3 route inspection | `ip route`; `show ip route` on router | `gcloud compute routes list`; VPC Route table in Console | `aws ec2 describe-route-tables` | `az network route-table list` |
| Path tracing | `traceroute -n`; `mtr` | Same tools on GCE VM; also Connectivity Tests in Network Intelligence Center | Same on EC2; VPC Reachability Analyzer | Same on Azure VM; Network Watcher Connection Troubleshoot |
| L4 port open? | `nc -zv` | Same on GCE VM | Same on EC2 | Same on Azure VM |
| Firewall drop check | Syslog / firewall logs | VPC Flow Logs; Firewall Rules Logging (per rule) | VPC Flow Logs; Security Group / NACL | NSG Flow Logs; Network Watcher |
| DNS resolution path | `dig`; `nslookup` | `dig` on GCE; Cloud DNS logs | `dig` on EC2; Route 53 Resolver query logs | `dig`; Azure DNS private resolver logs |
| Packet capture | `tcpdump` on host | `tcpdump` on GCE; Packet Mirroring (see N54) | `tcpdump` on EC2; VPC Traffic Mirroring | `tcpdump` on VM; Network Watcher packet capture |
| Automated reachability | — | Network Intelligence Center: Connectivity Tests | VPC Reachability Analyzer | Azure Network Watcher |

**GCP-specific tip:** Network Intelligence Center's **Connectivity Tests** can
simulate a packet (source IP, dest IP, protocol, port) and trace it through GCP
routing and firewall rules *without sending real traffic* — it reads your config
and returns `DELIVERED` or `DROPPED` with the rule that matched. Invaluable for
pre-change validation. [needs cloud account]

**AWS equivalent:** VPC Reachability Analyzer does the same config-level
simulation; results show the path and the blocking rule. [needs cloud account]

## Do it (the exercise)

### Part A — Walk the playbook on your laptop [laptop]

1. Find the IP of a public host (e.g. `1.1.1.1` or `8.8.8.8`).
   Work the playbook from Step 3 onward:

   ```bash
   # Step 3: Is there a route?
   ip route get 1.1.1.1

   # Step 3: Ping
   ping -c 3 1.1.1.1

   # Step 5: Trace
   traceroute -n 1.1.1.1        # Linux
   tracert -d 1.1.1.1           # Windows
   mtr --report 1.1.1.1         # if mtr is installed

   # Step 6: L4 (DNS over TCP)
   nc -zv -w5 1.1.1.1 53

   # Step 7: DNS
   dig +short www.example.com @1.1.1.1

   # Step 8: App
   curl -v --max-time 5 https://www.example.com 2>&1 | head -30
   ```

   For each step, write: *what layer did this confirm?*

2. Now deliberately break L7: pick a port that should be closed.
   ```bash
   nc -zv -w3 1.1.1.1 8080
   ```
   Is the result `timed out` or `Connection refused`? What does each mean?

3. Deliberately test a name that does not exist:
   ```bash
   dig +short nonexistent.meridian.example
   curl -v http://nonexistent.meridian.example 2>&1 | grep -E 'Could not|Failed'
   ```
   Which step in the playbook would this fail at?

### Part B — Simulate the Meridian scenario [laptop]

Run a local web server on port 8443, then simulate a firewall block using
`iptables` (Linux only, requires `sudo`):

```bash
# Start a listener
python3 -m http.server 8443 &

# Confirm it is reachable
nc -zv localhost 8443

# Block it at L4 (simulates firewall drop)
sudo iptables -I INPUT -p tcp --dport 8443 -j DROP

# Now test: timeout vs refused?
nc -zv -w3 localhost 8443

# Clean up
sudo iptables -D INPUT -p tcp --dport 8443 -j DROP
kill %1
```

Note: with the `DROP` rule, `nc` times out (silent drop = firewall). Change
`DROP` to `REJECT` and observe: `nc` gets `Connection refused` immediately.

### Part C — Cloud flow-log triage [needs cloud account]

1. In GCP: enable **Firewall Rules Logging** on one rule in a test VPC.
   Trigger a blocked connection. Query the logs in Cloud Logging:
   ```
   resource.type="gce_subnetwork"
   logName="projects/<PROJECT>/logs/compute.googleapis.com%2Ffirewall"
   jsonPayload.disposition="DENIED"
   ```
   Identify: source IP, dest IP, dest port, rule that matched.

2. In AWS: enable **VPC Flow Logs** on a test VPC. Trigger a blocked
   connection. Query in CloudWatch Logs Insights:
   ```
   fields srcAddr, dstAddr, dstPort, action
   | filter action="REJECT"
   | sort @timestamp desc
   | limit 20
   ```

## Say it back (self-check)

1. State the layer-by-layer playbook order and the one tool you use at each
   layer to confirm/rule it out.
2. What is the difference between `nc` returning `timed out` and `Connection
   refused`? What does each tell you about the path?
3. A `traceroute` reaches hop 3 but all subsequent hops are `* * *`. What are
   the two most likely causes?
4. Why must you run diagnostic tools from the *failing process's host*, not a
   bastion?
5. A name resolves to the wrong IP but ping to the correct IP succeeds. Which
   layer is broken? What would you check?

## Talk to the IT/security head

**Ask:**

- "Do you have a standard triage playbook, or does it vary by team member?"
  *(A good answer: there is a runbook per service tier, stored in the ITSM
  system. A red flag: "whoever picks up the ticket figures it out." Implies
  variable MTTR — and in FSI that becomes a regulatory metric.)*

- "Can the network team see flow logs in real time, or do they need a ticket to
  access them?" *(Good: a SIEM/logging platform with delegated read-only query
  access per zone. Red flag: logs are locked behind a ticketing process — adds
  30–60 min to every triage.)*

- "When `traceroute` shows a hop that drops all probes, how do you determine if
  it is a genuine fault vs a device that blocks ICMP for security reasons?"
  *(Good: "we use TCP-based traceroute (`traceroute -T -p 443`) to a port the
  device is known to allow, or we check interface stats on the device via
  NMS/SNMP." Red flag: "we just assume it is broken" — leads to false
  escalations.)*

- "How do you differentiate a firewall drop from a routing black-hole in your
  environment?" *(Good: firewall logs enabled by default on all inter-zone
  rules; `DROP` shows in logs; if *nothing* shows in logs it may be a routing
  miss. Red flag: firewall logging is off to save storage — that is a
  compliance finding in PCI-DSS environments.)*

- "What is your MTTR SLA for a Severity-1 outage, and how is triage time
  tracked?" *(At an FSI, P1 SLAs are often 15–30 minutes to isolation,
  60 minutes to resolution. This playbook is designed to isolate in < 15 min.)*

**Red flags to listen for:**

- "We just reboot things and see if it fixes it." — no structured triage; high
  MTTR; likely to have undiscovered chronic issues.
- Firewall logging is disabled on inter-zone rules "for performance." — blind
  spot for both ops and the auditor.
- The network team and the cloud team do not have each other's monitoring — a
  hybrid outage (like the Meridian scenario above) requires two teams who may
  have never collaborated.

## Pitfalls & war stories

**The "it must be DNS" trap.** DNS is the last-mile culprit often enough that
teams jump there first. But if L3 is broken, DNS is irrelevant — the fix
resolves to the right IP that the app still cannot reach. Work the stack
bottom-up.

**Testing from the wrong host.** An architect SSHes into a bastion, runs `ping
10.10.50.20`, it succeeds, and declares the network fine — while the app server
on a different subnet, behind a different firewall rule, still cannot connect.
Always test from the machine that is actually failing.

**Timeout vs refused confusion at the CAB.** A firewall change is proposed to
"open port 8443." The network team comes back: "port 8443 is already reachable
— I can nc to it." But they tested from inside the zone; the failing path is
from outside. The test must be end-to-end on the *exact* source-to-dest path.

**ICMP-filtered hops mislead traceroute.** Many enterprise devices (and all
cloud NAT gateways) do not respond to ICMP TTL-exceeded. A row of `* * *` in
`traceroute` can mean: (a) genuinely dropped, (b) ICMP filtered but traffic
passes through. Use `traceroute -T -p 443` (TCP SYN probes) to a port you
know is allowed, or cross-check with flow logs.

**At Meridian Bank — the change-log habit.** The Meridian scenario above was
solved in minutes because someone checked the change log (Step 1). In reality,
teams often skip this and spend 40 minutes on packet traces before discovering
a firewall rule was tightened at exactly the time the outage started. In
regulated shops, **every change is logged** (see N02) — that log is your first
tool, not your last.

**Northwind FMCG — plant-floor timeouts.** Plant networks (`10.50.x.x`)
running WMS scanners reported intermittent timeouts. The triage playbook
revealed: `traceroute` succeeded from corporate (`10.50.0.x`) but stalled at
hop 2 from the plant VLAN (`10.50.64.x`). Root cause: a routing asymmetry
introduced by an M&A network merge (the Eastfield Foods `10.50.0.0/16` overlap
from N11). Traffic went out one path, replies came back a different path with a
different NAT. The fix required the L3 route check at Step 4 — visible only
when testing from the plant VLAN.

## Going deeper (optional)

- **RFC 792** — ICMP specification: how `ping` and `traceroute` work at the
  protocol level. Explains why TTL-exceeded messages are optional for routers to
  send.
- **`mtr` (Matt's Traceroute):** combines `ping` + `traceroute` into a
  real-time view with packet-loss % per hop — more useful than a single
  traceroute snapshot. Install: `apt install mtr` / `brew install mtr`.
- **GCP Network Intelligence Center — Connectivity Tests:**
  `https://cloud.google.com/network-intelligence-center/docs/connectivity-tests`
- **AWS VPC Reachability Analyzer:**
  `https://docs.aws.amazon.com/vpc/latest/reachability/`
- **Pairs with:** N06 (ping/traceroute basics), N53 (latency/packet-loss
  metrics), N54 (flow logs and packet mirroring), N56 (design-review playbook).
- **Also pairs with:** N26 (firewall rule design) and N42 (cloud firewall rules)
  — understanding drop behaviour requires knowing how rules are evaluated.

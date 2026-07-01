# Kata S28 — Microsegmentation & identity-aware proxy in practice

> **Track:** Security · **Module:** S7 Zero Trust & modern access · **Prereqs:** S26, S27, N27 · **Time:** ~35 min
> **Tags:** `zero-trust` `micro-segmentation` `identity-aware-proxy` `segmentation` `east-west` `security` `ztna` `fsi`

## Why it matters

A perimeter firewall controls north-south traffic. It does nothing once an attacker
or compromised workload is already inside. PCI-DSS scoping guidance (Req 1.3–1.4 —
segmentation to control connections between the CDE and other networks and reduce
CDE scope) drives the CDE to be isolated from systems that don't need to reach it.
The CISO's real question is not "can attackers get in?" but "if they get one
foothold, how far can they move?" Microsegmentation and identity-aware proxying are
the two practical controls that make Zero Trust real at the workload and
user-to-app layers.

## The mental model

### The problem: flat east-west traffic

Traditional zones leave all hosts inside a zone free to talk to each other.
An attacker who compromises one host can pivot to every neighbour.

```
  Flat internal zone (old model):
  ┌───────────────────────────────────────────────┐
  │  10.10.0.0/16  HQ-DC1                        │
  │                                               │
  │  [app-server] ──────► [card-processor]        │
  │       └─────────────────────► [HSM]           │
  └───────────────────────────────────────────────┘
  One perimeter firewall. Everything inside reaches everything.
```

### Microsegmentation: workload-level deny-by-default

Policy moves from zone edge to each workload. Every VM or service gets its own
firewall rules; east-west traffic is denied unless explicitly permitted.

```
  Microsegmented (Zero Trust):
  ┌───────────────────────────────────────────────┐
  │  10.10.0.0/16  HQ-DC1                        │
  │                                               │
  │  [app-server] ──TCP 8443──► [card-processor]  │
  │       │                          │            │
  │       X (denied)                 └──TCP 8200─►[HSM-api]
  │       └──────────X (denied)──────────────────►[HSM]
  └───────────────────────────────────────────────┘
  Policy enforced per workload; lateral movement is blocked.
```

The policy language shifts from IP ranges to **workload identity** — the rule says
"this service account may call that service account on this port," surviving
container rescheduling and IP changes.

### Identity-Aware Proxy (IAP): identity before the network

An IAP sits in front of an application and refuses to forward any request until
it verifies (1) **authentication** — identity token or mTLS cert — and
(2) **authorization** — does this identity have access to this specific app?
Only then does it proxy the request. The backend has no public IP and accepts no
inbound connection except from the IAP. The user needs no VPN client.

```
  IAP flow (IAP-for-web, behind an Application Load Balancer):
                            ┌── Identity Provider ──┐
  [Browser] ─HTTPS:443─► [ALB + IAP] ─► verify token │
                            └── allow/deny ──────────┘
                                   │ (allow)
                                   ▼
                          [Backend VM  10.100.4.12]
                          (no public IP; FW: allow only from the
                           load-balancer / Google Front End ranges)
```

Contrast with VPN: VPN gives the user a network address and trusts them laterally.
IAP grants access to **one application**, so a stolen credential compromises one
service, not the whole network (see S26 for the principle; this kata is the
implementation).

## Worked example

**Meridian Bank: securing the GCP mobile-banking backend**

The mobile-API (`10.100.x.x`) calls a connector, which calls the card-processor,
which calls a secrets service. Security requirements:

1. No engineer reaches the admin console via VPN — use IAP with corporate SSO.
2. Only the connector may call the card-processor; all other workloads are denied.
3. The CDE (`10.10.20.0/24` in HQ-DC1) is reachable only via the connector.

**IAP on the admin console**

The admin console is published through an Application Load Balancer with GCP Cloud
IAP enabled on the backend service; the admin VM itself has no external IP. Because
IAP-for-web traffic arrives via the load balancer / Google Front End, the VPC
firewall permits the backend's serving port (TCP 8080) only from `130.211.0.0/22`
and `35.191.0.0/16` (the Google load-balancer and health-check ranges). All other
inbound is denied. When an engineer opens the admin URL, IAP checks their Google
Workspace token against the IAP resource policy (`roles/iap.httpsResourceAccessor`
granted only to `group:infra-team`). Deny if not in the group; forward if allowed.

(If this were instead SSH/RDP or arbitrary TCP to the VM via `gcloud compute
start-iap-tunnel`, that is IAP *TCP forwarding* — a different path. There the
firewall source is `35.235.240.0/20` and the grant is
`roles/iap.tunnelResourceAccessor`. Don't conflate the two ranges or roles.)

**Microsegmentation via GCP service accounts**

```
  Service          Service Account       Allowed ingress
  ─────────────────────────────────────────────────────
  mobile-api       sa-mobile-api         connector:8443
  connector        sa-connector          card-processor:9443
  card-processor   sa-card-proc          secrets-svc:8200
  secrets-svc      sa-secrets            (none from workloads)
  any other VM     —                     DENIED to all above
```

GCP VPC firewall rule (simplified):

```
  Name:     allow-connector-to-cardproc
  Target:   service-account=sa-card-proc@meridian.iam.gserviceaccount.com
  Source:   service-account=sa-connector@meridian.iam.gserviceaccount.com
  Protocol: TCP  Port: 9443
  Priority: 1000
  (Implicit final rule: deny all ingress — GCP default)
```

The rule references service accounts, not IP ranges. When the connector pod
reschedules, the IP changes — the rule still holds. This is the critical shift
from traditional firewall design.

**CDE boundary**

Cloud Router does not advertise `10.10.20.0/24` into the mobile-API subnets. Only
the connector's firewall rules permit the on-prem interconnect path to that range.
All other GCP workloads receive DENY for `10.10.20.0/24` traffic at the VPC
firewall level. This satisfies PCI-DSS segmentation/scoping intent (Req 1.3–1.4):
network access to and from the CDE is restricted to required flows.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Microsegmentation | Host firewall (iptables/nftables) or NSX distributed firewall | VPC firewall rules by service account or network tag | Security Groups per ENI + AWS Network Firewall for stateful east-west inspection | (Azure: TODO — NSG + Azure Firewall; Illumio for agent-based) |
| Workload identity for policy | AD computer account / Kerberos SPN | GCP Service Account (used as firewall source/target) | IAM role on EC2 instance profile; SG-to-SG referencing | (Azure: TODO — Managed Identity) |
| Identity-Aware Proxy | Nginx + OIDC plugin; Cloudflare Access | **GCP Cloud IAP** (native; Google Workspace / Cloud Identity) for GCP-hosted apps; **BeyondCorp Enterprise + connector** covers arbitrary on-prem apps | **AWS Verified Access** (GA 2023); ALB + Cognito as lighter alternative | (Azure: TODO — Azure AD Application Proxy) |
| Top-down deny (org-wide) | Panorama / Cisco ACI contract | Hierarchical Firewall Policy (org/folder level) | SCPs at the AWS Organization level | (Azure: TODO) |

**GCP vs AWS microseg key difference:** GCP VPC firewall rules natively reference
service accounts as source/target. AWS Security Groups reference other SGs, which
works within a VPC; cross-VPC east-west enforcement needs AWS Network Firewall.

## Do it (the exercise)

**A — Blast radius comparison [laptop / paper]**

1. Draw the five Meridian Bank services as boxes and arrows (allowed calls only).
2. Mark the card-processor as compromised in the flat model. Shade all reachable
   boxes red. Repeat for the microsegmented model. Count red boxes in each case.
3. Calculate the blast-radius reduction.

**B — Simulate microsegment deny with iptables [laptop]**

```bash
# Deny all inbound to port 9443
sudo iptables -A INPUT -p tcp --dport 9443 -j DROP

# Start a listener (second terminal):
nc -l 9443 &

# Attempt connection — should hang/timeout:
nc 127.0.0.1 9443

# Allow from loopback (simulate the connector SA):
sudo iptables -I INPUT -p tcp -s 127.0.0.1 --dport 9443 -j ACCEPT

# Retry — succeeds now:
nc 127.0.0.1 9443

# Clean up:
sudo iptables -D INPUT -p tcp --dport 9443 -j DROP
sudo iptables -D INPUT -p tcp -s 127.0.0.1 --dport 9443 -j ACCEPT
kill %1
```

This is the deny-by-default + explicit-allow pattern. On GCP it is VPC firewall
rules; in Kubernetes it is NetworkPolicy objects.

**C — Inspect an IAP resource policy [needs cloud account]**

```bash
# Read the IAP policy on a backend service:
gcloud iap web get-iam-policy \
  --resource-type=backend-services \
  --service=<backend-service-name> \
  --project=<project-id>

# Grant an engineer IAP accessor:
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services \
  --service=<backend-service-name> \
  --member="user:engineer@meridian.example" \
  --role="roles/iap.httpsResourceAccessor"
```

Navigating the backend URL without the binding returns HTTP 403 before the app
code is ever reached.

## Say it back (self-check)

1. What lateral-movement attack does microsegmentation prevent that a perimeter
   firewall cannot?
2. Why does a microsegmentation rule referencing a service account survive a
   container reschedule when an IP-range rule would break?
3. What two checks does IAP perform? What does the user *not* need compared with
   traditional VPN?
4. A developer says "the service is in a private subnet, that's sufficient." What
   specific threat does that not address?
5. In GCP, what is the correct primitive for microsegmentation policy (network tag
   vs service account vs IP range), and why?

## Talk to the IT/security head

**Ask:**
- "For east-west traffic inside the VPC, is there an explicit allow rule per
  service pair, or is the zone broadly open?"
  *Good answer:* "Deny by default; we have explicit rules per service account and
  audit them quarterly."
  *Red flag:* "Everything inside the VPC is trusted — that's why we have the
  perimeter." This is a flat network; one compromised workload owns the zone.

- "How do engineers reach internal admin tools — VPN to the whole network, or
  per-app access control?"
  *Good answer:* "Cloud IAP with SSO and device-posture check; we decommissioned
  SSL-VPN for internal tooling."
  *Red flag:* Client VPN assigns a network address; a stolen credential gives
  lateral access to every host on that range. In a PCI scope this is an audit finding.

- "If a service account is compromised, how far can it pivot?"
  *Good answer:* a named bounded set of services, constrained by explicit firewall
  rules — the CISO can show you the rule base.
  *Red flag:* "The SA has Editor on the project" — not microsegmentation; single
  point of failure for the entire workload plane.

**Red flags:**
- "We have a WAF / perimeter NGFW, so east-west is handled." WAF/NGFW are
  north-south controls; east-west is a separate attack surface.
- Zero-trust language on slides; VPN still the sole access model; no workload-level
  firewall rules in place.
- Microsegmentation project "in progress for two years" with policy-enforcement
  still off pending exception review — extremely common in FSI estates.

## Pitfalls & war stories

**The rule base that was never enforced.** A bank spent 18 months mapping flows and
drafting rules. The rules lived in a spreadsheet. A catch-all "allow internal" rule
at priority 100 stayed in the firewall. The microseg layer never switched on. The
RBI examiner found it; the CISO did not. Map-then-enforce is the only sequence that
works.

**Service account sprawl.** When three services share the default Compute Engine SA
("it was easier"), every firewall rule that allows service A also allows B and C.
Northwind FMCG hit this after M&A: forty VMs running as the default SA, the
microsegmentation model collapsed back to zone-level.

**CDE scope creep via flat VPC.** If the analytics service and the CDE-touching
connector share a subnet with no VPC firewall block between them, PCI-DSS scoping
guidance (Req 1.3–1.4 segmentation) may pull analytics into CDE scope. The
microsegmentation rule that blocks
analytics → connector is the technical control that keeps analytics out of scope.

**mTLS is not a substitute.** mTLS authenticates and encrypts; it does not restrict
which services are permitted to initiate connections (unless an authorization layer
such as Istio AuthorizationPolicy is also in place). Network-layer microsegmentation
is a separate defense-in-depth control (see S01).

## Going deeper (optional)

- **NIST SP 800-207** Zero Trust Architecture — Section 3 covers the
  microsegmentation approach vs. the SDP and identity approaches; the authoritative
  GRC reference.
- **BeyondCorp** (Google, 2014) — the original paper describing large-scale
  IAP-style access; no VPN, identity + device posture per request. Shaped Cloud IAP.
- **GCP Cloud IAP docs** — `cloud.google.com/iap/docs` — includes the
  `35.235.240.0/20` TCP-forwarding range and BeyondCorp Enterprise context-aware
  access extension.
- **AWS Verified Access** — `docs.aws.amazon.com/verified-access/latest/ug/` — AWS
  native IAP equivalent (GA April 2023; previewed re:Invent Nov 2022).
- Pairs with: S26 (Zero Trust principles), S27 (ZTNA/SASE), N27 (DMZ &
  segmentation), N37 (remote-access VPN & ZTNA successor), S07 (RBAC/least privilege).

# Kata N44 — Private connectivity: PSC / PrivateLink / Private Endpoint

> **Track:** Networking · **Module:** N8 Cloud networking foundations · **Prereqs:** N39, N40, N41, N42 · **Time:** ~35 min
> **Tags:** `cloud` `networking` `private-link` `psc` `private-endpoint` `vpc` `segmentation` `gcp`

## Why it matters

Every cloud workload eventually needs to consume a managed service — a database,
a storage bucket, a Kafka-style queue, a third-party SaaS API. The default path
for those services is a **public endpoint** on the internet. That is fine for a
startup; it is unacceptable for a bank. Meridian Bank's CISO will not allow
cardholder data to flow across the public internet even under TLS — and the RBI
expects every path into the regulated zone to be auditable and controlled. Private
connectivity constructs (PSC, PrivateLink, Private Endpoint) solve this by giving
a cloud or partner service a private IP inside your own VPC, so traffic never
leaves the cloud provider's fabric and never touches the internet. Understanding
how these work — and where they differ — is the difference between a cloud design
that passes a regulated audit and one that doesn't.

## The mental model

### The problem: public endpoints in a private world

A managed service like Cloud SQL, Amazon RDS, or a partner's SaaS API normally
listens on a public IP. Your VPC workload reaches it over the internet (or at best
across the provider's backbone with no IP-level isolation). That path:

- crosses a public address range the CISO must justify to auditors,
- can't be firewall-ruled with a stable IP (managed services rotate IPs),
- fails data-residency rules if the packet could be observed or rerouted.

```
WITHOUT private connectivity
─────────────────────────────────────────────────────────────────────
  Your VM  ─→  NAT gateway  ─→  public internet / cloud backbone
               (egress cost)     (no audit control over the path)
                                              ↓
                                   Managed service (public IP)
```

### The solution: inject a private endpoint into your VPC

All three clouds solve this by creating a **private endpoint** — a virtual NIC or
DNS alias sitting inside your VPC, with a private RFC 1918 IP, that forwards
traffic to the managed service. From your VM's perspective the service looks
local. The path never leaves the provider's internal fabric.

```
WITH private connectivity
─────────────────────────────────────────────────────────────────────
  Your VM  ─→  private IP (10.100.x.x)  ─→  provider's internal fabric
               (stays in your VPC)                     ↓
                                           Managed service (no public IP)
```

### How each cloud builds this

The mechanism differs per cloud; the mental model is the same.

**GCP — Private Service Connect (PSC)**

PSC is GCP's current preferred mechanism (replacing older Private Service Access /
VPC peering with `/29` allocations for some services). A PSC endpoint is a
**forwarding rule** that points to a PSC published service or a Google-managed
service API. GCP assigns it a private IP from a subnet you specify; DNS resolves
to that IP. The traffic flows over Google's internal network, not the internet.

PSC also allows **producers** (your own service, or a partner service on GCP) to
publish via PSC so consumers connect without VPC peering.

```
Consumer VPC (Meridian Bank)          Google-managed service
─────────────────────────────         ───────────────────────
 App subnet: 10.100.0.0/20           Cloud SQL (asia-south1)
                                       no public IP required
  VM (10.100.0.10)
     │
     ▼
 PSC subnet: 10.100.16.0/28           Google's internal
  PSC endpoint                       →  service fabric
  10.100.16.4  ──────────────────────
  (forwarding rule)
     │
  DNS: private.meridian.internal
       → 10.100.16.4
```

**AWS — VPC Endpoint / PrivateLink**

AWS has two flavours:
- **Interface endpoints** (PrivateLink): ENI (Elastic Network Interface) injected
  into your subnet with a private IP; used for AWS services (S3, SQS, KMS, etc.)
  and third-party SaaS via AWS Marketplace.
- **Gateway endpoints**: a route-table entry (not an ENI); supported only for S3
  and DynamoDB; free but less flexible.

PrivateLink also lets producers publish via NLB (Network Load Balancer) and
consumers create an endpoint connection — the same producer/consumer pattern as PSC.

**Azure — Private Endpoint**

Azure's Private Endpoint injects a NIC (with a private IP from your VNet subnet)
into your VNet, representing an Azure PaaS service (Azure SQL, Storage, Key Vault,
etc.) or a partner service. It is the Azure equivalent of AWS Interface Endpoint.
Azure Private Link Service is the producer side.

### The DNS subtlety

Private connectivity is useless if DNS still resolves to the public IP. All three
clouds provide private DNS zones that override the public hostname for the service.
You **must** configure this — or your VM resolves to the public IP and routes
around the endpoint. In a hybrid setup (on-prem via VPN or Interconnect) you must
also forward DNS to the cloud's private zones (see N45, N50).

```
Public resolution (WRONG for private connectivity):
  cloud-sql-instance.example.com  →  34.102.x.x  (public IP)

Private zone override (CORRECT):
  cloud-sql-instance.example.com  →  10.100.0.100  (PSC endpoint)
```

### PSC vs VPC peering for service access

An older GCP pattern used **VPC peering** to connect a Google-managed service VPC
to yours. PSC supersedes this for most new services. The critical difference:

| | VPC peering | PSC |
|---|---|---|
| Route propagation | All routes shared (transitive peering not supported; flat subnet risks) | Only the endpoint IP; no route leakage |
| IP space collision | Risk if both VPCs use the same RFC 1918 ranges | No collision — only a single IP injected |
| Multiple consumers | Each needs a peering relationship | Many consumers can connect to one producer |

For Meridian Bank this matters: VPC peering to a managed-services VPC exposes
more of the network than the CISO wants. PSC is the least-privilege option.

## Worked example

Meridian Bank's mobile-banking backend runs on GCP in the `meridian-prod` VPC,
CIDR `10.100.0.0/14` (see `reference/running-example.md`). The backend needs to
read from a **Cloud SQL** (PostgreSQL) instance storing account data.

### Step 1 — allocate a PSC endpoint subnet

Reserve a small subnet for PSC endpoints. GCP requires endpoints sit in a
`/29` or larger subnet with **Purpose: PRIVATE_SERVICE_CONNECT**. Choose a range
from the GCP allocation:

```
GCP supernet: 10.100.0.0/14  (10.100.0.0 – 10.103.255.255)
  meridian-prod-apps:      10.100.0.0/20   (workloads)
  meridian-prod-psc:       10.100.16.0/28  (PSC endpoints — 16 IPs, enough)
```

Subnet math check: `10.100.16.0/28` → network 10.100.16.0, broadcast 10.100.16.15,
usable 10.100.16.1–10.100.16.14. All within the `10.100.0.0/14` supernet (last
address in /14 is 10.103.255.255). Correct — no overlap.

### Step 2 — create the PSC endpoint (forwarding rule)

```bash
# [needs cloud account]
gcloud compute forwarding-rules create psc-cloudsql-endpoint \
  --network=meridian-prod \
  --subnet=meridian-prod-psc \
  --address=10.100.16.4 \
  --target-service-attachment=projects/[google-managed]/regions/asia-south1/serviceAttachments/[sql-attachment] \
  --region=asia-south1
```

This assigns `10.100.16.4` as the private IP for Cloud SQL inside `meridian-prod`.

### Step 3 — configure private DNS

Create a Cloud DNS private zone so the Cloud SQL hostname resolves to the endpoint
rather than its public IP:

```bash
# [needs cloud account]
gcloud dns managed-zones create psc-cloudsql-zone \
  --dns-name="asia-south1.sql.goog." \
  --visibility=private \
  --networks=meridian-prod

gcloud dns record-sets create meridian-db.asia-south1.sql.goog. \
  --zone=psc-cloudsql-zone \
  --type=A \
  --ttl=300 \
  --rrdatas=10.100.16.4
```

### Step 4 — verify (from a VM in the VPC)

```bash
# [needs cloud account] — from a VM in meridian-prod-apps subnet
dig +short meridian-db.asia-south1.sql.goog.
# Expected: 10.100.16.4   ← private IP (correct)
# Wrong answer: 34.102.x.x ← public IP means DNS override is missing

# Confirm route stays private (no public gateway in path)
traceroute -n 10.100.16.4
# Should show 1 hop within the VPC fabric
```

### AWS equivalent for the same pattern (Northwind FMCG)

Northwind's ERP on AWS (`10.104.0.0/14`) needs to reach Amazon RDS without public
exposure. The AWS path uses an **Interface VPC Endpoint** (PrivateLink):

```
Northwind-prod VPC: 10.104.0.0/20
  Private endpoint ENI: 10.104.0.250  (assigned by AWS from the subnet)
  → rds.ap-south-1.amazonaws.com private hosted zone → 10.104.0.250
```

AWS automatically creates a private hosted zone entry when you enable
**private DNS** on the interface endpoint. Same DNS-override pattern.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem equivalent | GCP | AWS | Azure |
|---------|-------------------|-----|-----|-------|
| Private service endpoint | Firewall-rule to private IP of managed service | **Private Service Connect** (PSC) endpoint | **Interface VPC Endpoint** (PrivateLink) | **Private Endpoint** |
| Producer side (publish your service privately) | n/a (internal network) | PSC published service (ServiceAttachment) | VPC Endpoint Service (backed by NLB) | Private Link Service |
| Free gateway-style endpoint | Static route to internal service | Not applicable | **Gateway VPC Endpoint** (S3 + DynamoDB only) | (Azure: TODO) |
| Private DNS override required? | n/a | Yes — Cloud DNS private zone | Yes — Route 53 private hosted zone (auto if enabled) | Yes — Azure Private DNS Zone |
| Endpoint IP assigned from | — | Subnet you specify (Purpose: PSC) | Subnet in your VPC (assigned by AWS) | Subnet in your VNet |
| Transitive access (on-prem via VPN/interconnect) | Native | Requires DNS forwarding + PSC endpoint reachable via hybrid path | Requires Route 53 Resolver + endpoint in subnet reachable from on-prem | Requires custom DNS + Private Endpoint reachable from on-prem |
| Older / predecessor pattern | — | Private Service Access (VPC peering `/29`) | *(no equivalent predecessor for PrivateLink)* | (Azure: TODO) |

## Do it (the exercise)

**Part A — reason about the DNS problem [laptop]**

On your laptop, observe the difference between public and private resolution for a
real GCP-managed service hostname. You won't have a PSC endpoint, but you can see
what the public IP would be — and understand why a private zone must override it:

```bash
# [laptop] — needs dig (macOS: built-in; Linux: apt install dnsutils)
dig +short sqladmin.googleapis.com
# Returns one or more public IPs (34.x.x.x or similar)
# This is what your VM resolves WITHOUT a private DNS override.
```

Observe: these are public IPs. A VM using PSC should never see these — it should
see its private endpoint IP instead. That's the override.

**Part B — design the endpoint subnet [laptop / paper]**

Given Meridian Bank's GCP CIDR `10.100.0.0/14`:

1. Sketch which `/28` to reserve for PSC endpoints. Verify it is within the /14
   and does not overlap `10.100.0.0/20` (the app subnet).
2. How many PSC endpoint IPs does a `/28` give you? (Answer: 14 usable after
   network and broadcast.)
3. What happens if you put a PSC endpoint in the same subnet as your workloads?
   (It works technically but defeats the principle of isolating service endpoints
   for easier firewall auditing — the CISO will ask.)

**Part C — compare PSC vs PrivateLink [laptop / paper]**

Draw a two-column table: for each difference in the cloud mapping table above,
write one sentence on how it changes the conversation with the IT head or security
team at Meridian Bank.

**Part D — trace the DNS path [needs cloud account]**

If you have a GCP project:
```bash
# Create a test VM in a private subnet (no public IP)
# Attempt to reach Cloud Storage public endpoint
dig +short storage.googleapis.com       # public IP
# Create a Private Service Connect endpoint for Cloud Storage
# Re-run dig from inside the VPC
dig +short storage.googleapis.com       # should now return 10.x.x.x
```

## Say it back (self-check)

1. What is the core problem private connectivity solves, and why does it matter
   more for a bank than a startup?
2. Why is the DNS override not optional — what goes wrong if you skip it?
3. Name the GCP, AWS, and Azure constructs for private service connectivity (the
   consumer side).
4. What is the difference between a **PSC endpoint** and **VPC peering** to a
   managed-service VPC — and why does least-privilege favor PSC?
5. In a hybrid setup where on-prem servers must also reach Cloud SQL privately,
   what two things must be configured beyond just the PSC endpoint?

## Talk to the IT/security head

**Ask:**

- "Which cloud managed services are your workloads consuming, and do they have
  public endpoints today?" *(maps the exposure surface; often the answer is "I
  don't know" — which is itself important)*
- "Does your VPC allow outbound to the internet for managed-service traffic, or
  is it locked down to private paths only?" *(reveals whether egress firewall
  policy actually enforces private-only access)*
- "Have you configured private DNS zones to override the service hostnames? Who
  owns that DNS config — the network team or the cloud platform team?" *(DNS
  ownership is a frequent gap; if neither team claims it, the override won't
  exist)*
- "If on-prem systems need to consume the same cloud service, can they reach the
  private endpoint via your Interconnect/VPN path?" *(tests whether the hybrid
  connectivity kata N38 has been worked through for service access)*
- "Has the CISO signed off on which services are exempt from private connectivity
  — and is that list reviewed regularly?" *(determines whether there is a policy
  or just ad-hoc decisions)*

**A good answer sounds like:** "We have a policy: no public endpoints for services
handling customer data. PSC is deployed for Cloud SQL and Cloud Storage in prod.
DNS is managed via a Terraform module that the platform team owns. Our pentest
confirmed no public path to those services. For on-prem access via Interconnect,
DNS forwarding routes to Cloud DNS." Specific, owned, tested.

**Red flags:**

- "We use TLS so the public endpoint is fine" — TLS encrypts the data but doesn't
  prevent the path from being audited, rerouted, or surfaced in network logs the
  bank cannot control. The CISO and RBI auditor will disagree.
- "The developers handle that" — managed-service exposure is not a dev decision;
  it is a network and security policy decision.
- No one knows who owns the private DNS zones. This means the override probably
  isn't configured correctly, and some services are resolving to public IPs.
- "We set it up for prod but not for dev/test" — attackers don't distinguish;
  lateral movement from dev to prod is a known attack path.

## Pitfalls & war stories

**Forgetting the DNS override.** A team at a regulated client spent two weeks
wondering why traffic wasn't flowing through their PSC endpoint. The endpoint was
correctly provisioned. The VMs were resolving the service hostname to its public
IP because no private DNS zone had been created. The PSC endpoint was never used.
The fix is two commands; the discovery took two weeks.

**VPC peering to managed-services VPC — then regretting it.** The older GCP
Private Service Access pattern allocates a `/29` from your IP space and peers the
managed-service VPC to yours. If your VPC is already peered to others, you hit
GCP's **transitive peering limitation** (GCP does not allow peering chains: A↔B
and B↔C does not let A reach C). PSC was introduced partly to escape this. If
you're in a design with many VPCs or Shared VPC (N52), PSC is the right answer.

**Interface endpoint per-AZ cost on AWS.** AWS Interface Endpoints are charged per
AZ per hour (~$0.01/hour each, 2025 pricing) plus per-GB data processing. In
multi-AZ setups with many services, the cost accumulates. Gateway endpoints (S3,
DynamoDB) are free — use them for those two services. Know the difference before
the cloud bill lands.

**On-prem DNS not forwarding to private zones.** A hybrid design often has
on-prem resolvers (BIND, Windows DNS) that don't know about the cloud's private
zones. On-prem systems resolve managed-service hostnames to public IPs and route
across the internet even when a private endpoint exists in the VPC. The fix is
**conditional DNS forwarding** from on-prem resolvers to the cloud's inbound DNS
forwarders — see N45 (Cloud DNS) and N50 (hybrid DNS end-to-end).

**Producer endpoint misconfiguration (PSC published service).** When you publish
your own service via PSC for a partner or another VPC to consume, you must
explicitly **accept** connection requests. A common mistake: the service
attachment is set to auto-accept all connections — removing the control that PSC
is meant to provide. Always review the acceptance policy, especially in
FSI where every connectivity path must be auditable.

**Confusing PSC with Shared VPC.** PSC gives a **single endpoint IP** for a
specific service. Shared VPC (N52) shares subnets across projects in the same
organization. They are complementary, not interchangeable. A common mistake is
using VPC peering or Shared VPC to solve what PSC handles better, and vice versa.

## Going deeper (optional)

- [GCP Private Service Connect overview](https://cloud.google.com/vpc/docs/private-service-connect)
  — authoritative; covers endpoint types, DNS, and the producer/consumer model.
- [AWS PrivateLink concepts](https://docs.aws.amazon.com/vpc/latest/privatelink/concepts.html)
  — interface vs gateway endpoints, service endpoint policies.
- [Azure Private Endpoint docs](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview)
  — DNS integration is the most complex part; their "DNS for Private Endpoints"
  article is worth reading end-to-end.
- RFC 1918 — the private address space that makes private endpoints meaningful;
  reviewed in N07.
- Pairs with N38 (dedicated interconnect) — private endpoints become useful only
  if the path from on-prem to cloud is also private.
- Pairs with N45 (Cloud DNS) and N50 (hybrid DNS) — the DNS forwarding config
  that makes private endpoints work end-to-end.
- Pairs with S35 (cloud network security) — private connectivity is a network
  control that supports the CISO's data-exposure posture.

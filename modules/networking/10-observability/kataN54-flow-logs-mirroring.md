# Kata N54 — Flow logs & packet mirroring across clouds

> **Track:** Networking · **Module:** N10 Observability & troubleshooting · **Prereqs:** N39, N42, N53 · **Time:** ~35 min
> **Tags:** `networking` `flow-logs` `packet-mirroring` `cloud` `monitoring` `security` `gcp` `aws`

## Why it matters

When a bank's mobile-banking API times out or a suspicious lateral-movement alert
fires in the SOC, the first question is always: *what was the actual traffic?*
On-premises, NetOps would pull a NetFlow export from the router or span a port.
In the cloud the answer is **flow logs** (metadata about connections) and
**packet mirroring** (full payloads captured inline). Architects who don't know
the difference end up promising "we can investigate any incident" when the
evidence was never collected, or burning cloud spend capturing every byte when
summarized flow data would have sufficed. This kata maps the on-premises concept
to every cloud, so you can specify the right level of visibility before the
auditor or CISO asks whether it exists.

## The mental model

### Flow logs — the NetFlow analogy

On-premises, a router or firewall can be configured to export **NetFlow** (or
its successor IPFIX) records to a collector. A NetFlow record is a summary of
one TCP/UDP flow:

```
  srcIP  srcPort  dstIP  dstPort  protocol  bytes  packets  start  end  action
```

Think of it as the call-detail record (CDR) your phone carrier keeps: it proves
*that* a call happened and *how long* it lasted, but it does not contain the
conversation itself.

Cloud flow logs follow the same idea:

```
  ┌─────────────────────────────────────────────────────────────┐
  │                        Your VPC / VNet                      │
  │                                                             │
  │  VM-A ──────► VM-B  (real traffic)                         │
  │     │                                                       │
  │     └──► flow log record written to storage/logging sink    │
  │              srcIP  dstIP  port  proto  bytes  action       │
  └─────────────────────────────────────────────────────────────┘
```

A flow log record does NOT contain the HTTP payload, the query, or the credit
card number — just the envelope metadata. This makes it safe to keep for a long
time (compliance), cheap to store, and fast to query.

### What flow logs can and cannot answer

| Question | Flow logs? | Needs mirroring? |
|----------|-----------|-----------------|
| Did host A talk to host B on port 443? | Yes | No |
| Was that connection allowed or denied? | GCP: no — needs Firewall Rules Logging. AWS: yes (`action` = ACCEPT/REJECT) | No |
| How many bytes were transferred? | Yes | No |
| Which client IP is hammering our API? | Yes | No |
| What was the HTTP path or query string? | No | Yes |
| What malware C2 payload was in the packet? | No | Yes |
| TLS handshake parameters (cipher, SNI)? | No | Yes |

### Packet mirroring — SPAN in the cloud

On-premises, a **SPAN port** (Switched Port Analyzer, also called port
mirroring) copies every frame from one port (or VLAN) to a dedicated capture
port where a sensor or Wireshark sits.

Cloud packet mirroring replicates this:

```
  ┌───────────────────────────────────────────────────────────────┐
  │                          Your VPC                             │
  │                                                               │
  │  VM-A ──────► VM-B  (real traffic, unaffected)               │
  │     │                                                         │
  │     └──► Mirroring policy copies packet bytes                 │
  │               │                                               │
  │               ▼                                               │
  │        Collector (IDS/IPS VM, NDR sensor, PCAP bucket)        │
  └───────────────────────────────────────────────────────────────┘
```

Mirroring adds near-zero latency to the mirrored flows — traffic is not
intercepted, only copied (compare: a TAP, not an in-line proxy). The collector
receives a copy and can do deep packet inspection, IDS signature matching,
or store PCAPs for forensic replay.

Cost implication: mirroring copies raw traffic, which means bytes processed ×
cloud pricing. Mirroring a 10 Gbps production subnet continuously is expensive
and usually impractical. Mirror **surgically**: specific subnets, specific ports,
or triggered on alert.

### The sampling question

Neither NetFlow nor cloud flow logs capture every packet — they record
metadata for each *flow*, aggregated over an interval. Within a flow record,
bytes and packets are counted, not replayed. This matters when
the CISO asks "can we prove no card data left the CDE?" — flow logs prove no
*connection* was made to unexpected destinations; they cannot prove the *content*
of allowed connections didn't include card data. That distinction belongs in
your threat model.

## Worked example

Meridian Bank runs its mobile-banking backend in GCP (`10.100.0.0/14`). The
security team wants to:

1. Keep a 90-day audit trail of all connections into and out of the CDE subnet
   (`10.100.16.0/20` — a `/20` within the GCP VPC, reserved for card-adjacent
   services).
2. Run an IDS sensor on east-west traffic within that subnet to catch lateral
   movement.

**Step 1 — flow logs for audit trail (GCP)**

GCP VPC Flow Logs are enabled per subnet. For the CDE subnet
(`10.100.16.0/20`), the team enables flow logs with:

```
  Aggregation interval: 5 seconds     (fine enough to reconstruct sessions)
  Sampling rate:        1.0 (100%)    (compliance: don't miss a connection)
  Metadata:            include all    (src/dst project, region, VM name)
  Filter:              none           (capture all; filter at query time in BigQuery)
```

Flow logs are written to **Cloud Logging**. To retain them for 90 days in a
CMEK-encrypted bucket, the team adds a separate **Log Router sink** that exports
the matching log entries to Cloud Storage (or BigQuery for query) — enabling
flow logs on the subnet does not, by itself, let you pick Cloud Storage as the
destination.

A log record for a connection from the Meridian app tier to the card-processor
IP `10.100.16.45:8443` looks like:

```
  connection.src_ip:      10.100.8.12        (app tier VM)
  connection.dst_ip:      10.100.16.45       (card processor)
  connection.dst_port:    8443
  connection.protocol:    6                  (TCP)
  bytes_sent:             4192
  bytes_received:         1024
  start_time:             2026-06-17T03:42:11Z
  end_time:               2026-06-17T03:42:12Z
  reporter:               SRC
```

(Note: VPC Flow Logs have no allow/deny field — they only record traffic that
was actually transmitted, i.e. allowed. To see ALLOWED/DENIED decisions in GCP
you enable the separate **Firewall Rules Logging** feature, whose record carries
a `disposition` field with values `ALLOWED` / `DENIED`.)

The auditor can now answer "which IPs talked to the CDE on which day" from a
BigQuery query — no live traffic capture needed.

**Step 2 — packet mirroring for the IDS sensor (GCP)**

A packet-mirroring policy is attached to the CDE subnet. It copies all inbound
+ outbound traffic to a dedicated IDS VM (`10.100.16.252`) running Suricata:

```
  Mirroring policy:
    Source subnet:    10.100.16.0/20
    Direction:        INGRESS + EGRESS
    Protocol filter:  all (or narrow to TCP/8443 if cost pressure)
    Collector:        Internal Load Balancer group (IDS VM farm, for HA)
```

Suricata sees full packet payloads and can match signatures for known C2
patterns, credential stuffing, or data exfiltration. Alerts ship to the SIEM.

Cost reality check: a `/20` (4,092 usable hosts in GCP, which reserves 4 per
range) mirroring all traffic at 1 Gbps average ≈ 10.8 TB/day of mirrored bytes.
At GCP's Packet Mirroring pricing (~$0.05 per GB as of early 2026), that is
~$540/day. In practice Meridian would mirror only the card-processor VMs — a
properly aligned `10.100.16.32/27` (.32–.63, 32 addresses) — and filter to the
specific service ports, dropping the cost by ~90%.

**Northwind contrast**

Northwind FMCG has no PCI requirement but does need visibility across
3,000 retail points feeding into AWS (`10.104.0.0/14`). They enable **Transit
Gateway Flow Logs** (a distinct feature from VPC Flow Logs) on the Transit
Gateway to capture inter-site traffic centrally, and choose the 10-minute
aggregation interval and a minimal field set for cost control. (Unlike GCP VPC
Flow Logs, AWS flow logs have no sampling-rate knob — they capture every
matching flow; you only control the aggregation interval and which fields are
emitted.) Full mirroring is not justified — they instead use CloudWatch
Contributor Insights on the flow logs to spot anomalous talkers (e.g. a plant VM
exfiltrating to an unexpected internet IP after an OT/IT boundary break).

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Flow logging | NetFlow / IPFIX exported from router or firewall | **VPC Flow Logs** (per subnet, sampling configurable, sinks to Cloud Logging/Storage/BigQuery) | **VPC Flow Logs** (per ENI, subnet, or VPC; published to CloudWatch Logs or S3) | **NSG Flow Logs** stored in Azure Storage (Azure: flow log API v2 supports Traffic Analytics via Log Analytics) |
| Flow log granularity | Per-flow, per-interface | Per subnet or per VM NIC; 5 s–15 min aggregation | Per ENI (elastic network interface); 1 min or 10 min intervals | Per NSG (covers the NIC or subnet the NSG is attached to) |
| Flow log sink / query | NetFlow collector (e.g. ntopng, Elastic) | Cloud Logging, Cloud Storage, BigQuery | CloudWatch Logs, S3 + Athena | Azure Storage, Log Analytics / Sentinel |
| Packet mirroring / SPAN | SPAN port, network TAP | **Packet Mirroring** (policy on subnet or VM tag; copies to ILB/collector) | **VPC Traffic Mirroring** (on individual ENIs; copies to NLB or target ENI) | **Azure vNET TAP** — (Azure: TODO — feature exists in preview on select regions; check current GA status) |
| IDS integration | Dedicated IDS appliance on SPAN port | Packet Mirroring → IDS VM or Cloud IDS (managed) | Traffic Mirroring → partner IDS (e.g. Suricata via Marketplace) or Gateway Load Balancer GWLB | Azure vNET TAP → partner sensor (Azure: TODO) |
| Managed IDS (no sensor VM) | Rarely on-prem | **Cloud IDS** (powered by Palo Alto, mirrors under the hood) | **Amazon Inspector** (not traffic IDS — vulnerability scan); GuardDuty analyses VPC Flow Logs for threat signals | **Microsoft Defender for Cloud** + Azure Sentinel (log-based; no inline mirroring equivalent in GA) |
| Egress / transit flow visibility | Core switch / MPLS PE router | Enable **VPC Flow Logs** (subnet-level) and **Cloud NAT logging** for north-south; **Packet Mirroring** for east-west | Enable Flow Logs on **Transit Gateway** ENI or NAT Gateway | Enable Flow Logs on **VPN Gateway** or **NAT Gateway** (Azure: TODO) |
| Retention & compliance | Syslog/NetFlow on SIEM with defined retention | Set GCS bucket lifecycle (e.g. 90 days) with CMEK | S3 lifecycle policy; SSE-KMS | Azure Storage lifecycle management; CMEK via Key Vault |

**Key differences worth explaining to the IT head:**

- GCP's Packet Mirroring targets *subnets or VM network tags* — easy to scope by
  workload tag without knowing individual IPs.
- AWS Traffic Mirroring targets *individual ENIs* — more granular but operationally
  heavier at scale (one policy per ENI, quotas apply).
- Neither copies traffic leaving the cloud (internet egress after NAT) by default.
  To inspect post-NAT traffic you need a dedicated sensor at the egress point or
  a forward proxy (see N23).

## Do it (the exercise)

**Part A — examine flow log schema [laptop]**

1. Download a sample GCP VPC Flow Log in JSON from the public GCP documentation
   sample set (search "VPC Flow Logs log record example") and identify each field:
   `connection.src_ip`, `connection.dst_ip`, `connection.dst_port`,
   `connection.protocol`, `bytes_sent`, `packets_sent`. Map each to its NetFlow
   v9 / IPFIX equivalent.

2. Simulate what a flow log query looks like. If you have BigQuery or Athena
   access, run this mental-model query [needs cloud account]:

   ```sql
   -- BigQuery: find all connections into the CDE subnet in last 24h
   SELECT
     connection.src_ip,
     connection.dst_ip,
     connection.dst_port,
     SUM(bytes_sent)   AS total_bytes,
     COUNT(*)          AS flow_count
   FROM   `project.dataset.vpc_flows`
   WHERE  TIMESTAMP_TRUNC(start_time, DAY) = CURRENT_DATE()
     AND  NET.IP_TRUNC(NET.SAFE_IP_FROM_STRING(connection.dst_ip), 20)
            = NET.IP_FROM_STRING('10.100.16.0')
   GROUP BY 1,2,3
   ORDER BY total_bytes DESC
   LIMIT  20;
   ```

   On paper: write the equivalent question in English ("which source IPs sent
   the most bytes to the CDE subnet in the last 24 hours?") and verify the SQL
   matches.

**Part B — design the visibility plan [laptop / paper]**

Meridian Bank's new GCP project has four subnets:

```
  10.100.8.0/21    app tier (mobile-banking APIs)
  10.100.16.0/20   CDE (card-adjacent services)
  10.100.32.0/20   management plane (jump hosts, CI/CD)
  10.100.64.0/19   data tier (Cloud SQL, analytics)
```

For each subnet, decide:
- Enable VPC Flow Logs? (Y/N, sampling %, aggregation interval)
- Enable Packet Mirroring? (Y/N, direction, filter)
- Where do the logs/captures go? (sink: BigQuery / GCS / SIEM)
- Retention period?

Write your decisions in a table. Compare with the principles from this kata:
compliance subnets → 100% flow log sampling, long retention; low-risk subnets →
lower sampling or no mirroring.

**Part C — AWS equivalent [needs cloud account or paper]**

Sketch the AWS equivalent for Northwind's `10.104.0.0/14` VPC:
- Where do you enable VPC Flow Logs — per ENI, per subnet, or per VPC?
- Do you publish to CloudWatch Logs or S3 + Athena? What's the cost trade-off?
- If the security team wants IDS on the `/20` Transit Gateway-attached subnet,
  which AWS feature enables it and what does the collector architecture look like?

## Say it back (self-check)

1. What is the difference between a VPC Flow Log record and a PCAP? Give two
   questions each can answer that the other cannot.
2. How is cloud Packet Mirroring analogous to an on-prem SPAN port, and what is
   one key operational difference between GCP Packet Mirroring and AWS Traffic
   Mirroring?
3. Why would a bank set flow log sampling to 100% on a CDE subnet but 10% on a
   dev subnet?
4. A SOC analyst reports "we have no idea what happened during the incident —
   logs are empty." Name three configuration mistakes that could cause this.
5. A 10 Gbps subnet is proposed for continuous full packet mirroring. What cost
   and architecture questions must you answer before committing?

## Talk to the IT/security head

**Ask:**

- "Are VPC Flow Logs enabled on every subnet that touches regulated data, or only
  some? What's the sampling rate and retention?"
  *Good answer:* "Flow logs are on by default in the CDE and management VPCs,
  100% sampling, 90-day GCS with CMEK, indexed in BigQuery. Non-regulated VPCs
  are 10% sampled, 30-day retention."
  *Red flag:* "I think they're on somewhere" — no explicit policy, gaps in the
  audit trail.

- "Do we have packet mirroring or an IDS on east-west traffic within the CDE?"
  *Good answer:* describes a specific mirroring policy, named subnets, the
  collector (Cloud IDS or a Suricata cluster), and integration with the SIEM.
  *Red flag:* "we rely on perimeter firewall logs only" — east-west lateral
  movement would be invisible.

- "Where do flow logs land, how long are they kept, and can the SOC query them
  in under 5 minutes for an incident?"
  *Good answer:* specific sink (BigQuery), named dataset, retention policy, and
  they have actually run an incident drill against it.
  *Red flag:* logs go to a bucket nobody queries, or retention is 7 days
  (insufficient for most regulatory requirements — PCI DSS requires 12 months
  with 3 months immediately available).

- "For our cloud workloads, do we know the difference between connection metadata
  we're collecting and actual payload inspection — and which threats each covers?"
  *Good answer:* clear articulation that flow logs detect beaconing/exfiltration
  *patterns* while mirroring/IDS detects payload-level attacks; different tools
  for different threat models.
  *Red flag:* "flow logs are enough for everything" — this misunderstands the
  capability boundary and creates a false assurance.

**Red flags to listen for:**
- No retention policy set → logs auto-expire in 30 days (GCP default) or the
  Cloud Logging bucket is never exported to long-term storage.
- Packet mirroring is enabled "on everything" in production — without cost
  controls this can generate unexpected bills of thousands of dollars per day.
- The SIEM only ingests firewall allow/deny logs, not flow logs — east-west
  inside the VPC is completely dark.

## Pitfalls & war stories

- **The 30-day default trap.** GCP's `_Default` log bucket retains for 30 days.
  PCI DSS v4.0 Requirement 10.5.1 mandates 12 months of audit log retention
  (3 months must be immediately available). If you don't explicitly configure a sink to GCS
  with a 90–365 day lifecycle rule, your compliance posture is broken before you
  start.

- **"We have flow logs" ≠ "we can investigate."** The logs were going to a bucket
  nobody knew about. No IAM access was granted to the SOC. No BigQuery dataset
  was linked. Incident happens; logs are present but inaccessible in under an
  hour. The capability is meaningless without the operational plumbing around it.

- **Mirroring the transit VPC by mistake.** A Northwind engineer enabled AWS
  Traffic Mirroring on the Transit Gateway attachment ENIs without realizing the
  volume. The IDS collector ran out of disk in 4 hours and the unexpected data
  transfer charges hit the next bill. Always estimate bytes/day before enabling
  mirroring on high-throughput links.

- **GCP vs AWS scope difference caught teams off guard.** GCP Packet Mirroring
  is scoped by *subnet or VM network tag* — attaching the network **tag** (e.g.
  `mirrored`) to a VM enrolls it. Network tags are not labels — a label will not
  match a packet-mirroring tag filter. AWS Traffic Mirroring must be configured on each ENI
  individually, and there are per-session quotas. A team that designed the GCP
  policy and expected identical AWS behavior re-architected the collector when
  they hit ENI quota limits.

- **Sampling at 10% passes 90% of suspicious flows undetected.** Sampling is
  fine for capacity planning and cost control but it is not appropriate for
  security monitoring on high-value subnets. These are different requirements;
  don't let the FinOps conversation override the compliance requirement.

- **Meridian Bank FSI scenario.** The RBI/PCI auditor asked: "Show me all
  connections between the card processor and the internet in the last 30 days."
  The team had flow logs enabled but had filtered out egress records to save
  cost. The answer was "we can't" — a minor audit finding that took six months of
  back-filled monitoring to close.

## Going deeper (optional)

- **GCP:** [VPC Flow Logs overview](https://cloud.google.com/vpc/docs/flow-logs)
  and [Packet Mirroring concepts](https://cloud.google.com/vpc/docs/packet-mirroring).
- **AWS:** [VPC Flow Logs User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
  and [Traffic Mirroring User Guide](https://docs.aws.amazon.com/vpc/latest/mirroring/what-is-traffic-mirroring.html).
- **NetFlow / IPFIX:** RFC 3954 (NetFlow v9), RFC 7011 (IPFIX) — the on-prem
  ancestors of cloud flow logs.
- **PCI DSS v4.0 Requirement 10** — log collection, retention, and review
  obligations; **10.5.1** drives the 12-month / 3-month-immediate rule.
- **Pairs with:** N42 (cloud firewalls — what generates deny logs), N53 (latency
  and performance baselines that flow data supports), S20 (SIEM ingestion of
  flow logs), S21 (using flow data for detection engineering), N55 (using flow
  logs in structured troubleshooting).

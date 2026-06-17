# Running Example — Meridian Bank & Northwind FMCG

Every kata reuses these two fictional organizations so knowledge compounds. When
a kata needs a concrete network, draw from here rather than inventing new numbers.

---

## Meridian Bank (regulated financial institution)

A mid-size retail + commercial bank. Conservative, heavily regulated, change is
slow and audited. The IT head's instincts: **segment everything, trust nothing,
keep regulated data in-country, prove it to the auditor.**

### Sites
| Site | Role | Notes |
|------|------|-------|
| HQ-DC1 | Primary data center | Core banking, card systems (PCI scope) |
| DC2 | DR data center | ~40 km away, synchronous-ish replication |
| 220 branches | Retail branches | Thin, SD-WAN candidates, 4G backup |
| Corp offices (3) | Staff | Standard office connectivity |
| Cloud (GCP primary, AWS secondary) | New digital channels | Mobile/web banking, analytics |

### Regulatory constraints (the lens for every design)
- **PCI-DSS**: cardholder data environment (CDE) must be segmented and monitored.
- **Data residency**: customer/regulated data stays in-country (drives region
  choice and DNS/egress design).
- **RBI-style audit**: every firewall rule and access path must be justifiable.
- **Segregation of duties**: network team ≠ security team ≠ app team.

### IP plan (we grow this through the katas — start here)
- Enterprise supernet (RFC 1918): `10.0.0.0/8` carved by region/site.
  - `10.10.0.0/16` — HQ-DC1
  - `10.20.0.0/16` — DC2 (DR)
  - `10.30.0.0/16` — branches (further subnetted per branch)
  - `10.40.0.0/16` — corp offices
- Cloud uses **non-overlapping** ranges (critical for hybrid):
  - GCP: `10.100.0.0/14`
  - AWS: `10.104.0.0/14`
  - (Reserved for Azure later: `10.108.0.0/14`)

> Why non-overlapping matters: site-to-site VPN / interconnect + NAT-free routing
> require unique address space. Overlap is the #1 cause of hybrid pain — see
> Kata 11 and Kata 41.

---

## Northwind FMCG (large fast-moving consumer goods)

A consumer-goods manufacturer + distributor. Many sites, thin margins, cost
pressure, M&A sprawl. The IT head's instincts: **keep the plants and stores
online cheaply, simplify the branch, consolidate the mess we inherited.**

### Sites
| Site | Role | Notes |
|------|------|-------|
| 4 plants | Manufacturing | OT/IT separation, uptime-critical |
| 12 distribution centers | Logistics | WMS, scanners, must not stop |
| ~3,000 retail/field points | Sales | Tiny footprint, SD-WAN sweet spot |
| 2 regional offices | Staff | |
| Cloud (AWS primary, GCP secondary) | ERP/analytics/e-comm | |

### Constraints (the lens)
- **Cost first**: WAN and cloud egress costs dominate conversations.
- **Scale of sites**: 3,000 endpoints → automation and SD-WAN, not hand-config.
- **M&A sprawl**: acquired companies brought **overlapping** `192.168.x.x` and
  `10.x` ranges — the real-world overlap problem.
- **OT/IT separation**: plant-floor networks isolated from corporate IT.

### IP plan (deliberately messier — teaches real problems)
- Original Northwind: `10.50.0.0/16`
- Acquired "Eastfield Foods": also used `10.50.0.0/16` ← **overlap!** (Kata 11)
- Many small sites on `192.168.0.0/16` defaults ← classic sprawl.

---

## How to use these in katas

- **Meridian** = the place to teach segmentation, compliance, DR, careful design.
- **Northwind** = the place to teach scale, cost, SD-WAN, overlap/M&A, simplicity.
- Reuse the **same IPs and site names** so a learner who did Kata 09 recognizes
  `10.10.0.0/16` again in Kata 41.
- When a kata needs an "IT head reaction," channel the instincts above.

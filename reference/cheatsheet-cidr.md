# Cheat-sheet — CIDR & Subnetting

Quick reference for the math you'll do constantly. Full teaching is in N07–N11.

## Private address ranges (RFC 1918) — memorize these

| Range | CIDR | Size | Typical use |
|-------|------|------|-------------|
| 10.0.0.0 – 10.255.255.255 | `10.0.0.0/8` | 16,777,216 | large enterprises (Meridian uses this) |
| 172.16.0.0 – 172.31.255.255 | `172.16.0.0/12` | 1,048,576 | mid-size; Docker default-ish |
| 192.168.0.0 – 192.168.255.255 | `192.168.0.0/16` | 65,536 | home/small office, SOHO gear defaults |
| 100.64.0.0 – 100.127.255.255 | `100.64.0.0/10` | 4,194,304 | RFC 6598 CGNAT / cloud-internal |

## The core idea

`a.b.c.d/n` — the `/n` is how many **leading bits are the network**. The rest are
**host** bits. Bigger `/n` = smaller network.

```
/24  = 255.255.255.0     →  256 addrs,  254 usable hosts
       └─ network ─┘└host┘
```

Usable hosts = `2^(32 − n) − 2` (subtract network + broadcast address).
Exceptions: `/31` (2 addrs, point-to-point links, RFC 3021) and `/32` (1 host).

## The /n ↔ mask ↔ size table (IPv4)

| CIDR | Subnet mask | # addresses | usable hosts |
|------|-------------|-------------|--------------|
| /8  | 255.0.0.0       | 16,777,216 | 16,777,214 |
| /16 | 255.255.0.0     | 65,536     | 65,534 |
| /20 | 255.255.240.0   | 4,096      | 4,094 |
| /22 | 255.255.252.0   | 1,024      | 1,022 |
| /23 | 255.255.254.0   | 512        | 510 |
| /24 | 255.255.255.0   | 256        | 254 |
| /25 | 255.255.255.128 | 128        | 126 |
| /26 | 255.255.255.192 | 64         | 62 |
| /27 | 255.255.255.224 | 32         | 30 |
| /28 | 255.255.255.240 | 16         | 14 |
| /29 | 255.255.255.248 | 8          | 6 |
| /30 | 255.255.255.252 | 4          | 2 |
| /31 | 255.255.255.254 | 2          | 2* (P2P links) |
| /32 | 255.255.255.255 | 1          | 1 (single host) |

**Last-octet jump trick:** for /25–/30, block size = `256 − mask_octet`.
E.g. /26 → mask 192 → blocks of 64 → subnets at .0, .64, .128, .192.

## Worked: split `10.10.0.0/16` into /24s (Meridian HQ)

- `/16` → `/24` borrows 8 bits → **256** subnets of **254** hosts each.
- They are `10.10.0.0/24`, `10.10.1.0/24`, … `10.10.255.0/24`.
- Assign by function: `.0` = servers, `.10` = DB tier, `.20` = DMZ, etc.

## Cloud reservations (don't assume all hosts are usable!)

Cloud providers reserve addresses in **every** subnet:

| Provider | Reserved per subnet | Note |
|----------|--------------------|------|
| AWS | **5** (.0 network, .1 router, .2 DNS, .3 future, last broadcast) | usable = size − 5 |
| GCP | **4** (.0 network, .1 gateway, second-to-last, last broadcast) | usable = size − 4 |
| Azure | **5** (.0 network, .1 gateway, .2/.3 DNS, last broadcast) | usable = size − 5 |

So a `/24` gives ~251 usable in AWS/Azure, ~252 in GCP — not 254. This matters
when sizing tight subnets. *Taught in N40.*

## Verify, don't trust your head

```bash
ipcalc 10.10.0.0/22
sipcalc 10.10.0.0/22
python3 -c "import ipaddress as i; n=i.ip_network('10.10.0.0/22'); \
print(n.network_address, n.broadcast_address, n.num_addresses)"
python3 -c "import ipaddress as i; \
print(list(i.ip_network('10.10.0.0/16').subnets(new_prefix=24))[:4])"
```

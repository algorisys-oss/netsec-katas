# Lab Setup — Laptop-first toolchain

This curriculum is **laptop + paper first**. You can do the vast majority of
exercises with free CLI tools and containers on your own machine. Cloud-account
steps are always marked `[needs cloud account]` and are optional until Module 8.

## Core CLI tools (install once)

| Tool | Use | Linux | macOS |
|------|-----|-------|-------|
| `ping` | reachability | built-in | built-in |
| `traceroute` / `mtr` | path + per-hop loss | `apt install traceroute mtr` | `brew install mtr` |
| `dig` / `nslookup` | DNS queries | `apt install dnsutils` | `nslookup` built-in; `brew install bind` pulls full BIND to get `dig` |
| `ip` (iproute2) | addresses, routes, links | built-in | use `ifconfig`/`netstat` or Linux container |
| `tcpdump` | packet capture | `apt install tcpdump` | built-in |
| Wireshark | packet capture GUI | `apt install wireshark` | `brew install --cask wireshark` |
| `curl` | HTTP/TLS testing | built-in | built-in |
| `openssl` | TLS/cert inspection | built-in | built-in |
| `nc` (netcat) | raw TCP/UDP | `apt install netcat-openbsd` | built-in |
| `nmap` | port scan (your own hosts only) | `apt install nmap` | `brew install nmap` |

> **macOS note:** the Linux `ip` command isn't native. Either learn the BSD
> equivalents (`ifconfig`, `netstat -rn`, `route`) or run a Linux container:
> `docker run -it --rm --privileged nicolaka/netshoot` gives you every tool above
> in one shell. This `netshoot` image is the recommended sandbox for most katas.

## Container sandbox (recommended)

Docker/Podman lets you build multi-host networks on one laptop — perfect for
subnetting, routing, DNS, and proxy katas without touching a cloud.

```bash
# A throwaway network-tools shell with everything preinstalled:
docker run -it --rm --privileged nicolaka/netshoot

# Build a private lab network and attach two hosts to it:
docker network create --subnet 10.10.1.0/24 labnet
docker run -dit --name hostA --network labnet --ip 10.10.1.10 nicolaka/netshoot
docker run -dit --name hostB --network labnet --ip 10.10.1.20 nicolaka/netshoot
docker exec hostA ping -c2 10.10.1.20      # they can reach each other
```

We'll grow this lab network as modules progress (add routers, a DNS server, an
nginx reverse proxy, a Squid forward proxy — all containers).

## Pen-and-paper

Module 2 (subnetting) is best done **by hand first**, then checked with a tool
(`ipcalc`, or `sipcalc`, or Python's `ipaddress` module). Build the muscle, then
verify:

```bash
apt install ipcalc       # or: pip install ipcalc-ng
ipcalc 10.10.0.0/22
python3 -c "import ipaddress; print(list(ipaddress.ip_network('10.10.0.0/22').subnets(new_prefix=24)))"
```

## Optional cloud (Module 8+)

Only needed when you want to *touch* real VPCs. Free tiers exist for GCP and AWS;
network primitives (VPCs, subnets, firewall rules, route tables) are mostly free
— the charges come from running VMs, NAT gateways, LBs, and egress. Always tear
down. Setup instructions live in the relevant Module 8 katas, not here.

> Golden rule for cloud labs: **create in a throwaway project/account, set a
> budget alert, and destroy everything when done.** NAT gateways and idle LBs
> quietly bill by the hour.

# Tag vocabulary

Every kata carries a `> **Tags:**` line (the second blockquote line) with **4–8**
tags, each backtick-wrapped and `lowercase-hyphenated`, e.g.:

```markdown
> **Tags:** `dns` `resolution` `ttl` `caching` `hybrid`
```

Tags power search/filter in the web app. Keep them **consistent** — prefer a term
already listed here over a synonym. Coin a new tag only when nothing fits, then
add it to the right section below. Always include:

- exactly one **layer** tag when the kata is about a specific OSI/TCPIP layer
  (skip for pure concept/process katas), and
- at least one **domain** tag (`networking`, `security`, `cloud`, …).

---

## Layer
`l1-physical` · `l2-data-link` · `l3-network` · `l4-transport` · `l7-application`

## Domain
`networking` · `security` · `cloud` · `on-prem` · `hybrid` · `multi-cloud` ·
`data-center` · `wan` · `branch`

## Networking — protocols & concepts
`osi` · `tcp-ip` · `encapsulation` · `mtu` · `ethernet` · `mac` · `arp` ·
`switching` · `vlan` · `broadcast-domain` · `ipv4` · `ipv6` · `cidr` ·
`subnetting` · `vlsm` · `rfc1918` · `nat` · `routing` · `default-gateway` ·
`static-routing` · `ospf` · `bgp` · `dns` · `dhcp` · `ipam` · `tcp` · `udp` ·
`ports` · `tls` · `mtls` · `pki` · `load-balancing` · `proxy` · `forward-proxy` ·
`reverse-proxy` · `api-gateway` · `cdn` · `waf` · `qos` · `multicast`

## Network security & perimeter
`firewall` · `stateful-firewall` · `defense-in-depth` · `cia-triad` ·
`segmentation` · `micro-segmentation` ·
`dmz` · `north-south` · `east-west` · `ids-ips` · `ndr` · `ddos` · `vpn` ·
`ipsec` · `site-to-site` · `remote-access` · `ssl-vpn` · `interconnect`

## On-prem & WAN
`spine-leaf` · `three-tier` · `oversubscription` · `high-availability` ·
`vrrp` · `hsrp` · `link-aggregation` · `mpls` · `leased-line` · `sd-wan` ·
`netflow` · `change-control` · `monitoring`

## Cloud
`vpc` · `vnet` · `subnets` · `regions` · `zones` · `route-table` ·
`internet-gateway` · `nat-gateway` · `vpc-peering` · `transit-gateway` ·
`hub-and-spoke` · `private-link` · `psc` · `private-endpoint` · `shared-vpc` ·
`cloud-dns` · `cloud-lb` · `cloud-cdn` · `landing-zone` · `egress` ·
`flow-logs` · `packet-mirroring`

## Cloud vendors
`gcp` · `aws` · `azure`

## Security — identity
`iam` · `authn` · `authz` · `sessions` · `tokens` · `sso` · `federation` ·
`saml` · `oidc` · `oauth2` · `mfa` · `passwordless` · `fido2` · `passkeys` ·
`rbac` · `abac` · `least-privilege` · `pam` · `jml` · `directory-services`

## Security — crypto & data
`cryptography` · `symmetric` · `asymmetric` · `hashing` · `signing` ·
`certificates` · `revocation` · `key-management` · `kms` · `hsm` · `vault` ·
`envelope-encryption` · `encryption-at-rest` · `encryption-in-transit` ·
`cmek` · `byok` · `data-classification` · `dlp` · `tokenization` · `masking`

## Security — appsec, secops, resilience
`owasp` · `secure-sdlc` · `sast` · `dast` · `sca` · `api-security` ·
`supply-chain` · `sbom` · `siem` · `telemetry` · `detection-engineering` ·
`soar` · `soc` · `threat-intel` · `vulnerability-management` · `patching` · `incident-response` ·
`ransomware` · `bcp-dr` · `backups` · `forensics`

## Security — zero trust & posture
`zero-trust` · `ztna` · `sase` · `sse` · `identity-aware-proxy` ·
`shared-responsibility` · `cspm` · `cwpp` · `cnapp` · `cloud-iam` ·
`security-command-center` · `guardduty` · `defender`

## Governance, risk & compliance
`compliance` · `pci-dss` · `rbi` · `gdpr` · `dpdp` · `data-residency` ·
`nist-csf` · `iso-27001` · `soc2` · `cis` · `risk-management` ·
`third-party-risk` · `audit`

## Concept / pedagogy / context (cross-cutting)
`first-principles` · `mental-model` · `troubleshooting` · `tooling` ·
`cost` · `latency` · `blast-radius` · `architecture-review` · `conversation` ·
`capstone` · `fsi` · `fmcg` · `meridian-bank` · `northwind` · `who-is-who`

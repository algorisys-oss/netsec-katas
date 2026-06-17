# Kata S16 — Software supply chain: dependencies, SBOM, signing, provenance

> **Track:** Security · **Module:** S3 Application & API security · **Prereqs:** S01, S14 · **Time:** ~35 min
> **Tags:** `supply-chain` `sbom` `signing` `sca` `secure-sdlc` `security` `vulnerability-management` `fsi`

## Why it matters

Modern applications are mostly code you did not write. The average enterprise
Java service carries 150–300 transitive dependencies; a containerised Python
service easily tops 500 packages. In 2020, SolarWinds showed that a single
poisoned build step could give attackers undetected access to 18,000 customers.
In 2021, Log4Shell turned a ubiquitous logging library into a zero-day in
thousands of unrelated applications — and most teams didn't even know they had
it. For a CISO at Meridian Bank, the question is not "do you patch your own
code?" — it's "can you tell me in 30 minutes every system that carries a
vulnerable component, and can you prove your build pipeline wasn't tampered
with?" That question requires a software bill of materials, artifact signing,
and provenance — the three pillars of this kata.

## The mental model

**The supply chain has four attack surfaces:**

```
  Source code ──► Build pipeline ──► Artifact registry ──► Runtime
  (your repo)     (CI/CD)            (container/package)    (prod)
       │               │                     │                  │
   typosquatting    CI runner          registry poisoning    known-CVE
   dependency       compromise         unsigned image         component
   confusion        (SolarWinds)       swap                   (Log4Shell)
```

Each stage can be compromised independently. Defense requires controls at
every stage — you can't compensate for a poisoned registry with a clean source.

---

**SBOM — the ingredient label for software**

An SBOM (Software Bill of Materials) is a machine-readable list of every
component in a software artifact: package name, version, license, and (in
modern formats) the known vulnerabilities and the supplier. Two dominant
formats:

```
  SPDX      (ISO/IEC 5962:2021) — Linux Foundation project; tag-value/JSON/YAML/RDF-XML
  CycloneDX (OWASP project)     — XML/JSON; richer VEX support
```

You generate an SBOM at build time and attach it to the artifact. Later —
when Log4Shell breaks — you query the SBOM: "give me every image containing
`log4j-core` before version 2.15.0." Without an SBOM you grep logs and pray.

---

**Dependency confusion and typosquatting**

```
  Your package.json: "@meridian/auth-utils": "1.2.0"   ← private package (Nexus)
  Attacker publishes:  @meridian/auth-utils  99.0.0  on npmjs.com  ← higher version
  Build tool resolves public registry first (if misconfigured) → attacker wins
```

Dependency confusion (Alex Birsan, 2021): by publishing a public package with
the same name as your internal one but a higher version number, an attacker can
cause misconfigured build tools to pull their malicious package instead of yours.
Typosquatting is simpler: `reqeusts` instead of `requests`.

---

**Artifact signing and provenance (SLSA)**

Signing answers: "was this artifact produced by my trusted build and not
swapped in transit?"

```
  Build produces artifact
        │
        ▼
  Sign with private key  ──────────────────────────────────────────────┐
  (Sigstore/cosign or GPG)                                             │
        │                                                              │
        ▼                                                              ▼
  Push: image + signature + SBOM + attestation             Verifier checks:
        │                                                   1. Signature valid?
        ▼                                                   2. SBOM present?
  Registry (Artifact Registry / ECR)                       3. Built from main?
                                                            4. No critical CVE?
```

**SLSA (Supply chain Levels for Software Artifacts)** — a Google-originated
framework (now OpenSSF). SLSA v1.0 (April 2023, current as of 2026)
restructured the model into *tracks*; the **Build track** defines levels L0–L3:

| SLSA Build level | What is guaranteed |
|------------------|-------------------|
| L0 | No guarantees — baseline (no provenance) |
| L1 | Build is scripted; provenance exists and describes how the artifact was built |
| L2 | Build runs on a hosted platform that signs provenance; provenance is authenticated and tamper-evident |
| L3 | Build runs in a hardened, isolated platform; provenance is unforgeable and resistant to a compromised build process |

> **Legacy note:** the older SLSA v0.1 model used Levels 1–4, where "Level 4"
> meant a two-party-reviewed, hermetic, reproducible build. v1.0 **removed L4**
> and deferred hermetic/reproducible-build requirements to a future version, so
> treat any "SLSA Level 4" reference as the obsolete v0.1 numbering.

Most FSI teams target SLSA Build L2–L3 for production-critical pipelines. L1 is
the minimum defensible position.

---

**VEX — Vulnerability Exploitability eXchange**

A VEX document says: "yes, this component is in our SBOM and has CVE-XXXX,
but here is why we assess it as not exploitable in our deployment context."
This stops the triage queue from drowning in false positives. VEX is
an OWASP/CISA standard and is embedded in CycloneDX 1.4+.

## Worked example

Meridian Bank's mobile-banking backend (GCP, `10.100.0.0/14` cloud range, see
running-example.md) is a Java Spring Boot service built in Cloud Build and
stored in Artifact Registry. The security team needs to demonstrate Log4Shell
blast radius to the auditor within one business day.

**Without SBOM:**
```
Security team: grep all running containers for 'log4j'
→ 180 images, 4 registries, no consistent manifest format
→ 6 hours later: probably found 80% of them. Auditor is not satisfied.
```

**With SBOM (SPDX) generated at build time and stored in Artifact Registry:**
```bash
# [laptop] Query Artifact Registry metadata for a known image
# (illustrative — uses real gcloud CLI flags; requires [needs cloud account])
gcloud artifacts docker images list \
  asia-south1-docker.pkg.dev/meridian-prod/services \
  --format="value(package,version)"

# The SBOM was attached at build time via cosign:
cosign download sbom \
  asia-south1-docker.pkg.dev/meridian-prod/services/mobile-api:v2.4.1

# Parse SBOM for log4j-core < 2.15.0 (the Log4Shell fix version)
# Output is SPDX JSON; use jq to filter:
cosign download sbom <image> \
  | jq '.packages[] | select(.name=="log4j-core") | {name, version}'
```

If the SBOM is stored consistently, a one-liner query across images identifies
every affected service in minutes. The CISO gives the auditor a list in under
an hour — a meaningful audit differentiator for an RBI inspection.

---

**SLSA Build L2 pipeline in Cloud Build (structure only):**

```
cloudbuild.yaml (sketch — not full production config):

steps:
  - id: build
    name: 'maven:3.9-eclipse-temurin-17'
    args: ['mvn', 'package', '-DskipTests']

  - id: generate-sbom
    name: 'anchore/syft'
    args: ['packages', 'dir:.', '-o', 'spdx-json=sbom.spdx.json']

  - id: docker-build-push
    name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/...', '.']

  - id: sign-and-attest
    name: 'gcr.io/projectsigstore/cosign'
    args:
      - sign
      - '--key=gcpkms://projects/.../cryptoKeyVersions/1'
      - '${_IMAGE}'
    # cosign attaches the signature to the registry alongside the image

  - id: attach-sbom
    name: 'gcr.io/projectsigstore/cosign'
    args: ['attach', 'sbom', '--sbom=sbom.spdx.json', '${_IMAGE}']
```

The signature uses a key in Cloud KMS (see S11, S12) — the build runner never
touches a raw private key.

---

**Verifying the image at deploy time:**

```bash
# [laptop] Install cosign (v2.x)
# https://docs.sigstore.dev/cosign/system_config/installation/

# Verify signature before allowing deploy
cosign verify \
  --key gcpkms://projects/meridian-prod/... \
  asia-south1-docker.pkg.dev/meridian-prod/services/mobile-api:v2.4.1

# Output (success):
# Verification for asia-south1-docker.pkg.dev/.../mobile-api:v2.4.1 --
# The following checks were performed on each of these signatures:
#   - The cosign claims were validated
#   - The signatures were verified against the specified public key
```

If the image was swapped after signing, `cosign verify` fails with a non-zero
exit code. Gate your deploy pipeline on this check.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem / generic | GCP | AWS | Azure |
|---------|-------------------|-----|-----|-------|
| Artifact registry | Nexus, JFrog Artifactory | Artifact Registry | Amazon ECR | Azure Container Registry |
| SBOM generation | Syft, cdxgen (open source, runs anywhere) | Syft in Cloud Build step | Syft / cdxgen in CodeBuild; Amazon Inspector generates SBOMs | (Azure: TODO) |
| SBOM attachment & storage | cosign attach (open source) | cosign + Artifact Registry (OCI referrers API) | cosign + ECR (OCI referrers API); Inspector SBOM export | (Azure: TODO) |
| Artifact signing | GPG, cosign (Sigstore) | cosign + Cloud KMS key | cosign + AWS KMS key; AWS Signer | (Azure: TODO) |
| Provenance / SLSA attestation | in-toto attestation + cosign | Cloud Build native SLSA provenance (L2 for managed workers) | CodeBuild provenance (L2 when using managed compute) | (Azure: TODO) |
| SCA / CVE scanning | OWASP Dependency-Check, Grype | Artifact Registry vulnerability scanning (powered by Container Analysis) | Amazon Inspector v2 (ECR scanning) | (Azure: TODO) |
| Policy enforcement at deploy | OPA / Kyverno (Kubernetes) | Binary Authorization (GKE, Cloud Run) | AWS Signer + EKS admission webhook; ECR pull-through policies | (Azure: TODO) |
| Dependency proxy / firewall | Nexus proxy repo, JFrog remote repo | Artifact Registry remote repositories (proxy + allow-list) | CodeArtifact (npm, PyPI, Maven proxy) | (Azure: TODO) |

> **Binary Authorization (GCP):** a GKE/Cloud Run admission controller that
> refuses to deploy any image that lacks a valid attestation from your signing
> key — enforces the "sign before deploy" invariant in production.

## Do it (the exercise)

**Part A — generate an SBOM from a real project [laptop]**

1. Install [Syft](https://github.com/anchore/syft) (open source, SBOM
   generator by Anchore):
   ```bash
   # Linux / macOS via official install script
   curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh \
     | sh -s -- -b /usr/local/bin
   ```
2. Pick any local Docker image or directory with a `pom.xml` / `requirements.txt`:
   ```bash
   # Scan a local image (pull a small public one if needed)
   docker pull eclipse-temurin:17-jre-alpine
   syft eclipse-temurin:17-jre-alpine -o spdx-json > sbom.spdx.json
   ```
3. Count the packages found:
   ```bash
   jq '.packages | length' sbom.spdx.json
   ```
4. Check for any package with "log4j" in its name:
   ```bash
   jq '.packages[] | select(.name | test("log4j"; "i"))' sbom.spdx.json
   ```

**Part B — scan SBOM for known CVEs [laptop]**

5. Install [Grype](https://github.com/anchore/grype) (Anchore's CVE scanner):
   ```bash
   curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh \
     | sh -s -- -b /usr/local/bin
   ```
6. Scan the image directly (Grype generates an SBOM internally then cross-
   references the NVD and GitHub Advisory databases):
   ```bash
   grype eclipse-temurin:17-jre-alpine --fail-on critical
   # exit code 1 if any CRITICAL vulnerability found
   ```
7. Note the severity breakdown. Ask: which of these would block a PCI-DSS audit?

**Part C — understand signing with cosign [laptop]**

8. Install cosign v2:
   ```bash
   # See https://docs.sigstore.dev/cosign/system_config/installation/
   # e.g. on Linux amd64:
   COSIGN_VERSION=v2.2.4
   curl -Lo cosign https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-linux-amd64
   chmod +x cosign && sudo mv cosign /usr/local/bin/
   ```
9. Generate a short-lived keyless signing identity (requires GitHub/Google/
   Microsoft account — no permanent key to manage):
   ```bash
   # Sign a local image digest (you need write access to a registry; or
   # use the --registry-referrers-mode flag with a local OCI layout)
   # For the exercise, inspect an already-signed public image instead:
   cosign verify \
     --certificate-identity-regexp='https://github.com/sigstore/.*' \
     --certificate-oidc-issuer='https://token.actions.githubusercontent.com' \
     cgr.dev/chainguard/static:latest
   ```
   Examine the output — note the Fulcio-issued certificate chain and the
   Rekor transparency-log entry (a public, append-only audit log).

**Part D — policy thinking [paper]**

10. For Meridian Bank's mobile-banking backend, write a one-paragraph deploy
    gate policy: what must be true about an image *before* it is allowed into
    production? Consider: signed? SBOM present? No CRITICAL CVEs? Built from
    `main` branch only? How do you enforce this in a Kubernetes admission
    controller?

## Say it back (self-check)

1. What is an SBOM and what two standard formats exist? What problem does it
   solve that a traditional vulnerability scan alone cannot?
2. Explain dependency confusion. What misconfiguration enables it, and what is
   the mitigation?
3. What does cosign signing prove about an artifact, and what does it NOT prove
   if your CI runner itself was compromised?
4. Name the SLSA v1.0 Build track levels (L0–L3) in one phrase each. At which
   level would you say a team is "defensible" in an FSI audit context?
5. What is a VEX document and why does a CISO care about it alongside an SBOM?

## Talk to the IT/security head

**Ask:**

- "Do you produce an SBOM for every production artifact today? What format, and
  where is it stored?" *(reveals whether they can answer a Log4Shell-style
  question in hours or days)*
- "How do you prevent a developer from pulling a typosquatted package from a
  public registry?" *(tests whether they have a dependency proxy or allow-list)*
- "Are your container images signed, and is the signature verified before
  deploy?" *(the gap between signing and enforcing is where most teams are)*
- "What is your SLA for patching a CRITICAL CVE in a transitive dependency you
  don't control?" *(PCI-DSS Req 6.3.3 requires critical patches within one
  month; RBI mandates 30 days for critical)*
- "Do your build pipelines run on shared, long-lived runners or ephemeral
  isolated workers?" *(shared persistent runners are the main SLSA L2→L3 gap)*

**A good answer sounds like:** "We generate CycloneDX SBOMs in our CloudBuild
pipelines and attach them to every image in Artifact Registry. Binary
Authorization blocks any unsigned image from reaching GKE. Container Analysis
gives us a CVE feed per image within minutes of push. Our SCA gates the build
on HIGH and above; the CISO reviews CRITICAL findings within 24 hours."

**Red flags:**

- "We scan the OS layer but not the application dependencies" — misses 80% of
  the attack surface; Log4Shell was in the JAR, not the OS.
- "Developers use their own `~/.m2` or `~/node_modules` caches" — no audit
  trail; dependency confusion is trivially exploitable.
- "We sign images but Binary Authorization is in monitor mode, not enforce
  mode" — signing theatre; deploy gate is wide open.
- "We'll patch it in the next sprint" — no risk-based prioritization; CRITICAL
  CVEs in internet-exposed services warrant emergency response, not sprint
  planning.
- "Our CI runners are shared across teams" — single-tenant persistent runners
  are a lateral-movement vector; a compromised build in one team can poison
  another team's artifacts.

## Pitfalls & war stories

**The "we scan at build" gap.** Scanning a container image at build time and
never again means a CVE disclosed six months later is invisible until the next
build. Continuous scanning in the registry (Artifact Registry / ECR Inspector)
is required — image contents don't change after push but the CVE database does.

**Dependency confusion in a bank.** An FSI client had internal npm packages
named `@meridian/auth-utils` published only to a private Nexus instance.
Their CI runner was configured with *both* the public npm registry and the
private one, public first. An attacker published `@meridian/auth-utils` to
npmjs.com at version 99.0.0. The CI runner fetched the malicious package. The
fix: configure the private Nexus as the sole allowed registry, with explicit
allow-listing for public packages, and remove public registry access from
build runners entirely.

**SBOM completeness traps.** Syft and similar tools are excellent on the JVM
and Python ecosystems but can miss dynamically-loaded plugins, Go vendor
directories that weren't committed, or native libraries bundled inside a JAR
(e.g. Netty's native TLS). Treat SBOM coverage as a KPI, not a checkbox.
For Meridian Bank's payment gateway, 97% SBOM coverage is a different risk
posture than 70%.

**Signing without enforcing.** The most common supply-chain control gap: images
are signed, Binary Authorization or OPA-Gatekeeper is deployed, but the policy
is in `WARN` (monitor) mode, not `DENY`. No image is ever blocked. The
CISO's dashboard shows "signed: 100%" and nobody notices that the enforcement
door is open. Always test the gate by deploying an *unsigned* image — it should
fail.

**VEX fatigue.** A team inherits 2,000 CVE findings from an automated scanner
on day one. Without VEX triage, every finding looks equal. With VEX, the team
marks 1,800 as "not exploitable in our configuration" and focuses energy on the
200 that matter. The risk: VEX can become a mechanism for dismissing real
findings without rigorous analysis. The CISO should review VEX decisions for
HIGH and above.

**Northwind FMCG note.** An FMCG with 3,000 retail endpoints running
containerised point-of-sale is also in PCI scope. Managing SBOMs and signing
across a heterogeneous estate of ARM-based thin clients, x86 servers, and a
mix of AWS (primary) and GCP (secondary) registries requires a unified signing
key hierarchy and a registry proxy that enforces the same policy at both clouds.
Cost pressure means the team often skips private Nexus/JFrog and uses public
registries directly — precisely the configuration that enables dependency
confusion.

## Going deeper (optional)

- **SLSA framework:** https://slsa.dev — the canonical reference for supply
  chain levels; produced by OpenSSF (Google, CNCF, Linux Foundation).
- **Sigstore / cosign:** https://www.sigstore.dev — the keyless signing
  ecosystem; cosign, Fulcio (CA), Rekor (transparency log).
- **CISA SBOM guidance:** "SBOM at a Glance" (April 2021) and the NTIA minimum
  elements document — what a regulator will look for.
- **OWASP CycloneDX / VEX:** https://cyclonedx.org — the standard for SBOM
  with VEX support; actively maintained by OWASP.
- **NIST SP 800-218 (Secure Software Development Framework):** the SSDF maps
  supply-chain controls to specific practices; referenced by US executive orders
  on software security and increasingly cited in FSI audits.
- **OpenSSF Scorecard:** https://github.com/ossf/scorecard — automated
  assessment of open-source project security hygiene (branch protection,
  signed releases, pinned dependencies); use it to evaluate a third-party
  dependency before adding it.
- Pairs with **S14** (secure SDLC), **S11** (key management for signing keys),
  **S22** (vulnerability management at scale), and **N25** (WAF/front door as
  the last line of defense when a vulnerable component reaches prod).

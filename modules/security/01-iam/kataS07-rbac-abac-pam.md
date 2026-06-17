# Kata S07 — RBAC vs ABAC; least privilege; PAM; joiner-mover-leaver

> **Track:** Security · **Module:** S1 Identity & Access Management · **Prereqs:** S04, S05, S06 · **Time:** ~35 min
> **Tags:** `iam` `rbac` `abac` `least-privilege` `pam` `jml` `security` `fsi`

## Why it matters

Banks and FMCGs issue hundreds — sometimes thousands — of access grants per year.
Without a disciplined model for how those grants are structured and cleaned up,
the accumulated excess permission is where breaches live: an attacker who
compromises any account inherits everything that account was ever granted. The
CISO's nightmare is a stale privileged account with production DB access sitting
on a developer's laptop. This kata gives you the frameworks — RBAC, ABAC, least
privilege, and PAM — and the joiner-mover-leaver process that keeps them honest.
PCI-DSS (Req 7 and 8) and RBI IT Framework both make this mandatory; knowing the
vocabulary lets you translate a compliance finding into a concrete design decision.

## The mental model

**1. How access decisions work: RBAC vs ABAC**

Both answer the same question — "should subject S be allowed to perform action A
on resource R?" — but they use different evidence.

```
  RBAC  (Role-Based Access Control)
  ─────────────────────────────────
  Subject ──▶ assigned Roles ──▶ Permissions on Resources

  Example: User "priya.k" has role "branch-ops"
           which grants READ on accounts, NO access to card PAN.

  ABAC  (Attribute-Based Access Control)
  ──────────────────────────────────────
  Policy engine evaluates attributes at request time:

    subject attributes:  role=branch-ops, dept=retail, location=Mumbai
    resource attributes: classification=PCI, data-type=PAN, region=IN
    environment attrs:   time=09:30, device-trust=managed, risk-score=2

    Policy: DENY if data-type=PAN AND subject.role != card-ops
            DENY if time outside 08:00-20:00 AND risk-score > 5
            ALLOW otherwise

  ABAC is RBAC's superset — you can express role in an attribute.
  Most enterprise IAM combines both: RBAC for coarse-grained assignment,
  ABAC/policy for fine-grained context-aware enforcement.
```

**2. Least privilege — the first principle**

A subject should hold the *minimum permissions required to complete its task,
for the minimum time needed.* Two corollaries that architects get wrong:

```
  Principle                What architects miss
  ────────────────────────────────────────────────────────────────────
  Minimum permissions      Roles accumulate. Nobody ever removes access.
                           "While I have access, I'll also look at X."

  Minimum time (JIT)       Standing privileged access is a loaded gun.
                           Issue a 4-hour ticket; revoke automatically.
```

**3. PAM — Privileged Access Management**

PAM addresses the specific problem of *high-powered* accounts: database admins,
root, cloud owner-project, network engineers with firewall write-access.

```
  A PAM system does four things:

  ┌────────────────────────────────────────────────────────────────┐
  │  1. Vault      store privileged credentials (rotate auto)     │
  │  2. Broker     check out a session credential for N hours     │
  │  3. Record     full keystroke/screen recording of the session │
  │  4. Detect     alert on anomalous commands in real time       │
  └────────────────────────────────────────────────────────────────┘

  Without PAM: admin SSH directly with a shared root password
               known to 12 people, never rotated.
  With PAM:    admin requests access → PAM validates identity + reason
               → injects a one-time SSH key → session is recorded
               → key expires after 2 hours.
```

**4. JML — Joiner-Mover-Leaver**

Every HR event that touches an employee's role must trigger an IAM event:

```
  JOINER   New hire → provision minimum role set on day 1.
           Do NOT copy a peer's permissions ("copy user" anti-pattern).
           Provision only what the role definition says.

  MOVER    Transfer/promotion → add new role AND remove old role.
           Most systems add; almost no system removes automatically.
           This is where privilege accumulation happens.

  LEAVER   Resignation / termination → deprovision ALL access within
           SLA (PCI-DSS: immediately for terminated (Req 8.2.5); RBI: same day).
           Includes service accounts, shared IDs, VPN credentials,
           cloud console, physical badge.
```

The JML process fails silently. No error is thrown when a leaver's account
still has access. The first signal is often an audit finding — or a breach.

## Worked example

**Meridian Bank: card-ops access, applied**

Meridian's CDE subnet `10.10.20.0/24` (see `reference/running-example.md`) hosts
the card-processing system. Three staff types need access:

```
  Staff type       What they legitimately need
  ───────────────────────────────────────────────────────────────────
  card-ops team    Read + update card records during business hours
  DBA (priv)       Schema changes via a PAM session, fully recorded
  auditor          Read-only, time-limited, specific query set only
```

**Step 1 — RBAC layer (coarse):**

```
  Role           Permissions on card-system
  ─────────────────────────────────────────────────────────────────
  card-ops       READ/WRITE card records (no raw PAN export)
  cde-dba-priv   FULL — only accessible via PAM broker, JIT
  cde-auditor    READ, specific audit views only, 90-day window
```

**Step 2 — ABAC policy (fine-grained):**

```
  Policy for card-ops:
    ALLOW if subject.role=card-ops
      AND request.time between 06:00-22:00 IST
      AND subject.device.managed=true
      AND subject.mfa-verified=true
    DENY PAN export regardless of role unless subject.role=cde-auditor
         AND request.approved-by=CISO
```

**Step 3 — PAM for cde-dba-priv:**

No standing access. When DBA Ramesh logs a change ticket:
1. PAM validates ticket number + approver in ITSM.
2. PAM injects a time-limited SSH key (expires 4 hours).
3. Session is recorded, keystroke-searchable, stored 180 days.
4. If Ramesh runs `DROP TABLE`, an alert fires within 30 seconds.

**Step 4 — JML event: Priya moves from branch-ops to card-ops:**

```
  Correct:  add role card-ops, REMOVE role branch-ops on same day.
  Common mistake: add card-ops, forget to remove branch-ops.
  Result:   Priya can now access branch audit logs AND card records.
  PCI-DSS finding: user holds permissions beyond job function (Req 7).
```

**Northwind: contractor access pattern**

A logistics-software contractor needs access to the WMS at distribution center
`10.50.x.x` for 6 weeks during a go-live. Without JML + PAM discipline:
the contractor's account exists 18 months later, the contract is over, nobody
notices. With JML:
- Account provisioned with an explicit expiry date = 6 weeks.
- System auto-disables on day 43, does not wait for HR to file a ticket.
- Access limited to the WMS API namespace, not the full DC network.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem / traditional | GCP | AWS | Azure |
|---|---|---|---|---|
| RBAC model | AD security groups → ACLs | IAM roles bound to principals (predefined + custom) | IAM policies + Permission Boundaries | Azure RBAC built into Entra ID |
| ABAC / conditions | Custom policy engines (e.g. Axiomatics, PlainID) | IAM Conditions (resource tags, request time, IP range) | IAM Condition Keys in policies | Azure ABAC on resource attributes (preview/GA by tier) |
| Least privilege enforcement | Manual role review; entitlement reviews | Recommender (unused permissions → shrink role) | IAM Access Analyzer + last-used data | Entra ID Access Reviews |
| PAM vault + brokering | CyberArk, BeyondTrust, Delinea | Privileged Access Manager (GCP PAM, GA Sep 2024) | AWS Systems Manager Session Manager + Secrets Manager | Azure PIM (Privileged Identity Management) |
| JIT privileged access | PAM system issues time-limited credentials | GCP PAM grants (time-bounded, approval workflow) | AWS IAM Identity Center session + SSM Session Manager | Azure PIM role activation (time-bound, approval) |
| JML lifecycle | HR system → AD provisioning script; IAM reviews | Workforce Identity Federation + Recommender | IAM Identity Center with auto-provisioning via SCIM | Entra ID Lifecycle Workflows (SCIM provisioning) |
| Privileged session recording | CyberArk PSM, BeyondTrust | GCP PAM + Cloud Audit Logs | SSM Session Manager log to S3 / CloudWatch | Azure Bastion session recording |

GCP note: **GCP PAM** (Cloud Privileged Access Manager) reached GA for Org-level
grants in late 2024. It issues time-bounded IAM grants with an approval workflow
and logs every grant/revocation in Cloud Audit Logs — directly replacing the
"always-on Owner role for the ops team" anti-pattern.

AWS note: **AWS IAM Access Analyzer** generates least-privilege policies by
analyzing CloudTrail history of what a role actually called — a practical starting
point for right-sizing over-permissioned roles.

## Do it (the exercise)

**Part A — JML audit [laptop / paper]**

1. Take any system you know (cloud or on-prem). List five accounts that have
   access to it.
2. For each account answer: (a) is it still active? (b) does the permission
   level match the current job function? (c) when was it last used?
3. Identify whether any account has accumulated access from a prior role
   (classic mover failure). Flag it.

**Part B — RBAC role design [paper]**

Design roles for Meridian Bank's GCP landing zone:
- `network-admin`: can modify VPC firewall rules in the network project.
- `app-developer`: can deploy Cloud Run in service projects, no network changes.
- `security-auditor`: read-only on all projects, including audit logs.
- `break-glass`: full project owner, PAM-gated, session-recorded.

For each role, state: (a) minimum IAM permissions, (b) whether standing or JIT,
(c) whether MFA-required (see S06).

**Part C — ABAC policy [paper]**

Write plain-English ABAC rules for Meridian Bank's card-ops role that:
- Allow access only from managed devices (`device.managed=true`).
- Allow access only during business hours (06:00–22:00 IST).
- Deny PAN export to any role other than `cde-auditor` with CISO approval.

**Part D — verify IAM Recommender output [needs cloud account — GCP]**

```bash
# List permission recommendations for a GCP project (requires roles/recommender.iamViewer)
gcloud recommender recommendations list \
  --project=YOUR_PROJECT_ID \
  --location=global \
  --recommender=google.iam.policy.Recommender \
  --format="table(name,stateInfo.state,primaryImpact.securityProjection.details)"
```

Each recommendation shows which role bindings have unused permissions.
Apply one recommendation and verify the principal still functions correctly.

## Say it back (self-check)

1. What is the core difference between RBAC and ABAC? Give a use case where
   ABAC is necessary and RBAC alone is insufficient.
2. State the least-privilege principle in one sentence. Name two organizational
   habits that routinely violate it.
3. What four functions does a PAM system provide, and which one stops an insider
   threat *during* a session (not just after)?
4. Walk through the three JML lifecycle stages. At which stage does privilege
   accumulation typically occur, and why?
5. A PCI-DSS auditor finds that a developer has the `card-ops` role that a
   former colleague held. Which JML stage failed, and what control would have
   caught it?

## Talk to the IT/security head

**Ask:**

1. "What's your role model — RBAC, ABAC, or a combination? How are roles
   formally defined and who owns that definition?"

   *Good answer:* a documented role catalog tied to job functions (not
   individuals), reviewed annually, owned by a named team. Roles are assigned
   to job titles, not individuals directly.
   *Red flag:* "we copy an existing user's access" — this is the most reliable
   way to propagate excess privilege.

2. "How long does it take to deprovision a leaver's access after HR files the
   termination? Who tracks it end-to-end?"

   *Good answer:* a defined SLA (e.g. same business day for voluntary; immediate
   for involuntary termination), automated where possible, with an exception report
   to the CISO. PCI-DSS Req 8.2.5 requires that access for terminated users is
   immediately revoked.
   *Red flag:* "it usually happens, HR sends an email" — no defined SLA, no
   tracking, almost certainly failing PCI Req 8.

3. "Do your privileged accounts (DBAs, firewall admins, cloud owners) have
   standing access, or is it just-in-time through a PAM system?"

   *Good answer:* JIT via CyberArk/BeyondTrust/GCP PAM/AWS IAM Identity Center
   / SSM Session Manager (Azure PIM); sessions
   recorded; credentials rotated after each checkout; alerts on anomalous commands.
   *Red flag:* "our DBAs have a shared root password" — a single compromised
   credential gives full database access to an attacker, with no session recording.

4. "Has your access model been reviewed against actual usage? Do you have
   entitlement reviews or rely on tools like IAM Analyzer/Recommender?"

   *Good answer:* quarterly or annual entitlement review using tooling; unused
   permissions trigger role shrinkage; evidence preserved for audit.
   *Red flag:* access is only reviewed during an audit — by definition too late.

5. "For cloud IAM: what's the highest privilege role in production, who holds it,
   and is it JIT or standing?"

   *Good answer:* `Owner` or equivalent is granted only via PAM/PIM for
   break-glass scenarios, never standing. Regular admin roles are custom with
   minimal permissions.
   *Red flag:* "a few people have Owner" — in cloud, an Owner can exfiltrate
   all data, modify all network controls, and disable logging.

## Pitfalls & war stories

**The copy-user anti-pattern:** An IT admin is asked to provision a new joiner
and "just copies Priya's access because she's in the same team." Priya joined in
2019 and was in three different roles before her current one. The new joiner now
has access to systems from 2019. This is invisible until an audit.

**Service accounts accumulate the worst access:** At Meridian Bank, a CI/CD
pipeline service account was given `Owner` on the GCP project "temporarily"
during setup. Three years later it still has it — and it's not subject to
MFA or session recording. Service accounts are principals too; apply the same
JML and least-privilege discipline.

**"We can't deprovision — they might need access for the audit":** A classic FSI
stall. The answer is a read-only, time-limited, auditor-scoped grant, not keeping
a leaver's account active. Keeping a leaver's credentials active is a PCI Req 8
violation; it is not a hedge against audit disruption.

**FMCG: contractor sprawl:** Northwind's procurement team rotates contractors
every few months across 3,000 sites. Without automated expiry on contractor
accounts, the active-account count grows indefinitely. At one FMCG, a security
audit found 800 active contractor accounts for a company with 200 current
contractors — and no one person owned the cleanup.

**Cloud "emergency" credentials live forever:** The break-glass `Owner` account
created during a production incident to "just fix it quickly" gets used once,
then lives in a spreadsheet. The password is never rotated. This is the credential
an attacker will find if they get read access to that spreadsheet.

## Going deeper (optional)

- **PCI-DSS v4.0, Requirements 7 and 8** — the authoritative source for access
  control and identity management requirements in FSI card environments.
  <https://www.pcisecuritystandards.org/document_library/>
- **NIST SP 800-207** — Zero Trust Architecture; Section 3 covers identity-centric
  access and is the conceptual underpinning of ABAC + continuous verification.
  Revisit in S26.
- **NIST SP 800-53 Rev 5, AC family** — Access Control controls catalog;
  AC-2 (Account Management) is the JML control; AC-6 is Least Privilege.
- **GCP IAM Conditions** — <https://cloud.google.com/iam/docs/conditions-overview>
- **AWS IAM Access Analyzer** — <https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html>
- Pairs with **S04** (AuthN/AuthZ fundamentals), **S05** (SSO/federation —
  where identities come from), **S06** (MFA — the gate before access is granted),
  and **S08** (directory services and cloud IAM deep dive).
- Cross-track: **N37** (ZTNA) and **S26** (Zero Trust) apply identity-aware
  access at the network level — the network enforcing the same ABAC policy
  you designed here.

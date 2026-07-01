# Kata S01 — The security mindset: CIA, threat/vuln/risk, defense in depth

> **Track:** Security · **Module:** S0 Security foundations · **Prereqs:** none · **Time:** ~25 min
> **Tags:** `security` `first-principles` `risk-management` `mental-model` `defense-in-depth`

## Why it matters

A CISO doesn't think in features; they think in **risk**. If you propose a design
in feature language and they answer in risk language, the conversation stalls and
your design waits. The few foundational concepts in this kata — CIA, the
threat/vulnerability/risk distinction, and defense in depth — are the grammar of
every security review. Get them right and you can frame your own designs in terms
the CISO will actually approve.

## The mental model

**1. The CIA triad** — what security protects:

```
        Confidentiality   only the right people can read it
   CIA  Integrity         data isn't altered without authorization
        Availability      it's there when needed
```

These *trade off*. Encrypting everything (C) can hurt availability (A) if you lose
a key. Locking a system down hard (C, I) can make it unusable (A). Security
architecture is choosing the *balance the business needs* — for a bank, integrity
of a transaction ledger may outrank everything; for a public website, availability.

**2. Threat vs vulnerability vs risk** — the three words people muddle:

```
  THREAT          a potential cause of harm        "an attacker / malware / insider"
  VULNERABILITY   a weakness it could exploit       "unpatched server, weak password"
  RISK            likelihood × impact of that match  "what we actually act on"

  RISK ≈ Likelihood × Impact
        where Likelihood ≈ Threat × Vulnerability
        so   RISK ≈ (Threat × Vulnerability) × Impact
```

You can't remove threats (attackers exist). You reduce **vulnerabilities** and
limit **impact** — and you prioritize by **risk**, not by what's scariest.

**3. Defense in depth** — no single control is trusted; layer them so one failure
isn't fatal:

```
  Perimeter → Network seg → Host → App → Data → Identity → Monitoring
  (firewall)  (VLAN/ZTNA)   (EDR)  (WAF)  (encrypt) (MFA/IAM)  (SIEM)
```

Pairs directly with networking **blast radius** (see N01) and **segmentation**
(N27): the network *is* several of these layers.

**4. AAA** — the access backbone you'll meet again in IAM (S04):
**A**uthentication (who are you), **A**uthorization (what may you do),
**A**ccounting (what did you do).

## Worked example

Meridian Bank's new mobile backend (the same system from N01), in risk language:

| Concept | Applied to the mobile backend |
|---------|------------------------------|
| Confidentiality | Account balances must not leak → TLS in transit (N21), encryption at rest, tight IAM. |
| Integrity | A transfer amount must not be tamperable → signed requests, server-side validation, audit log. |
| Availability | Customers expect 24/7 → DR region, DDoS protection (N28). |
| Threat | External attacker; malicious insider; compromised dependency. |
| Vulnerability | Over-permissioned cloud role; unpatched library; flat network path to core. |
| Risk | "Over-permissioned role × internet-exposed API = high" → fix first. |
| Defense in depth | WAF (L7) + isolated VPC + least-privilege IAM + MFA + SIEM alerting. |

Notice the architecture decisions are the *same* ones from N01 — security just
gives you the language to justify them to the CISO.

## Do it (the exercise) [laptop / paper]

1. Take a system you know. Write its **CIA priority order** in one line and
   justify it (which matters most for *this* business?).
2. List three **threats**, the **vulnerability** each would exploit, and rank the
   resulting **risks** high/med/low. Notice you naturally fix high-risk, not
   scariest.
3. Draw the **defense-in-depth** layers for it and mark which ones are *network*
   controls (you'll deepen these in Track N).
4. Inspect a real control in action — TLS protecting confidentiality/integrity:
   ```bash
   openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null \
     | openssl x509 -noout -issuer -subject -dates
   ```
   That cert is one layer. Ask yourself what protects the data *after* TLS
   terminates (hint: that's why one layer is never enough).

## Say it back (self-check)

1. State the CIA triad and give a case where two of them conflict.
2. Distinguish threat, vulnerability, and risk in one sentence each.
3. Why do we prioritize by risk rather than by the scariest threat?
4. What is defense in depth, and why does it assume each control will sometimes fail?
5. Expand AAA and name where you've already seen authentication today.

## Talk to the IT/security head

**Ask:**
- "For this system, what's the CIA priority — what matters most if we have to
  trade off?"
- "What's on our risk register for this data, and what's the residual risk after
  current controls?"
- "If the outer layers fail, what's the *next* layer protecting this data?"

**A good answer sounds like:** risk framed as likelihood × impact with named
controls per layer, and an honest statement of *residual* risk (no control is
perfect).

**Red flags:** "we're secure, we have a firewall" (single control = no depth);
inability to state what matters most (no risk prioritization); treating every
finding as equally urgent (no risk ranking).

## Pitfalls & war stories

- Pitching designs in feature language to a risk-driven CISO — reframe in CIA/risk.
- "Compliance = security." Passing an audit is a floor, not proof of safety.
- Over-indexing on confidentiality and forgetting **availability** — a bank that
  can't process payments is also a security failure.

## Going deeper (optional)

- NIST CSF 2.0 functions (Govern, Identify, Protect, Detect, Respond, Recover) —
  the same mindset, organized. Revisit in S29.
- Pairs with N01 (blast radius/compliance) and sets up S03 (threat modeling).

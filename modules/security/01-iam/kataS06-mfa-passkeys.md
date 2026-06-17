# Kata S06 — MFA, passwordless, FIDO2/passkeys

> **Track:** Security · **Module:** S1 Identity & Access Management · **Prereqs:** S04, S05 · **Time:** ~35 min
> **Tags:** `security` `iam` `authn` `mfa` `passwordless` `fido2` `passkeys` `fsi`

## Why it matters

Stolen credentials remain the leading cause of breaches. Passwords alone fail at
scale: phishing, credential stuffing, and social-engineering attacks reliably
defeat them. For Meridian Bank the stakes are compounding — a compromised admin
credential can reach the CDE, trigger RBI breach-notification obligations, and
put a PCI-DSS QSA's sign-off at risk. Every authentication control decision you
make (or let slip through as "IT's problem") directly widens or narrows the blast
radius (see S01, N27). Understanding the spectrum from TOTP codes to hardware
passkeys lets you ask the right question in a design review: "what's the realistic
attack that defeats *this* factor?"

## The mental model

### The problem with one factor

A password is something you **know**. It can be phished, keylogged, reused, or
bought in a credential dump. Adding a second factor means an attacker must also
compromise something you **have** or something you **are**. The defence-in-depth
layer (S01) for authentication is: each additional factor must be independently
breakable — and breakable via a different attack class.

```
Factor categories
─────────────────────────────────────────────────────
 Knowledge  (know)  │  password, PIN, secret question
 Possession (have)  │  TOTP app, SMS OTP, hardware key
 Inherence  (are)   │  fingerprint, face, voice
─────────────────────────────────────────────────────
MFA = at least two categories together
```

### The phishing problem with "MFA" you probably know

Not all second factors are equal. An attacker who clones a login page can
intercept an SMS code or a TOTP (time-based one-time password) in real time and
replay it before it expires. This is called a **real-time phishing relay** attack
and defeats OTP-based MFA entirely.

```
   Legitimate flow:
   User → [password + TOTP] → Bank login → Session granted

   Phishing relay:
   User → [password + TOTP] → Fake site → Attacker → Real bank → Session stolen
                                                       └── forwards creds instantly
```

The attacker just needs to act within the 30-second TOTP window. SMS OTP is
even worse — SIM-swap attacks let an attacker receive your codes directly.

### FIDO2: the fix (and why it's different)

FIDO2 is an open standard (from the FIDO Alliance, W3C WebAuthn spec) that uses
**public-key cryptography** tied to the **origin** (the exact domain the browser
is talking to). The key insight:

```
 Registration (once):
  Device generates a key pair per site
  Public key → stored on the server
  Private key → never leaves the device

 Authentication (each login):
  Server sends a challenge
  Device signs the challenge with the private key
  AND includes the origin it was asked to sign for
  Server verifies signature + confirms origin matches
```

A phishing site has a different origin (`meridian-bank-secure.evil` ≠
`mobile.meridian.example`) so the device **refuses to sign** — the credential is
cryptographically bound to the legitimate domain. There is nothing for a relay
attacker to steal.

### Passkeys: FIDO2 for everyone

A **passkey** is a FIDO2 credential that is synced across a user's devices via
the OS/cloud provider (Apple Keychain, Google Password Manager, Windows Hello
cloud backup). This solves the original FIDO2 hardware-token pain:
loss-of-device = locked out. Passkeys make FIDO2 practical for millions of users.

```
 Hardware security key (YubiKey, Titan Key)
  └── private key on the device, never exported, no sync
  └── loss = lockout (need backup key or recovery code)

 Passkey (synced FIDO2)
  └── private key synced across user's trusted devices via iCloud / Google / Windows
  └── loss of one device = still accessible from others
  └── PIN or biometric gates local use
```

Both are **phishing-resistant** by construction; neither OTP-based approach is.

### The spectrum of MFA strength

```
 Weakest ─────────────────────────────────────────── Strongest
 SMS OTP  →  TOTP  →  Push notification  →  FIDO2/passkey  →  FIDO2 hardware key
    ↑            ↑              ↑                    ↑                  ↑
 SIM-swap   phishing       push-bombing        phishing-resistant    non-exportable
  risk        relay          risk               (origin-bound)       no sync
```

Regulators and frameworks (NIST SP 800-63B, PCI-DSS v4.0 Req 8.4.2) now
explicitly distinguish phishing-resistant from phishing-susceptible MFA. Be
precise about what PCI-DSS actually mandates: Req 8.4.2 requires MFA for **all**
access into the CDE — administrative *and* non-administrative — not just admin
access. Req 8.5.1 requires that MFA be **resistant to replay attacks** and not
susceptible to being circumvented; it does **not** mandate *phishing-resistant*
MFA. Phishing-resistance is strongly recommended best practice (and under v4.0.1
a single phishing-resistant factor can substitute for MFA for non-admin CDE
access), but it is not a hard PCI-DSS requirement. TOTP and push satisfy the
replay-resistance bar; only FIDO2/passkeys add phishing-resistance on top.

## Worked example

Meridian Bank is rolling out MFA for three populations with different risk
profiles:

```
 User population         Example                       Chosen factor
 ──────────────────────────────────────────────────────────────────────
 Retail customers        App login on phone            Passkey (synced FIDO2)
                                                        → biometric to unlock
                                                        → replaces 2FA SMS OTP

 Corp staff              Intranet + cloud console      TOTP app (Authenticator)
 (non-privileged)        10.40.0.0/16 offices          → acceptable risk for
                                                        internal-only resources

 Privileged admins       CDE access (10.10.20.0/24)   FIDO2 hardware key (YubiKey)
 (ops team)              SSH jump, cloud console       → MFA is required for all
                                                          CDE access (PCI-DSS
                                                          8.4.2); phishing-
                                                          resistant key chosen as
                                                          best practice, not a
                                                          PCI mandate
                                                        → no sync, two keys issued
```

The same login flow for a privileged admin:

1. Admin opens GCP Console or SSH jump host (bastion in `10.10.0.0/16`).
2. Identity provider (IdP — see S05) presents login page at
   `console.google.com` or the Meridian SSO URL.
3. Admin enters password.
4. Browser requests FIDO2 assertion from the YubiKey.
5. YubiKey LEDs blink — admin touches the key.
6. YubiKey signs the challenge with the private key. The signed payload includes
   the `rpId` (relying party domain, e.g. `meridian.example`) — the binding.
7. IdP verifies the signature against the registered public key and the `rpId`.
8. Session established; IdP issues an OIDC token (see S05) scoped to admin roles.

If the admin were directed to `meridian-bank-support.evil` instead, step 6 would
fail: the YubiKey would refuse to sign because the `rpId` in the WebAuthn
challenge would not match the registered domain.

**Recovery path (important design question):**
Meridian issues every admin two hardware keys. A recovery code (stored in a
sealed envelope in the DR vault) covers a total-loss scenario. The CISO has
approved this break-glass procedure; it is logged, dual-custody, and tested
quarterly.

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| MFA enforcement | AD / RADIUS MFA policies | Google Workspace / Cloud Identity MFA settings; Org Policy for GCP console | IAM Identity Center MFA required setting; IAM per-user virtual MFA | (Azure: TODO) |
| Phishing-resistant MFA | FIDO2 hardware key on AD with Windows Hello for Business | Cloud Identity: security key (FIDO2) as primary/only factor | IAM Identity Center: "FIDO2 authenticator" as required MFA type | (Azure: TODO) |
| Passkey support | OS + IdP dependent | Google Accounts support passkeys (Google Password Manager sync) | AWS not a primary IdP; passkeys via federated IdP (Okta, Azure) | (Azure: TODO) |
| Privileged / admin MFA | PAM tools (CyberArk, BeyondTrust) + FIDO2 | GCP Privileged Access Manager (preview); BeyondCorp + keys | AWS IAM requires MFA for sensitive API calls; STS MFA condition keys | (Azure: TODO) |
| Push/OTP enforcement | RSA SecurID, Duo Security | Duo or Okta integrated as SAML/OIDC IdP (N21, S05) | Duo/Okta + IAM Identity Center federation | (Azure: TODO) |
| Authenticator app (TOTP) | Any RFC 6238-compliant app | Google Authenticator, Authy | Virtual MFA device (RFC 6238 TOTP) | (Azure: TODO) |

> GCP-first note: Cloud Identity is the GCP-native IdP. If Meridian Bank is
> Google Workspace-based, FIDO2 hardware key enforcement is a single toggle in
> the Admin console ("Allow only security keys"). For AWS, IAM Identity Center
> lets you enforce an MFA condition on any permission set, but passkeys as a
> primary auth factor depend on the upstream IdP (usually Okta, Azure AD, or
> Workspace).

## Do it (the exercise)

### Part 1 — examine a TOTP code [laptop]

1. Install a TOTP authenticator app on your phone (Google Authenticator, Authy,
   or the `otp-auth` CLI).
2. On your laptop, generate a throwaway TOTP secret and QR code:
   ```bash
   # Requires: python3 + pyotp
   pip install pyotp qrcode[pil]
   python3 - <<'EOF'
   import pyotp, qrcode
   secret = pyotp.random_base32()
   totp = pyotp.TOTP(secret)
   uri = totp.provisioning_uri("alice@meridian.example", issuer_name="MeridianTest")
   print("Secret:", secret)
   print("Current OTP:", totp.now())
   qr = qrcode.make(uri)
   qr.save("/tmp/totp-test.png")
   print("QR saved to /tmp/totp-test.png")
   EOF
   ```
3. Scan the QR with your phone. Compare the code shown on the app with
   `python3 -c "import pyotp; print(pyotp.TOTP('YOUR_SECRET').now())"`.
   They will match. This is RFC 6238: HMAC-SHA1 of (secret, floor(time/30)).
4. Notice: if you were phished and an attacker captured this code over a relay,
   they would have ~30 seconds to use it. This is the TOTP weakness.

### Part 2 — verify origin-binding in WebAuthn (conceptual) [laptop]

1. Open `https://webauthn.io` in your browser (a safe public demo by Duo/Cisco).
2. Register a passkey with your platform authenticator (Touch ID, Windows Hello,
   or an Android fingerprint).
3. Try to authenticate. The site sends a challenge; your authenticator signs it
   bound to `webauthn.io`.
4. Now manually type `https://evil-webauthn.io` — no such site exists, but
   understand: if a phishing site sent the same challenge claiming `webauthn.io`
   as the `rpId`, your browser would refuse to sign for the wrong origin. The
   browser binds the *true* origin into the signed `clientDataJSON`, and the
   relying-party server is required by spec to verify that the origin (and the
   `rpIdHash` in `authenticatorData`) matches the registered relying party on
   every registration and authentication. Phishing resistance comes from **both**
   — the browser binding the origin *and* the server validating it — so a relayed
   challenge from a different origin fails.

### Part 3 — check MFA posture at a cloud provider [needs cloud account]

For GCP:
```bash
# List users without 2-step enrollment (requires Cloud Identity admin or Workspace admin)
# Via Admin SDK — conceptual; run in Cloud Shell or with a service account
gcloud beta resource-manager org-policies list --organization=ORG_ID
# Then in Admin Console: Security → 2-Step Verification → monitor enrollment
```

For AWS:
```bash
# List IAM users without MFA enabled
aws iam generate-credential-report
# Wait ~10 seconds
aws iam get-credential-report --query 'Content' --output text | base64 -d \
  | awk -F',' 'NR>1 && $8=="false" {print $1, "no MFA"}'
```
The second command will output every IAM user without a virtual or hardware MFA
device. Any name appearing here is a credential-stuffing attack waiting to happen.

## Say it back (self-check)

1. Name the three factor categories. Which two does an SMS OTP actually use?
2. Why does a TOTP code not protect against a real-time phishing relay, but a
   FIDO2 passkey does?
3. What is the `rpId` in WebAuthn and why does it prevent phishing?
4. What is the practical difference between a synced passkey and a hardware
   security key? When would you mandate the latter?
5. What does PCI-DSS v4.0 Req 8.4.2 actually require, and for what scope? Is
   phishing-resistant MFA mandated by PCI-DSS, or is it best practice? Where does
   the replay-resistance requirement (8.5.1) leave TOTP?

## Talk to the IT/security head

**Ask:**
- "What MFA method is required for privileged access to the CDE — is it
  phishing-resistant, and can you show me the policy that enforces it?"
- "How do you handle MFA recovery or bypass? Who authorises it, is it logged,
  and how long does a bypass stay open?"
- "Do you allow SMS OTP for any user population? If so, what's the plan to
  deprecate it?"
- "Have you had a push-bombing or MFA fatigue incident? What changed afterward?"
- "For cloud console access, is MFA enforced at the IdP before the SAML/OIDC
  assertion is issued, or only as an optional per-service setting?"

**A good answer sounds like:**
Privileged users on hardware FIDO2 keys, backed by a break-glass procedure with
dual-custody and audit trail. A named date for SMS OTP deprecation. MFA bypass is
a formal exception that auto-expires in hours and triggers a SOC alert. The CISO
can point to a policy document and an enforcement control (Org Policy, SCP,
identity provider enforcement) — not just a configuration that can be overridden.

**Red flags:**
- "We have MFA" with no qualification of which type or which users (almost
  certainly means SMS or push for some admin accounts).
- Break-glass is "just call the helpdesk" with no logging or time limit.
- Push notifications used for privileged users with no number-matching or
  additional context — pure fatigue-attack exposure.
- MFA enforced in the app but not at the IdP layer; an attacker who bypasses
  the app bypasses MFA entirely.
- Administrators who "get an exception" because MFA "breaks their workflow."

## Pitfalls & war stories

**Phishing-resistant in name only.** A bank's CISO told the QSA "we use MFA for
admin access." The MFA was push notifications with no number matching. An admin's
repeated "Deny" taps (the right thing to do!) led to a support call. The helpdesk
reset MFA "to help," granting the attacker a new device enrollment window. The
control failed at the human layer, not the technical one.

**SMS OTP and the roaming SIM.** Northwind had outbound-sales staff who changed
SIM cards when travelling internationally. IT provisioned secondary numbers for
MFA. Within six months no one could track which number was active for which user.
During an M&A integration the authentication logs showed MFA codes going to
deactivated numbers — which still worked because the recycled SIMs had been
reissued to someone else.

**Passkey sync and the threat model mismatch.** A consumer-facing app replaced
SMS OTP with synced passkeys — a genuine improvement for the vast majority of
users. But for a subset of high-value accounts (HNI banking, trading desks), the
threat model includes account takeover via iCloud compromise. The CISO flagged
this: passkeys synced to a shared family iCloud account mean a compromised Apple
ID is an authentication credential. Risk-tier the solution: passkeys for mass
retail, hardware keys for privileged or high-value access.

**MFA prompt fatigue (push-bombing).** An attacker sends 50 push notifications
at 2 a.m. hoping the sleepy admin taps "Approve" to stop the noise. Fix: require
number matching (app shows "Code 47, enter 47 in prompt") or add the FIDO2 layer
instead. Meridian's policy: three consecutive MFA denies = account temporarily
locked + SOC alert.

**"It's MFA so we don't need to rotate passwords."** Adding a second factor
reduces credential-stuffing risk but does not eliminate long-lived passwords as a
single-factor fallback for helpdesk resets. Password rotation policy and MFA are
independent controls; neither removes the other's value.

## Going deeper (optional)

- NIST SP 800-63B (rev 3) §5.2.5 — Verifier Impersonation Resistance; the
  normative requirement underlying what the industry calls "phishing-resistant"
  authentication, referenced by FedRAMP and others (rev 4 calls this out as
  phishing resistance explicitly).
- W3C WebAuthn Level 3 specification — the normative standard for passkey
  authenticator behavior (w3.org/TR/webauthn).
- FIDO Alliance White Paper: "FIDO2 and passkeys" — accessible overview of the
  CTAP2 protocol and platform authenticator model.
- RFC 6238 — TOTP: Time-Based One-Time Password Algorithm; understand what TOTP
  actually does before deciding it isn't enough.
- Pairs with S04 (AuthN/AuthZ foundations), S05 (SSO and OIDC token issuance —
  MFA happens at the IdP before the assertion is issued), and S07 (PAM and
  privileged access controls that complement phishing-resistant MFA).

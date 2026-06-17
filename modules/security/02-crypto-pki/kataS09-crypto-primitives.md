# Kata S09 — Crypto primitives: symmetric, asymmetric, hashing, signing

> **Track:** Security · **Module:** S2 Cryptography, PKI & key management · **Prereqs:** S01, N21 · **Time:** ~35 min
> **Tags:** `security` `cryptography` `symmetric` `asymmetric` `hashing` `signing` `key-management` `first-principles`

## Why it matters

Every time a CISO asks "is data encrypted?" or an auditor asks "how are keys managed?",
you need to know *which kind* of encryption — because symmetric, asymmetric, hashing,
and signing are four different tools that solve four different problems. Using the
wrong word in a design review signals you don't understand what you've built. Using
the right one lets you ask the question that exposes whether Meridian Bank's card data
is actually protected — or just wrapped in a key that's sitting in plaintext next to it.

## The mental model

There are four primitives. Know what each one guarantees and what it costs.

### 1. Symmetric encryption — one key, shared secret

Both sides use the **same key** to encrypt and decrypt. Fast and cheap on CPU.
The problem: how do you securely share that key in the first place?

```
  Alice                              Bob
  ──────                             ───
  plaintext ──[AES-256-GCM, key K]──▶ ciphertext
  ciphertext ──[AES-256-GCM, key K]──▶ plaintext

  Key K must reach Bob without an eavesdropper seeing it.
  This is the "key distribution problem."
```

**Guarantees:** Confidentiality (no one without K can read it).
**Common algorithms:** AES-128-GCM, AES-256-GCM (authenticated encryption — also
checks integrity). DES/3DES are obsolete and must not be used.
**Where you see it:** Bulk data encryption at rest (disk, database column, cloud
storage), the data phase of TLS sessions (see N21), IPsec ESP payload (see N36).

### 2. Asymmetric encryption — key pair: public + private

Each party holds a mathematically linked **key pair**. Anything encrypted with the
public key can only be decrypted by the matching private key. The public key is safe
to publish; the private key never leaves its owner.

```
  Alice wants to send a secret to Bob:

  Bob publishes:  [public key Kpub]
  Alice encrypts: plaintext ──[Kpub]──▶ ciphertext
  Bob decrypts:   ciphertext ──[Kpriv]──▶ plaintext

  Eve has ciphertext + Kpub. She cannot reverse it.
```

**Guarantees:** Confidentiality (only the private-key holder can read it).
**Common algorithms:** RSA-2048 / RSA-4096, ECDH/ECDSA on P-256 or P-384.
Elliptic curve variants are preferred today — smaller keys, same security level.
**Cost:** ~1,000× slower than AES per byte. Never used for bulk data.
**Where you see it:** Key exchange (wrapping a symmetric key so it can travel
safely), TLS handshake, encrypted email (S/MIME, PGP).

### 3. Hashing — one-way fingerprint

A hash function takes any input and produces a **fixed-length digest**. Critically:
- It is **one-way**: you cannot reverse a digest to recover the input.
- It is **deterministic**: the same input always produces the same digest.
- A tiny change in input produces a completely different digest (avalanche effect).

```
  Input: "transfer 50000 account 0012345678"
  SHA-256 digest: 2b299a2ad3f6732d952dd9229d223c56...  (64 hex chars, always)

  Change one byte (50000 → 50001):
  Input: "transfer 50001 account 0012345678"
  SHA-256 digest: efb0ff596ba3431594fb024d9c06aaee...  (completely different)
```

(These are the real digests of the two ASCII strings — reproduce them yourself in
the "Do it" section with `echo -n "..." | sha256sum`.)

**Guarantees:** Integrity detection (if the digest matches, the data has not been
altered). No confidentiality — hashing is not encryption.
**Common algorithms:** SHA-256, SHA-384, SHA-512 (SHA-2 family). SHA-1 is broken
for collision resistance; MD5 is broken. Use SHA-256 minimum.
**Where you see it:** File and firmware integrity checks, git commit IDs, password
storage (with a salt — see Pitfalls), TLS certificate fingerprints.

### 4. Digital signing — asymmetric + hashing combined

Signing flips the asymmetric key direction and adds a hash:

```
  Alice signs a document:

  1. Compute:  digest = SHA-256(document)
  2. Encrypt:  signature = RSA-encrypt(digest, Alice's PRIVATE key)
  3. Send:     document + signature

  Bob verifies:
  1. Compute:  digest' = SHA-256(document)
  2. Decrypt:  digest  = RSA-decrypt(signature, Alice's PUBLIC key)
  3. Check:    digest' == digest ?  → authentic and untampered
```

**Guarantees:** Authentication (only Alice's private key could have produced that
signature) + Integrity (the document has not been changed since signing).
**Note:** The private key operates on *a hash*, not the document — the document is
typically too large for raw RSA, and the hash is the right size.
**Precise framing:** "encrypt the hash with the private key" is a useful
first-principles picture, but real signing is its own primitive with a dedicated
padding scheme (RSASSA-PSS or PKCS#1 v1.5 — RFC 8017), not RSA encryption run
backwards. ECDSA (the preferred choice here) has no "encrypt with the private key"
form at all — it computes a signature directly. Say "sign / verify," not
"encrypt / decrypt," in a design review.
**Where you see it:** TLS certificates (the CA signs the server's public key),
code signing, JWT tokens (`RS256` or `ES256` signatures), software release artifacts.

### The four in one table

```
  Primitive        Key model        Guarantees           Typical use
  ─────────────────────────────────────────────────────────────────────
  Symmetric enc.   1 shared key     Confidentiality      Bulk data at rest/transit
  Asymmetric enc.  pub/priv pair    Confidentiality      Key exchange, encrypted email
  Hashing          no key           Integrity            File checks, password storage
  Signing          pub/priv pair    Auth + Integrity     Certs, tokens, code signing
```

### How they combine in practice: hybrid encryption

Because asymmetric is slow and symmetric has the key-distribution problem, real
systems combine them. TLS does this every time you visit a website (see N21):

```
  TLS handshake (asymmetric / slow)  ──▶  agree on a symmetric session key
  TLS record (symmetric / fast)       ──▶  encrypt actual data with that key
```

The server's certificate (signed by a CA) lets the client trust the public key.
The public key is used to securely exchange a session key. The session key encrypts
gigabytes of traffic. This three-layer stack (signing → asymmetric → symmetric) is
the backbone of all modern secure communication.

## Worked example

Meridian Bank's mobile backend processes a funds transfer. Follow the primitives at
each step:

```
  Customer phone                GCP (asia-south1)           HQ-DC1 (10.10.0.0/16)
  ──────────────                ─────────────────           ──────────────────────
  TLS to 10.100.x.x  ────▶  [1] TLS cert verified via     Core banking API
  (see N21, N39)               CA signature (signing)      on 10.10.20.5 (CDE)
                               Session key negotiated
                               (asymmetric → symmetric)
                         ────▶ [2] Transfer payload AES-256 ────▶ Received
                               encrypted in transit (symmetric)
                         ────▶ [3] SHA-256 HMAC on payload       Validated
                               confirms integrity (hashing)
                         ────▶ [4] Transfer record written to    Stored
                               Cloud SQL with CMEK (symmetric,
                               key in Cloud KMS — see S11)
                         ────▶ [5] Audit log entry signed        Logged
                               with service account key (signing)
```

Step [4] is where architects most often stumble: the data is encrypted at rest, but
*who holds the key?* If it's the cloud provider's managed key, Meridian's DBA cannot
turn off access to the bank regulator. If it's a CMEK in Cloud KMS, Meridian controls
the key. If it's BYOK, Meridian brings a key from their on-prem HSM. Each choice has
different compliance, operational, and cost implications (fully explored in S11).

Key lengths in Meridian's approved cipher list (from their PCI-DSS policy):

| Algorithm      | Key / digest size | Status at Meridian |
|----------------|-------------------|--------------------|
| AES-256-GCM    | 256-bit key       | Approved (bulk enc) |
| RSA            | 4096-bit key      | Approved (legacy)   |
| ECDSA P-256    | 256-bit key       | Approved (preferred) |
| SHA-256        | 256-bit digest    | Approved (min)      |
| SHA-1          | 160-bit digest    | **Prohibited**      |
| MD5            | 128-bit digest    | **Prohibited**      |
| DES / 3DES     | 56 / 168-bit key  | **Prohibited**      |

## Cloud / vendor mapping (when applicable)

| Concept | On-prem | GCP | AWS | Azure |
|---------|---------|-----|-----|-------|
| Symmetric key store | HSM appliance (Thales / SafeNet) | Cloud KMS (AES-256 keys) | AWS KMS (symmetric CMK) | (Azure: TODO) |
| Asymmetric key store | HSM appliance | Cloud KMS (RSA/EC key pairs) | AWS KMS (asymmetric CMK) | (Azure: TODO) |
| Envelope encryption | App encrypts DEK; HSM protects KEK | Cloud KMS wraps a Data Encryption Key | AWS KMS GenerateDataKey | (Azure: TODO) |
| Secrets / certificates | Vault / CyberArk | Secret Manager + Certificate Authority Service | AWS Secrets Manager + ACM | (Azure: TODO) |
| FIPS 140-2 Level 3 HSM | Dedicated HSM appliance | Cloud HSM (add-on to Cloud KMS) | AWS CloudHSM | (Azure: TODO) |
| TLS offload (signing) | F5 / Nginx with cert | GCP-managed SSL certs on LB | ACM certs on ALB | (Azure: TODO) |

Cloud KMS and AWS KMS both perform **envelope encryption**: your app generates a
short-lived **Data Encryption Key (DEK)** to encrypt data, then calls KMS to encrypt
the DEK with a long-lived **Key Encryption Key (KEK)** that never leaves the HSM.
Only the encrypted DEK is stored alongside the ciphertext. This is the pattern behind
CMEK on every managed service in GCP and AWS.

## Do it (the exercise)

**All steps are [laptop] — no cloud account needed.**

**1. Hashing in your shell:**

```bash
echo -n "transfer 50000 account 0012345678" | sha256sum
# outputs: a hex digest

echo -n "transfer 50001 account 0012345678" | sha256sum
# completely different digest — avalanche effect confirmed
```

Observe: the two digests share no obvious common prefix despite a one-digit change.

**2. Symmetric encryption with OpenSSL:**

```bash
# Encrypt a file with AES-256-CBC (simpler flags than GCM for a first demo)
echo "Meridian Bank — confidential transfer" > plaintext.txt
openssl enc -aes-256-cbc -pbkdf2 -in plaintext.txt -out encrypted.bin -pass pass:TestKey123
# Decrypt it back
openssl enc -d -aes-256-cbc -pbkdf2 -in encrypted.bin -pass pass:TestKey123
```

Note: `-pbkdf2` derives the actual AES key from the password using PBKDF2 with
HMAC-SHA256 — one layer of key derivation. Production systems use a KMS-managed key,
not a password.

**3. Generate an RSA key pair and sign a file:**

```bash
# Generate a 2048-bit RSA key pair (demo only — use 4096 in production)
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# Sign: hash the file and encrypt the hash with the private key
openssl dgst -sha256 -sign private.pem -out transfer.sig plaintext.txt

# Verify: recompute the hash and check against signature using the public key
openssl dgst -sha256 -verify public.pem -signature transfer.sig plaintext.txt
# Expected output: Verified OK
```

Tamper with the file and re-run the verify step to see "Verification Failure."

**4. Inspect a real TLS certificate's signature:**

```bash
openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -text \
  | grep -A2 "Signature Algorithm"
```

Identify: which hash algorithm? Which asymmetric algorithm? (Likely `sha256WithRSAEncryption`
or `ecdsa-with-SHA256`.) This is a CA's *digital signature* on the server's public key.

**5. Check key length on a live cert:**

```bash
openssl s_client -connect meridian.example:443 -servername meridian.example </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep "Public-Key"
# Should show RSA 4096 or EC 256 — if 1024 or 2048, raise it in the review.
```

## Say it back (self-check)

1. Name the four primitives and the one security property each guarantees.
2. Why do real systems always combine asymmetric and symmetric encryption rather than
   using asymmetric for everything?
3. What is the difference between hashing and encryption? Why is "we hash passwords"
   not the same as "we encrypt passwords"?
4. In a digital signature, which key encrypts and which verifies — and why does it
   go in that direction?
5. In envelope encryption, what is a DEK and a KEK, and why does the KEK never leave
   the KMS boundary?

## Talk to the IT/security head

**Ask:**

- "What cipher suite is approved for data at rest in the CDE? AES-256-GCM or
  something older?" *(SHA-1, 3DES, RC4 in the answer = a PCI-DSS finding.)*
- "Where are your encryption keys stored — cloud-managed, CMEK, or BYOK from an HSM?
  Who can revoke access to those keys?" *(Reveals key control and audit gap.)*
- "What's the key rotation schedule, and is it automated or manual?" *(Manual rotation
  on HSMs at a bank usually means it hasn't happened in three years.)*
- "Is the same key used for multiple purposes — encryption, signing, authentication?"
  *(Key reuse across purposes is a design smell and a crypto control failure.)*

**A good answer sounds like:** key types match their use case (asymmetric for signing,
symmetric for bulk), keys are in HSM-backed KMS, rotation is automated and logged,
and the CISO can name the approved algorithm list from their cryptographic standard
document.

**Red flags:** "we use SSL" as a complete answer; inability to name the symmetric
algorithm used at rest; keys stored in a config file or a secrets-in-env-vars pattern;
SHA-1 or MD5 anywhere in the current design; no documented rotation schedule.

## Pitfalls & war stories

**"We hash the password" ≠ "passwords are secure."**  
An unsalted SHA-256 of "password123" produces the same digest on every system. An
attacker with a precomputed rainbow table cracks it instantly. Passwords must be
hashed with a purpose-built, slow function: bcrypt, scrypt, or Argon2. Architects
often don't know which their system uses — find out.

**Symmetric key in the same bucket as the data it protects.**  
Meridian's object storage has encrypted files and the AES key in a README. Both got
exfiltrated in the same breach. Envelope encryption (key in KMS, encrypted DEK with
the data) prevents this — the attacker needs both the ciphertext and KMS access.

**"TLS means encrypted" — but where does TLS terminate?**  
If a load balancer terminates TLS and the hop from LB to backend is plaintext HTTP,
data is "encrypted in transit" to the LB and nowhere else. For PCI-DSS CDE traffic,
TLS re-encryption to the backend is required (see N21).

**Confusing signing and encryption direction.**  
RSA private key *decrypts* (from the encryption direction) and *signs* (from the
signing direction). The public key *encrypts* and *verifies*. Conflating these leads
to designs where validation logic is reversed and the signing key is exposed.
Caveat: signing and encryption are *distinct* primitives with different padding
(RFC 8017), even when both use an RSA key pair — and ECDSA only signs/verifies, it
cannot encrypt. The "direction" mnemonic is for intuition, not an implementation spec.

**Algorithm negotiation downgrade.**  
A server that accepts TLS 1.0 or weak cipher suites can be forced to use them by an
active attacker (POODLE, BEAST). Always configure a minimum TLS version (1.2 minimum,
prefer 1.3) and explicitly disable RC4, DES, and export-grade ciphers. Verify with:
```bash
nmap --script ssl-enum-ciphers -p 443 <host>
```

## Going deeper (optional)

- RFC 5116 — "An Interface and Algorithms for Authenticated Encryption": the
  specification behind AES-GCM, the authenticated-encryption mode that protects
  both confidentiality and integrity in one pass.
- NIST SP 800-57 Part 1 Rev 5 — Recommendation for Key Management: the authoritative
  source for key lengths, key types, and rotation guidance; what a good CISO cites.
- RFC 8017 — PKCS #1: RSA cryptography standard; the spec behind RSA signing.
- Pairs with S10 (PKI & certificate chains — signing in production), S11 (KMS, HSM,
  envelope encryption), S12 (encryption at rest vs in transit). Also builds on N21
  (TLS handshake — where these four primitives are all used together).

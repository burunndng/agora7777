# Agora Threat Model & Red-Team Findings

Scope: client-side cryptography, Nostr handling, network surface, PWA + CSP
posture for the `artifacts/agora` web app. Last reviewed: 2026-04-19.

Trust model: Agora has no backend. The user's passphrase derives an Argon2id
seed in a Web Worker; that seed produces a Nostr signing key and an AES-GCM
cache key, both held only in memory. Anyone with read access to the running
JS context (XSS, malicious extension) is game over for the active session;
this review focuses on weaknesses that turn a smaller adversary into that.

Severity scale: **High** (compromises identity / DMs / persistent backdoor),
**Medium** (data exposure or weakening of a security guarantee under specific
conditions), **Low** (defense-in-depth).

---

## High

### 1. Global static Argon2id salt — **Fixed**
- File / line: `artifacts/agora/src/lib/nostr/identity.ts:22` (was
  `SALT = "agora.nostr.v1.passphrase-salt"`).
- Attack: a single shared salt enables one rainbow table to attack every
  Agora user simultaneously, and any two users picking the same passphrase
  silently share the same Nostr identity (a silent account takeover on
  first login by the second user).
- Remediation: `deriveIdentity` now takes a user-supplied **handle** which
  is normalised (NFKC, lowercase, trim) and mixed into the Argon2id salt as
  `agora.nostr.v2|handle=<handle>`. The handle is collected at login but
  never published to relays. A "Legacy login (v1)" path remains for one
  release so existing accounts can still recover their old key; it is
  documented as deprecated in the privacy page.

### 2. CSP is over-permissive in production and absent in dev — **Fixed**
- File / line: `artifacts/agora/vite.config.ts:50-160`.
- Attack: `connect-src 'self' wss: https:` and `img-src *` mean any XSS
  can exfiltrate to attacker-controlled hosts. Dev had no CSP at all, so
  XSS regressions never surface during development.
- Remediation: production CSP is now **runtime-generated** by an inline
  bootstrap script that the build prepends as the first child of `<head>`.
  Before any bundle script is parsed the bootstrap reads the user's
  persisted relays (`agora.relays.v1`) and NIP-96 upload hosts
  (`agora_media_upload_hosts`), runs them through the same conservative
  validators we use at runtime (rejects loopback / RFC1918 / link-local /
  bare hosts / credential URLs), and adds them to `connect-src` along with
  the always-on defaults (default relays, default upload hosts,
  `nostr.band`, `corsproxy.io`). User-added relays / upload hosts work
  without a rebuild; tampered localStorage payloads are sanitised. NIP-05
  verification is **off by default**; toggling it on in
  Settings → Privacy relaxes `connect-src` to include `https:` on the
  next reload, with the trade-off explicitly documented in the toggle
  copy. `img-src` / `media-src` are restricted to `https: data: blob:`
  (click-to-load remains the user's opt-in for the third-party host).
  A dev-mode middleware (`devCspPlugin`) emits a comparable
  `Content-Security-Policy-Report-Only` header so XSS regressions surface
  in development without breaking HMR. Meta-tag CSP cannot enforce
  `frame-ancestors`; deployments should additionally serve the policy
  as an HTTP response header (tracked as a follow-up).

### 3. Relay URLs not validated before persistence — **Fixed**
- File / line: `artifacts/agora/src/lib/nostr/store.ts:87-92`.
- Attack: `addRelay` accepted any string starting with `wss://`. A future
  XSS, a tampered persisted store, or a deep link calling `addRelay` could
  install `wss://attacker.example/` (or `wss://localhost/`) as a permanent
  MITM that survives reload and silently captures every published event.
- Remediation: `isValidRelayUrl` now parses with `new URL`, requires the
  `wss:` scheme, rejects loopback (`localhost`, `127.0.0.0/8`, `::1`),
  RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`,
  `fe80::/10`), `0.0.0.0`, bracketed IPv6 loopback, hostnames without a
  dot, and hostnames longer than 253 chars. Comparison is
  case-insensitive on host and lower-cased on persistence. The same
  validator runs on store rehydration via `migrate`, so a tampered
  `localStorage` payload is filtered down to the safe set before use.

---

## Medium

### 4. Encrypted cache never cleared on logout — **Fixed**
- File / line: `artifacts/agora/src/lib/nostr/store.ts:64-72`,
  `artifacts/agora/src/lib/nostr/cache.ts:46-72`.
- Attack: `logout()` zeroed the in-memory key but left the encrypted
  IndexedDB store intact and orphaned the imported `CryptoKey`. A process
  memory adversary could keep using the still-imported `CryptoKey` after
  logout, and per-user disk usage grew monotonically across logins.
- Remediation: `EncryptedEventCache.destroy()` nulls `keyPromise` so the
  imported `CryptoKey` is no longer reachable. Both `logout()` and
  `setIdentity(null)` await `destroyCache()`.

### 5. AES-GCM ciphertext in IndexedDB has no AAD — **Fixed**
- File / line: `artifacts/agora/src/lib/nostr/cache.ts:53-99`.
- Attack: an attacker with disk write (malware, shared device) can swap
  `(iv, cipher)` pairs between records — decrypt succeeds because
  authenticity was per-blob, not per-record.
- Remediation: each record now binds `id|kind|created_at` as
  `additionalData` to AES-GCM, so a swapped record fails to authenticate.

### 6. NIP-05 fetch leaks IP / acts as tracking pixel — **Fixed**
- File / line: `artifacts/agora/src/lib/nostr/nip05.ts:19-77`.
- Attack: fetching attacker-controllable HTTPS domains for any rendered
  profile turns Agora into an unintentional tracker.
- Remediation: NIP-05 verification is gated by a new privacy toggle
  (`getNip05Verification()` / `setNip05Verification()`), default **off**.
  When off, `useNip05Verification` returns `idle` without making any
  request. The settings page exposes the toggle. Cached negative results
  remain in memory for the existing TTL.

### 7. Panic Wipe one keystroke from data loss — **Fixed**
- File / line: `artifacts/agora/src/components/panic-wipe.tsx:39-51`.
- Attack: Ctrl+Shift+X with no confirmation collides with browser/IDE
  shortcuts and can accidentally destroy a user's local cache.
- Remediation: the shortcut now opens a confirmation modal instead of
  running the wipe immediately. The user must explicitly click
  "Wipe everything" to proceed; Escape or "Cancel" aborts.

---

## Low / hardening

### 8. `linkify` regex includes trailing punctuation — **Fixed**
- File / line: `artifacts/agora/src/components/safe-link.tsx:110`.
- Attack: `https://example.com).` rendered as a link to
  `https://example.com).`, which doesn't match the visible text and could
  be redirected by the trailing-character handling of some sites.
- Remediation: matched URLs are trimmed of trailing
  `.,;:!?)]}>'"` characters; balanced parens are preserved.

### 9. `SafeLink` does not validate scheme — **Fixed**
- File / line: `artifacts/agora/src/components/safe-link.tsx:41-58`.
- Attack: only `linkify` enforced `http(s)` today. Any future caller
  passing `javascript:`/`data:`/`vbscript:`/`file:` would render a clickable
  XSS sink.
- Remediation: `SafeLink` now applies a scheme allowlist
  (`http`, `https`, `mailto`, plus relative / hash / Agora-internal
  routes). Disallowed schemes render as plain text with a small warning
  badge.

### 10. Service worker `skipWaiting` + `clients.claim` — **Fixed**
- File / line: `artifacts/agora/public/sw.js:36, 50`.
- Attack: a poisoned deploy is permanently cached for offline users until
  they hard-clear.
- Remediation: the worker no longer calls `skipWaiting()` on install or
  `clients.claim()` on activate. A new `SwUpdatePrompt` component listens
  for a waiting worker and surfaces a "Reload to apply update" banner; the
  user must click it to send the `SKIP_WAITING` message before the new
  worker takes over.

### 11. First-seen npub map is plaintext in localStorage — **Accepted /
documented**
- File / line: `artifacts/agora/src/lib/nostr/store.ts:12-36`.
- Trade-off: anyone with browser access can enumerate accounts used on this
  device. Acceptable for a multi-account UX hint; documented in the
  privacy page so users with shared devices know to clear it.

### 12. `@noble/hashes` Argon2id is JS, not WASM — **Accepted**
- The CSP allows `wasm-unsafe-eval` but the current implementation uses the
  pure-JS Argon2id from `@noble/hashes`. Empirically the worker completes
  64 MiB / t=3 within ~1.5–4s on mobile in our testing (no OS-induced
  truncation observed). Raising iteration counts would require re-baseline
  benchmarks on low-end Android; revisit when WASM Argon2id ships
  upstream.

---

## Out of scope / future work
- Per-pubkey scoping of the encrypted cache (today wipe is all-or-nothing).
- A formal forward-secrecy model across logins (current model is "wipe and
  re-derive").
- Threat-modelling of the third-party relays, NIP-96 hosts and the Lemmy
  bridge (`corsproxy.io`).
- Server-side header-based CSP for a hosted deployment (today the policy is
  emitted via `<meta http-equiv>` which cannot enforce `frame-ancestors`).

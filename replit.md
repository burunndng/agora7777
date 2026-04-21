# Agora

## Overview

A decentralized, censorship-resistant social forum built on the Nostr protocol. Reddit-style communities with cryptographic identity, Proof-of-Work spam resistance, and a collaborative scoring algorithm. **Agora is a pure client-side web app** — no backend, no database. Identity is passphrase-derived in the browser; events are signed locally and broadcast directly to Nostr relays. All cached state lives in the user's browser.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/agora) — Wouter HashRouter, Tailwind CSS, Zustand
- **Routing**: Wouter `useHashLocation` (static-host friendly: works on GitHub Pages with no rewrites)
- **State**: Zustand (in-memory identity store; persisted relay store)
- **Nostr stack**: `nostr-tools` (SimplePool, NIP-10, NIP-13, NIP-19, NIP-72), `@noble/hashes` (Argon2id, HMAC-SHA256), `@zxcvbn-ts/core` (passphrase strength), `idb` (IndexedDB cache)

## Key Features

1. **Passphrase identity**: Argon2id (m=64MB, t=3, p=1, dkLen=32) in a Web Worker derives a 256-bit seed from passphrase + fixed app salt. HMAC-SHA256 derives two domain-separated subkeys: a Nostr signing key and a cache encryption key. The seed is wiped immediately after derivation; the signing key only lives inside an `Identity` closure and is wiped on `destroy()`.
2. **Encrypted local cache**: AES-GCM encrypted IndexedDB store (`agora-cache`) keyed by the cache subkey. Different identities cannot decrypt each other's events. `destroy()` deletes the database.
3. **Proof-of-Work (NIP-13)**: Posts and reactions can be mined to a chosen difficulty in a dedicated worker via `minePow`. PoW is shown as a badge and feeds into scoring.
4. **Communities (NIP-72)**: Communities are kind 34550 events. Posts join communities via the `a` tag (`34550:<author>:<identifier>`); a duplicate `t` tag enables relay queries that don't support wildcard `#a`.
5. **NIP-10 reply trees**: Post detail page reconstructs threaded discussions from `e`/`p` tags using `nostr-tools/nip10`.
6. **Voting**: kind 7 reactions; `+` / emoji = up, `-` = down. Vote weight is biased by the voter's PoW.
7. **Author labels**: Every author appears as `Display Name (npub1…abcd)` (or just the short npub when no profile is available).
8. **Relay management**: Multi-relay config with live connection-status indicators; defaults to damus.io / nos.lol / relay.nostr.band.
9. **Resilient Media (NIP-96)**: Attachments are uploaded to two NIP-96 hosts in parallel (defaults: nostr.build, void.cat) with byte-level EXIF/metadata stripping (no re-encoding) and ephemeral NIP-98 auth. Mirrors are stored as a NIP-92 `imeta` tag on the event. Embeds render as click-to-load placeholders by default and automatically fall back to the next mirror on load failure. Auto-load and the upload host list are user-configurable in Settings.
10. **Key backup**: Settings → Identity → "Backup signing key" reveals the bech32 `nsec` (NIP-19) and exports it as a `.txt` or `.md` file. The key is fetched from the in-memory `Identity.exportNsec()` only on click and never persisted. Markdown export is a self-contained doc with strong warnings; both formats include the matching npub.
11. **Agora vs Federation communities**: New communities created from inside Agora carry an `["app","agora"]` tag on their kind:34550 metadata event. The Communities page renders two stacked sections (Agora rooms first, federation rooms second), each with a count chip and a colored origin badge per row. The tag is **spoofable** — it is a UI grouping hint only and must not be used for trust decisions.
12. **NIP-05 verified handles in feeds**: A shared `<Nip05Badge>` component (`src/components/nip05-badge.tsx`) renders a profile's NIP-05 identifier with verification state. It is wired into post cards, post-detail comments, and the profile header. Verification stays opt-in via Settings → Privacy (CSP-gated `connect-src`); when off, the badge shows the identifier in a neutral style with no network call.

## Architecture

- `artifacts/agora/` — single React+Vite SPA, the only artifact users interact with.
- `artifacts/agora/src/lib/nostr/` — identity derivation, encrypted cache, SimplePool wrapper hooks (`useNostrPool`, `useNostrQuery`), profile cache, scoring, Zustand stores.
- `artifacts/agora/src/workers/` — Argon2id and PoW Web Workers.

## Hosting

The app is deployable as static files (e.g. GitHub Pages). HashRouter avoids needing server-side rewrites. There is no backend or database to provision.

## Bot Protection (Anubis)

The site is protected by [Anubis](https://github.com/TecharoHQ/anubis), a proof-of-work reverse proxy that shields against AI scrapers and abusive bots.

**Architecture:**
```
Browser → Anubis (:$PORT, e.g. 5000) → Vite dev server (:$INNER_PORT, default 5050)
```

- **Binary**: `bin/anubis` (gitignored — built from source automatically on first start)
- **Policy**: `anubis/botPolicy.yaml` (uses Anubis default rules: blocks AI crawlers, denies headless Chrome, allows good search crawlers)
- **Launcher**: `scripts/start-with-anubis.sh` — honors the `PORT` and `BASE_PATH` env vars supplied by the agora artifact's `[services.env]` block. Starts Vite on `INNER_PORT` (default 5050; auto-bumped if it collides with `PORT`) and fronts it with Anubis on `PORT`.
- **Build script**: `scripts/build-anubis.sh` — clones and compiles Anubis if the binary is missing

The agora artifact's `[services.development]` runs the launcher directly (as `bash ../../scripts/start-with-anubis.sh`, since the workflow's working directory is the artifact dir), so the auto-generated `artifacts/agora: web` workflow is the single source of truth for the public port. There is no separate top-level "Start application" workflow — that legacy duplicate was removed to fix a port-5000 bind conflict. The launcher automatically rebuilds the binary if it's absent (e.g. after a fresh clone).

## Key Commands

- `pnpm --filter @workspace/agora run dev` — run frontend locally (bypasses Anubis; requires `PORT` and `BASE_PATH`)
- `PORT=5000 bash scripts/start-with-anubis.sh` — run with Anubis protection (matches the artifact dev workflow)
- `bash scripts/build-anubis.sh` — rebuild the Anubis binary from source
- `pnpm --filter @workspace/agora run typecheck` — typecheck
- `pnpm --filter @workspace/agora run build` — production bundle (static)

## Always-Free Infrastructure

| Service | Purpose |
| :--- | :--- |
| Public Nostr relays | Event transport (damus.io, nos.lol, nostr.band) |
| Argon2id / Web Worker | Client-side key derivation |
| AES-GCM + IndexedDB | Encrypted local cache |
| NIP-13 PoW | Spam resistance |

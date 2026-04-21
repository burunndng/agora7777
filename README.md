# Agora

A decentralized, censorship-resistant social forum built on the Nostr protocol.
Reddit-style communities, cryptographic identity, Proof-of-Work spam resistance,
read-only Lemmy bridge, full search via nostr.band, and an installable PWA that
works offline.

## Live deployment

The static build is published to GitHub Pages on every push to `main` by
`.github/workflows/deploy.yml`. Once enabled in the repository settings
(`Settings → Pages → Build and deployment → Source = GitHub Actions`), the app
is served at:

> `https://<your-github-username>.github.io/<this-repo-name>/`

The Wouter `HashRouter` keeps deep links (`#/post/...`) working without server
rewrites; a `404.html` copy of `index.html` covers the rare cases where the
SPA boots from a non-root path.

## Local development

```sh
pnpm install
pnpm --filter @workspace/agora run dev   # vite dev server
pnpm --filter @workspace/agora run build # static bundle in dist/public
```

## Transport disclosure (User Privacy Manual)

Agora has no backend, but using it still puts your browser in touch with a
handful of third parties. The Settings → Privacy page surfaces the live list,
and the relevant feeds annotate themselves at the source. Summary:

- **Configured Nostr relays** (default: relay.damus.io, nos.lol,
  relay.nostr.band) see your IP, your public key, every event you sign, and
  the filters you ask about.
- **nostr.band** powers the search bar. They see your IP and the search
  string. The encrypted local cache is searched in parallel so an offline
  search returns results without a network call.
- **corsproxy.io** proxies the Lemmy "Federated" feed. Both the proxy and the
  destination Lemmy instance see your IP and which community you're reading.
  Lemmy posts are read-only and live only in memory.
- **NIP-96 upload hosts** (default: nostr.build, void.cat) see your IP, the
  bytes you upload, and a temporary NIP-98 auth signed by your key.
- **Embedded image/video hosts** are not contacted until you tap "Load" on a
  placeholder (the auto-load default is off).

What stays local: your passphrase, the Argon2id-derived seed (wiped after
derivation), the signing key (kept in a closure, wiped on disconnect), and
the AES-GCM-encrypted IndexedDB cache.

## PWA

`public/manifest.webmanifest` makes the app installable on Android and iOS.
`public/sw.js` precaches the built shell on install and serves it
stale-while-revalidate, so the UI boots offline; cross-origin traffic
(relays, nostr.band, corsproxy.io, media hosts) is never cached. After
login the app calls `navigator.storage.persist()` so the encrypted cache
isn't evicted on mobile.

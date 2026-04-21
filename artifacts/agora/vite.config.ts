import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import type { Plugin } from "vite";

/**
 * Default network destinations baked into the build. Keep these in sync
 * with:
 *   - DEFAULT_RELAYS in src/lib/nostr/store.ts
 *   - DEFAULT_UPLOAD_HOSTS in src/lib/media/preferences.ts
 *   - The third-party APIs documented in src/pages/privacy.tsx
 */
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];
const DEFAULT_UPLOAD_HOSTS = ["https://nostr.build", "https://void.cat"];
// Always-allowed read-only API endpoints we ship by default.
const STATIC_API = [
  "https://nostr.band", // search backend
  // Federated bridge: public CORS proxies tried in order for Lemmy fetches
  // when the destination instance does not allow direct CORS.
  "https://api.allorigins.win",
  "https://corsproxy.org",
  "https://cors.eu.org",
  // Federated bridge: default Mastodon instance. Other instances visited
  // through the federated tab are persisted in localStorage and added to
  // connect-src on the next reload (see buildBootstrap below).
  "https://mastodon.social",
];

/**
 * Production CSP: emitted as an inline bootstrap script that reads the
 * user's persisted relays + NIP-96 hosts from localStorage and the
 * NIP-05 opt-in toggle, then prepends a <meta http-equiv="CSP"> to
 * <head> BEFORE the app bundle loads. This way:
 *   - User-added relays / upload hosts work without a rebuild.
 *   - NIP-05 verification can fetch arbitrary domains, but only when the
 *     user has opted in via Settings → Privacy (the toggle relaxes
 *     connect-src to include `https:`). Off by default.
 *   - Tampered localStorage payloads are sanitised by the same conservative
 *     validators we use at runtime — loopback / RFC1918 / link-local /
 *     bare-host entries are dropped before being placed into the CSP.
 *
 * If the bootstrap throws (corrupt JSON, browser quirks) it fails closed:
 * no CSP is added, but every other Agora invariant still holds. Meta-tag
 * CSPs cannot enforce frame-ancestors; for real clickjacking protection
 * the deployment should additionally serve a header.
 */
function buildBootstrap(): string {
  return `(function(){
  try {
    var DEFAULT_RELAYS = ${JSON.stringify(DEFAULT_RELAYS)};
    var DEFAULT_HOSTS = ${JSON.stringify(DEFAULT_UPLOAD_HOSTS)};
    var STATIC_API = ${JSON.stringify(STATIC_API)};
    var LOOPBACK = {"localhost":1,"0.0.0.0":1,"::1":1,"[::1]":1,"ip6-localhost":1,"ip6-loopback":1};
    function isPrivIp4(h){
      var m = /^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/.exec(h);
      if (!m) return false;
      var o = [+m[1],+m[2],+m[3],+m[4]];
      if (o[0]===10||o[0]===127||o[0]===0) return true;
      if (o[0]===169&&o[1]===254) return true;
      if (o[0]===172&&o[1]>=16&&o[1]<=31) return true;
      if (o[0]===192&&o[1]===168) return true;
      return false;
    }
    function safeOrigin(u, scheme){
      if (typeof u !== "string") return null;
      try {
        var p = new URL(u);
        if (p.protocol !== scheme) return null;
        if (p.username || p.password) return null;
        var h = p.hostname.toLowerCase();
        if (!h || h.length > 253) return null;
        if (LOOPBACK[h]) return null;
        if (isPrivIp4(h)) return null;
        if (h.indexOf(":")>=0) {
          if (h==="::1"||h==="::"||h.indexOf("fe80:")===0||h.indexOf("fc")===0||h.indexOf("fd")===0) return null;
        }
        if (h.indexOf(".") < 0) return null;
        return p.origin;
      } catch(e){ return null; }
    }
    function safeJSON(k){
      try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch(e){ return null; }
    }
    var relayBlob = safeJSON("agora.relays.v1");
    var rawRelays = relayBlob && relayBlob.state && relayBlob.state.relays;
    if (!Array.isArray(rawRelays)) rawRelays = DEFAULT_RELAYS;
    var relays = [];
    for (var i=0;i<rawRelays.length;i++){
      var ro = safeOrigin(rawRelays[i], "wss:");
      if (ro) relays.push(ro);
    }
    if (relays.length === 0) relays = DEFAULT_RELAYS.slice();

    var rawHosts = safeJSON("agora_media_upload_hosts");
    if (!Array.isArray(rawHosts)) rawHosts = DEFAULT_HOSTS;
    var hosts = [];
    for (var j=0;j<rawHosts.length;j++){
      var ho = safeOrigin(rawHosts[j], "https:");
      if (ho) hosts.push(ho);
    }
    if (hosts.length === 0) hosts = DEFAULT_HOSTS.slice();

    // Mastodon instances the user has previously loaded through the
    // federated tab. Stored as an array of origin strings.
    var rawMasto = safeJSON("agora.federated.mastodonHosts.v1");
    var masto = [];
    if (Array.isArray(rawMasto)) {
      for (var m=0;m<rawMasto.length;m++){
        var mo = safeOrigin(rawMasto[m], "https:");
        if (mo) masto.push(mo);
      }
    }

    var nip05On = false;
    try { nip05On = localStorage.getItem("agora.privacy.nip05Verification.v1") === "true"; } catch(e){}

    var connect = ["'self'"].concat(relays, hosts, masto, STATIC_API);
    if (nip05On) connect.push("https:");
    var seen = {}, dedup = [];
    for (var k=0;k<connect.length;k++){ if (!seen[connect[k]]) { seen[connect[k]] = 1; dedup.push(connect[k]); } }

    var csp = [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' https: data: blob:",
      "media-src 'self' https: data: blob:",
      "connect-src " + dedup.join(" "),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "object-src 'none'",
      "worker-src 'self' blob:"
    ].join("; ");

    var meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = csp;
    document.head.insertBefore(meta, document.head.firstChild);
  } catch(e) { /* fail-safe: no CSP if bootstrap fails */ }
})();`;
}

function productionCspPlugin(): Plugin {
  return {
    name: "agora-prod-csp",
    apply: "build",
    transformIndexHtml(html) {
      const inline = `<script>${buildBootstrap()}</script>`;
      // Insert as the very first child of <head> so it runs before any
      // bundle/module script is parsed, ensuring the CSP is in effect
      // when the app bundle is fetched and evaluated.
      return html.replace(/<head>/, `<head>\n    ${inline}`);
    },
  };
}

/**
 * Dev-mode CSP middleware. Sends a comparable policy as
 * Content-Security-Policy-Report-Only so XSS regressions surface in
 * devtools without breaking Vite's inline scripts. Uses the build-time
 * defaults; runtime additions surface as report-only violations during
 * development which is the desired feedback loop.
 */
function devCspPlugin(): Plugin {
  const connect = ["'self'", ...DEFAULT_RELAYS, ...DEFAULT_UPLOAD_HOSTS, ...STATIC_API, "ws:", "http://localhost:*", "ws://localhost:*"];
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: data: blob:",
    `connect-src ${connect.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ].join("; ");
  return {
    name: "agora-dev-csp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        try {
          res.setHeader("Content-Security-Policy-Report-Only", csp);
        } catch {
          /* ignore */
        }
        next();
      });
    },
  };
}

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    productionCspPlugin(),
    devCspPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

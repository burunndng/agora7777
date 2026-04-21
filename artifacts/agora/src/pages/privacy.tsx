import { Link } from "wouter";
import { ArrowLeft, Shield, Globe, Server, Search, Network, Key, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRelayStore } from "@/lib/nostr/store";
import { getUploadHosts } from "@/lib/media/preferences";

export default function Privacy() {
  const relays = useRelayStore((s) => s.relays);
  const hosts = getUploadHosts();

  return (
    <div className="flex flex-col min-h-screen pb-10">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center gap-3">
        <Link href="/settings">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-full shrink-0"
            aria-label="Back to settings"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <Shield className="h-5 w-5" />
          User Privacy Manual
        </h1>
      </div>

      <div className="p-4 md:p-6 max-w-3xl space-y-6">
        <p className="text-sm text-muted-foreground font-mono leading-relaxed">
          Agora is a client-side app. There is no Agora server. The list below is an
          honest accounting of every third party your browser talks to and what they
          can see when you use the app.
        </p>

        <Section icon={<Server className="h-4 w-4" />} title="Nostr relays">
          <p>
            Every post you publish, every reaction you cast, and every page that
            shows a feed opens a websocket to each configured relay. The relay
            sees: your IP address, the public key you publish under, every event
            you sign, and which event ids / authors you ask about.
          </p>
          <ul className="mt-3 space-y-1 font-mono text-xs">
            {relays.map((r) => (
              <li key={r} className="break-all">• {r}</li>
            ))}
          </ul>
        </Section>

        <Section icon={<Search className="h-4 w-4" />} title="Search (nostr.band)">
          <p>
            The header search bar queries{" "}
            <a
              href="https://nostr.band"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              nostr.band
            </a>
            . They see your IP address and the search string you typed.
            Local cached events are searched in parallel and no second-party
            requests happen if you stay on a query that matched offline.
          </p>
        </Section>

        <Section icon={<Network className="h-4 w-4" />} title="Federated bridges (Lemmy & Mastodon)">
          <p>
            The "Federated" tab on a community page reads from two networks.
            Both are strictly read-only and never written to the encrypted
            cache.
          </p>
          <p className="mt-3">
            <strong className="text-foreground">Lemmy.</strong> Lemmy
            instances rarely enable CORS, so the bridge first attempts a
            direct fetch and then tries a small ordered list of public CORS
            proxies:{" "}
            <code>api.allorigins.win</code>, <code>corsproxy.org</code>, and{" "}
            <code>cors.eu.org</code>. Whichever one answers first sees your
            IP address and the full URL of the community you're reading. The
            destination Lemmy instance also sees your IP. The footer above
            each fetched feed names the proxy that actually served the
            response (or says "directly" when none was needed).
          </p>
          <p className="mt-3">
            <strong className="text-foreground">Mastodon.</strong> Mastodon's
            public timeline endpoints enable CORS, so the bridge calls them
            directly with no proxy. Only the destination instance sees your
            IP. Each Mastodon instance you load is added to the production
            CSP allowlist on the next reload. Identifiers must be explicit:
            <code> #tag@instance</code> for hashtags or
            <code> @user@instance</code> for accounts (a pasted{" "}
            <code>https://instance/tags/…</code> or{" "}
            <code>https://instance/@user</code> URL also works). A bare{" "}
            <code>name@instance</code> is rejected as ambiguous so the bridge
            never silently fetches the wrong timeline.
          </p>
        </Section>

        <Section icon={<Globe className="h-4 w-4" />} title="Media uploads (NIP-96 hosts)">
          <p>
            Every attachment is uploaded in parallel to all configured hosts.
            They see your IP address, the upload's bytes, and the temporary
            NIP-98 auth signed by your key. The list of hosts is editable in
            settings.
          </p>
          <ul className="mt-3 space-y-1 font-mono text-xs">
            {hosts.map((h) => (
              <li key={h} className="break-all">• {h}</li>
            ))}
          </ul>
        </Section>

        <Section icon={<Globe className="h-4 w-4" />} title="Embedded media">
          <p>
            Image and video embeds are click-to-load by default. When you click
            "Load", the host serving the file sees your IP. Auto-load can be
            toggled in settings; the default is off.
          </p>
        </Section>

        <Section icon={<Key className="h-4 w-4" />} title="Identity derivation (per-handle salt)">
          <p>
            Your passphrase is never sent anywhere. The login screen also
            asks for a <strong className="text-foreground">handle</strong>;
            both inputs are mixed into the Argon2id salt as
            <code> agora.nostr.v2|handle=&lt;handle&gt;</code> and run in a
            Web Worker. The handle stays in this browser (cached in
            localStorage so the next login is one field shorter) and is
            never published to relays. Two users picking the same passphrase
            but different handles get different keys, which closes the old
            silent-collision bug from the v1 single-shared-salt design.
            Existing v1 accounts can still log in via the "Legacy login"
            link for one release.
          </p>
        </Section>

        <Section icon={<Sparkles className="h-4 w-4" />} title="Resonance Map (opt-in)">
          <p>
            Resonance Mode is off by default. When you turn it on in
            Settings → Privacy and edit your Resonance Map, Agora
            publishes a single replaceable Nostr event under your npub:
            <code> kind 30015</code> with{" "}
            <code>d="agora-resonance-v1"</code> and one{" "}
            <code>["t", "&lt;tag&gt;", "&lt;1–5&gt;"]</code> entry per
            selected interest. The event is plaintext on every
            configured relay — anyone who fetches your kind 30015 event
            can read every tag and intensity. No "hard boundary" topics
            (HIV/PrEP, drug use, dealbreakers) are published; those need
            zero-knowledge protection and are intentionally absent.
            Saving an empty map publishes a fresh empty event so older
            selections are no longer surfaced by clients that fetch the
            replaceable kind. Resonance features (the map view and the
            shared-interests badge on profiles) are gated entirely
            behind the Resonance Mode toggle and never render when it's
            off.
          </p>
        </Section>

        <Section icon={<Server className="h-4 w-4" />} title="Relay validation">
          <p>
            Relay URLs added via Settings are validated before being
            persisted: the URL must parse, use the <code>wss:</code>
            scheme, and resolve to a public-internet host. Loopback
            (<code>localhost</code>, <code>127/8</code>, <code>::1</code>),
            RFC1918 ranges (<code>10/8</code>, <code>172.16/12</code>,
            <code> 192.168/16</code>), link-local
            (<code>169.254/16</code>, <code>fe80::/10</code>) and bare
            hostnames without a dot are rejected. The same check runs when
            relays are loaded from localStorage, so a tampered store cannot
            inject a malicious MITM relay.
          </p>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="Content Security Policy">
          <p>
            Agora ships a strict CSP. In production an inline bootstrap
            script reads your saved relays and upload hosts from
            localStorage and writes a <code>Content-Security-Policy</code>
            meta tag before the app bundle loads, so adding a relay or a
            new NIP-96 upload host in Settings just works on the next
            reload — no rebuild needed. The same conservative validation
            (no loopback, no RFC1918, no link-local, no bare hosts) is
            applied to those entries before they enter the policy.
            NIP-05 verification is off by default; turning it on in
            Settings → Privacy relaxes <code>connect-src</code> to allow
            <code> https:</code> on the next reload so verifies can reach
            the claimed domain. Inline scripts, eval, framing, and
            cross-origin form posts are blocked.
          </p>
        </Section>

        <Section icon={<Shield className="h-4 w-4" />} title="What stays local">
          <p>
            Your passphrase is never sent anywhere. Your signing key is derived
            in a Web Worker, kept in a closure, and wiped when you disconnect.
            The encrypted cache lives in your browser's IndexedDB, binds
            <code> id|kind|created_at</code> as AES-GCM additional data so
            individual records cannot be silently swapped on disk, and is
            destroyed on logout (not only on Panic Wipe). The first-seen
            npub map is plaintext in localStorage — anyone with browser
            access can enumerate accounts used on this device.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-secondary/10 border border-border rounded-md p-4">
      <h2 className="text-sm font-bold font-mono text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
        {icon} {title}
      </h2>
      <div className="text-sm text-muted-foreground font-mono leading-relaxed">
        {children}
      </div>
    </section>
  );
}

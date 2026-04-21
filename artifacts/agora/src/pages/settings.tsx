import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useIdentityStore, useRelayStore, DEFAULT_RELAYS } from "@/lib/nostr/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrPool, publishSigned } from "@/lib/nostr/pool";
import {
  Settings as SettingsIcon,
  Server,
  Shield,
  Sun,
  Trash2,
  Plus,
  RotateCcw,
  Image as ImageIcon,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Keyboard,
  AtSign,
  HardDrive,
  ChevronRight,
  Key,
  Download,
  Eye,
  EyeOff,
  Sparkles,
  Pencil,
} from "lucide-react";
import {
  setResonanceMode,
  useResonanceMode,
} from "@/lib/resonance/preferences";
import { EditResonanceMapDialog } from "@/components/resonance/edit-resonance-map-dialog";
import {
  estimateStorage,
  isStoragePersisted,
  requestPersistentStorage,
  type PersistState,
} from "@/lib/storage/persist";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  getAutoLoadMedia,
  setAutoLoadMedia,
  getUploadHosts,
  setUploadHosts,
  DEFAULT_UPLOAD_HOSTS,
} from "@/lib/media/preferences";
import { useProfile } from "@/lib/nostr/profiles";
import { isValidNip05, verifyNip05 } from "@/lib/nostr/nip05";
import {
  getNip05Verification,
  setNip05Verification,
} from "@/lib/nostr/preferences";
import {
  useNearbySelf,
  publishNearbyOptIn,
  publishNearbyOptOut,
  sampleCoarseLocation,
  clearLocalNearbyState,
} from "@/lib/nostr/nearby";
import { useToast } from "@/hooks/use-toast";
import { Compass, MapPin } from "lucide-react";
import { RegionPickerDialog } from "@/components/region-picker-dialog";
import type { CoarseLocation } from "@/lib/nostr/nearby";

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildBackupMarkdown(npub: string, nsec: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return [
    "# Agora signing key backup",
    "",
    `Exported: ${date}`,
    "",
    "## Public key (npub) — safe to share",
    "",
    "```",
    npub,
    "```",
    "",
    "## Private key (nsec) — TREAT AS A PASSWORD",
    "",
    "Anyone with this string can post, vote, and read your DMs as you.",
    "Store it offline (paper, password manager). Never paste it into a website,",
    "chat, or email. Agora does not keep a copy — losing it means losing the",
    "account permanently.",
    "",
    "```",
    nsec,
    "```",
    "",
  ].join("\n");
}

export default function Settings() {
  const identity = useIdentityStore((s) => s.identity);
  const logout = useIdentityStore((s) => s.logout);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [revealedNsec, setRevealedNsec] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { relays, addRelay, removeRelay, setRelays } = useRelayStore();
  const { connectionStatus } = useNostrPool();
  const [newRelay, setNewRelay] = useState("");
  const [autoLoad, setAutoLoadState] = useState(false);
  const [nip05Verify, setNip05VerifyState] = useState(false);
  const resonanceMode = useResonanceMode();
  const [editResonanceOpen, setEditResonanceOpen] = useState(false);
  const [hosts, setHostsState] = useState<string[]>([...DEFAULT_UPLOAD_HOSTS]);
  const [newHost, setNewHost] = useState("");
  const { profile } = useProfile(identity?.pubkey);
  const { toast } = useToast();
  const [nip05, setNip05] = useState("");
  const [nip05Status, setNip05Status] = useState<
    "idle" | "checking" | "verified" | "mismatch" | "error"
  >("idle");
  const [publishing, setPublishing] = useState(false);
  const [persistState, setPersistState] = useState<PersistState>("unsupported");
  const [storageInfo, setStorageInfo] = useState<{ usage: number | null; quota: number | null }>(
    { usage: null, quota: null },
  );

  useEffect(() => {
    setAutoLoadState(getAutoLoadMedia());
    setNip05VerifyState(getNip05Verification());
    setHostsState(getUploadHosts());
    isStoragePersisted().then(setPersistState);
    estimateStorage().then(setStorageInfo);
  }, []);

  useEffect(() => {
    setNip05(profile?.nip05 ?? "");
  }, [profile?.nip05]);

  const handleRequestPersist = async () => {
    const next = await requestPersistentStorage();
    setPersistState(next);
    setStorageInfo(await estimateStorage());
  };

  const updateAutoLoad = (v: boolean) => {
    setAutoLoadState(v);
    setAutoLoadMedia(v);
  };
  const updateNip05Verify = (v: boolean) => {
    setNip05VerifyState(v);
    setNip05Verification(v);
  };
  const addHost = () => {
    const v = newHost.trim();
    if (!v) return;
    if (hosts.includes(v)) return;
    const next = [...hosts, v];
    setHostsState(next);
    setUploadHosts(next);
    setNewHost("");
  };
  const removeHost = (h: string) => {
    const next = hosts.filter((x) => x !== h);
    if (next.length === 0) return;
    setHostsState(next);
    setUploadHosts(next);
  };

  const verify = async () => {
    if (!identity || !isValidNip05(nip05)) return;
    setNip05Status("checking");
    setNip05Status(await verifyNip05(nip05, identity.pubkey));
  };

  const saveNip05 = async () => {
    if (!identity) return;
    if (!isValidNip05(nip05)) {
      toast({
        title: "Invalid identifier",
        description: "Use the form name@example.com.",
        variant: "destructive",
      });
      return;
    }
    setPublishing(true);
    try {
      const next = { ...(profile ?? {}), nip05 };
      const signed = identity.signEvent({
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(next),
      });
      await publishSigned(signed, relays);
      toast({
        title: "NIP-05 saved",
        description: "Republished kind:0 metadata to your relays.",
      });
    } catch (err) {
      toast({
        title: "Failed to publish",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleAdd = () => {
    if (!newRelay.trim()) return;
    addRelay(newRelay.trim());
    setNewRelay("");
  };

  const revealKey = () => {
    if (!identity) return;
    try {
      setRevealedNsec(identity.exportNsec());
      setKeyRevealed(true);
    } catch (err) {
      toast({
        title: "Could not export key",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const hideKey = () => {
    setKeyRevealed(false);
    setRevealedNsec(null);
  };

  const downloadKeyAs = (format: "txt" | "md") => {
    if (!identity) return;
    let nsec: string;
    try {
      nsec = identity.exportNsec();
    } catch (err) {
      toast({
        title: "Could not export key",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (format === "md") {
      downloadText(
        `agora-key-${stamp}.md`,
        buildBackupMarkdown(identity.npub, nsec),
      );
    } else {
      downloadText(
        `agora-key-${stamp}.txt`,
        [
          "Agora signing key backup",
          `Exported: ${new Date().toISOString()}`,
          "",
          "Public key (npub) — safe to share:",
          identity.npub,
          "",
          "Private key (nsec) — TREAT AS A PASSWORD:",
          nsec,
          "",
          "Anyone holding the nsec controls this account. Store it offline.",
          "",
        ].join("\n"),
      );
    }
    toast({
      title: "Key downloaded",
      description:
        "Your private key has left the browser. Move it to offline storage and delete the file from Downloads.",
    });
  };

  // Wipe revealed key from React state on unmount as a defense-in-depth.
  useEffect(() => {
    return () => {
      setRevealedNsec(null);
      setKeyRevealed(false);
    };
  }, []);

  return (
    <div className="flex flex-col min-h-screen pb-10">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" />
          Configuration
        </h1>
      </div>

      <div className="p-4 md:p-6 max-w-3xl space-y-8">
        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Shield className="h-4 w-4" /> Identity
          </h2>

          <div className="bg-secondary/10 border border-border rounded-md p-4 space-y-4">
            {identity ? (
              <>
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider font-mono font-bold mb-1 block">
                    Active npub
                  </label>
                  <div className="font-mono text-sm bg-background p-2 rounded border border-border break-all">
                    {identity.npub}
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button variant="destructive" onClick={logout}>
                    Disconnect identity
                  </Button>
                </div>
              </>
            ) : (
              <></>
            )}
            {identity && (
              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Key className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <h3 className="font-bold text-foreground text-sm">
                      Backup signing key
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono leading-relaxed mt-1">
                      Download your <code>nsec</code> (NIP-19 encoded private
                      key) as a plain-text file so you can restore this
                      account in any Nostr client.{" "}
                      <span className="text-destructive">
                        Anyone holding this key can post, vote, and read your
                        DMs as you.
                      </span>{" "}
                      Move it offline and delete the file from your Downloads
                      folder.
                    </p>
                  </div>
                </div>

                {!keyRevealed ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={revealKey}
                      data-testid="button-reveal-key"
                    >
                      <Eye className="h-4 w-4 mr-2" /> Reveal key
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadKeyAs("txt")}
                      data-testid="button-download-key-txt"
                    >
                      <Download className="h-4 w-4 mr-2" /> Download .txt
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadKeyAs("md")}
                      data-testid="button-download-key-md"
                    >
                      <Download className="h-4 w-4 mr-2" /> Download .md
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div
                      className="font-mono text-xs bg-background p-2 rounded border border-destructive/40 break-all select-all"
                      data-testid="text-revealed-nsec"
                    >
                      {revealedNsec}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (revealedNsec) {
                            void navigator.clipboard
                              .writeText(revealedNsec)
                              .then(() =>
                                toast({
                                  title: "Copied",
                                  description:
                                    "Private key on clipboard — paste it into your password manager and clear the clipboard.",
                                }),
                              );
                          }
                        }}
                        data-testid="button-copy-key"
                      >
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadKeyAs("txt")}
                      >
                        <Download className="h-4 w-4 mr-2" /> .txt
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadKeyAs("md")}
                      >
                        <Download className="h-4 w-4 mr-2" /> .md
                      </Button>
                      <Button variant="ghost" size="sm" onClick={hideKey}>
                        <EyeOff className="h-4 w-4 mr-2" /> Hide
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!identity && (
              <div className="text-center py-4">
                <p className="text-muted-foreground font-mono text-sm mb-4">
                  No active identity connected.
                </p>
                <Button
                  variant="outline"
                  onClick={() => (window.location.hash = "#/login")}
                >
                  Connect now
                </Button>
              </div>
            )}
          </div>
        </section>

        {identity && (
          <section>
            <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
              <AtSign className="h-4 w-4" /> Verified Identity (NIP-05)
            </h2>

            <div className="bg-secondary/10 border border-border rounded-md p-4 space-y-3">
              <p className="text-xs text-muted-foreground font-mono">
                Link a domain to your npub. Agora fetches{" "}
                <code>/.well-known/nostr.json</code> on the claimed domain and
                checks the pubkey matches.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="you@example.com"
                  className="font-mono"
                  value={nip05}
                  onChange={(e) => {
                    setNip05(e.target.value);
                    setNip05Status("idle");
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => void verify()}
                  disabled={!isValidNip05(nip05) || nip05Status === "checking"}
                >
                  {nip05Status === "checking" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Verify"
                  )}
                </Button>
                <Button onClick={() => void saveNip05()} disabled={publishing}>
                  {publishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Publish"
                  )}
                </Button>
              </div>
              {nip05Status === "verified" && (
                <div className="flex items-center gap-2 text-xs text-primary font-mono">
                  <CheckCircle2 className="h-4 w-4" /> Verified — domain serves
                  your pubkey.
                </div>
              )}
              {nip05Status === "mismatch" && (
                <div className="flex items-center gap-2 text-xs text-destructive font-mono">
                  <AlertTriangle className="h-4 w-4" /> Mismatch — the domain
                  serves a different pubkey for this name.
                </div>
              )}
              {nip05Status === "error" && (
                <div className="flex items-center gap-2 text-xs text-destructive font-mono">
                  <AlertTriangle className="h-4 w-4" /> Could not reach the
                  domain's well-known endpoint.
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Keyboard className="h-4 w-4" /> Panic Wipe
          </h2>
          <div className="bg-secondary/10 border border-border rounded-md p-4 space-y-2">
            <p className="text-sm text-foreground">
              Press{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-xs">
                Ctrl
              </kbd>{" "}
              +{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-xs">
                Shift
              </kbd>{" "}
              +{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-xs">
                X
              </kbd>{" "}
              anywhere to instantly wipe local state.
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              Clears the encrypted IndexedDB cache, zeroes the in-memory key
              material, removes Agora-scoped localStorage entries, and
              redirects to /login. Already-published events on relays are not
              affected.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Sun className="h-4 w-4" /> Appearance
          </h2>

          <div className="bg-secondary/10 border border-border rounded-md p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-foreground">Dark Mode</h3>
                <p className="text-sm text-muted-foreground font-mono">
                  Essential for late-night posting.
                </p>
              </div>
              <Switch
                checked={
                  theme === "dark" ||
                  (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches)
                }
                onCheckedChange={(c) => setTheme(c ? "dark" : "light")}
              />
            </div>
          </div>
        </section>

        {/* Media Section */}
        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <ImageIcon className="h-4 w-4" /> Media
          </h2>

          <div className="bg-secondary/10 border border-border rounded-md p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-foreground">Auto-load images & videos</h3>
                <p className="text-sm text-muted-foreground font-mono">
                  When off (default), embeds are click-to-load so a third-party host can't see your IP without consent.
                </p>
              </div>
              <Switch
                checked={autoLoad}
                onCheckedChange={updateAutoLoad}
                data-testid="switch-auto-load-media"
              />
            </div>
          </div>

          <div className="bg-secondary/10 border border-border rounded-md p-4">
            <h3 className="font-bold text-sm mb-2">Upload hosts (NIP-96)</h3>
            <p className="text-xs text-muted-foreground font-mono mb-3">
              Each attachment is uploaded to all configured hosts in parallel for redundancy. At least one is required.
            </p>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="https://nostr.build"
                className="font-mono"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                data-testid="input-new-upload-host"
              />
              <Button onClick={addHost} type="button" data-testid="button-add-upload-host">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {hosts.map((h) => (
                <div key={h} className="flex items-center justify-between p-2 bg-background border border-border rounded-md">
                  <span className="font-mono text-sm break-all">{h}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeHost(h)}
                    disabled={hosts.length <= 1}
                    data-testid={`button-remove-host-${h}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Storage / PWA Section */}
        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <HardDrive className="h-4 w-4" /> Storage
          </h2>

          <div className="bg-secondary/10 border border-border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-foreground">Persistent storage</h3>
                <p className="text-sm text-muted-foreground font-mono max-w-md">
                  Asks the browser not to evict the encrypted cache under storage
                  pressure. Required for reliable offline use on mobile.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="text-xs font-mono uppercase tracking-wider"
                  data-testid="text-persist-state"
                >
                  {persistState === "granted"
                    ? "✓ Granted"
                    : persistState === "denied"
                      ? "✗ Denied"
                      : "Unsupported"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  disabled={persistState === "granted" || persistState === "unsupported"}
                  onClick={handleRequestPersist}
                  data-testid="button-request-persist"
                >
                  Request
                </Button>
              </div>
            </div>
            {storageInfo.quota !== null && (
              <div className="text-xs font-mono text-muted-foreground border-t border-border pt-3">
                Used {formatBytes(storageInfo.usage ?? 0)} of{" "}
                {formatBytes(storageInfo.quota)} available.
              </div>
            )}
          </div>
        </section>

        {/* Privacy Section */}
        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Shield className="h-4 w-4" /> Privacy
          </h2>
          <div className="bg-secondary/10 border border-border rounded-md p-4 mb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-foreground">Verify NIP-05 identifiers</h3>
                <p className="text-sm text-muted-foreground font-mono">
                  When on, Agora fetches the claimed domain's
                  <code> /.well-known/nostr.json</code> to verify a profile's
                  NIP-05 — which leaks your IP to that domain. Toggling this
                  on also relaxes the production Content-Security-Policy to
                  permit <code>connect-src https:</code> on the next page
                  reload, so verifies can reach arbitrary hosts. Default
                  off; while off, the manual "Verify" button is also
                  blocked under the strict CSP.
                </p>
              </div>
              <Switch
                checked={nip05Verify}
                onCheckedChange={updateNip05Verify}
                data-testid="switch-nip05-verify"
              />
            </div>
          </div>

          {identity && <NearbyDiscoverabilityCard />}

          <div
            className="bg-secondary/10 border border-border rounded-md p-4 mb-3"
            data-testid="card-resonance-mode"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Resonance Mode
                </h3>
                <p className="text-sm text-muted-foreground font-mono leading-relaxed mt-1">
                  When on, Agora gains a "Resonance Map" — a small, opt-in
                  tag profile of what culturally resonates with you (music,
                  aesthetics, mind, lifestyle…). Saved as a single
                  replaceable Nostr event (NIP-51 kind 30015) so other
                  clients can read it. While off, nothing in the app
                  changes.
                </p>
              </div>
              <Switch
                checked={resonanceMode}
                onCheckedChange={(c) => setResonanceMode(c)}
                data-testid="switch-resonance-mode"
              />
            </div>
            {resonanceMode && identity && (
              <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditResonanceOpen(true)}
                  data-testid="button-open-resonance-editor"
                >
                  <Pencil className="h-4 w-4 mr-2" /> Edit Resonance Map
                </Button>
              </div>
            )}
            {resonanceMode && !identity && (
              <p className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground font-mono">
                Connect an identity to publish your map.
              </p>
            )}
          </div>

          <Link href="/privacy">
            <div
              className="bg-secondary/10 border border-border rounded-md p-4 flex items-center justify-between cursor-pointer hover:bg-secondary/20 transition-colors min-h-[44px]"
              data-testid="link-privacy-manual"
            >
              <div>
                <h3 className="font-bold text-foreground">User Privacy Manual</h3>
                <p className="text-sm text-muted-foreground font-mono">
                  Honest disclosure of every third party your browser talks to.
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </div>
          </Link>
        </section>

        {/* Relays Section */}
        <section>
          <h2 className="text-sm font-bold font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Server className="h-4 w-4" /> Relay Connections
          </h2>

          <div className="bg-secondary/10 border border-border rounded-md p-4 mb-4">
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="wss://relay.example.com"
                className="font-mono"
                value={newRelay}
                onChange={(e) => setNewRelay(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
              <Button onClick={handleAdd}>
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>

            <div className="space-y-2">
              {relays.length > 0 ? (
                relays.map((url) => {
                  const isConnected = connectionStatus.get(url) ?? false;
                  return (
                    <div
                      key={url}
                      className="flex items-center justify-between p-3 bg-background border border-border rounded-md"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            isConnected ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        <div className="font-mono text-sm text-foreground truncate">
                          {url}
                        </div>
                        {DEFAULT_RELAYS.includes(url) && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1 py-0"
                          >
                            Default
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRelay(url)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-4 text-muted-foreground font-mono text-sm">
                  No relays configured.
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRelays(DEFAULT_RELAYS)}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-2" />
                Reset to defaults
              </Button>
            </div>
          </div>
        </section>
      </div>

      {identity && resonanceMode && (
        <EditResonanceMapDialog
          open={editResonanceOpen}
          onOpenChange={setEditResonanceOpen}
          identity={identity}
        />
      )}
    </div>
  );
}

function NearbyDiscoverabilityCard() {
  const identity = useIdentityStore((s) => s.identity);
  const relays = useRelayStore((s) => s.relays);
  const { discoverable, coarseLocation, setCoarseLocation, setDiscoverable } =
    useNearbySelf();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"on" | "refresh" | "off" | "manual" | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const enable = async () => {
    if (!identity) return;
    setBusy("on");
    try {
      const loc = await sampleCoarseLocation();
      await publishNearbyOptIn(identity, loc, relays);
      setCoarseLocation(loc);
      setDiscoverable(true);
      toast({
        title: "Discoverable nearby",
        description:
          "Only a coarse cell (~11 km square) is shared with relays.",
      });
    } catch (err) {
      toast({
        title: "Could not enable",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    if (!identity) return;
    setBusy("refresh");
    try {
      const loc = await sampleCoarseLocation();
      await publishNearbyOptIn(identity, loc, relays);
      setCoarseLocation(loc);
      toast({ title: "Location refreshed" });
    } catch (err) {
      toast({
        title: "Refresh failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  // Publish a manually-picked region. The picker has already coarsened
  // the value; `publishNearbyOptIn` re-coarsens defensively.
  const handleManualPick = async (loc: CoarseLocation): Promise<boolean> => {
    if (!identity) return false;
    setBusy("manual");
    try {
      await publishNearbyOptIn(identity, loc, relays);
      setCoarseLocation(loc);
      setDiscoverable(true);
      toast({
        title: "Area updated",
        description: "Your chosen ~11 km cell was published.",
      });
      return true;
    } catch (err) {
      toast({
        title: "Could not publish your area",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const disable = async () => {
    setBusy("off");
    try {
      if (identity) {
        await publishNearbyOptOut(identity, relays);
      } else {
        clearLocalNearbyState();
      }
      setDiscoverable(false);
      setCoarseLocation(null);
      toast({
        title: "Hidden from Nearby",
        description:
          "Other clients will drop your card on next refresh, and your stored cell was cleared.",
      });
    } catch (err) {
      toast({
        title: "Could not publish opt-out",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="bg-secondary/10 border border-border rounded-md p-4 mb-3"
      data-testid="card-nearby-settings"
    >
      <div className="flex items-start gap-2 mb-3">
        <Compass className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div>
          <h3 className="font-bold text-foreground">
            Nearby discoverability
          </h3>
          <p className="text-sm text-muted-foreground font-mono leading-relaxed mt-1">
            When on, Agora rounds your location to a ~11 km grid cell and
            publishes that coarse cell to your relays under your npub so other
            opted-in users can see you in the Nearby view. Your precise position
            never leaves this device. Turn this off to disappear from others'
            views on their next refresh.
          </p>
        </div>
      </div>

      {discoverable && coarseLocation ? (
        <div className="space-y-3">
          <div className="text-xs font-mono text-muted-foreground bg-background border border-border rounded p-2 flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span>
              Currently sharing cell{" "}
              <span className="text-foreground">
                {coarseLocation.lat.toFixed(2)}°,{" "}
                {coarseLocation.lng.toFixed(2)}°
              </span>{" "}
              (~11 km square).
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={!!busy}
              data-testid="button-nearby-settings-refresh"
            >
              {busy === "refresh" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Refresh from GPS
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              disabled={!!busy}
              data-testid="button-nearby-settings-pick"
            >
              {busy === "manual" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Compass className="h-4 w-4 mr-2" />
              )}
              Change area manually
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void disable()}
              disabled={!!busy}
              data-testid="button-nearby-settings-disable"
            >
              {busy === "off" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Turn off & clear cell
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void enable()}
            disabled={!!busy}
            data-testid="button-nearby-settings-enable"
          >
            {busy === "on" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MapPin className="h-4 w-4 mr-2" />
            )}
            Use GPS
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            disabled={!!busy}
            data-testid="button-nearby-settings-pick"
          >
            {busy === "manual" ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Compass className="h-4 w-4 mr-2" />
            )}
            Pick area from list
          </Button>
        </div>
      )}

      <RegionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handleManualPick}
        initial={coarseLocation}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}


import { useRef, useState } from "react";
import { MediaUploader, type AttachedMedia } from "@/components/media-uploader";
import { uploadToSend } from "@/lib/send/upload";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useIdentityStore, useRelayStore } from "@/lib/nostr/store";
import { useToast } from "@/hooks/use-toast";
import { Shield, PenSquare, Info, Loader2, Paperclip, X } from "lucide-react";
import { useLocation } from "wouter";
import { minePowAsync } from "@/lib/nostr/miner";
import { publishSigned } from "@/lib/nostr/pool";
import type { UnsignedEvent } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/core";
import { buildImetaTag } from "@/lib/media/event-tags";
import {
  useCommunity,
  useCommunityKey,
  encryptString,
  ENCRYPTION_TAG,
  ENCRYPTION_SCHEME,
} from "@/lib/nostr/communities";
import { UnlockCommunityDialog } from "@/components/unlock-community-dialog";
import { Lock } from "lucide-react";

const formSchema = z.object({
  community: z.string().optional(),
  title: z.string().max(120).optional(),
  content: z.string().min(1, "Content is required"),
  powDifficulty: z.coerce.number().min(0).max(24),
});

export default function Submit() {
  const identity = useIdentityStore((s) => s.identity);
  const cache = useIdentityStore((s) => s.cache);
  const relays = useRelayStore((s) => s.relays);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState<"idle" | "mining" | "publishing">("idle");
  const [attached, setAttached] = useState<AttachedMedia[]>([]);
  const [uploadingSend, setUploadingSend] = useState(false);
  const [sendProgress, setSendProgress] = useState<{
    uploaded: number;
    total: number;
    filename: string;
  } | null>(null);
  const sendInputRef = useRef<HTMLInputElement | null>(null);
  const sendAbortRef = useRef<AbortController | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { community: "", title: "", content: "", powDifficulty: 16 },
  });

  const onSendFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be re-picked later.
    e.target.value = "";
    if (!file) return;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    setUploadingSend(true);
    setSendProgress({ uploaded: 0, total: file.size, filename: file.name });
    try {
      const { url, instance } = await uploadToSend(file, {
        signal: controller.signal,
        onProgress: (uploaded, total) => {
          setSendProgress({ uploaded, total, filename: file.name });
        },
      });
      const current = form.getValues("content") ?? "";
      const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
      form.setValue("content", `${current}${sep}${url}\n`, {
        shouldDirty: true,
        shouldValidate: true,
      });
      toast({
        title: "Uploaded to Send",
        description: `Encrypted and uploaded via ${new URL(instance).host}.`,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        toast({
          title: "Send upload cancelled",
          description: "The in-flight upload was aborted.",
        });
      } else {
        toast({
          title: "Send upload failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    } finally {
      sendAbortRef.current = null;
      setUploadingSend(false);
      setSendProgress(null);
    }
  };

  const cancelSendUpload = () => {
    sendAbortRef.current?.abort();
  };

  const watchedCommunity = form.watch("community")?.trim() || null;
  const { community: targetCommunity, loading: loadingCommunity } =
    useCommunity(watchedCommunity);
  const { key: communityKey } = useCommunityKey(
    targetCommunity?.encrypted ? targetCommunity.identifier : null,
  );
  const needsUnlock = !!targetCommunity?.encrypted && !communityKey;
  const communityUnknown =
    !!watchedCommunity && !loadingCommunity && !targetCommunity;

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!identity) {
      toast({
        title: "Authentication required",
        description: "Connect an identity before posting.",
        variant: "destructive",
      });
      return;
    }

    if (values.community) {
      if (loadingCommunity) {
        toast({
          title: "Community metadata still loading",
          description:
            "Wait a moment and try again — we need to confirm whether this community is encrypted before posting.",
          variant: "destructive",
        });
        return;
      }
      if (!targetCommunity) {
        toast({
          title: "Unknown community",
          description: `No NIP-72 metadata was found for "${values.community}". Posting refused so we don't accidentally publish plaintext into an encrypted community we just haven't seen yet.`,
          variant: "destructive",
        });
        return;
      }
    }

    const tags: string[][] = [];
    if (values.title) tags.push(["subject", values.title]);
    if (values.community) {
      // NIP-72 a-tag = kind:author:d. We use the resolved community
      // author's pubkey (guaranteed present after the loading guard above).
      const author = targetCommunity!.pubkey;
      tags.push(["a", `34550:${author}:${values.community}`]);
      tags.push(["t", values.community]);
    }

    for (const a of attached) {
      tags.push(
        buildImetaTag({
          mirrors: a.mirrors,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          filename: a.filename,
        }),
      );
    }

    let finalContent = values.content;
    if (targetCommunity?.encrypted) {
      if (!communityKey) {
        toast({
          title: "Community is locked",
          description: "Unlock the community first to post encrypted content.",
          variant: "destructive",
        });
        return;
      }
      try {
        finalContent = await encryptString(
          communityKey,
          values.content,
          targetCommunity.identifier,
        );
        tags.push([ENCRYPTION_TAG, ENCRYPTION_SCHEME]);
      } catch (err) {
        toast({
          title: "Encryption failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return;
      }
    }

    const baseTemplate: EventTemplate = {
      kind: 1,
      content: finalContent,
      created_at: Math.floor(Date.now() / 1000),
      tags,
    };

    try {
      let templateToSign: EventTemplate = baseTemplate;
      if (values.powDifficulty > 0) {
        setBusy("mining");
        const unsigned: UnsignedEvent = { ...baseTemplate, pubkey: identity.pubkey };
        const mined = await minePowAsync(unsigned, values.powDifficulty);
        templateToSign = {
          kind: mined.kind,
          content: mined.content,
          created_at: mined.created_at,
          tags: mined.tags,
        };
      }

      setBusy("publishing");
      const signed = identity.signEvent(templateToSign);
      await publishSigned(signed, relays);
      cache?.putEvent(signed, values.community || null).catch(() => {});

      toast({
        title: "Post broadcast",
        description: `Signed and published to ${relays.length} relays.`,
      });
      setLocation(`/post/${signed.id}`);
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy("idle");
    }
  }

  if (!identity) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Shield className="h-12 w-12 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Connect Identity</h1>
          <p className="text-muted-foreground font-mono text-sm mb-6">
            You need a cryptographic identity to post on Agora.
          </p>
          <Button onClick={() => setLocation("/login")} className="w-full">
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <PenSquare className="h-5 w-5" />
          Create Post
        </h1>
      </div>

      <div className="p-4 md:p-6 max-w-2xl w-full mx-auto">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="community"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-muted-foreground uppercase tracking-widest text-xs font-bold">
                    Community identifier (optional)
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. agora-meta"
                      {...field}
                      className="font-mono bg-secondary/30"
                    />
                  </FormControl>
                  <FormDescription className="text-xs font-mono">
                    Tags the post into a NIP-72 community via the <code>a</code> tag.
                  </FormDescription>
                  {targetCommunity?.encrypted && (
                    <div className="mt-2 p-2 border border-primary/40 bg-primary/5 rounded-md flex items-center justify-between gap-3">
                      <div className="text-[11px] font-mono text-primary flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5" />
                        {needsUnlock
                          ? "Encrypted community — unlock to post."
                          : "Encrypted community — your post will be encrypted client-side."}
                      </div>
                      {needsUnlock && (
                        <UnlockCommunityDialog community={targetCommunity} />
                      )}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-muted-foreground uppercase tracking-widest text-xs font-bold">
                    Title (optional)
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="An interesting title…"
                      {...field}
                      className="text-lg font-bold bg-secondary/30"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="font-mono text-muted-foreground uppercase tracking-widest text-xs font-bold">
                      Content
                    </FormLabel>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs font-mono"
                      onClick={() => sendInputRef.current?.click()}
                      disabled={uploadingSend}
                      title="Encrypt + upload a file to a public Send instance and paste the share link"
                    >
                      {uploadingSend ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <Paperclip className="h-3 w-3 mr-1.5" />
                          Upload to Send
                        </>
                      )}
                    </Button>
                    <input
                      ref={sendInputRef}
                      type="file"
                      className="hidden"
                      onChange={onSendFilePicked}
                    />
                  </div>
                  {sendProgress && (
                    <div className="mb-2 p-2 border border-border bg-secondary/30 rounded-md">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {sendProgress.filename}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-mono text-primary tabular-nums">
                            {sendProgress.total > 0
                              ? Math.floor(
                                  (sendProgress.uploaded / sendProgress.total) *
                                    100,
                                )
                              : 0}
                            %
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs font-mono"
                            onClick={cancelSendUpload}
                            title="Cancel upload"
                          >
                            <X className="h-3 w-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                      <div className="h-1.5 bg-background rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-150"
                          style={{
                            width: `${
                              sendProgress.total > 0
                                ? Math.min(
                                    100,
                                    (sendProgress.uploaded /
                                      sendProgress.total) *
                                      100,
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <FormControl>
                    <Textarea
                      placeholder="What's on your mind?"
                      className="min-h-[200px] font-mono bg-secondary/30 resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <div className="font-mono text-muted-foreground uppercase tracking-widest text-xs font-bold mb-2">
                Attachments (Optional)
              </div>
              <MediaUploader attached={attached} onChange={setAttached} />
            </div>

            <div className="bg-secondary/20 p-4 border border-border rounded-md">
              <FormField
                control={form.control}
                name="powDifficulty"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between mb-2">
                      <FormLabel className="font-mono text-muted-foreground uppercase tracking-widest text-xs font-bold flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5" /> NIP-13 Proof of Work
                      </FormLabel>
                      <span className="text-primary font-bold font-mono text-sm">
                        {field.value} bits
                      </span>
                    </div>
                    <FormControl>
                      <input
                        type="range"
                        min="0"
                        max="24"
                        step="1"
                        className="w-full accent-primary"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-xs font-mono mt-2">
                      <Info className="h-3 w-3 inline mr-1" />
                      Mined in a worker. Higher difficulty = more spam-resistance and
                      stronger weighting in the feed; takes longer to compute.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type="submit"
              className="w-full font-bold text-md h-12"
              disabled={busy !== "idle" || needsUnlock || communityUnknown}
            >
              {busy === "mining" && (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Mining proof of work…
                </>
              )}
              {busy === "publishing" && (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Broadcasting to relays…
                </>
              )}
              {busy === "idle" && "Sign & broadcast"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}

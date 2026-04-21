import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useDMs, sendDM, type DMThread } from "@/lib/nostr/dm";
import { useIdentityStore, useRelayStore } from "@/lib/nostr/store";
import { useProfile } from "@/lib/nostr/profiles";
import { authorLabel, hexToNpub, npubToHex } from "@/lib/nostr/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  Lock,
  Send,
  ArrowLeft,
  Plus,
  Inbox,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function ThreadListItem({
  thread,
  active,
}: {
  thread: DMThread;
  active: boolean;
}) {
  const { profile } = useProfile(thread.counterpart);
  const npub = hexToNpub(thread.counterpart);
  const last = thread.messages[thread.messages.length - 1];
  return (
    <Link href={`/messages/${npub}`}>
      <div
        className={`p-4 border-b border-border cursor-pointer transition-colors ${
          active ? "bg-secondary" : "hover:bg-secondary/40"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="font-mono text-sm font-bold truncate">
            {authorLabel(npub, profile?.display_name || profile?.name)}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatDistanceToNow(new Date(thread.lastAt * 1000), {
              addSuffix: true,
            })}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {last.content}
        </div>
      </div>
    </Link>
  );
}

function ComposeRecipient({ onPicked }: { onPicked: (pubkey: string) => void }) {
  const [value, setValue] = useState("");
  const { toast } = useToast();
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    const hex = v.startsWith("npub") ? npubToHex(v) : v;
    if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
      toast({
        title: "Invalid recipient",
        description: "Enter an npub… or 64-char hex pubkey.",
        variant: "destructive",
      });
      return;
    }
    onPicked(hex);
    setValue("");
  };
  return (
    <div className="p-3 border-b border-border bg-secondary/20 flex gap-2">
      <Input
        placeholder="npub1… recipient"
        className="font-mono text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button size="sm" onClick={submit}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ThreadView({
  counterpart,
  thread,
}: {
  counterpart: string;
  thread: DMThread | null;
}) {
  const identity = useIdentityStore((s) => s.identity);
  const relays = useRelayStore((s) => s.relays);
  const { profile } = useProfile(counterpart);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const npub = hexToNpub(counterpart);

  const send = async () => {
    if (!identity) return;
    if (!draft.trim()) return;
    setSending(true);
    try {
      await sendDM(counterpart, draft, relays);
      setDraft("");
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center gap-3">
        <Link href="/messages">
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="font-bold truncate">
            {authorLabel(npub, profile?.display_name || profile?.name)}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono truncate">
            {npub}
          </div>
        </div>
        <Badge variant="outline" className="border-primary/50 text-primary text-[10px]">
          <Lock className="h-3 w-3 mr-1" />
          NIP-17
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!thread || thread.messages.length === 0 ? (
          <div className="text-center text-muted-foreground font-mono text-sm py-12">
            No messages yet. Send the first one below.
          </div>
        ) : (
          thread.messages.map((m) => {
            const fromMe = identity && m.from === identity.pubkey;
            return (
              <div
                key={m.id}
                className={`flex ${fromMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    fromMe
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  <div>{m.content}</div>
                  <div className="text-[10px] opacity-60 mt-1 font-mono">
                    {new Date(m.createdAt * 1000).toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-border p-3 flex gap-2">
        <Input
          placeholder="Encrypted message…"
          className="font-mono text-sm"
          value={draft}
          disabled={sending || !identity}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          onClick={() => void send()}
          disabled={sending || !identity || !draft.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Messages() {
  const params = useParams();
  const identity = useIdentityStore((s) => s.identity);
  const { threads, loading } = useDMs();
  const npubParam = params.npub;
  const counterpart = useMemo(() => {
    if (!npubParam) return null;
    return npubParam.startsWith("npub") ? npubToHex(npubParam) : npubParam;
  }, [npubParam]);

  const activeThread = useMemo(
    () => (counterpart ? threads.find((t) => t.counterpart === counterpart) ?? null : null),
    [counterpart, threads],
  );

  if (!identity) {
    return (
      <div className="p-8 text-center text-muted-foreground font-mono">
        Sign in to read your private messages.
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <aside
        className={`w-full md:w-80 border-r border-border ${
          counterpart ? "hidden md:flex" : "flex"
        } flex-col`}
      >
        <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
          <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Encrypted DMs
          </h1>
        </div>
        <ComposeRecipient
          onPicked={(pk) => (window.location.hash = `#/messages/${hexToNpub(pk)}`)}
        />
        {loading && threads.length === 0 ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : threads.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm flex flex-col items-center gap-2">
            <Inbox className="h-8 w-8" />
            Inbox is empty.
          </div>
        ) : (
          <div>
            {threads.map((t) => (
              <ThreadListItem
                key={t.counterpart}
                thread={t}
                active={t.counterpart === counterpart}
              />
            ))}
          </div>
        )}
      </aside>

      {counterpart ? (
        <ThreadView counterpart={counterpart} thread={activeThread} />
      ) : (
        <div className="flex-1 hidden md:flex items-center justify-center text-muted-foreground font-mono">
          Select a thread or start a new one.
        </div>
      )}
    </div>
  );
}

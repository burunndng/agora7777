import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, X, Loader2, CheckCircle2, AlertCircle, ShieldCheck, ShieldAlert } from "lucide-react";
import { uploadToHosts, formatBytes, hostnameOf, type HostUploadStatus, type UploadResult } from "@/lib/media/upload";
import { getUploadHosts } from "@/lib/media/preferences";
import { useToast } from "@/hooks/use-toast";

export interface AttachedMedia {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  mirrors: string[]; // 1 or 2 URLs
  perHost: HostUploadStatus[];
  strippedFormats: string[]; // e.g. ["APP1/Exif"]
  notStrippedReason?: string;
}

interface PendingUpload {
  id: string;
  filename: string;
  sizeBytes: number;
  perHost: HostUploadStatus[];
}

interface Props {
  attached: AttachedMedia[];
  onChange: (attached: AttachedMedia[]) => void;
}

export function MediaUploader({ attached, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const { toast } = useToast();

  const handlePick = () => inputRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (inputRef.current) inputRef.current.value = "";
    const hosts = getUploadHosts();
    for (const file of list) {
      const id = crypto.randomUUID();
      const initialStatuses: HostUploadStatus[] = hosts.map((h) => ({ host: h, state: "pending" }));
      setPending((prev) => [...prev, { id, filename: file.name, sizeBytes: file.size, perHost: initialStatuses }]);

      let result: UploadResult;
      try {
        result = await uploadToHosts(file, {
          hosts,
          onStatus: (statuses) => {
            setPending((prev) => prev.map((p) => (p.id === id ? { ...p, perHost: statuses } : p)));
          },
        });
      } catch (e) {
        toast({
          title: "Upload failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
        setPending((prev) => prev.filter((p) => p.id !== id));
        continue;
      }

      setPending((prev) => prev.filter((p) => p.id !== id));

      if (result.urls.length === 0) {
        const errs = result.perHost
          .filter((s) => s.state === "error")
          .map((s) => `${hostnameOf(s.host)}: ${(s as { message: string }).message}`)
          .join("; ");
        toast({
          title: `Upload failed: ${file.name}`,
          description: errs || "All hosts rejected the file.",
          variant: "destructive",
        });
        continue;
      }

      if (result.urls.length < result.perHost.length) {
        toast({
          title: "Partial upload",
          description: `${file.name}: ${result.urls.length}/${result.perHost.length} hosts succeeded.`,
        });
      } else {
        toast({
          title: "Uploaded",
          description: `${file.name} mirrored to ${result.urls.length} host${result.urls.length === 1 ? "" : "s"}.`,
        });
      }

      const stripped = result.strip.stripped ? (result.strip as { removed: string[] }).removed : [];
      const notStrippedReason = !result.strip.stripped ? (result.strip as { reason: string }).reason : undefined;

      onChange([
        ...attached,
        {
          id,
          filename: result.filename,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          mirrors: result.urls,
          perHost: result.perHost,
          strippedFormats: stripped,
          notStrippedReason,
        },
      ]);
    }
  };

  const remove = (id: string) => {
    onChange(attached.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid="input-media-file"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handlePick}
        className="font-mono"
        data-testid="button-attach-media"
      >
        <Paperclip className="h-3.5 w-3.5 mr-2" />
        Attach Image / Video
      </Button>

      {pending.map((p) => (
        <PendingRow key={p.id} pending={p} />
      ))}

      {attached.map((a) => (
        <AttachedRow key={a.id} attached={a} onRemove={() => remove(a.id)} />
      ))}
    </div>
  );
}

function PendingRow({ pending }: { pending: PendingUpload }) {
  return (
    <div className="border border-border rounded-md p-3 bg-secondary/20 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
          <span className="text-xs font-mono truncate">{pending.filename}</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatBytes(pending.sizeBytes)}</span>
      </div>
      <div className="space-y-1">
        {pending.perHost.map((s) => (
          <HostStatusLine key={s.host} status={s} />
        ))}
      </div>
    </div>
  );
}

function AttachedRow({ attached, onRemove }: { attached: AttachedMedia; onRemove: () => void }) {
  const partial = attached.mirrors.length < attached.perHost.length;
  return (
    <div className="border border-border rounded-md p-3 bg-secondary/20 space-y-2" data-testid={`row-attached-${attached.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-mono truncate">{attached.filename}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono text-muted-foreground">{formatBytes(attached.sizeBytes)}</span>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove} data-testid={`button-remove-${attached.id}`}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {partial && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-amber-500">
          <AlertCircle className="h-3 w-3" />
          Only {attached.mirrors.length}/{attached.perHost.length} hosts accepted this file. Embed will still work but has fewer fallbacks.
        </div>
      )}

      {attached.notStrippedReason ? (
        <div className="flex items-center gap-2 text-[10px] font-mono text-amber-500">
          <ShieldAlert className="h-3 w-3" />
          {attached.notStrippedReason} — original metadata uploaded as-is.
        </div>
      ) : attached.strippedFormats.length > 0 ? (
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-primary" />
          Stripped: {attached.strippedFormats.join(", ")}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-primary" />
          No metadata segments found.
        </div>
      )}

      <div className="space-y-1">
        {attached.perHost.map((s) => (
          <HostStatusLine key={s.host} status={s} />
        ))}
      </div>
    </div>
  );
}

function HostStatusLine({ status }: { status: HostUploadStatus }) {
  const host = hostnameOf(status.host);
  if (status.state === "ok") {
    return (
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="flex items-center gap-1 text-primary">
          <CheckCircle2 className="h-3 w-3" /> {host}
        </span>
        <span className="text-muted-foreground truncate">{status.url}</span>
      </div>
    );
  }
  if (status.state === "error") {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono text-destructive">
        <AlertCircle className="h-3 w-3" /> {host}: {status.message}
      </div>
    );
  }
  if (status.state === "uploading") {
    return (
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted-foreground">
        <span className="flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> {host}
        </span>
        <span>{Math.round(status.progress * 100)}%</span>
      </div>
    );
  }
  if (status.state === "discovering") {
    return (
      <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> {host}: discovering capabilities…
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
      {host}: queued
    </div>
  );
}

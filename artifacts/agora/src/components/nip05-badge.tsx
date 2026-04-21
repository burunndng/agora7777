import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  useNip05Verification,
  type Nip05Status,
} from "@/lib/nostr/nip05";

/**
 * Renders a NIP-05 (`name@domain`) identifier with a verification state
 * indicator. Verification is opt-in: when the user has not enabled NIP-05
 * verification in Settings → Privacy, the hook stays "idle" and the badge
 * shows the identifier with a neutral style (no network call is made).
 */
export function Nip05Badge({
  value,
  pubkey,
  size = "sm",
}: {
  value: string;
  pubkey: string;
  /** "sm" matches profile header; "xs" matches post / comment meta rows. */
  size?: "sm" | "xs";
}) {
  const status = useNip05Verification(value, pubkey);
  return <Nip05BadgeStatic value={value} status={status} size={size} />;
}

/**
 * Static variant — accepts an explicit status. Used by the Settings page
 * which drives the status from a manual "Verify" button rather than the
 * passive hook.
 */
export function Nip05BadgeStatic({
  value,
  status,
  size = "sm",
}: {
  value: string;
  status: Nip05Status;
  size?: "sm" | "xs";
}) {
  const styles =
    status === "verified"
      ? "border-primary/50 text-primary"
      : status === "checking" || status === "idle"
        ? "border-muted-foreground/40 text-muted-foreground"
        : "border-destructive/60 text-destructive";
  const Icon =
    status === "verified"
      ? CheckCircle2
      : status === "checking"
        ? Loader2
        : status === "mismatch" || status === "error"
          ? AlertTriangle
          : CheckCircle2;
  const label =
    status === "verified"
      ? value
      : status === "checking"
        ? `Verifying ${value}…`
        : status === "mismatch"
          ? `${value} (does not match)`
          : status === "error"
            ? `${value} (unverified)`
            : value;
  const sizeClass =
    size === "xs"
      ? "font-mono text-[10px] h-4 px-1 py-0 leading-none"
      : "font-mono text-xs";
  const iconClass =
    size === "xs"
      ? `h-2.5 w-2.5 mr-1 ${status === "checking" ? "animate-spin" : ""}`
      : `h-3 w-3 mr-1 ${status === "checking" ? "animate-spin" : ""}`;
  return (
    <Badge variant="outline" className={`${sizeClass} ${styles}`}>
      <Icon className={iconClass} />
      {label}
    </Badge>
  );
}

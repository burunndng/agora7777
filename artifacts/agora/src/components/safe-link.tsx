import { useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, ShieldAlert } from "lucide-react";

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Defense in depth: anything that isn't an http(s)/mailto absolute URL or a
 * relative / hash / Agora-internal route is treated as unsafe and rendered
 * inert. This blocks `javascript:`, `data:`, `vbscript:`, `file:` etc. from
 * any future caller, even ones that bypass `linkify`.
 */
function classifyHref(href: string): "internal" | "external" | "unsafe" {
  if (!href) return "internal";
  // Hash-only / root-relative / explicitly relative paths stay internal.
  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    href.startsWith("?")
  ) {
    return "internal";
  }
  // Reject any string containing a scheme separator before validation —
  // some `javascript:` payloads use whitespace/control chars to evade
  // naive prefix checks.
  let parsed: URL;
  try {
    parsed = new URL(href, window.location.href);
  } catch {
    return "unsafe";
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return "unsafe";
  if (parsed.protocol === "mailto:") return "external";
  if (parsed.origin === window.location.origin) return "internal";
  return "external";
}

const DEREFERRERS = [
  "https://dereferer.me/?",
  "https://anon.to/?",
] as const;

/**
 * Wraps an outgoing http(s) URL with a randomly chosen privacy proxy so the
 * destination site does not see Agora as the referrer. Non-http(s) URLs (e.g.
 * `mailto:`) are returned unchanged.
 */
export function wrapWithDereferrer(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
  const prefix = DEREFERRERS[Math.floor(Math.random() * DEREFERRERS.length)];
  return `${prefix}${url}`;
}

function destination(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

/**
 * Renders an `<a>` tag. If the href points to a non-Agora origin, intercepts
 * the click and shows a confirmation dialog before navigating. Disallowed
 * URL schemes (e.g. `javascript:`, `data:`) render as plain text with a
 * warning badge instead of as a clickable link.
 */
export function SafeLink({ href, children, onClick, ...rest }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const kind = classifyHref(href);

  if (kind === "unsafe") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-destructive/10 text-destructive text-xs font-mono"
        title={`Blocked unsafe URL scheme: ${href.slice(0, 80)}`}
        data-testid="safelink-blocked"
      >
        <ShieldAlert className="h-3 w-3" />
        {children}
      </span>
    );
  }

  const internal = kind === "internal";

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (internal) return;
    if (e.defaultPrevented) return;
    e.preventDefault();
    setPending(href);
  };

  const proceed = () => {
    if (!pending) return;
    const url = pending;
    setPending(null);
    window.open(wrapWithDereferrer(url), "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <a
        href={href}
        onClick={handleClick}
        target={internal ? undefined : "_blank"}
        rel={internal ? undefined : "noopener noreferrer"}
        {...rest}
      >
        {children}
      </a>
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono">
              <ShieldAlert className="h-5 w-5 text-primary" />
              You are leaving Agora
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Destination:{" "}
                <span className="font-mono text-foreground break-all">
                  {pending ? destination(pending) : ""}
                </span>
              </span>
              <span className="block text-xs">
                External sites can track you. Continue at your own risk.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button onClick={proceed}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
// Trailing punctuation that should not be part of the URL even if the
// regex grabbed it. We don't strip closing parens unless the URL has no
// matching opening paren — common case: `(see https://example.com)`.
const TRAILING_PUNCT = /[.,;:!?'"]+$/;

function trimTrailingPunctuation(url: string): string {
  let out = url.replace(TRAILING_PUNCT, "");
  // Balance parens/brackets: drop a trailing `)` / `]` / `}` if there's
  // no matching opener earlier in the URL.
  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      while (out.endsWith(close)) {
        const opens = (out.match(new RegExp(`\\${open}`, "g")) ?? []).length;
        const closes = (out.match(new RegExp(`\\${close}`, "g")) ?? []).length;
        if (closes > opens) {
          out = out.slice(0, -1);
          changed = true;
        } else {
          break;
        }
      }
    }
    out = out.replace(TRAILING_PUNCT, (m) => {
      if (m.length > 0) changed = true;
      return "";
    });
  }
  return out;
}

/**
 * Linkifies bare URLs in plaintext. Returns ReactNode-friendly output.
 * Used inside post bodies / comments / about fields.
 */
export function linkify(text: string): React.ReactNode[] {
  URL_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    const url = trimTrailingPunctuation(raw);
    parts.push(
      <SafeLink
        key={`l-${key++}`}
        href={url}
        className="text-primary underline break-all"
      >
        {url}
      </SafeLink>,
    );
    const trimmedTail = raw.slice(url.length);
    lastIndex = match.index + url.length;
    if (trimmedTail.length > 0) {
      // Push the trimmed punctuation back into the surrounding text so the
      // user still sees `https://example.com).` rendered correctly.
      parts.push(trimmedTail);
      lastIndex += trimmedTail.length;
    }
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

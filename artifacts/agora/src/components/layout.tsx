import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Users,
  Settings as SettingsIcon,
  LogIn,
  PenSquare,
  LogOut,
  Activity,
  MessageCircle,
  Search as SearchIcon,
  Compass,
  Inbox as InboxIcon,
  Bookmark,
  Crown,
  Gavel,
  Terminal,
} from "lucide-react";
import { useIdentityStore } from "@/lib/nostr/store";
import { shortNpub } from "@/lib/nostr/format";
import { SearchBar } from "@/components/search-bar";
import { useInboxUnreadCount, useInboxSyncEffect } from "@/lib/nostr/inbox";
import { useIsAdmin, useIsModerator } from "@/lib/nostr/roles";
import { CreateCommunityDialog } from "@/components/create-community-dialog";
import { GeoLine, GeoAccent, GeoCornerTR, GeoCornerBL } from "@/components/geo";

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const identity = useIdentityStore((s) => s.identity);
  const logout = useIdentityStore((s) => s.logout);
  const npub = identity?.npub ?? null;
  useInboxSyncEffect();
  const unread = useInboxUnreadCount();
  const isAdmin = useIsAdmin();
  const isMod = useIsModerator();

  const navItems = [
    { href: "/", label: "Feed", icon: Activity },
    { href: "/communities", label: "Communities", icon: Users },
    { href: "/nearby", label: "Nearby", icon: Compass },
    { href: "/search", label: "Search", icon: SearchIcon },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row" style={{ backgroundColor: "#070b14" }}>
      <aside
        className="w-full md:w-64 md:min-h-[100dvh] md:sticky md:top-0 p-4 flex flex-col gap-5"
        style={{
          backgroundColor: "#0c1122",
          borderRight: "1px solid #1a2240",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <GeoCornerTR />
        <GeoCornerBL />

        {/* Logo */}
        <div className="flex items-center gap-3 px-2 pt-1">
          <div
            style={{
              width: 40,
              height: 40,
              border: "1px solid #7a5818",
              flexShrink: 0,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="/agora-logo.jpeg"
              alt="Agora"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
                if (img.parentElement) {
                  img.parentElement.innerHTML = `<span style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:18px;color:#c9962e">A</span>`;
                }
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: "0.15em",
                color: "#c9962e",
                lineHeight: 1,
              }}
            >
              AGORA
            </div>
            <div
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 10,
                letterSpacing: "0.2em",
                color: "#7a5818",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              Decentralized
            </div>
          </div>
          <GeoAccent className="ml-auto opacity-60" />
        </div>

        <GeoLine />

        <div className="md:hidden">
          <SearchBar />
        </div>

        <nav className="flex flex-col gap-0.5 flex-1">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href === "/search" && location.startsWith("/search"));
            return (
              <Link key={item.href} href={item.href}>
                <NavItem icon={item.icon} label={item.label} isActive={isActive} />
              </Link>
            );
          })}

          <GeoLine className="my-3" />

          {npub && (
            <>
              <Link href="/inbox">
                <NavItem
                  icon={InboxIcon}
                  label="Inbox"
                  isActive={location.startsWith("/inbox")}
                  badge={unread > 0 ? (unread > 99 ? "99+" : String(unread)) : undefined}
                  testId="nav-inbox"
                />
              </Link>
              <Link href="/bookmarks">
                <NavItem
                  icon={Bookmark}
                  label="Bookmarks"
                  isActive={location.startsWith("/bookmarks")}
                  testId="nav-bookmarks"
                />
              </Link>
              <Link href="/messages">
                <NavItem
                  icon={MessageCircle}
                  label="Messages"
                  isActive={location.startsWith("/messages")}
                />
              </Link>
              <Link href="/submit">
                <NavItem
                  icon={PenSquare}
                  label="New Post"
                  isActive={location === "/submit"}
                />
              </Link>
              {(isAdmin || isMod) && (
                <Link href="/moderation">
                  <NavItem
                    icon={Gavel}
                    label="Moderation"
                    isActive={location.startsWith("/moderation")}
                    testId="nav-moderation"
                  />
                </Link>
              )}
              {(isAdmin || isMod) && (
                <CreateCommunityDialog
                  onCreated={(identifier) =>
                    setLocation(`/community/${encodeURIComponent(identifier)}`)
                  }
                  trigger={
                    <NavItem
                      icon={PenSquare}
                      label="Create Community"
                      isActive={false}
                      testId="nav-create-community"
                      asButton
                    />
                  }
                />
              )}
              {isAdmin && (
                <Link href="/admin">
                  <NavItem
                    icon={Crown}
                    label="Admin"
                    isActive={location.startsWith("/admin")}
                    testId="nav-admin"
                  />
                </Link>
              )}
              <Link href={`/profile/${npub}`}>
                <NavItem
                  icon={Terminal}
                  label="Profile"
                  isActive={location.startsWith("/profile")}
                />
              </Link>
            </>
          )}

          <Link href="/settings">
            <NavItem
              icon={SettingsIcon}
              label="Settings"
              isActive={location === "/settings" || location === "/privacy"}
            />
          </Link>
        </nav>

        <GeoLine />

        <div className="pt-2">
          {npub ? (
            <div className="flex flex-col gap-3">
              <div
                style={{
                  fontSize: 11,
                  color: "#3d4f70",
                  fontFamily: "monospace",
                  padding: "0 4px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {shortNpub(npub)}
              </div>
              <GeoButton onClick={logout} dimmed>
                <LogOut className="h-4 w-4" />
                Disconnect
              </GeoButton>
            </div>
          ) : (
            <Link href="/login">
              <GeoButton gold>
                <LogIn className="h-4 w-4" />
                Connect Identity
              </GeoButton>
            </Link>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 max-w-4xl">
        <div
          className="hidden md:flex sticky top-0 z-20 items-center px-4 py-2"
          style={{
            backdropFilter: "blur(12px)",
            backgroundColor: "rgba(7,11,20,0.85)",
            borderBottom: "1px solid #1a2240",
          }}
        >
          <SearchBar />
        </div>
        {children}
      </main>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  isActive,
  badge,
  testId,
  asButton = false,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  isActive: boolean;
  badge?: string;
  testId?: string;
  asButton?: boolean;
}) {
  return (
    <div
      role={asButton ? "button" : undefined}
      tabIndex={asButton ? 0 : undefined}
      data-testid={testId}
      className="flex items-center gap-3 px-3 py-2.5 transition-colors cursor-pointer min-h-[44px]"
      style={{
        borderLeft: isActive ? "2px solid #c9962e" : "2px solid transparent",
        backgroundColor: isActive ? "rgba(201,150,46,0.08)" : "transparent",
        color: isActive ? "#c9962e" : "#8090b8",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.color = "#dde2f0";
          (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.03)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.color = "#8090b8";
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
        }
      }}
    >
      <Icon
        className="h-4 w-4 shrink-0"
        style={{ color: isActive ? "#c9962e" : "currentColor" }}
      />
      <span
        className="flex-1"
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 13,
          fontWeight: isActive ? 600 : 400,
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
      {badge && (
        <span
          style={{
            fontSize: 10,
            fontFamily: "monospace",
            color: "#c9962e",
            border: "1px solid #7a5818",
            padding: "1px 5px",
            minWidth: 20,
            textAlign: "center",
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function GeoButton({
  children,
  onClick,
  gold = false,
  dimmed = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  gold?: boolean;
  dimmed?: boolean;
}) {
  const borderColor = gold ? "#c9962e" : "#3d4f70";
  const color = gold ? "#c9962e" : "#8090b8";
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2.5 transition-colors min-h-[44px]"
      style={{
        border: `1px solid ${borderColor}`,
        color,
        backgroundColor: "transparent",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 13,
        fontWeight: gold ? 600 : 400,
        cursor: "pointer",
        letterSpacing: gold ? "0.05em" : "0.02em",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#c9962e";
        (e.currentTarget as HTMLElement).style.color = "#c9962e";
        (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(201,150,46,0.07)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = borderColor;
        (e.currentTarget as HTMLElement).style.color = color;
        (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}

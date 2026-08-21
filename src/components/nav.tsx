"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, LayoutDashboard, Link2, PenSquare, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "לוח בקרה", icon: LayoutDashboard },
  { href: "/compose", label: "פוסט חדש", icon: PenSquare },
  { href: "/approvals", label: "ממתין לאישור", icon: CheckCircle2 },
  { href: "/calendar", label: "יומן תוכן", icon: CalendarDays },
  { href: "/connections", label: "חשבונות מחוברים", icon: Link2 },
] as const;

export function Nav({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex h-full flex-col gap-1 border-e border-border-subtle bg-surface p-4">
      <div className="mb-6 px-2">
        <p className="text-sm font-semibold text-ink">מנהל הסושיאל</p>
        <p className="text-xs text-ink-muted">אינסטגרם · פייסבוק · טיקטוק</p>
      </div>

      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-brand-soft font-medium text-brand"
                : "text-ink-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{label}</span>
            {href === "/approvals" && pendingCount > 0 && (
              <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}

      <button
        type="button"
        onClick={logout}
        className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <LogOut className="size-4" aria-hidden />
        התנתקות
      </button>
    </nav>
  );
}

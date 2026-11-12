"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Mitt minne" },
  { href: "/import", label: "Importera" },
  { href: "/tools", label: "Anslutna verktyg" },
  { href: "/settings", label: "Data & integritet" },
];

export function Nav() {
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d: { user: { email: string } | null }) => setEmail(d.user?.email ?? null))
      .catch(() => setEmail(null));
  }, [path]);

  if (path.startsWith("/login")) return null;
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">𝄞</span>
          Maestro
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                (l.href === "/" ? path === "/" : path.startsWith(l.href)) && "bg-muted text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span className="hidden sm:inline">🇪🇺 Lagras i EU</span>
          {email && (
            <button
              className="hover:text-foreground"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                location.href = "/login";
              }}
              title={email}
            >
              Logga ut
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

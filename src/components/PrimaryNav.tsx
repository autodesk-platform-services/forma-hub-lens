"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

type NavItem = { href: string; label: string; adminOnly?: boolean };
type NavGroup = { label: string; items: NavItem[]; adminOnly?: boolean };

const GROUPS: NavGroup[] = [
  { label: "Projects", items: [
    { href: "/projects", label: "Project inventory" },
    { href: "/lifecycle", label: "Lifecycle review" },
    { href: "/closeout", label: "Closeout readiness" },
  ] },
  { label: "People & Access", items: [
    { href: "/people", label: "People directory" },
    { href: "/people?view=matrix", label: "Access matrix" },
    { href: "/permissions", label: "Folder permissions" },
    { href: "/offboarding", label: "Offboarding", adminOnly: true },
  ] },
  { label: "Insights", items: [
    { href: "/activity", label: "Activity explorer" },
    { href: "/governance", label: "Governance review" },
    { href: "/tools", label: "Tool dashboards" },
  ] },
  { label: "Data", items: [
    { href: "/extracts", label: "Extracts & schedules" },
    { href: "/data-health", label: "Data health" },
    { href: "/integrations", label: "Integration health" },
  ] },
  { label: "Admin", adminOnly: true, items: [
    { href: "/manage", label: "Bulk management" },
    { href: "/recipes", label: "Provisioning recipes" },
    { href: "/manage/audit", label: "Administrative audit" },
    { href: "/closeout/profiles", label: "Turnover profiles" },
  ] },
];

function matches(pathname: string, href: string, view: string): boolean {
  const [path, query] = href.split("?");
  if (path === "/people" && pathname === path) {
    return (new URLSearchParams(query ?? "").get("view") ?? "directory") === view;
  }
  if (path === "/people" && query) return false;
  return pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
}

export function PrimaryNav({ isHubAdmin }: { isHubAdmin: boolean }) {
  return <Suspense fallback={<nav aria-label="Primary navigation" className="flex items-center gap-3 text-xs text-adsk-lightgray"><Link href="/">Overview</Link><span>Projects · People &amp; Access · Insights · Data{isHubAdmin ? " · Admin" : ""}</span></nav>}>
    <PrimaryNavInner isHubAdmin={isHubAdmin} />
  </Suspense>;
}

function PrimaryNavInner({ isHubAdmin }: { isHubAdmin: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "matrix" ? "matrix" : "directory";
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeMenus = () => navRef.current?.querySelectorAll("details[open]").forEach((menu) => menu.removeAttribute("open"));
    closeMenus();
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) closeMenus();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenus(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pathname]);

  return (
    <nav ref={navRef} aria-label="Primary navigation" className="flex flex-wrap items-center gap-1">
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        className={`rounded px-2.5 py-1.5 font-legend text-xs hover:bg-white/10 hover:text-adsk-white ${pathname === "/" ? "bg-white/10 text-adsk-white underline decoration-adsk-yellow decoration-2 underline-offset-8" : "text-adsk-lightgray"}`}
      >
        Overview
      </Link>
      {GROUPS.filter((group) => !group.adminOnly || isHubAdmin).map((group) => {
        const items = group.items.filter((item) => !item.adminOnly || isHubAdmin);
        const matching = items.filter((item) => matches(pathname, item.href, view) && !(group.label === "Projects" && pathname.startsWith("/closeout/profiles")));
        const selected = matching.sort((a, b) => b.href.split("?")[0].length - a.href.split("?")[0].length)[0]?.href;
        const active = Boolean(selected);
        return (
          <details key={group.label} className="group relative">
            <summary
              onClick={(event) => {
                const current = event.currentTarget.parentElement;
                navRef.current?.querySelectorAll("details[open]").forEach((menu) => {
                  if (menu !== current) menu.removeAttribute("open");
                });
              }}
              className={`cursor-pointer list-none rounded px-2.5 py-1.5 font-legend text-xs hover:bg-white/10 hover:text-adsk-white [&::-webkit-details-marker]:hidden ${active ? "bg-white/10 text-adsk-white underline decoration-adsk-yellow decoration-2 underline-offset-8" : "text-adsk-lightgray"}`}
              aria-label={`${group.label} menu`}
            >
              {group.label}<span aria-hidden="true" className="ml-1 text-[10px]">▾</span>
            </summary>
            <div className="absolute left-0 top-full z-50 mt-2 min-w-48 rounded border border-adsk-gray bg-adsk-black p-1 shadow-xl">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={selected === item.href && pathname === item.href.split("?")[0] ? "page" : undefined}
                  onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
                  className={`block rounded px-3 py-2 text-xs hover:bg-white/10 hover:text-adsk-white ${selected === item.href ? "text-adsk-yellow" : "text-adsk-lightgray"}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}

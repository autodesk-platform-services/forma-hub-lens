import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/aps/auth";
import { configProblems } from "@/lib/env";
import { signOut } from "./actions";

export const metadata: Metadata = {
  title: "Forma Hub Lens",
  description: "Cross-project activity and hub management for an Autodesk Forma hub",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/tools", label: "Tools" },
  { href: "/projects", label: "Projects" },
  { href: "/activity", label: "Activity" },
  { href: "/extracts", label: "Extracts" },
  { href: "/manage", label: "Manage" },
];

/**
 * Autodesk mark, top-left on every screen.
 *
 * public/autodesk-logo.png is the white-on-transparent ("dark background")
 * variant, so it only reads on the black header — don't reuse it on the light
 * surfaces. Height matches the mark it replaced (20px); width follows the
 * asset's 1619:1109 aspect.
 */
function AutodeskMark() {
  return (
    <Image
      src="/autodesk-logo.png"
      alt="Autodesk"
      width={1619}
      height={1109}
      priority
      className="h-5 w-auto shrink-0"
    />
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const problems = configProblems();
  const session = problems.length === 0 ? await getSession() : null;

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <header className="surface-dark">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <AutodeskMark />
              <span className="font-legend text-sm tracking-tight text-adsk-white">
                Forma Hub Lens
              </span>
              <span className="rounded border border-adsk-gray px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-adsk-lightgray">
                internal
              </span>
            </Link>

            <nav className="flex flex-wrap items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2.5 py-1.5 font-legend text-xs text-adsk-lightgray hover:bg-white/10 hover:text-adsk-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3 text-xs">
              {session ? (
                <>
                  <span className="text-adsk-lightgray">
                    {session.userName || session.userEmail || "signed in"}
                  </span>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="rounded border border-adsk-gray px-2.5 py-1.5 font-legend text-xs text-adsk-lightgray hover:border-adsk-white hover:text-adsk-white"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <a
                  href="/api/aps/login"
                  className="rounded border border-adsk-lightgray bg-adsk-yellow px-3 py-1.5 font-legend text-xs text-adsk-black hover:opacity-90"
                >
                  Sign in with Autodesk
                </a>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] flex-1 px-6 py-6">{children}</main>

        <footer className="mx-auto w-full max-w-[1500px] px-6 pb-4 text-right">
          <p className="text-[8px] text-adsk-gray">
            Autodesk and Forma are registered trademarks of Autodesk, Inc. Internal use only.
          </p>
        </footer>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { getSession } from "@/lib/aps/auth";
import { env } from "@/lib/env";
import { PrimaryNav } from "@/components/PrimaryNav";
import { HeaderSearch } from "@/components/HeaderSearch";
import { HeaderSavedMenu } from "@/components/HeaderSavedMenu";
import { HubModeSwitch } from "@/components/HubModeSwitch";
import { DemoHubBanner } from "@/components/DemoHubBanner";
import { savedViewsOwner } from "@/lib/savedViews";

export const metadata: Metadata = {
  title: "Forma Hub Lens (Demo)",
  description: "Explore a fictional Forma portfolio with simulated administrative workflows",
};

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
  const session = await getSession();
  const savedOwner = session ? savedViewsOwner(session) : null;
  const savedSummary = {
    hasOwner: Boolean(savedOwner),
    views: [],
    watched: [],
  };

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <header className="surface-dark">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <AutodeskMark />
              <span className="font-legend text-sm tracking-tight text-adsk-white">
                Forma Hub Lens
              </span>
            </Link>

            <HubModeSwitch demoMode demoUrl={env.demoHubUrl} liveUrl={env.liveHubUrl} />

            <PrimaryNav isHubAdmin />

            <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
              <HeaderSearch demoMode />
              <HeaderSavedMenu initial={savedSummary} owner={savedOwner} />
            </div>
          </div>
        </header>

        <DemoHubBanner />

        <div role="note" aria-label="Data source status" className="border-b border-adsk-lightgray bg-adsk-white">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-2 gap-y-1 px-6 py-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-adsk-gray">Sources</span>
            <span className="rounded border border-adsk-gold bg-adsk-yellow/15 px-2 py-0.5 text-[11px] text-adsk-black">
              Sample data · synthetic hub records
            </span>
          </div>
        </div>

        <main className="mx-auto w-full max-w-[1500px] flex-1 px-6 py-6">{children}</main>

        <footer className="mx-auto w-full max-w-[1500px] px-6 pb-4 text-right">
          <p className="text-[8px] text-adsk-gray">
            Autodesk and Forma are registered trademarks of Autodesk, Inc.
          </p>
        </footer>
      </body>
    </html>
  );
}

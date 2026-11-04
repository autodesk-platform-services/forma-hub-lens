"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readToolFavorites, type ToolSummary } from "@/lib/toolFavorites";

export function FavoriteTools({ tools, storageKey }: { tools: ToolSummary[]; storageKey: string | null }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    setFavorites(readToolFavorites(storageKey, new Set(tools.map((tool) => tool.id))));
  }, [storageKey, tools]);

  if (!storageKey) return <p className="text-xs text-adsk-gray">Favorite tools are unavailable. Reload this page to try again.</p>;
  const selected = favorites.flatMap((id) => {
    const tool = tools.find((candidate) => candidate.id === id);
    return tool ? [tool] : [];
  });

  return selected.length ? (
    <div className="flex flex-wrap gap-2">
      {selected.map((tool) => <Link key={tool.id} href={`/tools?open=${encodeURIComponent(tool.id)}`}
        className="rounded border border-adsk-lightgray bg-adsk-white px-3 py-2 text-xs hover:border-adsk-yellow">
        <span aria-hidden>★ </span>{tool.name}
      </Link>)}
    </div>
  ) : <p className="text-xs text-adsk-gray">Star tools in the library to keep them here. Favorites are saved in this browser.</p>;
}

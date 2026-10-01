"use client";

import { useState } from "react";

export function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return <button type="button" onClick={copy}
    aria-label={`Copy ID ${value}`}
    className="ml-2 shrink-0 text-[10px] text-adsk-link hover:underline">
    {copied ? "Copied" : "Copy ID"}
  </button>;
}

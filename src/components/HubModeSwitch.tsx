type HubModeSwitchProps = {
  demoMode: boolean;
  demoUrl?: string;
  liveUrl?: string;
};

/** Each choice points to a separate deployment with its own session and data. */
export function HubModeSwitch({ demoMode, demoUrl, liveUrl }: HubModeSwitchProps) {
  const missingMode = demoMode ? "Live hub" : "Demo hub";
  const missingUrl = demoMode ? liveUrl : demoUrl;

  function choice(label: "Demo hub" | "Live hub", active: boolean, href?: string) {
    const className = `rounded px-2.5 py-1 font-legend text-[11px] ${active
      ? "bg-adsk-yellow text-adsk-black"
      : href
        ? "text-adsk-lightgray hover:bg-adsk-gray hover:text-adsk-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adsk-yellow"
        : "cursor-not-allowed text-adsk-gray"}`;

    if (active) return <span key={label} aria-current="page" className={className}>{label}</span>;
    if (href) return <a key={label} href={href} className={className}>{label}</a>;
    return <span key={label} aria-disabled="true" className={className}>{label}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <nav aria-label="Hub environment" className="inline-flex items-center gap-0.5 rounded border border-adsk-gray p-0.5">
        {choice("Demo hub", demoMode, demoUrl)}
        {choice("Live hub", !demoMode, liveUrl)}
      </nav>
      {!missingUrl && (
        <span className="text-[10px] text-adsk-lightgray">
          {missingMode} is not connected to this site.
        </span>
      )}
    </div>
  );
}

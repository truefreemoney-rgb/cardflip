"use client";

import dynamic from "next/dynamic";
import Spinner from "@/components/Spinner";

/**
 * The help chat inside the header flyout loads when the flyout opens. The
 * flyout frame is fixed-size, so the spinner just fills it: no layout jump.
 */
const HelpPanelLazy = dynamic(() => import("@/components/HelpPanel"), {
  loading: () => (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading help">
      <Spinner className="h-6 w-6 text-zinc-400" />
    </div>
  ),
});

export default HelpPanelLazy;

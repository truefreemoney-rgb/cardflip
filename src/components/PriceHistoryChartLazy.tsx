"use client";

import dynamic from "next/dynamic";

/**
 * The price chart for panels and modals that open on tap: its drawing code
 * loads on demand instead of riding in the page bundle. The placeholder is a
 * pulse block about the chart's height (header + plot) so nothing jumps.
 * Pages that render the chart above the fold with server-read series import
 * PriceHistoryChart directly.
 */
const PriceHistoryChartLazy = dynamic(() => import("@/components/PriceHistoryChart"), {
  loading: () => <div className="mt-2 h-[15rem] animate-pulse rounded-lg bg-white/5" aria-hidden />,
});

export default PriceHistoryChartLazy;

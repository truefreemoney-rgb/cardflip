"use client";

import dynamic from "next/dynamic";
import Spinner from "@/components/Spinner";

/**
 * The camera overlay only exists after a tap on Scan, so its code loads on
 * demand. The placeholder is the same full-screen dim layer the camera opens
 * on, with a spinner, so the tap answers at once and nothing jumps.
 */
const CameraCaptureLazy = dynamic(() => import("@/components/CameraCapture"), {
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" role="status" aria-label="Opening camera">
      <Spinner className="h-8 w-8 text-white" />
    </div>
  ),
});

export default CameraCaptureLazy;

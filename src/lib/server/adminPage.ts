import "server-only";
import { redirect } from "next/navigation";
import { adminRole } from "@/lib/server/adminGate";

/**
 * Console pages outside Tasks: a helper (lib/adminAuth.ts) is sent back to
 * her page. Separate from adminGate.ts because next/navigation drags the
 * app-router context into the script tests that import the gate.
 */
export async function requireOwnerPage(): Promise<void> {
  if ((await adminRole()) !== "owner") redirect("/admin/board");
}

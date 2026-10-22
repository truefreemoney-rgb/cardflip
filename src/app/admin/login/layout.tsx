import { redirect } from "next/navigation";
import { PRIVATE_META } from "@/lib/pageMeta";
import { hasAdminSession } from "@/lib/server/adminGate";

export const metadata = PRIVATE_META.adminLogin;

export default async function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  // Already signed in (10-22): straight to the console instead of the form again.
  if (await hasAdminSession()) redirect("/admin");
  return children;
}

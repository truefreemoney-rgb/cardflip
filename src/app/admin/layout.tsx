import { PRIVATE_META } from "@/lib/pageMeta";

export const metadata = PRIVATE_META.admin;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

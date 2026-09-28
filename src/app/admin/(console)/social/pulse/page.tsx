import { redirect } from "next/navigation";

/** Folded into /admin/social/posts (09-28): posts, counts and comments in one place. */
export default function Page() {
  redirect("/admin/social/posts");
}
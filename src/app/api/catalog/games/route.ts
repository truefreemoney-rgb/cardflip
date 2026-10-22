import { NextResponse } from "next/server";
import { publicCardGames } from "@/lib/server/cardPages";

/** 10-22: the games the public can use, for the nav search box (it is a client component and used to list the admin-only games too). */
export const revalidate = 300;

export async function GET() {
  try {
    return NextResponse.json({ games: await publicCardGames() });
  } catch (err) {
    console.error("catalog games failed:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

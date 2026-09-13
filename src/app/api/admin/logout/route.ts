import { NextResponse } from "next/server";
import { COOKIE_ADMIN, COOKIE_OPTS } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_ADMIN, "", { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}

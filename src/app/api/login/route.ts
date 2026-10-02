import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Eski istemciler için uyumluluk: şifre kontrolü ve oturum oluşturma yok.
export async function POST() {
  const response = NextResponse.json({ ok: true, protectionEnabled: false });
  response.cookies.set("uf_auth", "", { path: "/", maxAge: 0 });
  return response;
}

export async function DELETE() {
  return POST();
}

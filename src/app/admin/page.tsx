import Link from "next/link";
import { cookies } from "next/headers";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import LoginAdmin from "@/components/LoginAdmin";
import PanelAdmin from "@/components/PanelAdmin";
import CerrarSesion from "@/components/CerrarSesion";

export const dynamic = "force-dynamic";

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ sesion?: string }>;
}) {
  const { sesion } = await searchParams;
  const store = await cookies();
  const activa = await leerSesion(
    store.get(COOKIE_ADMIN)?.value,
    process.env.ADMIN_SECRET
  );

  if (!activa) {
    return <LoginAdmin expirada={sesion === "expirada"} />;
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--color-linea)] bg-[var(--color-papel)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-[15px] font-semibold text-[var(--color-tinta)]">
              Administración de cartera
            </h1>
            <p className="text-xs text-[var(--color-tinta-suave)]">
              Sesión de {activa.usuario}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[13px]">
            <Link
              href="/"
              className="text-[var(--color-tinta-suave)] underline underline-offset-2"
            >
              Ver consulta
            </Link>
            <CerrarSesion />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8">
        <PanelAdmin />
      </div>
    </main>
  );
}

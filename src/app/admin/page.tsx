import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_ADMIN, leerSesion, mandaEnElPanel } from "@/lib/auth";
import { COOKIE_MENU, COOKIE_MODO, esModo } from "@/lib/modo";
import LoginAdmin from "@/components/LoginAdmin";
import PanelAdmin from "@/components/PanelAdmin";

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
    return <LoginAdmin motivo={sesion} />;
  }

  // El middleware ya desvía a los perfiles BackOffice, pero la página no se
  // fía de eso: quien no sea admin no llega a ver el panel completo.
  if (!mandaEnElPanel(activa.rol)) redirect("/backoffice");

  return (
    <PanelAdmin
      usuario={activa.usuario}
      rol={activa.rol}
      modo={esModo(store.get(COOKIE_MODO)?.value)}
      menuOculto={store.get(COOKIE_MENU)?.value === "oculto"}
    />
  );
}

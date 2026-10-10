import { cookies } from "next/headers";
import { COOKIE_ADMIN, leerSesion } from "@/lib/auth";
import { COOKIE_MENU, COOKIE_MODO, esModo } from "@/lib/modo";
import LoginAdmin from "@/components/LoginAdmin";
import PanelBackOffice from "@/components/PanelBackOffice";

export const dynamic = "force-dynamic";

export default async function PaginaBackOffice({
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
    return (
      <LoginAdmin
        motivo={sesion}
        titulo="BackOffice"
        rotulo="Soporte · Cartera LiveTrade"
        descripcion="Consulta la cartera de cualquier consultor para resolverle por teléfono: su ruta, sus puntos en el mapa y las descargas."
      />
    );
  }

  // Un administrador también puede entrar aquí; solo que él además tiene el
  // panel completo a un clic, desde el menú.
  return (
    <PanelBackOffice
      usuario={activa.usuario}
      rol={activa.rol}
      modo={esModo(store.get(COOKIE_MODO)?.value)}
      menuOculto={store.get(COOKIE_MENU)?.value === "oculto"}
    />
  );
}

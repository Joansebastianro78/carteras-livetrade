import { cookies } from "next/headers";
import { COOKIE_MENU, COOKIE_MODO, esModo } from "@/lib/modo";
import { sesionConPermisos } from "@/lib/perfilesServidor";
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
  const activa = await sesionConPermisos();

  if (!activa) {
    return <LoginAdmin motivo={sesion} />;
  }

  // El panel muestra solo los módulos del perfil; el middleware cierra las
  // rutas de API de los demás.
  return (
    <PanelAdmin
      panel="admin"
      usuario={activa.usuario}
      nombrePerfil={activa.nombrePerfil}
      modulos={activa.modulos}
      modo={esModo(store.get(COOKIE_MODO)?.value)}
      menuOculto={store.get(COOKIE_MENU)?.value === "oculto"}
    />
  );
}

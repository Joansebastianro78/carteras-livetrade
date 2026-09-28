import Consulta from "@/components/Consulta";
import AvisoMantenimiento from "@/components/AvisoMantenimiento";
import { leerMantenimiento } from "@/lib/mantenimiento";

// El estado de mantenimiento se decide en el servidor, en cada visita: así el
// consultor nunca alcanza a ver el formulario para que se lo quiten encima.
export const dynamic = "force-dynamic";

export default async function Inicio() {
  const estado = await leerMantenimiento();

  if (estado.activo) return <AvisoMantenimiento estado={estado} />;

  return <Consulta />;
}

import { supabaseAdmin } from "./supabaseAdmin";
import {
  ESTADO_TEMA_POR_DEFECTO,
  TEMAS,
  type EstadoTema,
  type IdTema,
  type ModoTema,
} from "./temas";

/**
 * Lee el estado de los temas desde Supabase (una sola fila, id = 1).
 * Usa la service_role key: solo se importa desde el servidor.
 */
export async function leerEstadoTema(): Promise<EstadoTema> {
  const { data, error } = await supabaseAdmin
    .from("tema")
    .select("modo,tema_fijo,apagados")
    .eq("id", 1)
    .maybeSingle();

  // Si la tabla todavía no existe, el sitio queda en automático sin nada
  // apagado. Un error de lectura no debería tumbar la página entera.
  if (error || !data) {
    if (error) console.error("[tema]", error.message);
    return ESTADO_TEMA_POR_DEFECTO;
  }

  const validos = new Set(TEMAS.map((t) => t.id));
  const apagados = (data.apagados ?? []).filter((id: string) =>
    validos.has(id as IdTema)
  ) as IdTema[];

  return {
    modo: (data.modo ?? "automatico") as ModoTema,
    temaFijo: validos.has(data.tema_fijo as IdTema)
      ? (data.tema_fijo as IdTema)
      : null,
    apagados,
  };
}

/**
 * Arma las rutas en segundo plano para que la pantalla no se congele con
 * miles de puntos. Recibe las coordenadas tal como vienen del Excel y las
 * opciones; responde el avance y, al final, el resultado o el error.
 */
import { ErrorRutas, generarRutas, type OpcionesRutas } from "./rutas";

type Pedido = { lat: unknown[]; lon: unknown[]; opciones: OpcionesRutas };

const ctx = self as unknown as { postMessage: (m: unknown) => void; onmessage: ((e: MessageEvent<Pedido>) => void) | null };

ctx.onmessage = (e) => {
  try {
    const resultado = generarRutas(e.data.lat, e.data.lon, e.data.opciones, (hecho) => ctx.postMessage({ tipo: "avance", hecho }));
    ctx.postMessage({ tipo: "listo", resultado });
  } catch (err) {
    if (!(err instanceof ErrorRutas)) console.error("[rutas]", err);
    ctx.postMessage({ tipo: "error", mensaje: err instanceof ErrorRutas ? err.message : "No se pudieron armar las rutas." });
  }
};

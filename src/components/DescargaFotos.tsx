"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";
import { cicloDePdv } from "@/lib/ciclosPdv";
import { ZipSimple } from "@/lib/zipSimple";
import { EXTENSION_IMAGEN, nombreArchivo, tipoImagen, type FotoZip } from "@/lib/fotosZip";
import type { FilaImagen, Revision } from "@/lib/imagenesAuditoria";
import { cifra, megas } from "./ConsultaAthena";

/**
 * Descarga masiva de fotos en un ZIP, armado en el navegador: cada foto en su
 * carpeta y con su nombre (los decide quien llama: las galerías de las
 * auditorías, por ciclo del PDV; el Exportador de fotos, por la plantilla), y
 * un indice.xlsx con qué archivo es cada una y las que no se pudieron bajar.
 *
 * Cada foto se intenta bajar directo del servidor de fotos. Si ese servidor
 * no deja que otra página lea sus fotos (CORS), se piden a /api/admin/foto,
 * que las trae desde el servidor del panel. Se prueba con la primera foto de
 * cada servidor y lo que salga vale para las demás.
 *
 * Las fotos se guardan sin comprimir. Para no llenar la memoria, al pasar de
 * 400 MB se entrega esa parte y se sigue con otra (…_parte2.zip).
 */

const LIMITE_PARTE = 400 * 1024 * 1024;
const A_LA_VEZ = 6;
/** Una foto bajada directo que tarde más que esto se pide por el servidor. */
const ESPERA_DIRECTA = 30_000;

export type EstadoZip =
  | { tipo: "quieto" }
  | { tipo: "bajando"; hechas: number; total: number; bytes: number; partes: number }
  | { tipo: "listo"; fotos: number; fallidas: number; sinEnlace: number; partes: string[]; detenido: boolean }
  | { tipo: "error"; mensaje: string };

type Bajada = { ok: true; datos: Uint8Array; tipo: string } | { ok: false; motivo: string };

function entregar(blob: Blob, nombre: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 120_000);
}

/**
 * Directo del servidor de fotos. "cors": el navegador no la dejó leer (o no
 * respondió); "http": respondió, pero con un error o algo que no es imagen.
 */
async function bajarDirecto(url: string): Promise<{ datos: Uint8Array; tipo: string } | "cors" | "http"> {
  let r: Response;
  try {
    r = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(ESPERA_DIRECTA),
    });
  } catch {
    return "cors";
  }
  if (!r.ok) return "http";
  try {
    const datos = new Uint8Array(await r.arrayBuffer());
    const tipo = tipoImagen(datos);
    return tipo ? { datos, tipo } : "http";
  } catch {
    return "cors";
  }
}

/** Por el servidor del panel, con un reintento si el error pudo ser pasajero. */
async function bajarPorServidor(url: string): Promise<Bajada> {
  let motivo = "";
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(`/api/admin/foto?url=${encodeURIComponent(url)}`);
      if (r.ok) return { ok: true, datos: new Uint8Array(await r.arrayBuffer()), tipo: r.headers.get("content-type") ?? "" };
      motivo = (await r.json().catch(() => ({})))?.error ?? `respondió ${r.status}`;
      if (r.status !== 502) break; // solo se reintenta lo que pudo ser pasajero
    } catch {
      motivo = "se perdió la conexión";
    }
  }
  return { ok: false, motivo };
}

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function useDescargaFotos() {
  const [estado, setEstado] = useState<EstadoZip>({ tipo: "quieto" });
  const vuelta = useRef(0);

  /**
   * Arma el ZIP con esas fotos. `base` es el nombre del archivo (sin .zip) y
   * `encabezado`, los títulos de las columnas propias del índice (las de
   * FotoZip.indice), que van entre «archivo» y «estado».
   */
  async function descargar(fotos: FotoZip[], base: string, encabezado: string[]) {
    const id = ++vuelta.current;
    const vigente = () => vuelta.current === id;

    const conEnlace = fotos.map((x, i) => ({ x, i })).filter(({ x }) => x.url);
    const total = conEnlace.length;
    if (total === 0) return;
    const archivoBase = nombreArchivo(base).replace(/ /g, "_");

    let zip = new ZipSimple();
    let parte = 1;
    const partes: string[] = [];
    let usados = new Set<string>();
    let carpetas = new Set<string>();
    /** Una fila por foto, en el orden en que llegaron (no en el que se bajaron). */
    const indice: (string | number | null)[][] = new Array(fotos.length);
    let hechas = 0;
    let bytes = 0;
    let fallidas = 0;
    /** Por servidor de fotos: si se deja leer directo. */
    const directo = new Map<string, Promise<boolean>>();

    const nombreParte = () => `${archivoBase}${parte > 1 ? `_parte${parte}` : ""}.zip`;
    const cerrarParte = () => {
      if (zip.cantidad === 0) return;
      const nombre = nombreParte();
      entregar(zip.cerrar(), nombre);
      partes.push(nombre);
      zip = new ZipSimple();
      usados = new Set();
      carpetas = new Set();
      parte++;
    };

    const fila = (i: number, archivo: string | null, estadoFoto: string) => {
      const x = fotos[i];
      indice[i] = [archivo ? parte : null, x.carpeta || null, archivo, ...x.indice, estadoFoto];
    };

    async function bajar(url: string): Promise<Bajada> {
      const host = hostDe(url);
      const decidido = directo.get(host);
      if (decidido === undefined) {
        // La primera foto de este servidor decide por las demás.
        let decidir!: (v: boolean) => void;
        directo.set(host, new Promise<boolean>((r) => (decidir = r)));
        const d = await bajarDirecto(url);
        decidir(d !== "cors");
        if (typeof d === "object") return { ok: true, ...d };
      } else if (await decidido) {
        const d = await bajarDirecto(url);
        if (typeof d === "object") return { ok: true, ...d };
      }
      return bajarPorServidor(url);
    }

    fotos.forEach((x, i) => {
      if (!x.url) fila(i, null, x.motivo ?? "Sin enlace de foto");
    });

    setEstado({ tipo: "bajando", hechas, total, bytes, partes: 0 });
    let siguiente = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(A_LA_VEZ, total) }, async () => {
          while (siguiente < total && vigente()) {
            const { x, i } = conEnlace[siguiente++];
            const b = await bajar(x.url!);
            if (!vigente()) return;
            if (b.ok) {
              if (zip.tamano + b.datos.length > LIMITE_PARTE && zip.cantidad > 0) cerrarParte();
              const carpeta = x.carpeta ? `${x.carpeta}/` : "";
              // Cada nivel de la ruta con su propia entrada («CICLO 1/» y «CICLO 1/PDV/»).
              const niveles = x.carpeta ? x.carpeta.split("/") : [];
              niveles.forEach((_, n) => {
                const ruta = niveles.slice(0, n + 1).join("/");
                if (!carpetas.has(ruta)) {
                  zip.agregarCarpeta(ruta);
                  carpetas.add(ruta);
                }
              });
              const extension = EXTENSION_IMAGEN[b.tipo] ?? "jpg";
              let nombre = `${x.nombre}.${extension}`;
              for (let n = 2; usados.has(`${carpeta}${nombre}`.toLowerCase()); n++) nombre = `${x.nombre} (${n}).${extension}`;
              usados.add(`${carpeta}${nombre}`.toLowerCase());
              const fecha = x.fecha && !Number.isNaN(x.fecha.getTime()) ? x.fecha : new Date();
              zip.agregar(`${carpeta}${nombre}`, b.datos, fecha);
              bytes += b.datos.length;
              fila(i, nombre, "Descargada");
            } else {
              fallidas++;
              fila(i, null, `No se pudo descargar: ${b.motivo}`);
            }
            hechas++;
            setEstado({ tipo: "bajando", hechas, total, bytes, partes: partes.length });
          }
        })
      );
      if (!vigente()) return;

      // El índice va en la última parte: qué archivo es cada foto, y las que no se bajaron.
      const filas = indice.filter(Boolean);
      const titulos = ["parte", "carpeta", "archivo", ...encabezado, "estado"];
      const hoja = XLSX.utils.aoa_to_sheet([titulos, ...filas]);
      hoja["!cols"] = titulos.map((t, c) => ({
        wch: Math.min(60, Math.max(t.length + 2, ...filas.slice(0, 500).map((f) => String(f[c] ?? "").length + 1))),
      }));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, "Fotos");
      zip.agregar("indice.xlsx", new Uint8Array(XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
      cerrarParte();
      setEstado({ tipo: "listo", fotos: hechas - fallidas, fallidas, sinEnlace: fotos.length - total, partes, detenido: false });
    } catch (e) {
      if (vigente()) setEstado({ tipo: "error", mensaje: `No se pudo armar el ZIP: ${(e as Error).message}` });
    }
  }

  function detener() {
    vuelta.current++;
    setEstado((e) =>
      e.tipo === "bajando" ? { tipo: "listo", fotos: 0, fallidas: 0, sinEnlace: 0, partes: [], detenido: true } : { tipo: "quieto" }
    );
  }

  return { estado, descargar, detener, cerrar: () => setEstado({ tipo: "quieto" }) };
}

// ------------------------------------------------------- galerías de fotos

const NOMBRE_REVISION = { correcta: "Correcta", revisar: "Para revisar" } as const;

/** Las columnas del índice en las galerías (después de parte, carpeta y archivo). */
export const ENCABEZADO_VISITAS = ["pdv", "codigo", "consultor", "fecha", "revision", "enlace"];

const fechaDe = (f: FilaImagen) => (f.dia ? `${f.dia}${f.hora ? `_${f.hora.replace(":", "h")}` : ""}` : "sin fecha");

/**
 * Las fotos de las visitas de una galería: carpeta por el ciclo del PDV (por el
 * prefijo de su nombre, lib/ciclosPdv.ts) y nombre con el PDV, el código y la
 * fecha, «PLT-CHAPARRO_10737539_2026-09-15_17h26», con «_foto2» si la visita
 * trae varias.
 */
export function fotosDeVisitas<F extends FilaImagen>(visitas: F[], revisionDe: (f: F) => Revision | null): FotoZip[] {
  return visitas.flatMap((f) => {
    const r = revisionDe(f);
    const raiz = nombreArchivo(
      [(f.nombre_pdv ?? "").trim() || "PDV sin nombre", (f.cod_personalizado ?? "").trim() || "sin codigo", fechaDe(f)].join("_")
    );
    const fecha = f.dia ? new Date(`${f.dia}T${f.hora ?? "00:00"}:00`) : null;
    return f.fotos.map((url, i) => ({
      url,
      carpeta: cicloDePdv(f.nombre_pdv),
      nombre: raiz + (f.fotos.length > 1 ? `_foto${i + 1}` : ""),
      fecha,
      indice: [
        f.nombre_pdv,
        f.cod_personalizado,
        f.nombre_usuario,
        f.dia ? `${f.dia}${f.hora ? ` ${f.hora}` : ""}` : f.fecha_inicio,
        r ? NOMBRE_REVISION[r.estado] : null,
        url,
      ],
    }));
  });
}

/** El avance de la descarga, debajo del encabezado. */
export function ProgresoDescargaFotos({
  estado,
  onDetener,
  onCerrar,
}: {
  estado: EstadoZip;
  onDetener: () => void;
  onCerrar: () => void;
}) {
  if (estado.tipo === "quieto") return null;

  if (estado.tipo === "bajando") {
    return (
      <section aria-label="Descarga de fotos" className="tarjeta space-y-2 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="cifras flex items-center gap-2 text-[13px]" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Descargando fotos… {cifra(estado.hechas)} de {cifra(estado.total)} · {megas(estado.bytes)}
            {estado.partes > 0 && ` · ${estado.partes} ${estado.partes === 1 ? "parte entregada" : "partes entregadas"}`}
          </p>
          <button type="button" onClick={onDetener} className="boton boton-secundario boton-chico">
            Detener
          </button>
        </div>
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-relleno)]" aria-hidden>
          <span
            className="block h-full bg-[var(--color-tinta)] transition-[width]"
            style={{ width: `${estado.total ? (estado.hechas / estado.total) * 100 : 0}%` }}
          />
        </span>
        <p className="text-xs text-[var(--color-tinta-suave)]">
          No cierres esta pestaña hasta que termine. Si son muchas fotos, el ZIP sale por partes de 400 MB.
        </p>
      </section>
    );
  }

  const error = estado.tipo === "error";
  const texto =
    estado.tipo === "error"
      ? estado.mensaje
      : estado.detenido
        ? "Se detuvo la descarga. Las partes que ya salieron quedaron en tus descargas."
        : `Listo: ${cifra(estado.fotos)} ${estado.fotos === 1 ? "foto" : "fotos"} en ${
            estado.partes.length === 1
              ? estado.partes[0]
              : estado.partes.length === 2
                ? `2 archivos (${estado.partes.join(" y ")})`
                : `${estado.partes.length} archivos, de ${estado.partes[0]} a ${estado.partes[estado.partes.length - 1]}`
          }.${
            estado.fallidas > 0
              ? ` ${cifra(estado.fallidas)} no se ${estado.fallidas === 1 ? "pudo" : "pudieron"} descargar: están en indice.xlsx con el motivo.`
              : ""
          }${
            estado.sinEnlace > 0
              ? ` ${cifra(estado.sinEnlace)} ${estado.sinEnlace === 1 ? "fila no tenía" : "filas no tenían"} enlace de foto; también ${estado.sinEnlace === 1 ? "está" : "están"} en el índice.`
              : ""
          }`;
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
        error || (estado.tipo === "listo" && estado.fallidas > 0)
          ? "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]"
          : "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
      }`}
    >
      {error ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />}
      <span className="flex-1">{texto}</span>
      <button type="button" onClick={onCerrar} aria-label="Cerrar el aviso" className="shrink-0">
        <X size={14} aria-hidden />
      </button>
    </p>
  );
}

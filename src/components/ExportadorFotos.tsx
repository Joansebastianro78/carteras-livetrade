"use client";

import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FolderClosed, FolderDown, Loader2, TriangleAlert, Upload } from "lucide-react";
import {
  detectarColumnas,
  encabezadoIndice,
  ErrorPlantilla,
  fotosDe,
  fotosParaZip,
  leerPlantilla,
  nombreZip,
  resumirCarpetas,
  type Carpetas,
  type ColumnasExportador,
  type PlantillaFotos,
} from "@/lib/exportadorFotos";
import { ProgresoDescargaFotos, useDescargaFotos } from "./DescargaFotos";

/**
 * Exportador de fotos: se sube una plantilla de Excel con el enlace de la foto
 * de cada fila y se baja un ZIP con las fotos en una carpeta por ciclo (la
 * columna CICLO, o el prefijo del PDV: PLT-, BV1-…), cada una con el nombre
 * del PDV y su código, y un indice.xlsx. La plantilla se lee en el navegador
 * y no se sube a ningún lado; las fotos se bajan como en las galerías de las
 * auditorías (components/DescargaFotos.tsx).
 */

const cifra = (n: number) => n.toLocaleString("es-CO");

const valorCarpetas = (c: Carpetas) => (c.tipo === "columna" ? `col:${c.col}` : c.tipo);
function leerCarpetas(v: string): Carpetas {
  if (v.startsWith("col:")) return { tipo: "columna", col: Number(v.slice(4)) };
  return v === "prefijo" ? { tipo: "prefijo" } : { tipo: "ninguna" };
}

export default function ExportadorFotos() {
  const [plantilla, setPlantilla] = useState<PlantillaFotos | null>(null);
  const [columnas, setColumnas] = useState<ColumnasExportador | null>(null);
  const [fuera, setFuera] = useState<Set<string>>(() => new Set());
  const [leyendo, setLeyendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const zip = useDescargaFotos();
  const bajando = zip.estado.tipo === "bajando";

  async function leer(origen: File | PlantillaFotos, hoja?: string) {
    const nombre = origen instanceof File ? origen.name : origen.nombre;
    setLeyendo(nombre);
    setError(null);
    try {
      const p = await leerPlantilla(
        origen instanceof File ? origen : { name: origen.nombre, arrayBuffer: async () => origen.datos },
        hoja
      );
      const col = detectarColumnas(p);
      if (!col) {
        throw new ErrorPlantilla(
          `Ninguna columna de la hoja «${p.hoja}» trae enlaces de fotos (que empiecen por http:// o https://).`
        );
      }
      setPlantilla(p);
      setColumnas(col);
      setFuera(new Set());
      zip.cerrar();
    } catch (e) {
      if (!(e instanceof ErrorPlantilla)) console.error("[exportador plantilla]", e);
      setError(e instanceof ErrorPlantilla ? e.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(null);
    }
  }

  const carpetas = useMemo(() => (plantilla && columnas ? resumirCarpetas(plantilla, columnas) : []), [plantilla, columnas]);
  const elegidas = carpetas.filter((c) => !fuera.has(c.carpeta));
  const fotosElegidas = elegidas.reduce((n, c) => n + c.fotos, 0);
  const sinEnlace = elegidas.reduce((n, c) => n + c.sinEnlace, 0);

  /** Cuántas filas traen enlace en cada columna, para elegir la de la foto. */
  const enlacesPorColumna = useMemo(
    () => plantilla?.encabezados.map((_, c) => plantilla.filas.reduce((n, f) => n + (fotosDe(f, c).length ? 1 : 0), 0)) ?? [],
    [plantilla]
  );

  function cambiar(cambios: Partial<ColumnasExportador>) {
    if (!columnas) return;
    const nuevas = { ...columnas, ...cambios };
    nuevas.nombre = nuevas.nombre.filter((c) => c !== nuevas.foto);
    setColumnas(nuevas);
    setFuera(new Set());
  }

  function alternarNombre(c: number) {
    if (!columnas) return;
    const nombre = columnas.nombre.includes(c) ? columnas.nombre.filter((x) => x !== c) : [...columnas.nombre, c];
    setColumnas({ ...columnas, nombre });
  }

  function alternarCarpeta(carpeta: string) {
    setFuera((s) => {
      const n = new Set(s);
      if (n.has(carpeta)) n.delete(carpeta);
      else n.add(carpeta);
      return n;
    });
  }

  function descargar() {
    if (!plantilla || !columnas || fotosElegidas === 0) return;
    zip.descargar(fotosParaZip(plantilla, columnas, fuera), nombreZip(plantilla.nombre), encabezadoIndice(plantilla));
  }

  const ejemplo = carpetas.find((c) => !fuera.has(c.carpeta) && c.ejemplo);
  const archivoZip = plantilla ? `${nombreZip(plantilla.nombre).replace(/ /g, "_")}.zip` : null;

  return (
    <div className="space-y-5">
      <ProgresoDescargaFotos estado={zip.estado} onDetener={zip.detener} onCerrar={zip.cerrar} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {/* ------------------------------------------------ plantilla */}
          <section aria-labelledby="exportador-archivo" className="tarjeta p-5">
            <h2 id="exportador-archivo" className="rotulo">
              1 · Plantilla
            </h2>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                const f = e.dataTransfer.files?.[0];
                if (f && !bajando) leer(f);
              }}
              className={`mt-3 rounded-[6px] border-2 border-dashed px-4 py-6 text-center ${
                arrastrando ? "border-[var(--color-tinta)] bg-[var(--color-seleccion)]" : "border-[var(--color-linea)]"
              }`}
            >
              <FileSpreadsheet size={26} className="mx-auto text-[var(--color-tinta-suave)]" aria-hidden />
              <p className="mt-2 text-[14px] font-medium [overflow-wrap:anywhere]">{plantilla ? plantilla.nombre : "Arrastra el Excel aquí"}</p>
              <p className="mt-1 text-[12.5px] text-[var(--color-tinta-suave)]">
                Títulos en la fila 1 y el enlace de la foto en una columna. El archivo no sale de tu computador.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="sr-only"
                aria-label="Elegir la plantilla de fotos"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) leer(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={leyendo !== null || bajando}
                onClick={() => inputRef.current?.click()}
                className={`boton mt-4 ${plantilla ? "boton-secundario" : "boton-primario"}`}
              >
                {leyendo ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
                {leyendo ? `Leyendo ${leyendo}…` : plantilla ? "Cambiar archivo" : "Elegir archivo"}
              </button>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-[6px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] text-[var(--color-alerta)]"
              >
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            {plantilla && columnas && (
              <div className="mt-4 space-y-3">
                {plantilla.hojas.length > 1 && (
                  <div>
                    <label htmlFor="exportador-hoja" className="campo-etiqueta">
                      Hoja
                    </label>
                    <select
                      id="exportador-hoja"
                      value={plantilla.hoja}
                      disabled={bajando}
                      onChange={(e) => leer(plantilla, e.target.value)}
                      className="campo"
                    >
                      {plantilla.hojas.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <dl className="grid grid-cols-3 gap-2 text-[13px]" aria-label="Filas de la plantilla">
                  <div className="rounded-[6px] bg-[var(--color-relleno)] px-3 py-2">
                    <dt className="text-[var(--color-tinta-suave)]">Filas</dt>
                    <dd className="cifras text-[18px] font-semibold">{cifra(plantilla.filas.length)}</dd>
                  </div>
                  <div className="rounded-[6px] bg-[var(--color-relleno)] px-3 py-2">
                    <dt className="text-[var(--color-tinta-suave)]">Con foto</dt>
                    <dd className="cifras text-[18px] font-semibold">{cifra(enlacesPorColumna[columnas.foto] ?? 0)}</dd>
                  </div>
                  <div className="rounded-[6px] bg-[var(--color-relleno)] px-3 py-2">
                    <dt className="text-[var(--color-tinta-suave)]">Sin enlace</dt>
                    <dd className="cifras text-[18px] font-semibold">
                      {cifra(plantilla.filas.length - (enlacesPorColumna[columnas.foto] ?? 0))}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </section>

          {/* ------------------------------------------------ cómo se arma */}
          {plantilla && columnas && (
            <section aria-labelledby="exportador-armado" className="tarjeta space-y-4 p-5">
              <h2 id="exportador-armado" className="rotulo">
                2 · Carpetas y nombres
              </h2>
              <div>
                <label htmlFor="exportador-foto" className="campo-etiqueta">
                  Enlace de la foto
                </label>
                <select
                  id="exportador-foto"
                  value={columnas.foto}
                  disabled={bajando}
                  onChange={(e) => cambiar({ foto: Number(e.target.value) })}
                  className="campo"
                >
                  {plantilla.encabezados.map((t, c) =>
                    enlacesPorColumna[c] > 0 ? (
                      <option key={c} value={c}>
                        {t} ({cifra(enlacesPorColumna[c])} con enlace)
                      </option>
                    ) : null
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="exportador-carpetas" className="campo-etiqueta">
                  Una carpeta por
                </label>
                <select
                  id="exportador-carpetas"
                  value={valorCarpetas(columnas.carpetas)}
                  disabled={bajando}
                  onChange={(e) => cambiar({ carpetas: leerCarpetas(e.target.value) })}
                  className="campo"
                >
                  {plantilla.encabezados.map((t, c) =>
                    c === columnas.foto ? null : (
                      <option key={c} value={`col:${c}`}>
                        {t}
                      </option>
                    )
                  )}
                  {columnas.pdv !== null && (
                    <option value="prefijo">Ciclo según el prefijo de {plantilla.encabezados[columnas.pdv]} (PLT-, BV1-…)</option>
                  )}
                  <option value="ninguna">Sin carpetas: todas juntas</option>
                </select>
                <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[13.5px] leading-snug">
                  <input
                    type="checkbox"
                    checked={columnas.carpetaPorPdv}
                    disabled={bajando}
                    onChange={(e) => setColumnas({ ...columnas, carpetaPorPdv: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-tinta)]"
                  />
                  <span>
                    {columnas.carpetas.tipo === "ninguna" ? "Una carpeta por PDV" : "Y adentro, una carpeta por PDV"}, con su foto
                    <span className="block text-[12.5px] text-[var(--color-tinta-suave)]">
                      Se llama como la foto; si dos filas son el mismo PDV, sus fotos quedan juntas.
                    </span>
                  </span>
                </label>
              </div>
              <fieldset>
                <legend className="campo-etiqueta">Nombre de cada foto</legend>
                <div className="flex flex-wrap gap-1.5">
                  {plantilla.encabezados.map((t, c) =>
                    c === columnas.foto ? null : (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={columnas.nombre.includes(c)}
                        disabled={bajando}
                        onClick={() => alternarNombre(c)}
                        className="chip"
                      >
                        {t}
                      </button>
                    )
                  )}
                </div>
                <p className="mt-2 text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
                  {columnas.nombre.length === 0
                    ? "Sin columnas, cada foto se llama con su número de fila."
                    : "En el orden en que las marques, unidas con «_»; lo que ya está en el nombre no se repite."}
                  {ejemplo?.ejemplo && (
                    <>
                      {" "}
                      Por ejemplo:{" "}
                      <span className="font-medium text-[var(--color-tinta)] [overflow-wrap:anywhere]">
                        {ejemplo.ejemplo.split("/").pop()}.jpg
                      </span>
                    </>
                  )}
                </p>
              </fieldset>
              <button
                type="button"
                onClick={descargar}
                disabled={bajando || fotosElegidas === 0}
                className="boton boton-primario w-full justify-center"
              >
                {bajando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FolderDown size={16} aria-hidden />}
                Descargar ZIP ({cifra(fotosElegidas)} {fotosElegidas === 1 ? "foto" : "fotos"})
              </button>
              <p className="text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
                El ZIP se arma en tu navegador: deja la pestaña abierta hasta que termine. Si pasa de 400 MB, sale por partes.
              </p>
            </section>
          )}
        </div>

        {/* ------------------------------------------------ vista previa */}
        <section aria-labelledby="exportador-zip" className="tarjeta min-w-0 p-5">
          <h2 id="exportador-zip" className="rotulo">
            Así queda el ZIP
          </h2>
          {!plantilla || !columnas ? (
            <p className="mt-3 max-w-prose text-[13.5px] leading-relaxed text-[var(--color-tinta-suave)]">
              Sube la plantilla y aquí salen las carpetas, cuántas fotos van en cada una y cómo se llaman. Con una columna CICLO
              (o el nombre del PDV empezando por PLT-, BV1-, BV2-1-…) las fotos quedan separadas por ciclo, y dentro de cada
              ciclo, una carpeta por PDV con su foto.
            </p>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-2 text-[14px] font-medium [overflow-wrap:anywhere]">
                <FolderDown size={16} className="shrink-0 text-[var(--color-tinta-suave)]" aria-hidden />
                {archivoZip}
              </p>
              <ul className="mt-3 divide-y divide-[var(--color-linea)] border-y border-[var(--color-linea)]" aria-label="Carpetas del ZIP">
                {carpetas.map((c, i) => {
                  const dentro = !fuera.has(c.carpeta);
                  const id = `exportador-carpeta-${i}`;
                  return (
                    <li key={c.carpeta} className={`flex items-start gap-3 py-2.5 ${dentro ? "" : "opacity-55"}`}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={dentro}
                        disabled={bajando}
                        onChange={() => alternarCarpeta(c.carpeta)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-tinta)]"
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="flex items-center gap-1.5 text-[14px] font-medium">
                            <FolderClosed size={15} className="shrink-0 text-[var(--color-tinta-suave)]" aria-hidden />
                            {c.carpeta || "Sin carpeta (la raíz del ZIP)"}
                          </span>
                          <span className="cifras text-[13px]">
                            {cifra(c.fotos)} {c.fotos === 1 ? "foto" : "fotos"}
                          </span>
                          {c.pdvs > 0 && (
                            <span className="cifras text-[12.5px] text-[var(--color-tinta-suave)]">
                              en {cifra(c.pdvs)} {c.pdvs === 1 ? "carpeta de PDV" : "carpetas de PDV"}
                            </span>
                          )}
                          {c.sinEnlace > 0 && (
                            <span className="cifras text-[12.5px] text-[var(--color-tinta-suave)]">{cifra(c.sinEnlace)} sin enlace</span>
                          )}
                        </span>
                        {c.ejemplo && (
                          <span className="mt-0.5 block truncate text-[12.5px] text-[var(--color-tinta-suave)]">{c.ejemplo}.jpg</span>
                        )}
                      </label>
                    </li>
                  );
                })}
                <li className="flex items-start gap-3 py-2.5">
                  <span className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] font-medium">
                      <FileSpreadsheet size={15} className="shrink-0 text-[var(--color-tinta-suave)]" aria-hidden />
                      indice.xlsx
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--color-tinta-suave)]">
                      Una fila por foto, con las columnas de la plantilla, la carpeta, el archivo y si se descargó. Las filas sin
                      enlace también van, con lo que traía la celda.
                    </span>
                  </span>
                </li>
              </ul>
              <p className="cifras mt-3 text-[13px] text-[var(--color-tinta-suave)]">
                {cifra(fotosElegidas)} {fotosElegidas === 1 ? "foto" : "fotos"} en {cifra(elegidas.length)}{" "}
                {elegidas.length === 1 ? "carpeta" : "carpetas"}
                {sinEnlace > 0 && `; ${cifra(sinEnlace)} ${sinEnlace === 1 ? "fila" : "filas"} sin enlace de foto`}
                {fuera.size > 0 && `. Quitaste ${cifra(fuera.size)} ${fuera.size === 1 ? "carpeta" : "carpetas"}.`}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

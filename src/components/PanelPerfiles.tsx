"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Lock, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { MODULOS, SUPERADMIN, type IdModulo, type Modulo } from "@/lib/permisos";
import { cuando } from "@/lib/fechas";
import type { Navegacion } from "./PanelShell";

/**
 * Perfiles y permisos: la lista de perfiles a un lado y, al elegir uno, qué
 * módulos ve, con una casilla por módulo. La API vuelve a validar todo
 * (src/app/api/admin/perfiles); aquí solo se desactiva lo que va a fallar.
 */

type Perfil = {
  clave: string;
  nombre: string;
  descripcion: string | null;
  modulos: IdModulo[];
  sistema: boolean;
  actualizado_por: string | null;
  updated_at: string | null;
  usuarios: number;
  activos: number;
};

type Borrador = { nombre: string; descripcion: string; modulos: IdModulo[] };

const NUEVO = "__nuevo__";
const VACIO: Borrador = { nombre: "", descripcion: "", modulos: [] };

/** El catálogo agrupado como en el menú. */
const GRUPOS = MODULOS.reduce<{ grupo: string; modulos: Modulo[] }[]>((lista, m) => {
  const g = lista.find((x) => x.grupo === m.grupo);
  if (g) g.modulos.push(m);
  else lista.push({ grupo: m.grupo, modulos: [m] });
  return lista;
}, []);

function borradorDe(p: Perfil): Borrador {
  return { nombre: p.nombre, descripcion: p.descripcion ?? "", modulos: [...p.modulos] };
}

function iguales(a: Borrador, b: Borrador): boolean {
  return (
    a.nombre.trim() === b.nombre.trim() &&
    a.descripcion.trim() === b.descripcion.trim() &&
    a.modulos.length === b.modulos.length &&
    a.modulos.every((m) => b.modulos.includes(m))
  );
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export default function PanelPerfiles({ nav }: { nav: Navegacion }) {
  const [perfiles, setPerfiles] = useState<Perfil[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [miPerfil, setMiPerfil] = useState("");
  const [misModulos, setMisModulos] = useState<IdModulo[]>([]);

  const [elegido, setElegido] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(VACIO);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState<"guardar" | "borrar" | null>(null);
  const editor = useRef<HTMLDivElement>(null);

  /** Lee la lista. Con `seleccionar`, deja ese perfil abierto (null: ninguno). */
  const cargar = useCallback(async (seleccionar?: string | null) => {
    const r = await fetch("/api/admin/perfiles");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErrorCarga(j.error ?? "No se pudieron leer los perfiles.");
      setPerfiles((antes) => antes ?? []);
      return;
    }
    const lista = (j.perfiles ?? []) as Perfil[];
    setPerfiles(lista);
    setSinTabla(Boolean(j.sinTabla));
    setErrorCarga(j.sinTabla ? null : (j.aviso ?? null));
    setMiPerfil(j.miPerfil ?? "");
    setMisModulos(j.misModulos ?? []);
    if (seleccionar !== undefined) {
      const p = lista.find((x) => x.clave === seleccionar);
      setElegido(p ? p.clave : null);
      setBorrador(p ? borradorDe(p) : VACIO);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const esNuevo = elegido === NUEVO;
  const perfil = !esNuevo && elegido ? (perfiles?.find((p) => p.clave === elegido) ?? null) : null;
  const fijo = perfil?.clave === SUPERADMIN;
  const propio = perfil !== null && perfil.clave === miPerfil;
  const soySuper = miPerfil === SUPERADMIN;
  /** Solo se dan o quitan módulos que uno también tiene. */
  const puedoTocar = (m: IdModulo) => soySuper || misModulos.includes(m);
  const modulosBloqueados = sinTabla || fijo || propio;
  const datosBloqueados = sinTabla || fijo;

  const original = useMemo(() => (esNuevo ? VACIO : perfil ? borradorDe(perfil) : null), [esNuevo, perfil]);
  const sucio = original !== null && !iguales(borrador, original);

  function elegir(clave: string) {
    if (clave === elegido) return;
    if (sucio && !confirm("Tienes cambios sin guardar en este perfil. ¿Descartarlos?")) return;
    const p = perfiles?.find((x) => x.clave === clave);
    setMensaje(null);
    setElegido(clave);
    setBorrador(clave === NUEVO ? VACIO : p ? borradorDe(p) : VACIO);
    // En el celular el editor queda debajo de la lista: se baja hasta él.
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) {
        editor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function alternar(m: IdModulo) {
    setBorrador((b) => ({
      ...b,
      modulos: b.modulos.includes(m) ? b.modulos.filter((x) => x !== m) : [...b.modulos, m],
    }));
  }

  /** Marca o quita todos los que uno puede tocar; los demás quedan como estaban. */
  function todos(marcar: boolean) {
    setBorrador((b) => ({
      ...b,
      modulos: marcar
        ? [...new Set([...b.modulos, ...MODULOS.map((m) => m.id).filter(puedoTocar)])]
        : b.modulos.filter((m) => !puedoTocar(m)),
    }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (trabajando) return;
    setTrabajando("guardar");
    setMensaje(null);

    const cuerpo = esNuevo
      ? { nombre: borrador.nombre, descripcion: borrador.descripcion, modulos: borrador.modulos }
      : {
          clave: perfil?.clave,
          nombre: borrador.nombre,
          descripcion: borrador.descripcion,
          ...(modulosBloqueados ? {} : { modulos: borrador.modulos }),
        };

    try {
      const r = await fetch("/api/admin/perfiles", {
        method: esNuevo ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMensaje({ tipo: "mal", texto: j.error ?? "No se pudo guardar el perfil." });
        return;
      }

      const nombre: string = j.perfil?.nombre ?? borrador.nombre.trim();
      let texto: string;
      if (esNuevo) {
        texto = `Se creó el perfil «${nombre}».${
          nav.puede("usuarios") ? " Ya lo puedes asignar a alguien en Administradores." : ""
        }`;
      } else if (j.sinCambios) {
        texto = "No había cambios para guardar.";
      } else {
        texto = `Se guardó «${nombre}».${
          perfil && perfil.activos > 0
            ? " A quienes lo tienen les llega en menos de un minuto; el menú se les actualiza al recargar la página."
            : ""
        }`;
      }
      await cargar(j.perfil?.clave ?? perfil?.clave ?? null);
      setMensaje({ tipo: "ok", texto });
    } catch {
      setMensaje({ tipo: "mal", texto: "No hay conexión con el servidor." });
    } finally {
      setTrabajando(null);
    }
  }

  async function borrar() {
    if (!perfil || trabajando) return;
    if (!confirm(`¿Borrar el perfil «${perfil.nombre}»? No se puede deshacer.`)) return;
    setTrabajando("borrar");
    setMensaje(null);
    try {
      const r = await fetch("/api/admin/perfiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave: perfil.clave }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMensaje({ tipo: "mal", texto: j.error ?? "No se pudo borrar el perfil." });
        return;
      }
      await cargar(null);
      setErrorCarga(null);
      setMensaje({ tipo: "ok", texto: `Se borró el perfil «${perfil.nombre}».` });
    } catch {
      setMensaje({ tipo: "mal", texto: "No hay conexión con el servidor." });
    } finally {
      setTrabajando(null);
    }
  }

  const aviso = (m: { tipo: "ok" | "mal"; texto: string }) => (
    <p
      role="status"
      className={`rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
        m.tipo === "ok"
          ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
          : "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
      }`}
    >
      {m.texto}
    </p>
  );

  const marcados = fijo ? MODULOS.length : borrador.modulos.length;

  return (
    <div className="space-y-6">
      {sinTabla && (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-[6px] bg-[var(--color-aviso-fondo)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-aviso-tinta)]"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Falta la tabla de perfiles: ejecuta <b>supabase/perfiles.sql</b> en el SQL Editor de
            Supabase. Mientras tanto valen los tres perfiles de siempre, con sus permisos de siempre, y
            no se pueden cambiar.
          </span>
        </p>
      )}
      {errorCarga && aviso({ tipo: "mal", texto: errorCarga })}
      {/* Lo que pasó al borrar: el editor ya no está para mostrarlo. */}
      {!elegido && mensaje && aviso(mensaje)}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ------------------------------------------------------------ lista */}
        <section aria-labelledby="lista-perfiles" className="space-y-3">
          <div className="flex min-h-[36px] items-center justify-between gap-3">
            <h2 id="lista-perfiles" className="text-[15px] font-semibold">
              Perfiles
            </h2>
            <button
              type="button"
              onClick={() => elegir(NUEVO)}
              disabled={sinTabla || perfiles === null}
              className="boton boton-secundario boton-chico"
            >
              <Plus size={15} aria-hidden />
              Nuevo perfil
            </button>
          </div>

          {perfiles === null ? (
            <p className="flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
              <Loader2 size={15} className="animate-spin" aria-hidden />
              Cargando…
            </p>
          ) : (
            <ul className="tarjeta divide-y divide-[var(--color-linea)] overflow-hidden">
              {perfiles.map((p) => {
                const actual = p.clave === elegido;
                return (
                  <li key={p.clave}>
                    <button
                      type="button"
                      onClick={() => elegir(p.clave)}
                      aria-current={actual ? "true" : undefined}
                      className={`flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left ${
                        actual ? "bg-[var(--color-relleno)]" : "hover:bg-[var(--color-hover)]"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[14px] font-medium break-words">{p.nombre}</span>
                          {p.clave === SUPERADMIN ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-aviso-fondo)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-aviso-tinta)]">
                              <Lock size={10} aria-hidden />
                              Fijo
                            </span>
                          ) : (
                            p.sistema && (
                              <span className="rounded-full bg-[var(--color-relleno)] px-2 py-0.5 text-[11px] text-[var(--color-tinta-suave)]">
                                De siempre
                              </span>
                            )
                          )}
                          {p.clave === miPerfil && (
                            <span className="text-xs text-[var(--color-tinta-suave)]">tu perfil</span>
                          )}
                        </span>
                        <span className="cifras mt-0.5 block text-xs text-[var(--color-tinta-suave)]">
                          {p.clave === SUPERADMIN
                            ? "Todos los módulos"
                            : p.modulos.length === 0
                              ? "Sin módulos"
                              : `${p.modulos.length} de ${MODULOS.length} módulos`}
                          {" · "}
                          {p.usuarios === 0 ? "sin usuarios" : plural(p.usuarios, "usuario", "usuarios")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------------ editor */}
        <div ref={editor} className="scroll-mt-20">
          {elegido === null || (!esNuevo && !perfil) ? (
            <div className="tarjeta px-5 py-10 text-center text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
              Elige un perfil de la lista para ver y cambiar qué módulos ve, o crea uno nuevo.
            </div>
          ) : (
            <form onSubmit={guardar} aria-labelledby="titulo-perfil" className="tarjeta p-5 sm:p-6">
              <h2 id="titulo-perfil" className="text-[17px] font-semibold break-words">
                {esNuevo ? "Nuevo perfil" : perfil?.nombre}
              </h2>
              {perfil && (
                <p className="cifras mt-1 text-xs leading-relaxed text-[var(--color-tinta-suave)]">
                  {perfil.usuarios === 0
                    ? "Ningún usuario tiene este perfil."
                    : `Lo ${perfil.usuarios === 1 ? "tiene 1 usuario" : `tienen ${perfil.usuarios} usuarios`}${
                        perfil.activos < perfil.usuarios ? ` (${perfil.activos} activos)` : ""
                      }.`}
                  {perfil.updated_at && perfil.actualizado_por
                    ? ` Último cambio ${cuando(perfil.updated_at)} por ${perfil.actualizado_por}.`
                    : ""}
                </p>
              )}

              {fijo && (
                <p className="mt-4 flex items-start gap-2 rounded-[4px] bg-[var(--color-sutil)] px-3 py-2.5 text-[13px] leading-snug">
                  <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
                  Lo ve todo, también los módulos que se agreguen más adelante. Es fijo: no se puede
                  cambiar ni borrar.
                </p>
              )}
              {propio && !fijo && (
                <p className="mt-4 flex items-start gap-2 rounded-[4px] bg-[var(--color-sutil)] px-3 py-2.5 text-[13px] leading-snug">
                  <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
                  Es tu perfil: sus permisos te los cambia otra persona. El nombre y la descripción sí
                  los puedes cambiar.
                </p>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div>
                  <label htmlFor="perfil-nombre" className="campo-etiqueta">
                    Nombre
                  </label>
                  <input
                    id="perfil-nombre"
                    required
                    minLength={2}
                    maxLength={60}
                    placeholder="Coordinador regional"
                    value={borrador.nombre}
                    disabled={datosBloqueados}
                    onChange={(e) => setBorrador((b) => ({ ...b, nombre: e.target.value }))}
                    className="campo"
                  />
                </div>
                <div>
                  <label htmlFor="perfil-descripcion" className="campo-etiqueta">
                    Descripción <span className="font-normal text-[var(--color-tinta-suave)]">(opcional)</span>
                  </label>
                  <input
                    id="perfil-descripcion"
                    maxLength={300}
                    placeholder="Para qué es este perfil"
                    value={borrador.descripcion}
                    disabled={datosBloqueados}
                    onChange={(e) => setBorrador((b) => ({ ...b, descripcion: e.target.value }))}
                    className="campo"
                  />
                </div>
              </div>

              <fieldset className="mt-6">
                <legend className="text-[14px] font-semibold">
                  Módulos que ve{" "}
                  <span className="cifras font-normal text-[var(--color-tinta-suave)]">
                    · {marcados} de {MODULOS.length}
                  </span>
                </legend>
                {!modulosBloqueados && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button type="button" onClick={() => todos(true)} className="boton boton-secundario boton-chico">
                      Marcar todos
                    </button>
                    <button type="button" onClick={() => todos(false)} className="boton boton-secundario boton-chico">
                      Quitar todos
                    </button>
                  </div>
                )}

                <div className="mt-4 space-y-5">
                  {GRUPOS.map((g) => (
                    <div key={g.grupo}>
                      <p className="rotulo pb-2">{g.grupo}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {g.modulos.map((m) => {
                          const marcado = fijo || borrador.modulos.includes(m.id);
                          const ajeno = !puedoTocar(m.id);
                          const bloqueado = modulosBloqueados || ajeno;
                          return (
                            <label
                              key={m.id}
                              className={`flex gap-3 rounded-[4px] border p-3 ${
                                marcado
                                  ? "border-[var(--color-tinta)] bg-[var(--color-sutil)]"
                                  : "border-[var(--color-linea)]"
                              } ${bloqueado ? "cursor-not-allowed" : "cursor-pointer hover:border-[var(--color-tinta)]"}`}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                disabled={bloqueado}
                                onChange={() => alternar(m.id)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-tinta)]"
                              />
                              <span className={`min-w-0 ${bloqueado ? "opacity-75" : ""}`}>
                                <span className="block text-sm font-medium">{m.nombre}</span>
                                <span className="mt-0.5 block text-xs leading-snug text-[var(--color-tinta-suave)]">
                                  {m.detalle}
                                </span>
                                {ajeno && !modulosBloqueados && (
                                  <span className="mt-1 block text-xs font-medium text-[var(--color-aviso-tinta)]">
                                    Tu perfil no lo tiene: no lo puedes dar ni quitar.
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>

              {!modulosBloqueados && borrador.modulos.length === 0 && (
                <p className="mt-4 text-[13px] text-[var(--color-aviso-tinta)]">
                  Sin ningún módulo, quien tenga este perfil entra al panel y no ve nada.
                </p>
              )}

              {mensaje && <div className="mt-5">{aviso(mensaje)}</div>}

              {!fijo && (
                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--color-linea)] pt-5">
                  <button
                    type="submit"
                    disabled={sinTabla || trabajando !== null || (!esNuevo && !sucio) || borrador.nombre.trim().length < 2}
                    className="boton boton-primario"
                  >
                    {trabajando === "guardar" ? (
                      <Loader2 size={15} className="animate-spin" aria-hidden />
                    ) : esNuevo ? (
                      <Plus size={15} aria-hidden />
                    ) : (
                      <Save size={15} aria-hidden />
                    )}
                    {esNuevo ? "Crear perfil" : "Guardar cambios"}
                  </button>
                  {(esNuevo || sucio) && (
                    <button
                      type="button"
                      disabled={trabajando !== null}
                      onClick={() => {
                        setMensaje(null);
                        if (esNuevo) {
                          setElegido(null);
                          setBorrador(VACIO);
                        } else if (original) {
                          setBorrador(original);
                        }
                      }}
                      className="boton boton-secundario"
                    >
                      {esNuevo ? "Cancelar" : "Descartar cambios"}
                    </button>
                  )}

                  {perfil && !perfil.sistema && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:ml-auto">
                      {perfil.usuarios > 0 && (
                        <span className="text-xs text-[var(--color-tinta-suave)]">
                          {perfil.usuarios === 1
                            ? "Para borrarlo, primero cámbiale el perfil a su usuario."
                            : `Para borrarlo, primero cámbiales el perfil a sus ${perfil.usuarios} usuarios.`}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={borrar}
                        disabled={trabajando !== null || perfil.usuarios > 0 || propio}
                        className="boton boton-secundario text-[var(--color-alerta)]"
                      >
                        {trabajando === "borrar" ? (
                          <Loader2 size={15} className="animate-spin" aria-hidden />
                        ) : (
                          <Trash2 size={15} aria-hidden />
                        )}
                        Borrar perfil
                      </button>
                    </span>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

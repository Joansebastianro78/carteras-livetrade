"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, ShieldAlert, UserPlus } from "lucide-react";
import { cuando } from "@/lib/fechas";
import { MODULOS } from "@/lib/permisos";

/** La clave del perfil (tabla perfiles): superadmin, admin, backoffice o uno creado en el panel. */
type Rol = string;

type Admin = {
  id: number;
  usuario: string;
  nombre: string | null;
  rol: Rol | null;
  activo: boolean;
  ultimo_login: string | null;
  created_at: string;
};

/** Un perfil, tal como lo manda la API. asignable: si yo lo puedo dar. */
type OpcionPerfil = {
  clave: Rol;
  nombre: string;
  descripcion: string | null;
  modulos: string[];
  sistema: boolean;
  asignable: boolean;
};

const LARGO_MINIMO = 10;

/** Cómo se nombran los de siempre en una frase («Se creó X como administrador»). */
const EN_FRASE: Record<string, string> = {
  superadmin: "superadministrador",
  admin: "administrador",
  backoffice: "BackOffice",
};

/** Lo que diga la base; si viene vacío, administrador (así quedaban antes de los perfiles). */
function perfilDe(a: { rol: string | null }): Rol {
  return (a.rol ?? "").trim() || "admin";
}

/** El color de la pastilla del perfil en la lista. */
function colorPerfil(clave: Rol): string {
  if (clave === "backoffice") return "bg-[var(--color-info-fondo)] text-[var(--color-info-tinta)]";
  if (clave === "superadmin") return "bg-[var(--color-aviso-fondo)] text-[var(--color-aviso-tinta)]";
  if (clave === "admin") return "bg-[var(--color-morado-fondo)] text-[var(--color-morado-tinta)]";
  return "bg-[var(--color-relleno)] text-[var(--color-tinta)]";
}

/** "Inicio, Consultores y 3 más". */
function resumenModulos(p: OpcionPerfil): string {
  if (p.modulos.length === 0) return "Sin módulos: no ve nada del panel.";
  const nombres = p.modulos.map((m) => MODULOS.find((x) => x.id === m)?.nombre ?? m);
  if (nombres.length === MODULOS.length) return "Ve todos los módulos.";
  return `Ve ${nombres.length <= 4 ? nombres.join(", ") : `${nombres.slice(0, 3).join(", ")} y ${nombres.length - 3} más`}.`;
}

export default function AdminUsuarios() {
  const [lista, setLista] = useState<Admin[] | null>(null);
  const [perfiles, setPerfiles] = useState<OpcionPerfil[]>([]);
  const [yo, setYo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "mal"; texto: string } | null>(null);

  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [rol, setRol] = useState<Rol>("admin");
  const [verClave, setVerClave] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const campoClave = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const res = await fetch("/api/admin/usuarios");
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setLista(json.usuarios ?? []);
      setPerfiles(json.perfiles ?? []);
      setYo(json.yo ?? null);
    } else {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo leer la lista." });
    }
  }

  const existente = lista?.find((a) => a.usuario === usuario.trim().toLowerCase());
  const yaExiste = existente !== undefined;
  const asignables = perfiles.filter((p) => p.asignable);

  const nombrePerfil = (clave: Rol) => perfiles.find((p) => p.clave === clave)?.nombre ?? clave;
  const enFrase = (clave: Rol) => EN_FRASE[clave] ?? nombrePerfil(clave);

  // Al escribir un usuario que ya existe se precarga SU perfil: así cambiarle
  // la clave no lo asciende ni lo degrada sin querer.
  useEffect(() => {
    if (existente) setRol(perfilDe(existente));
  }, [existente]);

  // Si el perfil marcado no es uno que yo pueda dar, se marca el primero que sí.
  useEffect(() => {
    if (existente || perfiles.length === 0) return;
    if (!perfiles.some((p) => p.clave === rol && p.asignable)) {
      setRol(perfiles.find((p) => p.asignable)?.clave ?? "");
    }
  }, [perfiles, rol, existente]);

  /**
   * Al superadministrador solo lo toca otro superadministrador, y a los demás
   * quien tenga todos los módulos de su perfil. La API lo vuelve a validar;
   * esto es solo para no ofrecer botones que van a fallar.
   */
  function puedoTocar(a: Admin): boolean {
    return perfiles.find((p) => p.clave === perfilDe(a))?.asignable ?? false;
  }

  /** Carga a ese usuario en el formulario de abajo para cambiarle la clave. */
  function cambiarClave(a: Admin) {
    setAviso(null);
    setUsuario(a.usuario);
    setNombre(a.nombre ?? "");
    setRol(perfilDe(a));
    setClave("");
    setVerClave(false);
    campoClave.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    campoClave.current?.focus({ preventScroll: true });
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setAviso(null);

    const res = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, clave, nombre, rol }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo guardar." });
      return;
    }

    const comoRol = enFrase((json.rol as Rol) ?? rol);

    setAviso({
      tipo: "ok",
      texto: yaExiste
        ? `Se actualizó ${json.usuario}: clave nueva y perfil ${comoRol}.`
        : `Se creó ${json.usuario} como ${comoRol}. Entrégale la clave por un canal seguro: no se puede volver a consultar.`,
    });
    setUsuario("");
    setNombre("");
    setClave("");
    setVerClave(false);
    cargar();
  }

  const [cambiandoPerfil, setCambiandoPerfil] = useState<string | null>(null);

  /** Le cambia el perfil sin tocar su clave. */
  async function cambiarPerfil(a: Admin, nuevo: Rol) {
    const antes = perfilDe(a);
    if (nuevo === antes) return;
    const opcion = perfiles.find((p) => p.clave === nuevo);
    const aviso =
      nuevo === "superadmin"
        ? " Podrá tocar a otros superadministradores."
        : opcion
          ? ` ${resumenModulos(opcion)}`
          : "";
    if (
      !confirm(
        `¿Cambiar el perfil de ${a.nombre ?? a.usuario} de ${enFrase(antes)} a ${enFrase(nuevo)}?${aviso} Si tiene una sesión abierta, tendrá que volver a entrar.`
      )
    ) {
      return;
    }

    setAviso(null);
    setCambiandoPerfil(a.usuario);
    const res = await fetch("/api/admin/usuarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: a.usuario, rol: nuevo }),
    });
    const json = await res.json().catch(() => ({}));
    setCambiandoPerfil(null);

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo cambiar el perfil." });
      return;
    }
    setAviso({
      tipo: "ok",
      texto: `${a.nombre ?? a.usuario} ahora es ${enFrase(nuevo)}. Si tenía una sesión abierta, tendrá que volver a entrar.`,
    });
    cargar();
  }

  async function alternar(a: Admin) {
    setAviso(null);
    const res = await fetch("/api/admin/usuarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: a.usuario, activo: !a.activo }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAviso({ tipo: "mal", texto: json.error ?? "No se pudo actualizar." });
      return;
    }
    cargar();
  }

  function fecha(iso: string | null) {
    return iso ? cuando(iso) : "nunca";
  }

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-[15px] font-semibold">Usuarios</h2>
        <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
          Cambia el perfil de alguien desde su fila: no hace falta tocarle la clave.
        </p>

        {aviso && (
          <p
            role="status"
            className={`mt-3 rounded-[4px] px-3 py-2.5 text-[13px] leading-snug ${
              aviso.tipo === "ok"
                ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                : "bg-[var(--color-alerta-fondo)] text-[var(--color-alerta)]"
            }`}
          >
            {aviso.texto}
          </p>
        )}

        {lista === null ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-tinta-suave)]">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Cargando…
          </p>
        ) : (
          <ul className="tarjeta mt-4 divide-y divide-[var(--color-linea)]">
            {lista.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm"
              >
                <span className="min-w-[15rem] flex-1">
                  <span className="block truncate font-medium">
                    {a.nombre ?? a.usuario}
                    {a.usuario === yo && (
                      <span className="ml-2 text-xs font-normal text-[var(--color-tinta-suave)]">
                        tu sesión
                      </span>
                    )}
                  </span>
                  <span className="cifras mt-0.5 block text-xs leading-snug break-words text-[var(--color-tinta-suave)]">
                    {a.usuario}
                    <span className="whitespace-nowrap">
                      {" · último ingreso "}
                      {fecha(a.ultimo_login)}
                    </span>
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <label htmlFor={`perfil-${a.id}`} className="sr-only">
                    Perfil de {a.nombre ?? a.usuario}
                  </label>
                  <select
                    id={`perfil-${a.id}`}
                    value={perfilDe(a)}
                    disabled={a.usuario === yo || !puedoTocar(a) || cambiandoPerfil !== null}
                    title={
                      a.usuario === yo
                        ? "No puedes cambiar tu propio perfil"
                        : !puedoTocar(a)
                          ? perfilDe(a) === "superadmin"
                            ? "Solo un superadministrador puede cambiar este perfil"
                            : "Tiene permisos que tú no tienes"
                          : "Cambiar el perfil"
                    }
                    onChange={(e) => cambiarPerfil(a, e.target.value)}
                    className={`min-h-[32px] max-w-[14rem] shrink-0 truncate rounded-full border-0 py-0 pr-7 pl-2.5 text-xs font-medium disabled:opacity-100 ${colorPerfil(
                      perfilDe(a)
                    )}`}
                  >
                    {/* Los que yo puedo dar, y el que ya tiene aunque yo no pueda darlo. */}
                    {perfiles
                      .filter((p) => p.asignable || p.clave === perfilDe(a))
                      .map((p) => (
                        <option key={p.clave} value={p.clave}>
                          {p.nombre}
                        </option>
                      ))}
                    {!perfiles.some((p) => p.clave === perfilDe(a)) && (
                      <option value={perfilDe(a)}>{perfilDe(a)}</option>
                    )}
                  </select>
                  {cambiandoPerfil === a.usuario && (
                    <Loader2 size={14} className="animate-spin text-[var(--color-tinta-suave)]" aria-label="Guardando" />
                  )}

                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      a.activo
                        ? "bg-[var(--color-exito-fondo)] text-[var(--color-exito)]"
                        : "bg-[var(--color-relleno)] text-[var(--color-tinta-suave)]"
                    }`}
                  >
                    {a.activo ? "activo" : "inactivo"}
                  </span>

                  <button
                    type="button"
                    onClick={() => cambiarClave(a)}
                    disabled={!puedoTocar(a)}
                    title={
                      puedoTocar(a)
                        ? "Cargar este usuario abajo para ponerle una clave nueva"
                        : perfilDe(a) === "superadmin"
                          ? "Solo un superadministrador puede cambiar esta clave"
                          : "Tiene permisos que tú no tienes"
                    }
                    className="boton boton-secundario boton-chico shrink-0 text-xs"
                  >
                    <KeyRound size={13} aria-hidden />
                    Cambiar clave
                  </button>

                  <button
                    type="button"
                    onClick={() => alternar(a)}
                    disabled={(a.usuario === yo && a.activo) || !puedoTocar(a)}
                    title={
                      puedoTocar(a)
                        ? undefined
                        : perfilDe(a) === "superadmin"
                          ? "Solo un superadministrador puede desactivar esta cuenta"
                          : "Tiene permisos que tú no tienes"
                    }
                    className="boton boton-secundario boton-chico shrink-0 text-xs"
                  >
                    {a.activo ? "Desactivar" : "Reactivar"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-[15px] font-semibold">
          {yaExiste ? "Cambiar la clave" : "Crear un usuario del panel"}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-tinta-suave)]">
          Si escribes un usuario que ya existe, se le reemplaza la clave. Es la
          única forma de recuperarla: la clave se guarda cifrada y nadie, ni tú,
          puede volver a verla.
        </p>

        <form
          onSubmit={crear}
          className="tarjeta mt-4 p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nuevo-usuario" className="campo-etiqueta">
                Usuario
              </label>
              <input
                id="nuevo-usuario"
                required
                autoCapitalize="none"
                spellCheck={false}
                placeholder="jsrodriguez"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                className="campo"
              />
            </div>

            <div>
              <label htmlFor="nuevo-nombre" className="campo-etiqueta">
                Nombre
              </label>
              <input
                id="nuevo-nombre"
                placeholder="Juan Sebastián Rodríguez"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="campo"
              />
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="campo-etiqueta">Perfil</legend>
            {lista !== null && asignables.length === 0 && (
              <p className="mt-1 text-[13px] text-[var(--color-tinta-suave)]">
                Tu perfil no puede dar ninguno de los perfiles que hay.
              </p>
            )}
            <div className="mt-1 space-y-2">
              {asignables.map((p) => (
                <label
                  key={p.clave}
                  className={`flex cursor-pointer gap-3 rounded-[4px] border p-3 ${
                    rol === p.clave
                      ? "border-[var(--color-tinta)] bg-[var(--color-sutil)]"
                      : "border-[var(--color-linea)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="perfil"
                    value={p.clave}
                    checked={rol === p.clave}
                    onChange={() => setRol(p.clave)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.nombre}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-tinta-suave)]">
                      {p.descripcion ? `${p.descripcion.replace(/[.\s]+$/, "")}. ` : ""}
                      {p.clave === "superadmin" ? "" : resumenModulos(p)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <label htmlFor="nueva-clave" className="campo-etiqueta">
              Clave
            </label>
            <div className="relative">
              <input
                id="nueva-clave"
                ref={campoClave}
                type={verClave ? "text" : "password"}
                required
                autoComplete="new-password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="campo pr-11"
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                aria-label={verClave ? "Ocultar la clave" : "Ver la clave"}
                title={verClave ? "Ocultar la clave" : "Ver la clave"}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
              >
                {verClave ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
              </button>
            </div>
            <p
              className={`mt-1.5 text-xs ${
                clave && clave.length < LARGO_MINIMO
                  ? "text-[var(--color-alerta)]"
                  : "text-[var(--color-tinta-suave)]"
              }`}
            >
              Mínimo {LARGO_MINIMO} caracteres.
            </p>
          </div>

          {yaExiste && (
            <p className="mt-3 rounded-[4px] bg-[var(--color-aviso-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-aviso-tinta)]">
              Ese usuario ya existe. Al guardar, su clave actual deja de servir y
              queda con el perfil que esté marcado arriba. Para cambiar solo el
              perfil, usa su fila en la lista.
            </p>
          )}

          {existente && !puedoTocar(existente) && (
            <p className="mt-3 flex items-start gap-2 rounded-[4px] bg-[var(--color-alerta-fondo)] px-3 py-2.5 text-[13px] leading-snug text-[var(--color-alerta)]">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
              {perfilDe(existente) === "superadmin"
                ? "Esa cuenta es de un superadministrador. Solo otro superadministrador puede cambiarle la clave o el perfil."
                : "Ese usuario tiene permisos que tú no tienes: solo lo puede cambiar alguien que también los tenga."}
            </p>
          )}

          <button
            type="submit"
            disabled={
              guardando ||
              !usuario ||
              !rol ||
              clave.length < LARGO_MINIMO ||
              (existente !== undefined && !puedoTocar(existente))
            }
            className="boton boton-primario mt-5"
          >
            {guardando ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <UserPlus size={15} aria-hidden />
            )}
            {yaExiste ? "Cambiar la clave" : rol ? `Crear ${enFrase(rol)}` : "Crear usuario"}
          </button>
        </form>
      </section>
    </div>
  );
}

/*
  Pie de página común a todas las vistas. Va dentro del layout, así que el
  <body> es flex-col y este bloque queda siempre al final del contenido.
*/
export default function PieDePagina() {
  return (
    <footer className="mt-auto border-t border-[var(--color-linea)] bg-[var(--color-papel)]">
      <div className="mx-auto max-w-[1400px] px-4 py-3 text-[13px] leading-snug text-[var(--color-tinta-suave)]">
        <span className="font-semibold text-[var(--color-tinta)]">JR</span>{" "}
        © {new Date().getFullYear()}. Todos los derechos reservados
      </div>
    </footer>
  );
}

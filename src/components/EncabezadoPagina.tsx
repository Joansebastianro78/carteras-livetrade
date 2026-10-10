/**
 * Título de cada pantalla del panel, con su explicación corta y, a la
 * derecha, las acciones principales (descargar, volver a consultar...).
 */
export default function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-[var(--color-tinta)] sm:text-[26px]">
          {titulo}
        </h1>
        {descripcion && (
          <p className="cifras mt-1.5 max-w-[72ch] text-[14px] leading-relaxed text-[var(--color-tinta-suave)]">
            {descripcion}
          </p>
        )}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2.5">{acciones}</div>}
    </div>
  );
}

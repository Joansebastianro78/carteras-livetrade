"use client";

import { useRouter } from "next/navigation";

export default function CerrarSesion() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.refresh();
      }}
      className="rounded-[4px] border border-[var(--color-linea)] px-2.5 py-1.5 text-[var(--color-tinta-suave)] hover:text-[var(--color-tinta)]"
    >
      Salir
    </button>
  );
}

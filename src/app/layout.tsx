import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import PieDePagina from "@/components/PieDePagina";
import DecoracionTema from "@/components/DecoracionTema";
import { leerEstadoTema } from "@/lib/temaServidor";
import { resolverTema } from "@/lib/temas";
import { COOKIE_MODO, ENCABEZADO_PANEL, esModo } from "@/lib/modo";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Cartera LiveTrade",
  description: "Consulta tu cartera de puntos y descárgala en Excel.",
};

export const viewport: Viewport = {
  themeColor: "#16242b",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Los adornos se deciden en el servidor y salen en todas las vistas.
  const tema = resolverTema(await leerEstadoTema());

  // Modo claro u oscuro: solo en el panel y el BackOffice (el middleware marca
  // esas páginas). Se pinta desde el servidor para que no parpadee.
  const enPanel = (await headers()).get(ENCABEZADO_PANEL) === "1";
  const modo = enPanel ? esModo((await cookies()).get(COOKIE_MODO)?.value) : undefined;

  return (
    <html lang="es" className={plex.variable} data-modo={modo}>
      <body
        className="flex min-h-dvh flex-col antialiased"
        style={{ fontFamily: "var(--font-plex)" }}
      >
        {children}
        <PieDePagina />
        {tema && <DecoracionTema tema={tema.id} />}
      </body>
    </html>
  );
}

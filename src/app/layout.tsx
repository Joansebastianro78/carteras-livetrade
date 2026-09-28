import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import PieDePagina from "@/components/PieDePagina";
import DecoracionTema from "@/components/DecoracionTema";
import { leerEstadoTema } from "@/lib/temaServidor";
import { resolverTema } from "@/lib/temas";

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

  return (
    <html lang="es" className={plex.variable}>
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

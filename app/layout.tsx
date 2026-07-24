import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Panel · Clínica EiviLuxury",
  description: "Gestión de agenda, pacientes y asistente Alexia",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

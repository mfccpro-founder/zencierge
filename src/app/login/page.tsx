import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { HostAuthForm } from "@/components/auth/host-auth-form";

export const metadata: Metadata = {
  title: "Iniciar sesión · Zencierge",
  description: "Acceso de anfitriones al Host Command Center.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Bienvenido de nuevo"
      subtitle="Inicia sesión para abrir tu dashboard de anfitrión."
    >
      <HostAuthForm mode="login" nextPath={next || "/dashboard"} />
    </AuthShell>
  );
}

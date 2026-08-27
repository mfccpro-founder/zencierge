import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { HostAuthForm } from "@/components/auth/host-auth-form";

export const metadata: Metadata = {
  title: "Crear cuenta · Zencierge",
  description: "Registro de anfitriones para el Host Command Center.",
};

export default function SignupPage() {
  return (
    <AuthShell
      title="Crea tu cuenta de anfitrión"
      subtitle="Regístrate para configurar propiedades, voz y el portal del huésped."
    >
      <HostAuthForm mode="signup" nextPath="/dashboard" />
    </AuthShell>
  );
}

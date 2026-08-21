import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-ink">מנהל הסושיאל</h1>
          <p className="mt-1 text-sm text-ink-muted">
            אינסטגרם · פייסבוק · טיקטוק
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}

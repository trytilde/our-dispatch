import { type ReactNode, useEffect, useState } from "react";

type Session = { authenticated: true; user: { subject: string; email?: string } };

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>();
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSession()
      .then(setSession)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Authentication is unavailable");
        setSession(null);
      });
  }, []);

  if (session === undefined)
    return (
      <main className="grid min-h-screen place-items-center text-sm text-neutral-500">
        Checking access…
      </main>
    );
  if (!session)
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-50 p-6">
        <section className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-neutral-950">Sign in to OpenBot</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-600">
            Use a Tilde account that belongs to this OpenBot deployment&apos;s team.
          </p>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <button
            className="mt-6 w-full rounded-lg bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
            type="button"
            onClick={() => void signIn()}
          >
            Continue with Tilde
          </button>
        </section>
      </main>
    );
  return children;
}

async function loadSession(): Promise<Session | null> {
  if (window.openbotDesktop) return window.openbotDesktop.authStatus();
  const response = await fetch("/auth/session");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Authentication check failed (${response.status})`);
  return (await response.json()) as Session;
}

async function signIn(): Promise<void> {
  if (window.openbotDesktop) {
    await window.openbotDesktop.signIn();
    window.location.reload();
    return;
  }
  window.location.assign("/auth/login");
}

import { Button, Shimmer } from "@tryopenbot/ui";
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
      <main className="grid min-h-screen place-items-center bg-page">
        <Shimmer className="text-[13px]">Checking access…</Shimmer>
      </main>
    );
  if (!session)
    return (
      <main className="grid min-h-screen place-items-center bg-page p-6">
        <section
          className="w-full max-w-sm rounded-window bg-surface p-8 text-center shadow-card"
          style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
        >
          <span
            aria-hidden
            className="mx-auto flex size-12 items-center justify-center rounded-full
              bg-field text-[22px] text-ink shadow-hairline"
          >
            ✣
          </span>
          <h1 className="mt-5 text-[21px] font-semibold leading-snug tracking-[-0.02em] text-ink">
            Sign in to OpenBot
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Use a Tilde account that belongs to this OpenBot deployment&apos;s team.
          </p>
          {error ? <p className="mt-3 text-[12.5px] text-red">{error}</p> : null}
          <Button className="mt-6 w-full" onClick={() => void signIn()}>
            Continue with Tilde
          </Button>
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

interface Window {
  openbotDesktop?: {
    platform: "mac" | "linux";
    controlOrigin: string;
    openExternal(url: string): Promise<void>;
    authStatus(): Promise<{
      authenticated: true;
      user: { subject: string; email?: string };
    } | null>;
    signIn(): Promise<void>;
    signOut(): Promise<void>;
  };
}

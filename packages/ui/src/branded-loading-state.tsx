import { AgentAvatar } from "./agent-avatar.js";
import { Shimmer } from "./beautiful-ui/atoms/shimmer.js";

export interface BrandedLoadingStateProps {
  label: string;
}

/** Full-screen OpenBot wait state using the same mascot as onboarding. */
export function BrandedLoadingState({ label }: BrandedLoadingStateProps) {
  return (
    <main
      aria-label={label}
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-page"
      role="status"
    >
      <div className="flex -translate-y-4 flex-col items-center gap-5">
        <AgentAvatar
          className="!size-16"
          color="#1084FE"
          id="openbot-hero-loading"
          shape="blob"
          state="loading"
        />
        <Shimmer className="text-[13px]">{label}</Shimmer>
      </div>
    </main>
  );
}

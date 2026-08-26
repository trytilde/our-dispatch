import type { CSSProperties, ReactNode } from "react";
import { cn } from "./lib/utils.js";

export interface ProviderIconProps {
  backgroundColor?: string;
  className?: string;
  fallback: ReactNode;
  imageUrl?: string;
  onImageError?: () => void;
}

export function ProviderIcon({
  backgroundColor,
  className,
  fallback,
  imageUrl,
  onImageError,
}: ProviderIconProps) {
  const style: CSSProperties | undefined = imageUrl
    ? undefined
    : { backgroundColor: backgroundColor ?? "var(--field)" };

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[45px] shrink-0 place-items-center rounded-[10px] text-[11px] font-bold",
        "tracking-[-0.02em] text-white",
        imageUrl && "bg-surface",
        className,
      )}
      data-slot="provider-icon"
      style={style}
    >
      {imageUrl ? (
        <img
          alt=""
          className="h-auto max-h-8 w-auto max-w-8 object-contain"
          onError={onImageError}
          src={imageUrl}
        />
      ) : (
        fallback
      )}
    </span>
  );
}

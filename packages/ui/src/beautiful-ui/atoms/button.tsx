"use client";

/* ─────────────────────────────────────────────────────────
 * BUTTON
 * Token-driven button in the Beautiful UI idiom.
 * OpenBot reconstruction of the Beautiful UI atom API.
 * ───────────────────────────────────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "accent" | "success" | "quiet";

export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-canvas hover:opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
  secondary: "bg-surface text-ink shadow-btn hover:bg-hover",
  accent: "bg-accent text-white hover:brightness-105 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
  success: "bg-green text-white hover:brightness-105 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
  quiet: "text-ink-2 hover:bg-hover hover:text-ink",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-[13px] rounded-control gap-1.5",
  md: "h-8 px-3.5 text-[13px] rounded-control gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center font-medium select-none
        transition-[transform,background-color,opacity,filter] duration-150 ease-out
        active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50
        ${VARIANTS[variant]} ${SIZES[size]} ${className ?? ""}`}
      {...rest}
    />
  );
}

"use client";

import { useCallback, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * GLIDE MENU
 * Wraps a column of `data-menu-row` buttons and glides a
 * single highlight box behind the hovered / focused row.
 * OpenBot reconstruction of the Beautiful UI primitive API.
 * ───────────────────────────────────────────────────────── */

export interface GlideMenuProps {
  className?: string;
  highlightClassName?: string;
  children: React.ReactNode;
}

export default function GlideMenu({
  className,
  highlightClassName = "inset-x-0 rounded-[6px] bg-hover",
  children,
}: GlideMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  const moveTo = useCallback((target: EventTarget | null) => {
    const container = containerRef.current;
    const row = target instanceof Element ? target.closest("[data-menu-row]") : null;
    if (!container || !row) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setBox({ top: rowRect.top - containerRect.top, height: rowRect.height });
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ""}`}
      onMouseOver={(event) => moveTo(event.target)}
      onFocus={(event) => moveTo(event.target)}
      onMouseLeave={() => setBox(null)}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node)) {
          setBox(null);
        }
      }}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute ${highlightClassName}`}
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box ? 1 : 0,
          transition:
            "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
        }}
      />
      {children}
    </div>
  );
}

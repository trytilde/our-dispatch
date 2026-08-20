"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";

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

interface HighlightBox {
  top: number;
  height: number;
}

export default function GlideMenu({
  className,
  highlightClassName = "inset-x-0 rounded-[6px] bg-hover",
  children,
}: GlideMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HighlightBox | null>(null);
  // Entering the column places the highlight without sliding; only row-to-row moves glide.
  const visible = useRef(false);

  const moveTo = useCallback((target: EventTarget | null) => {
    const container = containerRef.current;
    const row = target instanceof Element ? target.closest("[data-menu-row]") : null;
    if (!container || !row) return;
    // A selected row already carries its own background; a hover layer on top only muddies it.
    if (row.hasAttribute("data-selected")) {
      visible.current = false;
      setBox(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setBox({ top: rowRect.top - containerRect.top, height: rowRect.height });
  }, []);

  const clear = useCallback(() => {
    visible.current = false;
    setBox(null);
  }, []);

  const gliding = visible.current && box !== null;
  if (box) visible.current = true;

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ""}`}
      onMouseOver={(event) => moveTo(event.target)}
      onFocus={(event) => moveTo(event.target)}
      onMouseLeave={clear}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node)) clear();
      }}
    >
      <motion.span
        aria-hidden
        animate={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box ? 1 : 0,
        }}
        className={`pointer-events-none absolute ${highlightClassName}`}
        initial={false}
        transition={{
          // Row-to-row moves glide slowly; the first appearance lands in place and fades in.
          top: gliding ? glide : instant,
          height: gliding ? glide : instant,
          opacity: fade,
        }}
      />
      {children}
    </div>
  );
}

const glide = { duration: 0.32, ease: [0.23, 1, 0.32, 1] } as const;
const instant = { duration: 0 } as const;
const fade = { duration: 0.18, ease: "easeOut" } as const;

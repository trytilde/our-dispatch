"use client";

import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * STREAM TEXT
 * Reveals text word by word with a blinking caret, calling
 * back as it advances. OpenBot reconstruction of the
 * Beautiful UI atom API.
 * ───────────────────────────────────────────────────────── */

export interface StreamTextProps {
  text: string;
  /** Milliseconds between revealed words. */
  interval?: number;
  onProgress?: () => void;
  onDone?: () => void;
  className?: string;
}

export function StreamText({
  text,
  interval = 55,
  onProgress,
  onDone,
  className,
}: StreamTextProps) {
  const words = text.split(/(\s+)/).filter((part) => part.length > 0);
  const [visible, setVisible] = useState(0);
  const callbacks = useRef({ onProgress, onDone });
  callbacks.current = { onProgress, onDone };

  useEffect(() => {
    setVisible(0);
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setVisible(count);
      callbacks.current.onProgress?.();
      if (count >= words.length) {
        clearInterval(timer);
        callbacks.current.onDone?.();
      }
    }, interval);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, interval]);

  const streaming = visible < words.length;

  return (
    <span className={className}>
      {words.slice(0, visible).map((word, index) => (
        <span key={index} className="inline" style={{ animation: "stream-in 300ms ease-out both" }}>
          {word}
        </span>
      ))}
      {streaming && <span className="stream-caret is-streaming" />}
    </span>
  );
}

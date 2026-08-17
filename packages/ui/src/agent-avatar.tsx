import type { CSSProperties } from "react";
import { agentAvatarShapes } from "./agent-avatar-shapes.js";

export interface AgentAvatarProps {
  id: string;
}

const colors = [
  { dark: "#855c36", light: "#a27952" },
  { dark: "#e02135", light: "#ff3e51" },
  { dark: "#ff6700", light: "#ff781c" },
  { dark: "#ff9800", light: "#ffaf38" },
  { dark: "#009957", light: "#00c972" },
  { dark: "#00a592", light: "#1cc3b0" },
  { dark: "#0e74e0", light: "#2a92fe" },
  { dark: "#804ee0", light: "#a97efe" },
  { dark: "#e02a88", light: "#ff5eb1" },
  { dark: "#777777", light: "#959595" },
] as const;

const shapeNames = [
  "blob",
  "pebble",
  "squircle",
  "tablet",
  "wedge",
  "hex",
  "cloud",
  "teardrop",
] as const;

export function AgentAvatar({ id }: AgentAvatarProps) {
  const color = colors[colorIndex(id)] ?? colors[0];
  const shapeName = shapeNames[shapeIndex(id)] ?? shapeNames[0];
  const shape = agentAvatarShapes[shapeName];
  const style = {
    "--agent-avatar-fill-dark": color.dark,
    "--agent-avatar-fill-light": color.light,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      className="avatar"
      data-avatar-key={id}
      data-avatar-shape={shapeName}
      style={style}
    >
      <svg className="agent-avatar-mark" viewBox={shape.viewBox}>
        <g transform={shape.transform}>
          <path className="agent-avatar-body" d={shape.path} fillRule="evenodd" />
        </g>
      </svg>
    </span>
  );
}

function colorIndex(value: string): number {
  const seed = (fnv1a(value) ^ Math.imul(1, 2_654_435_769)) >>> 0;
  const random = mulberry32((seed ^ Math.imul(1, 2_654_435_769)) >>> 0);
  return Math.floor(random() * colors.length);
}

function shapeIndex(value: string): number {
  let hash = fnv1a(value);
  hash = Math.imul(hash ^ (hash >>> 16), 73_244_475);
  hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
  return ((hash ^ (hash >>> 16)) >>> 0) % shapeNames.length;
}

function fnv1a(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 1_831_565_813) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

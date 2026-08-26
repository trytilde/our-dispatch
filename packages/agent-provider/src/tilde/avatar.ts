import { deflateSync } from "node:zlib";

const size = 128;
const palette = [
  "#ff5a5f",
  "#ff8a3d",
  "#ffc53d",
  "#7ed957",
  "#2fd07a",
  "#22d3c5",
  "#38bdf8",
  "#4f7cff",
  "#a66bff",
  "#ff5fa8",
] as const;

/** Render a deterministic, dependency-free PNG for an authored agent. */
export function renderAgentAvatarPng(id: string): Uint8Array {
  const hash = fnv1a(id);
  const color = rgb(palette[hash % palette.length]!);
  const pixels = new Uint8Array(size * size * 4);
  const shape = hash % 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = inShape(shape, x, y);
      const offset = (y * size + x) * 4;
      if (inside) {
        const texture = ((x * 17 + y * 31 + hash) & 15) < 3 ? 0.84 : 1;
        pixels[offset] = Math.round(color[0] * texture);
        pixels[offset + 1] = Math.round(color[1] * texture);
        pixels[offset + 2] = Math.round(color[2] * texture);
        pixels[offset + 3] = 255;
      }
    }
  }
  drawEye(pixels, 48, 57);
  drawEye(pixels, 80, 57);
  return encodePng(pixels);
}

function inShape(shape: number, x: number, y: number): boolean {
  const dx = x - 64;
  const dy = y - 66;
  switch (shape) {
    case 0:
      return (dx * dx) / 2500 + (dy * dy) / 3025 <= 1;
    case 1:
      return Math.abs(dx) <= 48 && Math.abs(dy) <= 52 && dx * dx + dy * dy <= 4_600;
    case 2:
      return Math.abs(dx) <= 50 && Math.abs(dy) <= 48 && Math.abs(dx) + Math.abs(dy) <= 78;
    default:
      return (
        (dx * dx) / 2304 + (dy * dy) / 2704 <= 1 ||
        (x - 43) ** 2 + (y - 54) ** 2 <= 28 ** 2 ||
        (x - 84) ** 2 + (y - 51) ** 2 <= 30 ** 2
      );
  }
}

function drawEye(pixels: Uint8Array, cx: number, cy: number): void {
  for (let y = cy - 8; y <= cy + 8; y += 1) {
    for (let x = cx - 6; x <= cx + 6; x += 1) {
      if ((x - cx) ** 2 / 36 + (y - cy) ** 2 / 64 > 1) continue;
      const offset = (y * size + x) * 4;
      pixels[offset] = 25;
      pixels[offset + 1] = 25;
      pixels[offset + 2] = 25;
      pixels[offset + 3] = 255;
    }
  }
}

function encodePng(pixels: Uint8Array): Uint8Array {
  const raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), row + 1);
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, size);
  new DataView(ihdr.buffer).setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  );
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "ascii");
  const result = new Uint8Array(12 + data.length);
  new DataView(result.buffer).setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  new DataView(result.buffer).setUint32(8 + data.length, crc32(concat(typeBytes, data)));
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function fnv1a(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

function rgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

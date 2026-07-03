/** Layer type palette — a LayerType indexes into this. Read-only constants. */
export const PALETTE: number[] = [
  0xffd23f, // 0 yellow
  0xff8c1a, // 1 orange
  0xff3b3b, // 2 red
  0xff4fd8, // 3 pink
  0x9b5bff, // 4 purple
  0x38b6ff, // 5 blue
  0x35e07c, // 6 green
  0x58e1c4, // 7 teal
];

export const MAX_TYPES = PALETTE.length;

export function colorHexCss(type: number): string {
  return `#${PALETTE[type % PALETTE.length].toString(16).padStart(6, '0')}`;
}

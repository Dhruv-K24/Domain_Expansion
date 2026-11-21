// Tiny math helpers shared everywhere (one copy instead of a copy-paste in every file).
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const easeOut = (k: number) => 1 - (1 - k) * (1 - k)

// Codabar start/stop letters (shared by validate.ts, encode.ts and the blind scorer; no imports, so no cycles).

/** Codabar: optional start/stop letters A–D at both ends; returns the body and the letters that were present. */
export function splitCodabar(value: string): { start: string | null; body: string; stop: string | null } {
  const start = /^[A-D]/.test(value) ? value[0] : null;
  const stop = value.length > 1 && /[A-D]$/.test(value) ? value[value.length - 1] : null;
  return { start, stop, body: value.slice(start ? 1 : 0, stop ? -1 : undefined) };
}

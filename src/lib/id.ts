// Row ids: time-ordered base-36 prefix + 64 random bits (card-scanner pattern). Unique enough for one phone's wallet;
// no dependency (Hermes has no crypto.randomUUID). Tests pass their own ids.
export function newId(now = Date.now(), random: () => number = Math.random): string {
  const rand = Array.from({ length: 4 }, () => Math.floor(random() * 0x10000).toString(16).padStart(4, '0')).join('');
  return `${now.toString(36)}-${rand}`;
}

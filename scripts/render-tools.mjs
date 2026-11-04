// Node glue for the referees: builds the Swift tools once (artifacts/referee/, git-ignored), runs the rasteriser on a
// jobs file and the Vision decoder on a directory, parses its TSV. Used by referee.mjs and blind.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '..');
const bin = join(root, 'artifacts', 'referee');

function build(name) {
  const src = join(root, 'referee', 'swift', `${name}.swift`);
  const out = join(bin, name);
  mkdirSync(bin, { recursive: true });
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs) {
    console.log(`building ${name} (swiftc -O)…`);
    execFileSync('swiftc', ['-O', src, '-o', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return out;
}

export function rasterize(jobs, jobsFile) {
  writeFileSync(jobsFile, JSON.stringify(jobs));
  return execFileSync(build('rasterize'), [jobsFile], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
}

/** Decodes every PNG under the given directories; returns Map<path, [{value, symbology}]>. */
export function decode(dirs) {
  const out = new Map();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const text = execFileSync(build('decode'), [dir], { encoding: 'utf8', maxBuffer: 1 << 28 });
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [path, value = '', symbology = ''] = line.split('\t');
      if (!out.has(path)) out.set(path, []);
      out.get(path).push({ value: value.replace(/\\n/g, '\n').replace(/\\t/g, '\t'), symbology });
    }
  }
  return out;
}

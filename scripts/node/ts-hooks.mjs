// Lets plain Node (>= 22.15, built-in type stripping) run the app's pure TypeScript engine with the repo's extensionless
// relative imports (`./phone` -> ./phone.ts) and the `@/` alias (-> src/). Used by the bench/referee scripts
// (`node --import ./scripts/node/ts-hooks.mjs …`), never by the app (Metro and Jest resolve these themselves).
// Pattern from electrician-toolkit's scripts/node/ts-hooks.mjs. No dependency.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));

registerHooks({
  resolve(specifier, context, next) {
    let spec = specifier;
    if (spec.startsWith('@/')) spec = pathToFileURL(src + spec.slice(2)).href;
    const isRel = /^\.\.?\//.test(spec) || spec.startsWith('file:');
    if (isRel && !/\.[cm]?[jt]s$/.test(spec)) {
      const base = spec.startsWith('file:') ? fileURLToPath(spec) : context.parentURL ? fileURLToPath(new URL(spec, context.parentURL)) : null;
      if (base) {
        for (const ext of ['.ts', '/index.ts']) {
          if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
        }
      }
    }
    return next(spec, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return next(url, { ...context, format: 'module-typescript' });
    return next(url, context);
  },
});

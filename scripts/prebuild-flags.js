#!/usr/bin/env node
// Decides the `expo prebuild` flags for scripts/native.sh (template D10). Prints the flags on stdout and the reason on stderr.
// Usage: node scripts/prebuild-flags.js <ios|android> <development|preview|production>   (run from the project root)
//
// Default: --no-clean. Deleting the generated ios/ or android/ folder is the owner's decision (deletion rule), and
// `prebuild --no-clean` applies the config to the existing folder.
// The ONE automatic exception: the folder was generated for ANOTHER variant (first word of `<platform>/.generated-for`,
// written by native.sh after every prebuild). --no-clean would keep that variant's URL scheme, App Group and widget bundle
// id (mood-journal D71: preview APK answered the dev scheme, iOS preview build failed) and mixed Debug/Release pods
// (print-cost D92/D95). A wrong release build is worse than regenerating a git-ignored folder, so the script answers
// `--clean` for THIS platform only, after saying why. Opt out with PREBUILD_KEEP_ON_VARIANT_SWITCH=1; PREBUILD_FLAGS
// (any value) is used verbatim and wins over everything.
const fs = require('fs');
const path = require('path');

const KEEP_ENV = 'PREBUILD_KEEP_ON_VARIANT_SWITCH';
const MARKER = '.generated-for';

/** First word of the marker text (`<variant> <hash>`), or null. */
function parseMarker(text) {
  const word = String(text ?? '').trim().split(/\s+/)[0];
  return word || null;
}

function readPreviousVariant(projectRoot, platform) {
  try {
    return parseMarker(fs.readFileSync(path.join(projectRoot, platform, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

/** @returns {{ flags: string, reason: string, deletes: boolean }} */
function decide({ platform, variant, previousVariant, env = {} }) {
  if (env.PREBUILD_FLAGS) {
    return { flags: env.PREBUILD_FLAGS, reason: `PREBUILD_FLAGS="${env.PREBUILD_FLAGS}" set by the caller; used as given.`, deletes: /(^|\s)--clean(\s|$)/.test(env.PREBUILD_FLAGS) };
  }
  if (previousVariant && previousVariant !== variant) {
    if (env[KEEP_ENV] === '1') {
      return {
        flags: '--no-clean',
        reason: `${platform}/ was generated for "${previousVariant}", now building "${variant}". ${KEEP_ENV}=1: keeping the folder; the other variant's leftovers stay (plugins/with-variant-manifest.js removes the known ones).`,
        deletes: false,
      };
    }
    return {
      flags: '--clean',
      reason:
        `${platform}/ was generated for "${previousVariant}", now building "${variant}": running expo prebuild --clean, which DELETES and re-creates ` +
        `the generated ${platform}/ folder (only that folder; D10). Why: --no-clean would keep the other variant's URL scheme, App Group, widget ` +
        `bundle id and Debug/Release pods, i.e. a wrong ${variant} build. Opt out: ${KEEP_ENV}=1 (or PREBUILD_FLAGS=--no-clean).`,
      deletes: true,
    };
  }
  return {
    flags: '--no-clean',
    reason: previousVariant ? `${platform}/ was last generated for "${previousVariant}" (same variant); applying changes in place.` : `no earlier prebuild recorded in ${platform}/${MARKER}; applying changes in place (nothing is deleted).`,
    deletes: false,
  };
}

module.exports = { decide, parseMarker, readPreviousVariant, KEEP_ENV, MARKER };

if (require.main === module) {
  const [platform, variant] = process.argv.slice(2);
  if (!platform || !variant) {
    console.error('Usage: prebuild-flags.js <ios|android> <development|preview|production>');
    process.exit(2);
  }
  const result = decide({ platform, variant, previousVariant: readPreviousVariant(process.cwd(), platform), env: process.env });
  console.error(`prebuild: ${result.reason}`);
  process.stdout.write(result.flags);
}

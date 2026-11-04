#!/usr/bin/env bash
# Exit 0 when Metro answers on this app's port (METRO_PORT in scripts/env.sh), 1 otherwise.
# Uses node's fetch: curl is blocked on the owner's Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
exec node -e '
  fetch("http://localhost:" + process.argv[1] + "/status", { signal: AbortSignal.timeout(3000) })
    .then((r) => r.text())
    .then((t) => process.exit(t.includes("running") ? 0 : 1))
    .catch(() => process.exit(1));
' "$METRO_PORT"

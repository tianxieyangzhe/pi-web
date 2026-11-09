#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$app_root"
export INIT_CWD="$app_root"
export NODE_ENV=production
node_binary="${NODE_BINARY:-node}"
app_host="${APP_HOST:-0.0.0.0}"
app_port="${PORT:-3000}"

if [[ ! "$app_port" =~ ^[0-9]{1,5}$ ]] || (( 10#$app_port < 1 || 10#$app_port > 65535 )); then
  echo 'PORT must be an integer from 1 to 65535.' >&2
  exit 1
fi
"$node_binary" -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<19)){console.error("Node.js >=22.19.0 is required");process.exit(1)}'
if [[ -f server.js ]]; then
  export HOSTNAME="$app_host"
  export PORT="$app_port"
  exec "$node_binary" "$app_root/server.js"
fi
if [[ ! -f node_modules/next/dist/bin/next ]]; then
  echo 'Next.js is missing. Run npm ci in the application directory first.' >&2
  exit 1
fi
if [[ ! -s .next/BUILD_ID ]]; then
  echo 'Production build is missing. Run npm run build before starting the service.' >&2
  exit 1
fi
# Replace Bash so systemd supervises Node directly and signals reach the server.
exec "$node_binary" "$app_root/node_modules/next/dist/bin/next" start --hostname "$app_host" --port "$app_port"

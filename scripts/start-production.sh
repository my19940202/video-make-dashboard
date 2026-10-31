#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."
if [[ ! -f .env.production ]]; then
  echo '缺少 .env.production；请先配置共享生产环境文件' >&2
  exit 1
fi

set -a
source .env.production
set +a
export NODE_ENV=production SAAS_MODE=1 PPT_WORKER=1 PORT=4112
export STORY_MAKE_HOME="$(pwd -P)"

exec node .mastra/output/index.mjs

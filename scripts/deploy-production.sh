#!/usr/bin/env bash
set -euo pipefail

revision="${1:-}"
if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo '需要 40 位 Git commit SHA' >&2
  exit 1
fi

root="${STORY_DEPLOY_ROOT:-/srv/story-make}"
release="$root/releases/$revision"
shared="$root/shared"
if [[ ! -f "$release/package.json" || ! -f "$shared/.env.production" ]]; then
  echo '发布目录或共享环境文件不存在' >&2
  exit 1
fi

ln -sfn "$shared/data" "$release/data"
ln -sfn "$shared/.env.production" "$release/.env.production"
cd "$release"
# 锁文件是 pnpm 9。系统里若是更新的 pnpm，会拒绝执行 esbuild 的安装脚本。
pnpm_prefix="${HOME}/.local/share/story-make/pnpm-9.15.4"
if [[ ! -x "${pnpm_prefix}/bin/pnpm" ]] || [[ "$("${pnpm_prefix}/bin/pnpm" --version)" != 9.15.4 ]]; then
  mkdir -p "${pnpm_prefix}"
  npm install -g --prefix "${pnpm_prefix}" pnpm@9.15.4
fi
export PATH="${pnpm_prefix}/bin:${PATH}"
pnpm install --frozen-lockfile --prod=false
pnpm run check
pnpm run build

previous=""
if [[ -L "$root/current" ]]; then
  previous="$(readlink -f "$root/current")"
fi
next="$root/.current-$revision"
ln -sfn "$release" "$next"
mv -Tf "$next" "$root/current"

if ! (cd "$root/current" && pm2 startOrRestart ecosystem.config.cjs --update-env) ||
   ! curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-connrefused --output /dev/null http://127.0.0.1:4112/workbench; then
  echo '新版本启动或健康检查失败，恢复上一个版本' >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$next"
    mv -Tf "$next" "$root/current"
    (cd "$root/current" && pm2 startOrRestart ecosystem.config.cjs --update-env) || true
  else
    pm2 delete story-make || true
    rm -f "$root/current"
  fi
  exit 1
fi

pm2 save
# Only revision directories are eligible for cleanup; shared data and secrets live outside releases.
for path in "$root"/releases/*; do
  [[ -d "$path" ]] || continue
  name="${path##*/}"
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] || continue
  [[ "$path" == "$release" || "$path" == "$previous" ]] && continue
  rm -rf -- "$path"
done

echo "已部署 ${revision}；当前版本：${release}"

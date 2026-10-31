# Lighthouse 上直接使用 PM2 部署

目标是腾讯云国际版香港 Lighthouse 的 Ubuntu。首版只开放视频工作台；一个 PM2 进程同时提供网页/API 和领取视频任务（`SAAS_MODE=1`、`PPT_WORKER=1`、`PORT=4112`），单机只执行一个制作任务。建议从 4 核 8 GB 起步，以实际视频导出测量内存和磁盘占用。无需 Docker。

## 1. 服务器首次准备

域名先解析到服务器。安全组仅放行 TCP 80、443 和 SSH；4112 不对公网放行。本工作流使用 GitHub 托管 runner，其出口 IP 会变化，因此 SSH 必须允许 runner 连接。若 SSH 只允许你自己的固定 IP，自动部署会连接失败；这种网络限制下需另行使用自托管 runner 或固定出口 IP 的 runner。[GitHub 的 runner 网络说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 以 Ubuntu 管理账号执行：

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates rsync ffmpeg fonts-noto-cjk caddy sqlite3
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
sudo npm install -g pnpm@9.15.4 pm2
node --version
pnpm --version
ffmpeg -version
test -f /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
test -f /usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc
```

Node.js 须为 22.13.0 或更新的 22.x。`fonts-noto-cjk` 提供视频导出使用的中文字体；如字体实际路径不同，用 `fc-match 'Noto Sans CJK SC' -f '%{file}\n'` 查到路径后修改生产环境文件。

创建专门的部署账号和共享目录；以下命令中的 `deploy` 是本指南统一使用的账号名：

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo install -d -o deploy -g deploy -m 750 /srv/story-make
sudo install -d -o deploy -g deploy -m 750 /srv/story-make/releases /srv/story-make/shared /srv/story-make/shared/data
```

在服务器的 `/srv/story-make/shared/.env.production` 填写 `.env.production.example` 中的配置，至少包括 `AUTH_CODE_SECRET`（32 字符以上随机值）、已在 Resend 验证的 `AUTH_EMAIL_FROM`、`RESEND_API_KEY`、`DEEPSEEK_API_KEY`、`IMAGE_PROVIDER=replicate`、`REPLICATE_API_TOKEN`、R2 的账号/桶/密钥和两条 `PPT_*_FONT` 路径。先以管理账号运行 `sudo install -m 600 -o deploy -g deploy /dev/null /srv/story-make/shared/.env.production`，再运行 `sudo -u deploy nano /srv/story-make/shared/.env.production` 编辑。此文件不进入 Git 或 GitHub Actions Secrets。不要把本机 `.env` 里的 macOS 路径复制到 Ubuntu。生产模式依赖 R2；即使本机有图片文件，生成的资产仍会上传到 R2。

```bash
sudo chown deploy:deploy /srv/story-make/shared/.env.production
sudo chmod 600 /srv/story-make/shared/.env.production
```

仓库的 `Caddyfile` 已指向本机 `127.0.0.1:4112`。首次部署完成后由管理员安装站点配置，并为 Caddy 服务提供域名：

```bash
sudo cp /srv/story-make/current/Caddyfile /etc/caddy/Caddyfile
sudo systemctl edit caddy
```

在打开的编辑器中写入以下内容，将域名替换为真实值：

```ini
[Service]
Environment=DOMAIN=example.com
```

随后执行 `sudo systemctl daemon-reload`、`sudo env DOMAIN=example.com caddy validate --config /etc/caddy/Caddyfile`（替换域名）和 `sudo systemctl restart caddy`。Caddyfile 后续有改动时，再复制并重载 Caddy。配置会把 `/workbench`、`/auth/*` 和 `/ppt/*` 代理到 PM2 服务，其余路径返回 404。

## 2. GitHub Actions 自动部署

`.github/workflows/deploy.yml` 在 PR 上只跑检查；推送 `main` 或在 `main` 上手动触发时，先检查，再通过 SSH 将代码传到 `/srv/story-make/releases/<commit SHA>`。服务器执行 `pnpm install --frozen-lockfile --prod=false`、检查、构建，成功后切换 `current` 并重启 PM2。构建失败时当前服务保持运行；启动或健康检查失败时自动切回上一个版本。部署脚本只清理旧的 SHA 版本目录，保留当前和上一个版本，不删除 `shared/data` 或生产环境文件。单进程重启会有短暂连接中断。

先给 `deploy` 账号配置 SSH 公钥登录。在管理电脑运行 `ssh-keygen -t ed25519 -f ~/.ssh/story_make_deploy -C story-make-actions`。由于 `deploy` 禁用了密码登录，使用已有的 Ubuntu 管理账号在服务器执行以下命令，再把公钥内容粘贴进去，最后按 `Ctrl+D`：

```bash
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudo tee -a /home/deploy/.ssh/authorized_keys >/dev/null
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

然后用 `ssh -i ~/.ssh/story_make_deploy deploy@<服务器地址>` 验证登录。把私钥完整内容存入 GitHub 仓库的 **Settings → Secrets and variables → Actions → Repository secrets**。不要使用个人日常 SSH 私钥。仓库需要以下 Secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | Lighthouse 公网 IP 或部署域名 |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | 专用 SSH 私钥的完整多行内容 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 已核对的服务器 SSH 主机公钥记录，格式与 `known_hosts` 相同 |

主机公钥可用 `ssh-keyscan -t ed25519 <服务器地址>` 获取，但必须通过服务器控制台上的 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 核对指纹后再保存为 Secret。工作流使用严格主机密钥检查。GitHub Actions 不保存应用密钥，只负责上传代码和启动部署脚本。首次触发后，在服务器以 `deploy` 身份执行 `pm2 startup systemd`，按 PM2 打印的命令安装开机启动服务，再运行 `pm2 save`。

## 3. 验收、日常操作与回滚

部署后检查 `pm2 list`、`pm2 logs story-make`、`curl -fsS -o /dev/null http://127.0.0.1:4112/workbench` 和 `sudo systemctl status caddy`。浏览器访问 `https://<DOMAIN>/workbench`，完成邮箱登录、生成参考图、确认样稿及带音乐的 MP4 导出。若生产变量变更，更新共享环境文件后执行 `pm2 restart story-make --update-env`。不要在生产服务器运行 `mastra dev`。

手动回滚时，以部署账号执行以下命令，把 `<上一版本 SHA>` 替换成 `/srv/story-make/releases/` 中保留的版本：

```bash
ln -s /srv/story-make/releases/<上一版本 SHA> /srv/story-make/.current-rollback
mv -Tf /srv/story-make/.current-rollback /srv/story-make/current
cd /srv/story-make/current
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
```

版本目录之外的 `shared/data` 不随代码回滚；涉及数据库结构变更时，先核对迁移兼容性。

SQLite 数据位于 `shared/data/saas.sqlite` 和 `shared/data/story-make.db`，项目中间文件位于 `shared/data/ppt/`。定期用 SQLite 在线备份命令或 `VACUUM INTO` 生成一致性副本，并把数据库、项目文件与 R2 资产备份到服务器外。Lighthouse 快照可作为整机恢复的补充。当前每日每用户最多发起 30 次生图；失败请求也可能已产生费用。正式收费、支付回调和用户自助删除仍未接入。

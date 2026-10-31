# Lighthouse 部署

首版仅开放视频工作台。生产环境使用腾讯云国际版香港 Lighthouse 的 Ubuntu Linux，建议从 4 核 8 GB 起步。镜像内包含 FFmpeg 和 Noto CJK 字体；`app` 处理请求，`worker` 每 5 秒领取一个待处理项目。

## 首次部署

1. 将域名解析到 Lighthouse。安装 Docker Engine 与 Compose，开放 TCP 80/443；SSH 仅允许管理地址。Resend 中验证发信域名，准备 Cloudflare AI Token 和私有 R2 桶及其 S3 凭据。
2. 把仓库放在服务器，复制 `.env.production.example` 为 `.env.production`，填写真实值。`AUTH_CODE_SECRET` 使用至少 32 字符的随机值。`.env.production` 不提交到版本库，文件权限设为 600。
3. 运行 `docker compose --env-file .env.production build` 和 `docker compose --env-file .env.production up -d`。浏览器访问 `https://<DOMAIN>/workbench`，测试邮箱验证码登录、生成参考图和完整视频导出。首次登录会自动创建用户。
4. 部署后检查 `docker compose logs app worker`，确认没有数据库、Resend、Cloudflare AI 或 R2 凭据错误。生产环境通过 Caddy 仅暴露工作台、认证和视频 API；Mastra 其余调试接口不开放。

## 更新与备份

通过 CI 构建带版本号的镜像并推送镜像仓库，在服务器把 `STORY_IMAGE` 指向该版本，再运行 `docker compose --env-file .env.production pull` 和 `docker compose --env-file .env.production up -d`。保持上一个镜像标签，用于回滚。上线前先备份 `data/saas.sqlite`，使用 SQLite 的在线备份或 `VACUUM INTO` 创建一致性副本；同时备份整个 `data/ppt` 目录及 `data/story-make.db`。把副本复制到服务器外并定期验证恢复。R2 中的图片、音乐和视频需单独设置生命周期与备份策略。Lighthouse 快照只作为整机恢复的补充。

目前每日每用户最多发起 30 次生图。失败的模型请求也占额度，因为可能已经产生费用；额度在 UTC 零点重置。单机只同时执行一个制作任务。部署前应以实际 6–8 页视频测量内存、CPU、磁盘峰值和跨境网络体验。

## 运行边界

生产数据保存在 `./data` 挂载目录与私有 R2 中。Web 与任务容器必须共享同一个挂载目录；当前渲染器仍从本地临时文件读取图片与音乐。正式收费、支付回调和用户自助删除尚未接入，不应在这些能力完成前公开收费。

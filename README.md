# Story Make

本机 Mastra 故事视频制作 Agent：DeepSeek 分镜、Codex 内置 imagegen 生图、人工逐关审核、复用 `story-to-handdrawn-video` 导出静音 MP4。

## 启动

需要 Node.js 22.13+、Python 3.10+、FFmpeg、Codex CLI，以及已经安装依赖的 `story-to-handdrawn-video` 项目。

1. `pnpm install`。
2. 将 `.env.example` 复制为 `.env`，填写 `DEEPSEEK_API_KEY`，确认 `STORY_MAKE_HOME` 和 `STORY_VIDEO_PROJECT` 路径。
3. `pnpm run dev`，打开 Mastra Studio（默认 `http://127.0.0.1:4112`）。
4. 在 Agents 中打开 **Story Make**，输入中文故事和标题；也可直接在 Workflows 中运行 `story-make-workflow`。

入口返回 Mastra `runId` 和 `data/runs/<runId>`。任务目录存放原文、每版分镜、Codex 生图清单、母图、预览及正式视频。Workflow 的挂起状态由 `data/story-make.db` 持久化，重启后可在 Studio 找回并继续。

## 审核

在 Studio 的 Workflow 挂起步骤提交 `resumeData`：

| 阶段 | 动作 | 附加字段 |
| --- | --- | --- |
| 分镜 | `approve`、`regenerate`、`replace`、`pause` | 重生填 `feedback`；替换填 `replacement`（JSON）或 `replacementPath` |
| 角色参考图 | `ready`、`approve`、`regenerate`、`replace`、`pause` | 生图完成填 `ready`；重画填 `feedback`；替换填 `replacementPath` |
| 每页场景图 | 同角色参考图 | 在对应 `forEachIndex` 审核该页 |
| 预览视频 | `approve`、`pause` | 批准后才导出正式 MP4 |

分镜 JSON 位于任务目录的 `draft.json`。手工替换时必须保留原句、场景 ID 和顺序，可修改视觉方向、角色设定和单场景时长。修改前的文件保存到 `revisions/`。图片与预览的挂起信息提供 `artifactUrl`，可在浏览器直接查看；审核图片前会验证文件尺寸，导入时由原渲染器继续检查版面。

若自动 Codex CLI 桥接可用，它会为角色和场景各执行一次内置 imagegen。桥接不通时，挂起信息包含 `promptFile`、`references` 和 `outputMaster`：在 Codex 中使用内置 imagegen 按提示生成图片，并复制到 `outputMaster`，然后对该步骤提交 `{"action":"ready"}` 进入图片审核。不会自动调用 OpenAI 图像 API。可设 `CODEX_AUTO_IMAGEGEN=0` 直接使用此接力路径。

在 Story Make Agent 中说“暂停任务 <runId>”会设置 `pause.flag`，阻止新生图任务派发；已经运行的任务会保存结果。说“解除暂停任务 <runId>”后，再在挂起步骤中提交审核动作继续。场景最多同时派发两张。预览位于 `out/picture_silent-preview.mp4`，正式视频位于 `out/picture_silent.mp4`。

## 验证

`npm run check` 运行类型检查和无需生图额度的关键关卡测试。真实端到端运行需要 DeepSeek 和本机 Codex imagegen 可用；分镜和图片均不会自动越过审核。


## PPT 视频工作台（新）

访问 `http://127.0.0.1:4112/workbench`：粘贴案例材料，系统按 6–8 页生成脚本；依次确认脚本与首张样稿，再自动完成其他配图和视频合成。文字和背景音乐修改不会触发重新生图；单页可单独重画。任务与图片保存在 `data/ppt/<taskId>`，重启后会恢复正在执行的阶段。

PPT 生图调用本机 `local-image-gen` 的异步 API（默认 `http://127.0.0.1:3000`），该服务默认最多并行 2 张，可用 `IMAGE_CONCURRENCY=1..4` 设置。每张图带稳定幂等键；参考图由首张已完成配图提供。可通过 `IMAGE_API_URL` 指定服务地址。PPT 导出使用系统 FFmpeg 与 macOS 中文字体（也可用 `PPT_FONT` 指定字体），页面图片和视频片段按内容缓存，成片保存在项目任务目录，可从工作台播放或下载。背景音乐从工作台导入 MP3/WAV。

开发中如已有一个 `mastra dev` 实例在运行，请使用该实例的工作台路由；Mastra 开发服务对同一项目采用单实例锁。


### 本地 API 调用选项

`POST /api/jobs` 仍支持只传 `prompt`，也可传 `aspect_ratio`（`16:9`、`9:16`、`1:1`）、`reference_ids`（最多 3 个已完成任务）及 `idempotency_key`（同键同请求返回已有任务，同键不同请求返回 409）。任务查询增加 `queue_ms`、`aspect_ratio` 和 `reference_ids` 字段。

默认最大并发为 2，可用 `IMAGE_CONCURRENCY=1..4` 配置。Codex 会按每个任务的画幅生成，并读取参考图片以保持视觉一致。提示词限制为 1–4200 字符。

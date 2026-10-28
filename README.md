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


## 法律案例视频工作台

访问 `http://127.0.0.1:4112/workbench`，粘贴案例材料后，DeepSeek 会生成 6–8 页脚本。确认脚本后先生成首张样稿；确认样稿后按页顺序生成其余配图并导出视频。每页可单独重画。任务保存在 `data/ppt/<taskId>`，中断后可在工作台重试。

### 生图流程

此工作台使用本机 Draw Things 的 HTTP 服务，默认地址为 `http://127.0.0.1:7860`，可通过 `DRAW_THINGS_URL` 修改。启动工作台前，在 Draw Things 中开启 HTTP 服务并加载 `z_image_turbo_1.0_q8p.ckpt`。程序向 `/sdapi/v1/txt2img` 发送每页的插画提示词，固定使用空负面提示词、768×768、8 steps、guidance scale 1、`UniPC Trailing`、shift 3 和随机种子。每次请求最多等待 300 秒。

服务在 `images[0]` 返回 base64 图片；程序解码并检查 PNG 尺寸，然后保存为页面图片。首张样稿必须经人工确认。后续页面沿用统一画风和人物描述，但 `txt2img` 不传首图作为参考图，因此人物一致性仍需人工检查。生图失败时保留已经完成的图片，修复服务后在工作台重试；修改文字、时长、音乐或入场动效不会重新生图，修改配图描述只会重画对应页。

每页可选淡入、模糊显现或飘入，标题、配图和正文依次出现。工作台用 SVG/CSS 预览，成片用 FFmpeg 渲染对应动效。导出依赖系统 FFmpeg 和支持中文的字体；可通过 `PPT_FONT` 指定字体。背景音乐可在工作台导入 MP3/WAV。

手动验证 Draw Things 接口：

```bash
curl -sS --max-time 300 \
  -X POST http://127.0.0.1:7860/sdapi/v1/txt2img \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "z_image_turbo_1.0_q8p.ckpt",
    "prompt": "一只坐在窗台上的橘猫，午后阳光，写实摄影",
    "negative_prompt": "",
    "width": 768,
    "height": 768,
    "steps": 8,
    "guidance_scale": 1,
    "sampler": "UniPC Trailing",
    "shift": 3,
    "seed": -1
  }' \
  | python3 -c '
import sys, json, base64
image = json.load(sys.stdin)["images"][0]
if image.startswith("data:"):
    image = image.split(",", 1)[1]
open("output.png", "wb").write(base64.b64decode(image))
print("saved output.png")
'
```

Story Make 手绘故事是独立流程，仍通过 Codex 内置 imagegen 生成角色和场景图；`DRAW_THINGS_URL` 只影响法律案例工作台。

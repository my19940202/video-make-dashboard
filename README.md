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


## 视频工作台：法律案例与童年回忆录

访问 `http://127.0.0.1:4112/workbench`，新建视频时选择口吻并粘贴素材，DeepSeek 会生成 6–8 页脚本。确认脚本后先生成首张样稿；确认样稿后按页顺序生成其余配图并导出视频。每页可单独重画。任务保存在 `data/ppt/<taskId>`，中断后可在工作台重试。

### 叙述口吻

新建项目时选择 **法律案例解读** 或 **童年回忆录**；新建视频的第一步就是生成可审核的分页稿件。法律模式沿用问题、经过、争议、结论和行动建议的结构，页眉为“案例笔记”。回忆录模式按经历的时间和情绪脉络，以讲述人的“我”来写，允许忠实改写和润色，不补编事件、对白或感受，页眉为“童年手记”。两种模式都需要先确认脚本和首张样稿。

口吻创建后固定；需要换口吻时新建项目。旧项目没有口吻字段时按法律案例解读读取，原有脚本、图片和成片不变。Story Make 手绘故事流程继续保留原文句子和顺序，不受工作台口吻设置影响。

### 配图样式

创建视频时选择整条视频统一使用的配图样式；新项目默认 **彩铅日记漫画**。页面的“配图描述”只写人物、动作和场景，工作台会在生图时组合所选画风与“不含文字”要求。

| 样式 | 画面特点 |
| --- | --- |
| 彩铅日记漫画 | 白底、手抖黑线、低饱和彩铅笔触 |
| 水墨写意 | 宣纸、干湿墨色、大面积留白 |
| 暖色几何扁平绘本 | 圆润几何色块、蓝橙色板、暖白留白 |
| 蓝白编辑插画 | 原工作台的白底、深浅蓝简洁插画 |

前三种样式按 `story-to-handdrawn-video/examples/style-showcase/style-sequence.json` 的顺序选取，画风提示词根据其 `references/handdrawn-style-library.json` 整理并内置于本项目。已有项目没有样式字段时继续使用蓝白编辑插画，原有配图不受影响。主动切换样式会使全部旧配图失效；保存后重新生成、确认首张样稿，再生成其余页面。脚本正文和页面动效保持原样。

### 生图与版式

视频工作台使用本机 Draw Things HTTP 服务，默认 `http://127.0.0.1:7860`，可通过 `DRAW_THINGS_URL` 修改。先在 Draw Things 中开启 HTTP 服务并选择 Z-Image-Turbo 模型。

彩铅日记漫画、水墨写意、暖色几何扁平绘本分别使用项目内 `assets/style-references/` 下对应的 960×960 PNG 参考图。它们从 `story-to-handdrawn-video/references/style-examples/standard/` 的样式示例通过 `sips -z 960 960` 缩放而来。生成时调用 `/sdapi/v1/img2img`，提交画面提示词、对应图片的 base64 `init_images`、960×960、`strength: 0.96`、10 steps，请求超时 600 秒。选用的 Z-Image-Turbo 模型由 Draw Things 当前设置决定。参考图约束画风，但不能保证人物身份或所有细节完全一致，首张样稿仍需人工确认。

旧蓝白编辑插画继续调用 `/sdapi/v1/txt2img`，使用 `z_image_turbo_1.0_q8p.ckpt`、768×768、8 steps、guidance scale 1、`UniPC Trailing`、shift 3、随机种子，超时 300 秒。服务从 `images[0]` 返回 base64 PNG，工作台解码并检查图片尺寸；失败时保留已完成图片，可在工作台重试，不会暗中切换生图方式。修改配图描述只重画对应页，切换样式重画全部页面。

每页插画区域为 920×920，图片铺满该区域；正文位于插画下方，最多 105 字且排版最多 5 行。工作台可用“隐藏页眉和页尾”开关统一隐藏页眉标签、页尾分隔线、页码和时长，页面标题仍显示。预览与视频导出同步；此设置、正文、时长、音乐、入场动效的修改不会重新生图，只会使成片失效。每页可选淡入、模糊显现或飘入。导出依赖 FFmpeg 和支持中文的字体，可通过 `PPT_FONT` 指定字体。背景音乐可导入 MP3/WAV。

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

Story Make 手绘故事是独立流程，仍通过 Codex 内置 imagegen 生成角色和场景图；`DRAW_THINGS_URL` 只影响视频工作台。

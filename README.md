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

新建项目时选择 **法律案例解读** 或 **童年回忆录**；新建视频的第一步就是生成可审核的分页稿件。新版法律模式以封面问句、分开的事实和原因页、结论页、末页小程序提问引导组成 6–8 页。文案专业准确，但用普通人能理解的语言解释为什么这样判断；缺少结论时明确说无法判断。每页正文最多两句，CTA 标题和正文可在编辑器修改。回忆录模式按经历的时间和情绪脉络，以讲述人的“我”来写，允许忠实改写和润色，不补编事件、对白或感受，页眉为“童年手记”。两种模式都需要先确认脚本和首张样稿。

口吻创建后固定；需要换口吻时新建项目。旧项目没有口吻字段时按法律案例解读读取，原有脚本、图片和成片不变。Story Make 手绘故事流程继续保留原文句子和顺序，不受工作台口吻设置影响。

### 画面模板

新建法律案例固定使用法律轮播模板：576×768（3:4）配图，画面中以 690×920 显示，标题最多两行，正文最多 42 字、四行。旧项目保持原版式。回忆录创建时仍可选择“标题＋图片＋正文”或“标题＋满幅图片”；前者使用方图，后者使用 3:4 图片且不显示正文。模板创建后固定，三种模板均支持淡入、模糊显现、飘入动效。

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

视频工作台默认通过 Replicate 的 `openai/gpt-image-2` 生图。设置服务端 `REPLICATE_API_TOKEN`；本地和生产环境均可设置 `IMAGE_PROVIDER=replicate`，此环境变量优先于本地旧设置。请求固定使用 `quality: low`，方图传 `1:1`，法律轮播和满幅模板传 `3:4`；模型返回的 PNG 直接使用，不裁剪。参考图会缩小并压缩后提交。未完成任务保存预测 ID 并在恢复后继续查询。Codex、Draw Things 与 Cloudflare 仍可用 `IMAGE_PROVIDER` 选择；切换生图服务不会重画已有图片。

如使用本机 Draw Things，可设置 `IMAGE_PROVIDER=draw-things`。其 HTTP 服务默认 `http://127.0.0.1:7860`，可通过 `DRAW_THINGS_URL` 修改；先在 Draw Things 中开启 HTTP 服务并选择 Z-Image-Turbo 模型。

彩铅日记漫画、水墨写意、暖色几何扁平绘本分别使用项目内 `assets/style-references/` 下对应的 960×960 PNG 参考图。它们从 `story-to-handdrawn-video/references/style-examples/standard/` 的样式示例通过 `sips -z 960 960` 缩放而来。满幅模板使用 `assets/style-references/portrait/` 下的 576×768 参考图，由方图缩至 768×768 后居中裁切得到。生成时调用 `/sdapi/v1/img2img`，提交画面提示词、对应图片的 base64 `init_images`、目标尺寸、`strength: 0.96`、20 steps，请求超时 600 秒。图文模板目标为 960×960，满幅模板目标为 576×768。选用的 Z-Image-Turbo 模型由 Draw Things 当前设置决定。参考图约束画风，但不能保证人物身份或所有细节完全一致，首张样稿仍需人工确认。

旧蓝白编辑插画继续调用 `/sdapi/v1/txt2img`，使用 `z_image_turbo_1.0_q8p.ckpt`、8 steps、guidance scale 1、`UniPC Trailing`、shift 3、随机种子，超时 300 秒。图文模板为 768×768，满幅模板为 576×768。服务从 `images[0]` 返回 base64 PNG，工作台解码并检查图片尺寸；满幅模板还会校验输出是否为 576×768。失败时保留已完成图片，可在工作台重试，不会暗中切换生图方式。修改配图描述只重画对应页，切换样式重画全部页面；已有满幅模板项目的旧方图不会自动重画，可在页面点击“重画这一页”生成新比例。

图文模板的正文最多 105 字且排版最多 5 行。工作台可用“隐藏页眉和页尾”开关统一隐藏页眉标签、页尾分隔线、页码和时长，页面标题仍显示。预览与视频导出同步；此设置、正文、时长、音乐、入场动效的修改不会重新生图，只会使成片失效。导出依赖 FFmpeg 和支持中文的字体；`PPT_FONT` 可指定正文及页眉页脚字体，标题默认使用较粗的 `/System/Library/Fonts/STHeiti Medium.ttc`，也可通过 `PPT_TITLE_FONT` 单独指定标题字体。背景音乐可导入 MP3/WAV。

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

## SaaS 上线准备（国内先行）

当前工作台适合作为本机创作工具，还不是可直接公开收费的多用户服务：项目接口 `requiresAuth:false`，数据和文件保存在本机 `data/ppt`，生图依赖本机 Draw Things，任务由当前进程执行。下面是后续改造顺序，不代表这些能力已经上线。

### 定位与 SEO 候选词

优先定位为“把故事或素材做成连环画式竖屏视频”。当前成片是逐页插画与入场动效，不承诺角色逐帧动画或配音。先验证以下搜索词；它们是候选词，尚无搜索量、难度或转化数据：

| 意图 | 待验证关键词 | 对应页面 |
| --- | --- | --- |
| 找工具 | 文字生成漫画视频、故事生成漫画视频、AI 连环画制作 | 首页与产品功能页 |
| 找具体做法 | 图文故事视频制作、AI 绘本视频制作、图片制作故事视频 | 模板示例与操作教程 |
| 找场景方案 | 童年回忆录视频制作、家庭故事视频制作、法律案例图解视频 | 有真实样片的场景页 |

“AI 漫剧制作”可以观察，但它常指更完整的剧情动画；现有产品应先用实际成片验证搜索意图，避免页面承诺超出能力。类似产品已经覆盖[漫画视频](https://felo.ai/zh-Hans/tools/create-manga-video)、[故事视频](https://fableclip.com/zh/story-to-video)和[绘本视频](https://storypix.art/zh-CN)页面，这说明需要按用户要完成的任务设计页面，不能只堆关键词。

选词时用[百度关键词规划师](https://pd.baidu.com/case/c1/23329.html)核实搜索量与竞争情况，逐词检查搜索结果是否以工具为主；上线后在[百度搜索资源平台](https://ziyuan.baidu.com/doc)观察收录、实际查询词和搜索流量。每个目标词对应一个有样片、操作步骤和明确入口的页面；同时记录访问、开始创作、完成导出及付费转化。再决定是否扩展英文站与 Google 搜索。

### 改造顺序与上线闸门

1. **图片 API 与成本。** 抽出服务端生图适配层，保留提示词和参考图的统一输入，比较国内供应商的风格还原、角色一致性、时延、失败率、单张成本与商用条款。[火山方舟图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)和[阿里云百炼图像编辑 API](https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference)都可作为参考图生图候选。选型后把密钥仅放服务端，保存模型、参数、调用成本和错误信息；图片需及时下载到自有存储。先完成固定样本的画质与成本对比，再替换本机 Draw Things 路径。
2. **多用户基础。** 增加登录、用户和项目归属校验、私有文件访问、对象存储及持久化任务队列。所有列表、编辑、重画、音乐和下载接口都必须按用户隔离；限制并发、文件大小和可用额度，支持任务恢复、重试、取消与数据删除。上线前用两个账号做交叉访问验证，并完成备份和恢复演练。
3. **收费与运营。** 按一次完整视频的脚本、生图、重画、导出成本设计试用额度和计费；实现支付回调幂等、额度扣减与失败退款，显示预计消耗和账单。准备服务协议、隐私规则、版权与素材授权说明、投诉入口、客服和故障公告。以“注册→首张样稿→导出→付费”漏斗观察产品是否值得扩张。
4. **国内公开发布核查。** 根据经营主体、托管位置和具体业务核定网站备案或许可；评估面向公众提供生成式 AI 服务的相关要求、所用模型备案信息展示、内容审核及[AI 生成内容标识](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。用户故事、裁判材料和参考图可能含个人信息，需落实告知、授权、保存期限和删除机制。相关依据见[工信部互联网信息服务管理办法](https://www.miit.gov.cn/zwgk/zcwj/flfg/art/2020/art_4c6a91eb93c34a6e8adc5852f9b56fd1.html)、[生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)与[个人信息保护法](https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_515a4b20c12f430eab54bb4f56d89f56.html)。具体手续在上线前由熟悉该业务的专业人士核定。

公开收费的最低验收：陌生用户无需本机服务即可完成创作和下载；账号之间不能访问对方项目或素材；每次生成可计费、可追踪、可重试；支付和退款路径经过真实小额验证；备案、协议、隐私、内容处理及标识事项已完成适用性核查。

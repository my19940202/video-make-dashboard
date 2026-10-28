import { z } from 'zod';

export const styleIds = ['colored-pencil-diary', 'ink-wash', 'warm-flat-storybook', 'legacy-blue'] as const;
export const styleIdSchema = z.enum(styleIds);
export type StyleId = z.infer<typeof styleIdSchema>;

// The first three styles are adapted from story-to-handdrawn-video's style library.
// Keep these prompts local so the workbench does not depend on that repository at runtime.
const stylePrompts: Record<StyleId, string> = {
  'colored-pencil-diary': '彩铅日记漫画。纯白背景，笨拙而有轻微手抖的黑色毡尖笔轮廓，圆润大头、短小身体和简洁表情。用可见的短斜线彩铅笔触填色，色块保留白色缝隙。只用灰蓝、砖红、炭黑、暖米色、浅棕、柔黄和浅灰，场景道具简洁，大面积留白。避免光滑数字填色、写实光影、水彩、渐变、动漫与三维效果。',
  'ink-wash': '中国传统写意水墨画。明亮宣纸背景，以焦、浓、重、淡、清的黑墨和干湿变化表现人物与场景。寥寥几笔抓住动作与神态，保留飞白、枯笔和自然洇化；主体偏置，大量留白，最多少量淡赭石或花青点染。避免均匀灰度滤镜、封闭硬轮廓、艳丽彩绘、写实摄影和密集背景。',
  'warm-flat-storybook': '暖色几何扁平绘本。用少量大而圆润的几何色块构成人物和道具，形状主要靠色彩相接，仅在五官和少量细节用极细深藏青线。成人比例自然，动作弧线柔软；每个色块最多一块硬边同色阴影，不用渐变。主体集中在中下部，保留大面积暖白留白。仅用深藏青、雾蓝、珊瑚橙、金橙、暖桃肤色和暖白；避免企业矢量小人、Q版、厚描边、三维和复杂背景。',
  'legacy-blue': '白底、深蓝与浅蓝配色，简洁清晰的编辑插画。人物造型与衣着保持前后一致。',
};

export function imagePrompt(styleId: StyleId, scene: string): string {
  return `为法律案例知识卡绘制一张插画。${stylePrompts[styleId]}画面内容：${scene}。画面内不含任何文字、数字、标注、印章、签名、标志或水印。`;
}

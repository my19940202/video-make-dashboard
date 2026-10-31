const svgOpen =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1920" viewBox="0 0 1080 1920">';
const fontFamily = 'PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif';

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[c]));
}

function charWidth(ch) {
  return /[\u0000-\u00ff]/.test(ch) ? 0.56 : 1;
}

function textWidth(value) {
  let width = 0;
  for (const ch of value) width += charWidth(ch);
  return width;
}

const breakAfter = /[，。！？、；：,.!?;:]/;

export function wrap(value, limit) {
  const lines = [];
  let line = '';
  let width = 0;
  for (const ch of value) {
    const w = charWidth(ch);
    if (ch === '\n') {
      lines.push(line);
      line = '';
      width = 0;
      continue;
    }
    if (width + w > limit) {
      lines.push(line);
      line = '';
      width = 0;
    }
    line += ch;
    width += w;
  }
  if (line) lines.push(line);
  return lines;
}

// 先尽量放满一行；放不下时退到最近的标点。避免把「充电桩」「配合」从中间切开。
function wrapSoft(value, limit) {
  const lines = [];
  for (const paragraph of String(value).split('\n')) {
    let rest = [...paragraph];
    if (rest.length === 0) {
      lines.push('');
      continue;
    }
    while (rest.length) {
      let width = 0;
      let count = 0;
      let punct = -1;
      for (const ch of rest) {
        const w = charWidth(ch);
        if (width + w > limit) break;
        width += w;
        if (breakAfter.test(ch)) punct = count;
        count++;
      }
      if (count === 0) count = 1;
      const overflow = count < rest.length;
      let cut = count;
      if (overflow && punct > 0) cut = punct + 1;
      else if (overflow && rest.length - count === 1 && count > 2) cut = count - 1;
      lines.push(rest.slice(0, cut).join(''));
      rest = rest.slice(cut);
    }
  }
  return lines;
}

function wrapTitle(value, limit) {
  const paragraphs = String(value).split('\n');
  if (paragraphs.length > 1) return wrapSoft(value, limit);
  const text = paragraphs[0];
  if (textWidth(text) <= limit) return text ? [text] : [];
  const chars = [...text];
  if (textWidth(text) <= limit * 2) {
    let best = null;
    for (let i = 1; i < chars.length; i++) {
      const left = chars.slice(0, i).join('');
      const right = chars.slice(i).join('');
      if (textWidth(left) > limit || textWidth(right) > limit) continue;
      const punct = breakAfter.test(chars[i - 1]) ? 0 : 1;
      const rank = punct * 100 + Math.abs(textWidth(left) - textWidth(right));
      if (!best || rank < best.rank) best = { rank, left, right };
    }
    if (best) return [best.left, best.right];
  }
  return wrapSoft(text, limit);
}

function legalLimit(size, x) {
  return (1080 - x - 48) / size;
}

export function legalTextLines(page) {
  const title = wrapTitle(page.title, legalLimit(legalCarousel.titleSize, legalCarousel.titleX));
  const body = wrapSoft(page.body, legalLimit(legalCarousel.bodySize, legalCarousel.bodyX));
  const sentenceCount = (page.body.match(/[。！？!?]/g) || []).length;
  if (title.length > 2 || page.body.length > 42 || body.length > 4 || sentenceCount > 2) {
    throw new Error('法律轮播文字超出版面：标题最多两行，正文最多两句、42字、4行');
  }
  return { title, body };
}

function motionStyle(effect, animate) {
  if (!animate) return '';
  const css = [
    `.entrance{animation:${effect} .55s ease-out both}`,
    '.title{animation-delay:.12s}',
    '.art{animation-delay:.42s}',
    '.body{animation-delay:.72s}',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes blur{from{opacity:0;filter:blur(16px)}to{opacity:1;filter:blur(0)}}',
    '@keyframes float{from{opacity:0;transform:translateY(42px)}to{opacity:1;transform:translateY(0)}}',
  ].join('');
  return `<style>${css}</style>`;
}

function entranceEffect(page) {
  return ['fade', 'blur', 'float'].includes(page.entrance) ? page.entrance : 'fade';
}

// 法律轮播的字号和位置。预览与 scripts/render-ppt.cjs 都读这里。
// titleSize / bodySize 是字号，titleStep / bodyStep 是相邻两行基线的距离，必须大于字号。
// bodyBaseline 是正文第一行基线：加大则离上方图片更远，减小则更近。panelY 是盖住图片下缘的白底上沿。
export const legalCarousel = {
  titleBaseline: 195,
  titleSize: 90,
  titleWeight: 600,
  titleStep: 120,
  titleX: 48,
  titleDrawY: 94,
  titleRegionY: 45,
  titleRegionHeight: 315,
  bodyBaseline: 1530,
  bodySize: 60,
  bodyWeight: 500,
  bodyStep: 100,
  bodyX: 80,
  panelX: 48,
  panelY: 1440,
  panelWidth: 984,
  panelHeight: 420,
};

export function pageSvg(
  page,
  index,
  total,
  image = '',
  animate = false,
  narrativeMode = 'legal-case',
  hideHeaderFooter = false,
  layoutTemplate = 'text-illustration',
) {
  if (layoutTemplate === 'legal-carousel-v2') {
    const { title, body } = legalTextLines(page);
    const effect = entranceEffect(page);
    const motion = motionStyle(effect, animate);
    // The 1080px export is a 3x rendition of a 360px design: 48px here equals 16px padding.
    const lines = (items, y, size, weight, step, x = 48) =>
      items
        .map(
          (line, i) =>
            `<text x="${x}" y="${y + i * step}" font-size="${size}" font-weight="${weight}" fill="#172a46">${escapeXml(line)}</text>`,
        )
        .join('');
    const header = hideHeaderFooter
      ? ''
      : '<text x="48" y="80" font-size="26" font-weight="600" fill="#546783">案例笔记</text>';
    const art = image
      ? `<image x="48" y="360" width="984" height="1312" preserveAspectRatio="xMidYMid meet" xlink:href="${escapeXml(image)}"/>`
      : '<text x="540" y="1000" text-anchor="middle" font-size="32" fill="#8191a9">配图生成后出现在这里</text>';
    const footer = hideHeaderFooter
      ? ''
      : `<text x="48" y="1900" font-size="24" fill="#72829a">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text>`;
    return [
      svgOpen,
      motion,
      '<rect width="1080" height="1920" fill="#f8f7f2"/>',
      `<g font-family="${fontFamily}">`,
      '<g class="entrance title">',
      header,
      lines(title, legalCarousel.titleBaseline, legalCarousel.titleSize, legalCarousel.titleWeight, legalCarousel.titleStep, legalCarousel.titleX),
      '</g>',
      '<g class="entrance art">',
      '<rect x="48" y="360" width="984" height="1312" fill="#e9eef7"/>',
      art,
      '</g>',
      '<g class="entrance body">',
      `<rect x="${legalCarousel.panelX}" y="${legalCarousel.panelY}" width="${legalCarousel.panelWidth}" height="${legalCarousel.panelHeight}" fill="#f8f7f2" fill-opacity=".96"/>`,
      lines(body, legalCarousel.bodyBaseline, legalCarousel.bodySize, legalCarousel.bodyWeight, legalCarousel.bodyStep, legalCarousel.bodyX),
      '</g>',
      footer,
      '</g></svg>',
    ].join('');
  }

  const title = wrap(page.title, 13);
  const body = wrap(page.body, 21);
  if (title.length > 3 || page.body.length > 105 || body.length > 5) {
    throw new Error('文字超出版面，请缩短标题或正文（正文最多105字、5行）');
  }
  const text = (lines, y, size, weight, color, step) =>
    lines
      .map(
        (line, i) =>
          `<text x="88" y="${y + i * step}" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`,
      )
      .join('');
  const effect = entranceEffect(page);
  const pageLabel = narrativeMode === 'childhood-memoir' ? '童年手记' : '案例笔记';
  const motion = motionStyle(effect, animate);

  if (layoutTemplate === 'title-full-image') {
    const art = image
      ? `<image x="0" y="480" width="1080" height="1440" preserveAspectRatio="xMidYMid slice" xlink:href="${escapeXml(image)}"/>`
      : '<rect x="0" y="480" width="1080" height="1440" fill="#e9eef7"/><text x="540" y="1200" text-anchor="middle" font-size="32" fill="#8191a9">配图生成后出现在这里</text>';
    return [
      svgOpen,
      motion,
      '<rect width="1080" height="1920" fill="#f6f8fc"/>',
      `<g font-family="${fontFamily}">`,
      '<g class="entrance title">',
      text(title, 236, 62, 600, '#172a46', 82),
      '</g>',
      '<g class="entrance art">',
      art,
      '</g></g></svg>',
    ].join('');
  }

  const header = hideHeaderFooter
    ? ''
    : `<rect x="88" y="96" width="8" height="32" rx="4" fill="#355cce"/><text x="116" y="122" font-size="25" fill="#546783" letter-spacing="4">${pageLabel}</text>`;
  const art = image
    ? `<image x="80" y="496" width="920" height="920" preserveAspectRatio="xMidYMid slice" xlink:href="${escapeXml(image)}"/>`
    : '<text x="540" y="980" text-anchor="middle" font-size="32" fill="#8191a9">配图生成后出现在这里</text>';
  const footer = hideHeaderFooter
    ? ''
    : `<line x1="88" y1="1810" x2="992" y2="1810" stroke="#d4deeb"/><text x="88" y="1858" font-size="24" fill="#72829a">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text><text x="992" y="1858" text-anchor="end" font-size="24" fill="#72829a">${page.duration} 秒</text>`;
  return [
    svgOpen,
    motion,
    '<rect width="1080" height="1920" fill="#f6f8fc"/>',
    `<g font-family="${fontFamily}">`,
    '<g class="entrance title">',
    header,
    text(title, 236, 64, 600, '#172a46', 82),
    '</g>',
    '<g class="entrance art">',
    '<rect x="64" y="480" width="952" height="952" rx="24" fill="#e9eef7"/>',
    art,
    '</g>',
    '<g class="entrance body">',
    text(body, 1500, 42, 400, '#263b57', 57),
    '</g>',
    footer,
    '</g></svg>',
  ].join('');
}

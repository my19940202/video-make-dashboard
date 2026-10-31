const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);

function cmd(name, args) {
  const result = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${name}: ${result.error || result.stderr?.slice(-2000)}`);
  }
}

function wrap(value, limit) {
  const lines = [];
  let line = '';
  let width = 0;
  for (const ch of value) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      width = 0;
      continue;
    }
    const next = /[\u0000-\u00ff]/.test(ch) ? 0.56 : 1;
    if (width + next > limit) {
      lines.push(line);
      line = '';
      width = 0;
    }
    line += ch;
    width += next;
  }
  if (line) lines.push(line);
  return lines;
}

function fontFile(file) {
  return file.replace(/ /g, '\\ ');
}

(async () => {
  const props = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const { pageSvg, legalTextLines } = await import(
    pathToFileURL(path.resolve(__dirname, '../public/workbench/layout.mjs')),
  );
  const pageLabel = props.narrativeMode === 'childhood-memoir' ? '童年手记' : '案例笔记';
  const fullImage = props.layoutTemplate === 'title-full-image';
  const legal = props.layoutTemplate === 'legal-carousel-v2';
  const cache = path.join(props.projectDir, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const font = process.env.PPT_FONT || '/System/Library/Fonts/STHeiti Light.ttc';
  const titleFont = process.env.PPT_TITLE_FONT || '/System/Library/Fonts/STHeiti Medium.ttc';
  if (!fs.existsSync(font)) {
    throw new Error(`缺少中文字体：${font}。请设置 PPT_FONT 指向支持中文的字体文件。`);
  }
  if (!fs.existsSync(titleFont)) {
    throw new Error(`缺少标题中文字体：${titleFont}。请设置 PPT_TITLE_FONT 指向支持中文的字体文件。`);
  }

  const clips = [];
  for (let i = 0; i < props.pages.length; i++) {
    const page = props.pages[i];
    const imagePath = path.resolve(props.projectDir, page.image);
    if (!fs.existsSync(imagePath)) throw new Error(`缺少第${i + 1}页配图：${imagePath}`);
    const image = fs.readFileSync(imagePath).toString('base64');
    const svg = pageSvg(
      page,
      i,
      props.pages.length,
      `data:image/png;base64,${image}`,
      false,
      props.narrativeMode,
      props.hideHeaderFooter,
      props.layoutTemplate,
    );
    const pageHash = hash(`${svg}:layout-v6:${titleFont}`);
    const png = path.join(cache, `${pageHash}.png`);
    if (!fs.existsSync(png)) {
      const textRoot = path.join(cache, pageHash);
      const titlePath = `${textRoot}-title.txt`;
      const bodyPath = `${textRoot}-body.txt`;
      const { title, body } = legal
        ? legalTextLines(page)
        : { title: wrap(page.title, 13), body: wrap(page.body, 21) };
      if (!legal && (title.length > 3 || page.body.length > 105 || body.length > 5)) {
        throw new Error(`第${i + 1}页文字超出版面，请缩短标题或正文（正文最多105字、5行）。`);
      }
      fs.writeFileSync(titlePath, title.join('\n'));
      fs.writeFileSync(bodyPath, body.join('\n'));

      const draw = (textfile, size, y, colour, spacing, fontfile = font, x = 88) =>
        `drawtext=fontfile=${fontFile(fontfile)}:textfile=${textfile}:fontcolor=${colour}:fontsize=${size}:line_spacing=${spacing}:x=${x}:y=${y}:expansion=none`;
      const pageNo = `${String(i + 1).padStart(2, '0')} / ${String(props.pages.length).padStart(2, '0')}`;
      const header = props.hideHeaderFooter
        ? ''
        : `drawbox=x=88:y=96:w=8:h=32:color=0x355cce:t=fill,drawtext=fontfile=${fontFile(font)}:text='${pageLabel}':fontcolor=0x546783:fontsize=25:x=116:y=96:expansion=none,`;
      const footer = props.hideHeaderFooter
        ? ''
        : `,drawbox=x=88:y=1810:w=904:h=1:color=0xd4deeb:t=fill,drawtext=fontfile=${fontFile(font)}:text='${pageNo}':fontcolor=0x72829a:fontsize=24:x=88:y=1840:expansion=none,drawtext=fontfile=${fontFile(font)}:text='${page.duration} 秒':fontcolor=0x72829a:fontsize=24:x=920:y=1840:expansion=none`;
      const legalHeader = props.hideHeaderFooter
        ? ''
        : `drawtext=fontfile=${fontFile(font)}:text='案例笔记':fontcolor=0x546783:fontsize=26:x=48:y=54:expansion=none,`;
      const legalFooter = props.hideHeaderFooter
        ? ''
        : `,drawtext=fontfile=${fontFile(font)}:text='${pageNo}':fontcolor=0x72829a:fontsize=24:x=48:y=1876:expansion=none`;
      const layout = legal
        ? `[0:v]drawbox=x=48:y=360:w=984:h=1312:color=0xe9eef7:t=fill[base];[1:v]scale=984:1312:force_original_aspect_ratio=decrease,pad=984:1312:(ow-iw)/2:(oh-ih)/2:color=0xe9eef7[art];[base][art]overlay=48:360,${legalHeader}${draw(titlePath, 128, 94, '0x172a46', 2, titleFont, 48)},drawbox=x=48:y=1440:w=984:h=420:color=0xf8f7f2@0.96:t=fill,${draw(bodyPath, 68, 1462, '0x172a46', 32, titleFont, 80)}${legalFooter}[v]`
        : fullImage
          ? `[1:v]scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440[art];[0:v][art]overlay=0:480,${draw(titlePath, 64, 205, '0x172a46', 18, titleFont)}[v]`
          : `[0:v]drawbox=x=64:y=480:w=952:h=952:color=0xe9eef7:t=fill[base];[1:v]scale=920:920:force_original_aspect_ratio=increase,crop=920:920[art];[base][art]overlay=80:496,${header}${draw(titlePath, 64, 205, '0x172a46', 18, titleFont)},${draw(bodyPath, 42, 1465, '0x263b57', 15)}${footer}[v]`;
      try {
        cmd('ffmpeg', [
          '-y',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=${legal ? '0xf8f7f2' : '0xf6f8fc'}:s=1080x1920:r=1:d=1`,
          '-i',
          imagePath,
          '-filter_complex',
          layout,
          '-map',
          '[v]',
          '-frames:v',
          '1',
          png,
        ]);
      } catch (error) {
        throw new Error(`第${i + 1}页排版失败：${error.message}`);
      }
    }

    const entrance = ['fade', 'blur', 'float'].includes(page.entrance) ? page.entrance : 'fade';
    const clip = path.join(cache, `${hash(`${pageHash}:${page.duration}:${entrance}:motion-v5`)}.mp4`);
    if (!fs.existsSync(clip)) {
      const regions = legal
        ? [
            ['title', 45, 315, 0.12],
            ['art', 360, 1312, 0.42],
            ['body', 1440, 420, 0.72],
          ]
        : fullImage
          ? [
              ['title', 80, 390, 0.12],
              ['art', 480, 1440, 0.42],
            ]
          : [
              ['title', 80, 390, 0.12],
              ['art', 480, 952, 0.42],
              ['body', 1460, 330, 0.72],
            ];
      const names = regions.map((region) => region[0]);
      const splitNames = ['base', ...names, ...(entrance === 'blur' ? names.map((name) => `${name}blur`) : [])];
      const background = legal ? '0xf8f7f2' : '0xf6f8fc';
      const clear = regions
        .map(([, y, h]) => `drawbox=x=0:y=${y}:w=1080:h=${h}:color=${background}:t=fill`)
        .join(',');
      const parts = [
        `[0:v]split=${splitNames.length}${splitNames.map((name) => `[${name}]`).join('')}`,
        `[base]${clear}[b0]`,
      ];
      let last = 'b0';
      for (let n = 0; n < regions.length; n++) {
        const [name, y, h, delay] = regions[n];
        const next = `b${n + 1}`;
        const fadeStart = entrance === 'blur' ? delay + 0.25 : delay;
        const fadeDuration = entrance === 'blur' ? 0.3 : 0.55;
        const alpha = `[${name}]crop=1080:${h}:0:${y},format=rgba,fade=t=in:st=${fadeStart}:d=${fadeDuration}:alpha=1`;
        parts.push(`${alpha}[layer${n}]`);
        if (entrance === 'blur') {
          parts.push(
            `[${name}blur]crop=1080:${h}:0:${y},gblur=sigma=12,format=rgba,fade=t=in:st=${delay}:d=0.2:alpha=1,fade=t=out:st=${delay + 0.25}:d=0.3:alpha=1[blur${n}]`,
          );
          parts.push(`[${last}][blur${n}]overlay=x=0:y=${y}:eval=frame[blurbase${n}]`);
          parts.push(`[blurbase${n}][layer${n}]overlay=x=0:y=${y}:eval=frame[${next}]`);
        } else if (entrance === 'float') {
          parts.push(
            `[${last}][layer${n}]overlay=x=0:y=${y}+42*max(0\\,1-(t-${delay})/0.55):eval=frame[${next}]`,
          );
        } else {
          parts.push(`[${last}][layer${n}]overlay=x=0:y=${y}:eval=frame[${next}]`);
        }
        last = next;
      }
      parts.push(`[${last}]format=yuv420p[v]`);
      cmd('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-loop',
        '1',
        '-framerate',
        '30',
        '-i',
        png,
        '-filter_complex',
        parts.join(';'),
        '-map',
        '[v]',
        '-t',
        String(page.duration),
        '-r',
        '30',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-an',
        clip,
      ]);
    }
    clips.push(clip);
  }

  const fingerprint = hash(clips.join('|'));
  const silent = path.join(cache, `${fingerprint}-silent.mp4`);
  if (!fs.existsSync(silent)) {
    const manifest = path.join(cache, `concat-${fingerprint}.txt`);
    fs.writeFileSync(
      manifest,
      clips.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'),
    );
    cmd('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', manifest, '-c', 'copy', silent]);
  }
  const duration = props.pages.reduce((sum, page) => sum + page.duration, 0);
  const output = path.join(props.projectDir, `final-${props.revision}.mp4`);
  if (props.musicPath) {
    cmd('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-i',
      silent,
      '-stream_loop',
      '-1',
      '-i',
      props.musicPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-af',
      `volume=${props.volume},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, duration - 2)}:d=2`,
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-t',
      String(duration),
      '-movflags',
      '+faststart',
      output,
    ]);
  } else {
    cmd('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-c', 'copy', '-movflags', '+faststart', output]);
  }
  console.log(output);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

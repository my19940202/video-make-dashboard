const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
function cmd(name,args){const result=spawnSync(name,args,{encoding:'utf8',maxBuffer:4*1024*1024});if(result.status!==0)throw new Error(`${name}: ${result.error||result.stderr?.slice(-2000)}`);}
function wrap(value,limit){const lines=[];let line='',width=0;for(const ch of value){if(ch==='\n'){lines.push(line);line='';width=0;continue;}const next=/[\u0000-\u00ff]/.test(ch)?.56:1;if(width+next>limit){lines.push(line);line='';width=0;}line+=ch;width+=next;}if(line)lines.push(line);return lines;}
(async()=>{
 const props=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const {pageSvg}=await import(pathToFileURL(path.resolve(__dirname,'../public/workbench/layout.mjs')));
 const cache=path.join(props.projectDir,'cache');fs.mkdirSync(cache,{recursive:true});
 const font=process.env.PPT_FONT || '/System/Library/Fonts/STHeiti Light.ttc';
 if(!fs.existsSync(font))throw new Error(`缺少中文字体：${font}。请设置 PPT_FONT 指向支持中文的字体文件。`);
 const clips=[];
 for(let i=0;i<props.pages.length;i++){
  const page=props.pages[i];const imagePath=path.resolve(props.projectDir,page.image);
  if(!fs.existsSync(imagePath))throw new Error(`缺少第${i+1}页配图：${imagePath}`);
  const image=fs.readFileSync(imagePath).toString('base64');const svg=pageSvg(page,i,props.pages.length,`data:image/png;base64,${image}`);
  const pageHash=hash(svg+':layout-v2');const png=path.join(cache,pageHash+'.png');
  if(!fs.existsSync(png)){
   const textRoot=path.join(cache,pageHash);const titlePath=textRoot+'-title.txt',bodyPath=textRoot+'-body.txt';
   const title=wrap(page.title,13),body=wrap(page.body,21);
   if(title.length>3||body.length>10)throw new Error(`第${i+1}页文字超出版面，请缩短标题或正文。`);
   fs.writeFileSync(titlePath,title.join('\n'));fs.writeFileSync(bodyPath,body.join('\n'));
   const draw=(textfile,size,y,colour,spacing)=>`drawtext=fontfile=${font.replace(/ /g,'\\ ')}:textfile=${textfile}:fontcolor=${colour}:fontsize=${size}:line_spacing=${spacing}:x=88:y=${y}:expansion=none`;
   const layout=`[0:v]drawbox=x=64:y=480:w=952:h=600:color=0xe9eef7:t=fill[base];[1:v]scale=920:568:force_original_aspect_ratio=decrease[art];[base][art]overlay=(W-w)/2:496,drawbox=x=88:y=96:w=8:h=32:color=0x355cce:t=fill,drawtext=fontfile=${font.replace(/ /g,'\\ ')}:text='案例笔记':fontcolor=0x546783:fontsize=25:x=116:y=96:expansion=none,${draw(titlePath,64,205,'0x172a46',18)},${draw(bodyPath,42,1190,'0x263b57',15)},drawbox=x=88:y=1810:w=904:h=1:color=0xd4deeb:t=fill,drawtext=fontfile=${font.replace(/ /g,'\\ ')}:text='${String(i+1).padStart(2,'0')} / ${String(props.pages.length).padStart(2,'0')}':fontcolor=0x72829a:fontsize=24:x=88:y=1840:expansion=none,drawtext=fontfile=${font.replace(/ /g,'\\ ')}:text='${page.duration} 秒':fontcolor=0x72829a:fontsize=24:x=920:y=1840:expansion=none[v]`;
   try{cmd('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=0xf6f8fc:s=1080x1920:r=1:d=1','-i',imagePath,'-filter_complex',layout,'-map','[v]','-frames:v','1',png]);}
   catch(error){throw new Error(`第${i+1}页排版失败：${error.message}`);}
  }
  const entrance=['fade','blur','float'].includes(page.entrance)?page.entrance:'fade';
  const clip=path.join(cache,hash(pageHash+':'+page.duration+':'+entrance+':motion-v3')+'.mp4');
  if(!fs.existsSync(clip)){
   const regions=[['title',80,390,.12],['art',480,600,.42],['body',1130,660,.72]];
   const parts=[entrance==='blur'?'[0:v]split=7[base][title][art][body][titleblur][artblur][bodyblur]':'[0:v]split=4[base][title][art][body]','[base]drawbox=x=0:y=80:w=1080:h=390:color=0xf6f8fc:t=fill,drawbox=x=0:y=480:w=1080:h=600:color=0xf6f8fc:t=fill,drawbox=x=0:y=1130:w=1080:h=660:color=0xf6f8fc:t=fill[b0]'];
   let last='b0';
   for(let n=0;n<regions.length;n++){
    const [name,y,h,delay]=regions[n],next=`b${n+1}`;
    const alpha=`[${name}]crop=1080:${h}:0:${y},format=rgba,fade=t=in:st=${entrance==='blur'?delay+.25:delay}:d=${entrance==='blur'?.3:.55}:alpha=1`;
    parts.push(`${alpha}[layer${n}]`);
    if(entrance==='blur'){
     parts.push(`[${name}blur]crop=1080:${h}:0:${y},gblur=sigma=12,format=rgba,fade=t=in:st=${delay}:d=0.2:alpha=1,fade=t=out:st=${delay+.25}:d=0.3:alpha=1[blur${n}]`);
     parts.push(`[${last}][blur${n}]overlay=x=0:y=${y}:eval=frame[blurbase${n}]`);
     parts.push(`[blurbase${n}][layer${n}]overlay=x=0:y=${y}:eval=frame[${next}]`);
    }else if(entrance==='float')parts.push(`[${last}][layer${n}]overlay=x=0:y=${y}+42*max(0\\,1-(t-${delay})/0.55):eval=frame[${next}]`);
    else parts.push(`[${last}][layer${n}]overlay=x=0:y=${y}:eval=frame[${next}]`);
    last=next;
   }
   parts.push(`[${last}]format=yuv420p[v]`);
   cmd('ffmpeg',['-y','-v','error','-loop','1','-framerate','30','-i',png,'-filter_complex',parts.join(';'),'-map','[v]','-t',String(page.duration),'-r','30','-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-an',clip]);
  }
  clips.push(clip);
 }
 const fingerprint=hash(clips.join('|'));const silent=path.join(cache,`${fingerprint}-silent.mp4`);
 if(!fs.existsSync(silent)){
  const manifest=path.join(cache,'concat-'+fingerprint+'.txt');fs.writeFileSync(manifest,clips.map(file=>`file '${file.replace(/'/g,"'\\''")}'`).join('\n'));
  cmd('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',manifest,'-c','copy',silent]);
 }
 const duration=props.pages.reduce((sum,page)=>sum+page.duration,0);const output=path.join(props.projectDir,`final-${props.revision}.mp4`);
 if(props.musicPath)cmd('ffmpeg',['-y','-v','error','-i',silent,'-stream_loop','-1','-i',props.musicPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-af',`volume=${props.volume},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0,duration-2)}:d=2`,'-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart',output]);
 else cmd('ffmpeg',['-y','-v','error','-i',silent,'-c','copy','-movflags','+faststart',output]);
 console.log(output);
})().catch(error=>{console.error(error);process.exit(1)});

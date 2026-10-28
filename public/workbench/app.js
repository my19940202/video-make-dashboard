import {pageSvg} from '/workbench/layout.mjs';
const $=id=>document.getElementById(id);
let project=null,selected=0,dirty=false,busy=false,music=[],polling=false;
const labels={drafting:'正在整理脚本',script:'等待确认脚本','sample-generating':'正在生成样稿',sample:'等待确认样稿',producing:'正在生成配图',rendering:'正在合成视频',done:'可以查看成片',failed:'制作中断'};
const generating=()=>project && ['drafting','sample-generating','producing','rendering'].includes(project.state);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000);}
async function api(url,method='GET',data){const res=await fetch(url,{method,headers:data && !(data instanceof FormData)?{'content-type':'application/json'}:undefined,body:data?data instanceof FormData?data:JSON.stringify(data):undefined});const value=await res.json();if(!res.ok)throw new Error(value.error||'请求失败');return value;}
async function guarded(fn){if(busy)return;busy=true;try{await fn();}catch(e){toast(e.message);}finally{busy=false;renderControls();}}
const asset=(p,page)=>page.image?`/ppt/projects/${p.id}/assets/${page.image}`:'';
function svgUrl(page,index,image,animate=false){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageSvg(page,index,project.pages.length,image,animate))}`;}
function mark(){dirty=true;$('saved').textContent='有未保存修改';renderPreview();renderControls();}
function renderControls(){if(!project)return;const locked=generating()||busy;
  ['saveButton','addPage','moveUp','moveDown','deletePage','redraw','pageTitle','pageBody','pagePrompt','pageDuration','pageEntrance','projectTitle','musicSelect','volume'].forEach(id=>$(id).disabled=locked);
  $('saveButton').disabled=locked||!dirty;$('redraw').disabled=locked||!project.scriptApproved||!project.pages.length;
  const map={script:['确认脚本，生成样稿','script'],sample:['确认样稿，开始制作','sample'],done:[project.final?'重新导出':'导出修改后的成片','render'],failed:['重试未完成步骤','retry']};
  const config=map[project.state];$('primaryAction').textContent=config?config[0]:labels[project.state];$('primaryAction').dataset.action=config?.[1]||'';$('primaryAction').disabled=locked||!config;
}
function renderPreview(){if(!project)return;const page=project.pages[selected];if(!page){$('canvas').textContent='正在整理分页脚本…';return;}
  $('canvas').replaceChildren();try{const img=document.createElement('img');img.alt=page.title;img.src=svgUrl(page,selected,asset(project,page),true);$('canvas').append(img);}catch(e){const d=document.createElement('div');d.className='overflow-message';d.textContent=e.message;$('canvas').append(d);}
  $('duration').textContent=`${project.pages.length} 页 · 总时长 ${project.pages.reduce((n,p)=>n+Number(p.duration),0).toFixed(1)} 秒`;
  $('textCount').textContent=`${page.body.length} / 180 字`;
}
// SVG image URLs cannot fetch nested remote images, so embed the generated illustration for preview.
const images=new Map();
async function embedPreview(){if(!project)return;const id=project.id,idx=selected,page=project.pages[idx];if(!page?.image)return;
  const url=asset(project,page);try{if(!images.has(url)){const blob=await fetch(url).then(r=>r.blob());const value=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});images.set(url,value);}
    if(project?.id===id && selected===idx){const img=$('canvas').querySelector('img');if(img)img.src=svgUrl(project.pages[idx],idx,images.get(url),true);}
  }catch(e){toast('预览图片加载失败：'+e.message);}
}
function render(){if(!project)return;$('empty').hidden=true;$('workspace').hidden=false;selected=Math.min(selected,Math.max(0,project.pages.length-1));$('projectTitle').value=project.title;
  $('saved').textContent=dirty?'有未保存修改':'已保存到本机';const phase=project.state==='script'||project.state==='drafting'?0:!project.sampleApproved?1:project.state==='done'?3:2;
  document.querySelectorAll('[data-step]').forEach(e=>e.classList.toggle('active',Number(e.dataset.step)===phase));
  const completed=project.pages.filter(p=>p.image).length;$('notice').className=project.error?'error':'';
  $('notice').textContent=project.error||`${labels[project.state]} · ${completed}/${project.pages.length} 页配图完成${project.state==='sample'?'。请检查排版和图片，右侧可试听背景音乐。':''}${project.renderMs?` · 最近合成 ${(project.renderMs/1000).toFixed(1)} 秒`:''}`;
  $('pageCount').textContent=project.pages.length;$('pageList').replaceChildren();
  project.pages.forEach((p,i)=>{const b=document.createElement('button');b.className='page-item'+(selected===i?' selected':'');const img=document.createElement('img');img.className='thumb';img.alt='';try{img.src=svgUrl(p,i,images.get(asset(project,p))||'');}catch{}const text=document.createElement('div'),name=document.createElement('strong'),status=document.createElement('small');name.textContent=`${String(i+1).padStart(2,'0')} ${p.title}`;status.textContent=p.error||({idle:'未生成',running:'生成中',done:'已完成',failed:'失败'}[p.status])+(p.generationMs?` · ${(p.generationMs/1000).toFixed(0)}s`:'');text.append(name,status);b.append(img,text);b.onclick=()=>{selected=i;render();};$('pageList').append(b);});
  const p=project.pages[selected];$('pageNumber').textContent=p?`${selected+1} / ${project.pages.length}`:'';
  for(const [id,key] of [['pageTitle','title'],['pageBody','body'],['pagePrompt','prompt'],['pageDuration','duration']])$(id).value=p?.[key]??'';
  $('pageEntrance').value=p?.entrance||'fade';
  $('musicSelect').value=project.musicId||'';$('volume').value=project.volume;setAudio();
  const final=project.final && !dirty;$('showVideo').hidden=!final;$('download').hidden=!final;
  if(final){const url=`/ppt/projects/${project.id}/assets/${project.final}`;$('download').href=url;if($('video').getAttribute('src')!==url)$('video').src=url;}else{$('video').hidden=true;$('video').pause();}
  renderPreview();embedPreview();renderControls();
}
function setAudio(){const id=$('musicSelect').value;$('musicPreview').hidden=!id;if(id){const src=`/ppt/music/${id}`;if($('musicPreview').getAttribute('src')!==src)$('musicPreview').src=src;$('musicPreview').volume=Number($('volume').value);}else{$('musicPreview').pause();$('musicPreview').removeAttribute('src');}}
async function loadMusic(){music=await api('/ppt/music');$('musicSelect').replaceChildren(new Option('无背景音乐',''),...music.map(m=>new Option(m.name,m.id)));if(project)$('musicSelect').value=project.musicId||'';}
async function openProject(id){if(dirty&&!confirm('当前修改尚未保存，放弃修改并切换任务？'))return;project=await api(`/ppt/projects/${id}`);selected=0;dirty=false;localStorage.setItem('story-ppt',id);render();}
async function save(){if(!dirty)return;for(const page of project.pages)pageSvg(page,0,project.pages.length);project=await api(`/ppt/projects/${project.id}`,'PUT',{revision:project.revision,title:project.title,pages:project.pages,musicId:project.musicId,volume:project.volume});dirty=false;render();}
$('saveButton').onclick=()=>guarded(save);
$('primaryAction').onclick=()=>guarded(async()=>{const action=$('primaryAction').dataset.action;await save();project=await api(`/ppt/projects/${project.id}/action`,'POST',{action,revision:project.revision});render();});
$('redraw').onclick=()=>guarded(async()=>{if(selected===0 && project.sampleApproved && !confirm('重画样稿会重新确认风格，并更新其他页配图。继续？'))return;await save();project=await api(`/ppt/projects/${project.id}/action`,'POST',{action:'redraw',revision:project.revision,pageId:project.pages[selected].id});render();});
for(const [id,key] of [['pageTitle','title'],['pageBody','body'],['pagePrompt','prompt'],['pageDuration','duration']])$(id).oninput=()=>{if(!project?.pages[selected])return;project.pages[selected][key]=key==='duration'?Number($(id).value):$(id).value;mark();embedPreview();};
$('pageEntrance').onchange=()=>{if(!project?.pages[selected])return;project.pages[selected].entrance=$('pageEntrance').value;mark();embedPreview();};
$('projectTitle').oninput=()=>{project.title=$('projectTitle').value;mark();};
$('musicSelect').onchange=()=>{project.musicId=$('musicSelect').value||null;setAudio();mark();};$('volume').oninput=()=>{project.volume=Number($('volume').value);setAudio();mark();};
$('musicUpload').onchange=()=>guarded(async()=>{const f=$('musicUpload').files[0];if(!f)return;const form=new FormData();form.append('file',f);const added=await api('/ppt/music','POST',form);await loadMusic();$('musicUpload').value='';if(project){project.musicId=added.id;$('musicSelect').value=added.id;setAudio();mark();}toast('音乐已导入');});
$('addPage').onclick=()=>{if(project.pages.length>=12)return toast('最多12页');project.pages.push({id:crypto.randomUUID(),title:'新页面',body:'在这里填写这一页的要点。',prompt:'用简洁插画呈现这一页的要点',duration:8,entrance:'fade',imageVersion:1,status:'idle'});selected=project.pages.length-1;mark();render();};
$('deletePage').onclick=()=>{if(project.pages.length<=1)return;project.pages.splice(selected,1);mark();render();};
for(const [id,delta] of [['moveUp',-1],['moveDown',1]])$(id).onclick=()=>{const next=selected+delta;if(next<0||next>=project.pages.length)return;[project.pages[selected],project.pages[next]]=[project.pages[next],project.pages[selected]];selected=next;mark();render();};
for(const id of ['newButton','startButton'])$(id).onclick=()=>$('newDialog').showModal();$('closeNew').onclick=()=>$('newDialog').close();$('closeHistory').onclick=()=>$('historyDialog').close();
$('newForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{if(dirty&&!confirm('当前修改尚未保存，放弃修改并新建？'))return;const form=new FormData(e.target);project=await api('/ppt/projects','POST',Object.fromEntries(form));dirty=false;selected=0;localStorage.setItem('story-ppt',project.id);$('newDialog').close();render();});};
$('historyButton').onclick=()=>guarded(async()=>{const rows=await api('/ppt/projects');$('historyList').replaceChildren();if(!rows.length)$('historyList').textContent='还没有任务，创建第一条视频吧。';for(const p of rows){const b=document.createElement('button');b.className='history-item';b.textContent=p.title;const small=document.createElement('small');small.textContent=`${labels[p.state]} · ${p.pages.length} 页 · ${new Date(p.createdAt).toLocaleString()}`;b.append(small);b.onclick=()=>guarded(async()=>{await openProject(p.id);$('historyDialog').close();});$('historyList').append(b);}$('historyDialog').showModal();});
$('showVideo').onclick=()=>{$('video').hidden=!$('video').hidden;if(!$('video').hidden)$('video').play().catch(()=>{});};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
setInterval(async()=>{if(!project||dirty||busy||polling||document.hidden)return;polling=true;const id=project.id;try{const next=await api(`/ppt/projects/${id}`);if(project?.id===id&&!dirty&&!busy&&next.updatedAt!==project.updatedAt){project=next;render();}}catch(e){$('notice').textContent='连接暂时中断，正在尝试恢复…';}finally{polling=false;}},2000);
await loadMusic().catch(e=>toast(e.message));const last=localStorage.getItem('story-ppt');if(last)await openProject(last).catch(()=>localStorage.removeItem('story-ppt'));

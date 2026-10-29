import {pageSvg} from '/workbench/layout.mjs';
const $=id=>document.getElementById(id);
let project=null,selected=0,dirty=false,busy=false,music=[],polling=false,settings={provider:'draw-things'};
const labels={drafting:'正在整理脚本',script:'等待确认脚本','references-generating':'正在生成参考图',references:'等待审核参考图','sample-generating':'正在生成样稿',sample:'等待确认样稿',producing:'正在生成配图',rendering:'正在合成视频',done:'可以查看成片',failed:'制作中断'};
const generating=()=>project && ['drafting','references-generating','sample-generating','producing','rendering'].includes(project.state);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000);}
async function api(url,method='GET',data){const res=await fetch(url,{method,headers:data && !(data instanceof FormData)?{'content-type':'application/json'}:undefined,body:data?data instanceof FormData?data:JSON.stringify(data):undefined});const value=await res.json();if(!res.ok)throw new Error(value.error||'请求失败');return value;}
async function guarded(fn){if(busy)return;busy=true;try{await fn();}catch(e){toast(e.message);}finally{busy=false;renderControls();}}
const asset=(p,page)=>page.image?`/ppt/projects/${p.id}/assets/${page.image}`:'';
function svgUrl(page,index,image,animate=false){return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageSvg(page,index,project.pages.length,image,animate,project.narrativeMode||'legal-case',project.hideHeaderFooter,project.layoutTemplate||'text-illustration'))}`;}
function mark(){dirty=true;$('saved').textContent='有未保存修改';renderPreview();renderControls();}
function renderControls(){if(!project)return;const locked=generating()||busy;
  ['saveButton','addPage','moveUp','moveDown','deletePage','redraw','pageTitle','pageBody','pagePrompt','pageDuration','pageEntrance','projectStyle','hideHeaderFooter','projectTitle','musicSelect','volume','addCharacter','addLocation','pageLocation'].forEach(id=>$(id).disabled=locked);
  document.querySelectorAll('#referencePanel input,#referencePanel textarea,#referencePanel button,#characterLinks input').forEach(e=>e.disabled=locked);
  $('addCharacter').disabled=locked||(project.references||[]).filter(r=>r.kind==='character').length>=3;
  $('addLocation').disabled=locked||(project.references||[]).filter(r=>r.kind==='location').length>=2;
  document.querySelectorAll('.reference-redraw').forEach(e=>e.disabled=locked||!project.scriptApproved||settings.provider!=='codex');
  $('saveButton').disabled=locked||!dirty;$('redraw').disabled=locked||!project.scriptApproved||!project.pages.length;
  const refsReady=project.references?.every(r=>r.status==='done'&&r.image);
  const map={script:['确认脚本，开始生图','script'],references:refsReady?['确认参考图，生成样稿','references']:['生成未完成的参考图','generate-references'],sample:['确认样稿，开始制作','sample'],done:[project.final?'重新导出':'导出修改后的成片','render'],failed:['重试未完成步骤','retry']};
  const config=map[project.state];$('primaryAction').textContent=config?config[0]:labels[project.state];$('primaryAction').dataset.action=config?.[1]||'';$('primaryAction').disabled=locked||!config;
}
function renderPreview(){if(!project)return;const page=project.pages[selected];if(!page){$('canvas').textContent='正在整理分页脚本…';return;}
  $('canvas').replaceChildren();try{const img=document.createElement('img');img.alt=page.title;img.src=svgUrl(page,selected,asset(project,page),true);$('canvas').append(img);}catch(e){const d=document.createElement('div');d.className='overflow-message';d.textContent=e.message;$('canvas').append(d);}
  $('duration').textContent=`${project.pages.length} 页 · 总时长 ${project.pages.reduce((n,p)=>n+Number(p.duration),0).toFixed(1)} 秒`;
  $('textCount').textContent=`${page.body.length} / 105 字 · 最多 5 行`;
}
function renderReferences(){
  const enabled=!!project.referenceWorkflowVersion;
  $('referencePanel').hidden=!enabled;
  $('pageLinks').hidden=!enabled;
  if(!enabled)return;
  const refs=project.references||[];
  $('referenceHint').textContent=settings.provider==='draw-things'&&!project.referenceWorkflowEnabled
    ?'Draw Things 的单图参考拼板尚待真机验证；当前选择将沿用原有页面生图流程。切换到 Codex 并确认脚本可启用参考图审核。'
    :'Codex 最多接收 3 张参考图；页面会优先使用角色，其次是地点，最后是画风图。切换引擎只影响之后启动的图片任务。';
  $('addCharacter').disabled=generating()||busy||refs.filter(r=>r.kind==='character').length>=3;
  $('addLocation').disabled=generating()||busy||refs.filter(r=>r.kind==='location').length>=2;
  $('referenceList').replaceChildren();
  for(const ref of refs){
    const card=document.createElement('article');card.className='reference-card';
    const info=document.createElement('div');info.className='reference-info';
    const title=document.createElement('strong');title.textContent=ref.kind==='character'?'人物三视图':'关键地点';
    const name=document.createElement('input');name.value=ref.name;name.maxLength=40;name.setAttribute('aria-label','参考图名称');
    name.oninput=()=>{ref.name=name.value;mark();};
    const description=document.createElement('textarea');description.value=ref.description;description.maxLength=500;description.rows=3;description.setAttribute('aria-label','参考图描述');
    description.oninput=()=>{ref.description=description.value;mark();};
    const status=document.createElement('small');status.textContent=ref.error||({idle:'待生成',running:'生成中',done:'已完成',failed:'失败'}[ref.status])+(ref.generationMs?` · ${(ref.generationMs/1000).toFixed(0)}s`:'');
    const actions=document.createElement('div');actions.className='row';
    const redraw=document.createElement('button');redraw.className='reference-redraw';redraw.textContent='重画此图';redraw.disabled=!project.scriptApproved||generating()||busy||settings.provider!=='codex';
    redraw.onclick=()=>guarded(async()=>{await save();const current=project.references.find(r=>r.id===ref.id);const action=current?.image?'redraw-reference':'generate-references';project=await api(`/ppt/projects/${project.id}/action`,'POST',{action,revision:project.revision,referenceId:ref.id});render();});
    const remove=document.createElement('button');remove.textContent='删除';remove.disabled=generating()||busy;
    remove.onclick=()=>{project.references=project.references.filter(r=>r.id!==ref.id);for(const page of project.pages){page.characterIds=(page.characterIds||[]).filter(id=>id!==ref.id);if(page.locationId===ref.id)page.locationId=null;}mark();render();};
    actions.append(redraw,remove);info.append(title,name,description,status,actions);
    const visual=document.createElement('div');visual.className='reference-visual';
    if(ref.image){const img=document.createElement('img');img.alt=`${ref.name}参考图`;img.src=`/ppt/projects/${project.id}/assets/${ref.image}`;visual.append(img);}else visual.textContent='待生成';
    card.append(visual,info);$('referenceList').append(card);
  }
  const page=project.pages[selected];$('characterLinks').replaceChildren();
  for(const ref of refs.filter(r=>r.kind==='character')){
    const label=document.createElement('label');label.className='check-option';const box=document.createElement('input');box.type='checkbox';box.checked=!!page?.characterIds?.includes(ref.id);
    box.onchange=()=>{page.characterIds=box.checked?[...new Set([...(page.characterIds||[]),ref.id])]:(page.characterIds||[]).filter(id=>id!==ref.id);mark();};
    label.append(box,document.createTextNode(ref.name));$('characterLinks').append(label);
  }
  $('pageLocation').replaceChildren(new Option('不使用地点参考图',''),...refs.filter(r=>r.kind==='location').map(r=>new Option(r.name,r.id)));
  $('pageLocation').value=page?.locationId||'';
}
// SVG image URLs cannot fetch nested remote images, so embed the generated illustration for preview.
const images=new Map();
async function embedPreview(){if(!project)return;const id=project.id,idx=selected,page=project.pages[idx];if(!page?.image)return;
  const url=asset(project,page);try{if(!images.has(url)){const blob=await fetch(url).then(r=>r.blob());const value=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});images.set(url,value);}
    if(project?.id===id && selected===idx){const img=$('canvas').querySelector('img');if(img)img.src=svgUrl(project.pages[idx],idx,images.get(url),true);}
  }catch(e){toast('预览图片加载失败：'+e.message);}
}
function render(){if(!project)return;$('empty').hidden=true;$('workspace').hidden=false;selected=Math.min(selected,Math.max(0,project.pages.length-1));$('projectTitle').value=project.title;$('projectMode').textContent=`${project.narrativeMode==='childhood-memoir'?'童年回忆录':'法律案例解读'} · ${project.layoutTemplate==='title-full-image'?'标题＋满幅图片':'图文页面'}`;$('projectStyle').value=project.styleId||'legacy-blue';$('hideHeaderFooter').checked=!!project.hideHeaderFooter;$('hideHeaderFooterOption').hidden=project.layoutTemplate==='title-full-image';$('bodyHint').hidden=project.layoutTemplate!=='title-full-image';
  const showRef=!!project.referenceWorkflowEnabled||(!!project.referenceWorkflowVersion&&settings.provider==='codex'&&!project.scriptApproved);
  $('referenceStep').hidden=!showRef;
  for(const [id,label] of [['2',showRef?'03　确认样稿':'02　确认样稿'],['3',showRef?'04　自动制作':'03　自动制作'],['4',showRef?'05　查看成片':'04　查看成片']])document.querySelector(`[data-step="${id}"]`).textContent=label;
  $('saved').textContent=dirty?'有未保存修改':'已保存到本机';const phase=project.state==='script'||project.state==='drafting'?0:project.state==='references'||project.state==='references-generating'?1:!project.sampleApproved?2:project.state==='done'?4:3;
  document.querySelectorAll('[data-step]').forEach(e=>e.classList.toggle('active',Number(e.dataset.step)===phase));
  const completed=project.pages.filter(p=>p.image).length;$('notice').className=project.error?'error':'';
  $('notice').textContent=project.error||`${labels[project.state]} · ${completed}/${project.pages.length} 页配图完成${project.state==='sample'?'。请检查排版和图片，右侧可试听背景音乐。':''}${project.referenceWorkflowEnabled&&settings.provider==='draw-things'?' · Draw Things 当前不使用人物参考图。':''}${project.renderMs?` · 最近合成 ${(project.renderMs/1000).toFixed(1)} 秒`:''}`;
  $('pageCount').textContent=project.pages.length;$('pageList').replaceChildren();
  project.pages.forEach((p,i)=>{const b=document.createElement('button');b.className='page-item'+(selected===i?' selected':'');const img=document.createElement('img');img.className='thumb';img.alt='';try{img.src=svgUrl(p,i,images.get(asset(project,p))||'');}catch{}const text=document.createElement('div'),name=document.createElement('strong'),status=document.createElement('small');name.textContent=`${String(i+1).padStart(2,'0')} ${p.title}`;status.textContent=p.error||({idle:'未生成',running:'生成中',done:'已完成',failed:'失败'}[p.status])+(p.generationMs?` · ${(p.generationMs/1000).toFixed(0)}s`:'');text.append(name,status);b.append(img,text);b.onclick=()=>{selected=i;render();};$('pageList').append(b);});
  const p=project.pages[selected];$('pageNumber').textContent=p?`${selected+1} / ${project.pages.length}`:'';
  for(const [id,key] of [['pageTitle','title'],['pageBody','body'],['pagePrompt','prompt'],['pageDuration','duration']])$(id).value=p?.[key]??'';
  $('pageEntrance').value=p?.entrance||'fade';
  renderReferences();
  $('musicSelect').value=project.musicId||'';$('volume').value=project.volume;setAudio();
  const final=project.final && !dirty;$('showVideo').hidden=!final;$('download').hidden=!final;
  if(final){const url=`/ppt/projects/${project.id}/assets/${project.final}`;$('download').href=url;if($('video').getAttribute('src')!==url)$('video').src=url;}else{$('video').hidden=true;$('video').pause();}
  renderPreview();embedPreview();renderControls();
}
function setAudio(){const id=$('musicSelect').value;$('musicPreview').hidden=!id;if(id){const src=`/ppt/music/${id}`;if($('musicPreview').getAttribute('src')!==src)$('musicPreview').src=src;$('musicPreview').volume=Number($('volume').value);}else{$('musicPreview').pause();$('musicPreview').removeAttribute('src');}}
async function loadMusic(){music=await api('/ppt/music');$('musicSelect').replaceChildren(new Option('无背景音乐',''),...music.map(m=>new Option(m.name,m.id)));if(project)$('musicSelect').value=project.musicId||'';}
async function openProject(id){if(dirty&&!confirm('当前修改尚未保存，放弃修改并切换任务？'))return;project=await api(`/ppt/projects/${id}`);selected=0;dirty=false;localStorage.setItem('story-ppt',id);render();}
async function save(){if(!dirty)return;for(const page of project.pages)pageSvg(page,0,project.pages.length,'',false,project.narrativeMode,project.hideHeaderFooter,project.layoutTemplate);project=await api(`/ppt/projects/${project.id}`,'PUT',{revision:project.revision,title:project.title,styleId:project.styleId,narrativeMode:project.narrativeMode,layoutTemplate:project.layoutTemplate,hideHeaderFooter:project.hideHeaderFooter,pages:project.pages,references:project.referenceWorkflowVersion?project.references:undefined,musicId:project.musicId,volume:project.volume});dirty=false;render();}
$('saveButton').onclick=()=>guarded(save);
$('primaryAction').onclick=()=>guarded(async()=>{const action=$('primaryAction').dataset.action;await save();project=await api(`/ppt/projects/${project.id}/action`,'POST',{action,revision:project.revision});render();});
$('redraw').onclick=()=>guarded(async()=>{if(selected===0 && project.sampleApproved && !confirm('重画样稿会重新确认风格，并更新其他页配图。继续？'))return;await save();project=await api(`/ppt/projects/${project.id}/action`,'POST',{action:'redraw',revision:project.revision,pageId:project.pages[selected].id});render();});
for(const [id,key] of [['pageTitle','title'],['pageBody','body'],['pagePrompt','prompt'],['pageDuration','duration']])$(id).oninput=()=>{if(!project?.pages[selected])return;project.pages[selected][key]=key==='duration'?Number($(id).value):$(id).value;mark();embedPreview();};
$('pageEntrance').onchange=()=>{if(!project?.pages[selected])return;project.pages[selected].entrance=$('pageEntrance').value;mark();embedPreview();};
$('pageLocation').onchange=()=>{if(!project?.pages[selected])return;project.pages[selected].locationId=$('pageLocation').value||null;mark();};
$('addCharacter').onclick=()=>{if(!project)return;if((project.references||[]).filter(r=>r.kind==='character').length>=3)return toast('最多3位角色');project.references||=[];project.references.push({id:crypto.randomUUID(),kind:'character',name:'新角色',description:'请填写角色年龄、发型、面部与固定服饰特征',imageVersion:1,status:'idle'});mark();render();};
$('addLocation').onclick=()=>{if(!project)return;if((project.references||[]).filter(r=>r.kind==='location').length>=2)return toast('最多2个地点');project.references||=[];project.references.push({id:crypto.randomUUID(),kind:'location',name:'新地点',description:'请填写环境布局、颜色和反复出现的视觉特征',imageVersion:1,status:'idle'});mark();render();};
$('providerSelect').onchange=()=>guarded(async()=>{const next=$('providerSelect').value;try{settings=await api('/ppt/settings','PUT',{provider:next});toast(`已切换到 ${next==='codex'?'本机 Codex':'Draw Things'}；仅影响之后启动的生图任务`);if(project)render();}catch(error){$('providerSelect').value=settings.provider;throw error;}});
$('projectStyle').onchange=()=>{project.styleId=$('projectStyle').value;mark();};
$('hideHeaderFooter').onchange=()=>{project.hideHeaderFooter=$('hideHeaderFooter').checked;mark();embedPreview();};
$('projectTitle').oninput=()=>{project.title=$('projectTitle').value;mark();};
$('musicSelect').onchange=()=>{project.musicId=$('musicSelect').value||null;setAudio();mark();};$('volume').oninput=()=>{project.volume=Number($('volume').value);setAudio();mark();};
$('musicUpload').onchange=()=>guarded(async()=>{const f=$('musicUpload').files[0];if(!f)return;const form=new FormData();form.append('file',f);const added=await api('/ppt/music','POST',form);await loadMusic();$('musicUpload').value='';if(project){project.musicId=added.id;$('musicSelect').value=added.id;setAudio();mark();}toast('音乐已导入');});
$('addPage').onclick=()=>{if(project.pages.length>=12)return toast('最多12页');project.pages.push({id:crypto.randomUUID(),title:'新页面',body:'在这里填写这一页的要点。',prompt:'用简洁插画呈现这一页的要点',duration:8,entrance:'fade',imageVersion:1,status:'idle'});selected=project.pages.length-1;mark();render();};
$('deletePage').onclick=()=>{if(project.pages.length<=1)return;project.pages.splice(selected,1);mark();render();};
for(const [id,delta] of [['moveUp',-1],['moveDown',1]])$(id).onclick=()=>{const next=selected+delta;if(next<0||next>=project.pages.length)return;[project.pages[selected],project.pages[next]]=[project.pages[next],project.pages[selected]];selected=next;mark();render();};
for(const id of ['newButton','startButton'])$(id).onclick=()=>$('newDialog').showModal();$('closeNew').onclick=()=>$('newDialog').close();$('closeHistory').onclick=()=>$('historyDialog').close();
$('newNarrativeMode').onchange=()=>{const memoir=$('newNarrativeMode').value==='childhood-memoir';$('newSourceLabel').textContent=memoir?'回忆素材':'案例材料';$('newSource').placeholder=memoir?'写下你记得的童年经历、人物、场景和当时的感受。工作台会以“我”的口吻忠实整理。':'粘贴案例经过、争议和已知结论。脚本会按要点整理，不会逐句拆图。';$('newModeHint').textContent=memoir?'以讲述人的第一人称整理经历，不编造事件、对白或感受；生成后先由你确认脚本。':'按问题、经过、争议和结论整理；生成后先由你确认脚本。';};
$('newForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{if(dirty&&!confirm('当前修改尚未保存，放弃修改并新建？'))return;const form=new FormData(e.target);project=await api('/ppt/projects','POST',Object.fromEntries(form));dirty=false;selected=0;localStorage.setItem('story-ppt',project.id);$('newDialog').close();render();});};
$('historyButton').onclick=()=>guarded(async()=>{const rows=await api('/ppt/projects');$('historyList').replaceChildren();if(!rows.length)$('historyList').textContent='还没有任务，创建第一条视频吧。';for(const p of rows){const b=document.createElement('button');b.className='history-item';b.textContent=p.title;const small=document.createElement('small');small.textContent=`${labels[p.state]} · ${p.pages.length} 页 · ${new Date(p.createdAt).toLocaleString()}`;b.append(small);b.onclick=()=>guarded(async()=>{await openProject(p.id);$('historyDialog').close();});$('historyList').append(b);}$('historyDialog').showModal();});
$('showVideo').onclick=()=>{$('video').hidden=!$('video').hidden;if(!$('video').hidden)$('video').play().catch(()=>{});};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
setInterval(async()=>{if(!project||dirty||busy||polling||document.hidden)return;polling=true;const id=project.id;try{const next=await api(`/ppt/projects/${id}`);if(project?.id===id&&!dirty&&!busy&&next.updatedAt!==project.updatedAt){project=next;render();}}catch(e){$('notice').textContent='连接暂时中断，正在尝试恢复…';}finally{polling=false;}},2000);
settings=await api('/ppt/settings').catch(e=>{toast(e.message);return settings;});$('providerSelect').value=settings.provider;
await loadMusic().catch(e=>toast(e.message));const last=localStorage.getItem('story-ppt');if(last)await openProject(last).catch(()=>localStorage.removeItem('story-ppt'));

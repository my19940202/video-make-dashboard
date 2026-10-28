export function escapeXml(value) {return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
export function wrap(value,limit) {
  const lines=[]; let line='',width=0;
  for(const ch of value) {const w=/[\u0000-\u00ff]/.test(ch)?0.56:1;
    if(ch==='\n'){lines.push(line);line='';width=0;continue;}
    if(width+w>limit){lines.push(line);line='';width=0;} line+=ch;width+=w;
  }
  if(line)lines.push(line);return lines;
}
export function pageSvg(page,index,total,image='',animate=false,narrativeMode='legal-case') {
  const title=wrap(page.title,13), body=wrap(page.body,21);
  if(title.length>3 || body.length>10) throw new Error('文字超出版面，请缩短标题或正文');
  const text=(lines,y,size,weight,color,step)=>lines.map((line,i)=>`<text x="88" y="${y+i*step}" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`).join('');
  const effect=['fade','blur','float'].includes(page.entrance)?page.entrance:'fade';
  const pageLabel=narrativeMode==='childhood-memoir'?'童年手记':'案例笔记';
  const motion=animate?`<style>.entrance{animation:${effect} .55s ease-out both}.title{animation-delay:.12s}.art{animation-delay:.42s}.body{animation-delay:.72s}@keyframes fade{from{opacity:0}to{opacity:1}}@keyframes blur{from{opacity:0;filter:blur(16px)}to{opacity:1;filter:blur(0)}}@keyframes float{from{opacity:0;transform:translateY(42px)}to{opacity:1;transform:translateY(0)}}</style>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1920" viewBox="0 0 1080 1920">${motion}<rect width="1080" height="1920" fill="#f6f8fc"/><g font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif"><g class="entrance title"><rect x="88" y="96" width="8" height="32" rx="4" fill="#355cce"/><text x="116" y="122" font-size="25" fill="#546783" letter-spacing="4">${pageLabel}</text>${text(title,236,64,600,'#172a46',82)}</g><g class="entrance art"><rect x="64" y="480" width="952" height="600" rx="24" fill="#e9eef7"/>${image?`<image x="80" y="496" width="920" height="568" preserveAspectRatio="xMidYMid meet" xlink:href="${escapeXml(image)}"/>`:'<text x="540" y="790" text-anchor="middle" font-size="32" fill="#8191a9">配图生成后出现在这里</text>'}</g><g class="entrance body">${text(body,1190,42,400,'#263b57',57)}</g><line x1="88" y1="1810" x2="992" y2="1810" stroke="#d4deeb"/><text x="88" y="1858" font-size="24" fill="#72829a">${String(index+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}</text><text x="992" y="1858" text-anchor="end" font-size="24" fill="#72829a">${page.duration} 秒</text></g></svg>`;
}

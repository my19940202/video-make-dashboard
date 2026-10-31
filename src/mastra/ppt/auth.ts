import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { appRoot } from '../lib/config';

const root = resolve(appRoot, 'data');
mkdirSync(root, {recursive:true});
const db = new DatabaseSync(resolve(root, 'saas.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS codes(id TEXT PRIMARY KEY, email TEXT NOT NULL, hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at INTEGER, created_at INTEGER NOT NULL, ip TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS project_owners(project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS music_owners(music_id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS image_usage(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at INTEGER NOT NULL);`);

const secret = () => {const value=process.env.AUTH_CODE_SECRET || ''; if(value.length<32) throw new Error('AUTH_CODE_SECRET 未配置'); return value;};
const digest = (value:string) => createHmac('sha256',secret()).update(value).digest('hex');
const emailOf = (value:unknown) => typeof value==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const ipOf = (request:Request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
const cookie = (value:string,maxAge:number) => `story_session=${value}; Path=/; HttpOnly; ${process.env.SAAS_MODE==='1'?'Secure; ':''}SameSite=Lax; Max-Age=${maxAge}`;
export function userFor(request:Request):string|null {
  const token=/\bstory_session=([0-9a-f-]{36})/.exec(request.headers.get('cookie')||'')?.[1];
  if(!token)return null;
  const row=db.prepare('SELECT user_id FROM sessions WHERE id=? AND expires_at>?').get(token,Date.now()) as {user_id:string}|undefined;
  return row?.user_id||null;
}
export function ownsProject(userId:string,id:string):boolean {return !!db.prepare('SELECT 1 FROM project_owners WHERE project_id=? AND user_id=?').get(id,userId);}
export function ownProject(userId:string,id:string) {db.prepare('INSERT INTO project_owners(project_id,user_id) VALUES (?,?)').run(id,userId);}
export function ownsMusic(userId:string,id:string):boolean {return !!db.prepare('SELECT 1 FROM music_owners WHERE music_id=? AND user_id=?').get(id,userId);}
export function ownMusic(userId:string,id:string) {db.prepare('INSERT INTO music_owners(music_id,user_id) VALUES (?,?)').run(id,userId);}
export function projectIds(userId:string):Set<string> {return new Set((db.prepare('SELECT project_id FROM project_owners WHERE user_id=?').all(userId) as {project_id:string}[]).map(r=>r.project_id));}
export function musicIds(userId:string):Set<string> {return new Set((db.prepare('SELECT music_id FROM music_owners WHERE user_id=?').all(userId) as {music_id:string}[]).map(r=>r.music_id));}
export function reserveImage(projectId:string) {
  const owner=db.prepare('SELECT user_id FROM project_owners WHERE project_id=?').get(projectId) as {user_id:string}|undefined;
  if(!owner)throw new Error('项目归属不存在');
  const now=Date.now(),start=new Date().setUTCHours(0,0,0,0);
  const used=(db.prepare('SELECT COUNT(*) AS n FROM image_usage WHERE user_id=? AND created_at>=?').get(owner.user_id,start) as {n:number}).n;
  if(used>=30)throw new Error('今天的生图额度已用完，请明天再试');
  db.prepare('INSERT INTO image_usage(id,user_id,project_id,created_at) VALUES (?,?,?,?)').run(randomUUID(),owner.user_id,projectId,now);
}
export async function sendCode(request:Request,emailInput:unknown) {
  const email=emailOf(emailInput); if(!email) throw new Error('邮箱无效');
  const now=Date.now(), ip=digest(ipOf(request));
  const recent=db.prepare('SELECT MAX(created_at) AS last, COUNT(*) AS count FROM codes WHERE email=? AND created_at>?').get(email,now-3600_000) as {last:number|null;count:number};
  const ipCount=(db.prepare('SELECT COUNT(*) AS count FROM codes WHERE ip=? AND created_at>?').get(ip,now-3600_000) as {count:number}).count;
  if((recent.last && now-recent.last<60_000)||recent.count>=5||ipCount>=20) throw new Error('发送过于频繁，请稍后重试');
  const key=process.env.RESEND_API_KEY,from=process.env.AUTH_EMAIL_FROM;
  if(!key) throw new Error('缺少 RESEND_API_KEY，请检查运行进程的环境变量并重启服务');
  if(!from) throw new Error('缺少 AUTH_EMAIL_FROM，请配置已在 Resend 验证的发件地址并重启服务');
  const code=String(randomInt(0,1_000_000)).padStart(6,'0'), id=randomUUID();
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from,to:[email],subject:'Story Make 登录验证码',html:`<p>你的登录验证码是：</p><p style="font-size:28px;letter-spacing:6px">${code}</p><p>10 分钟内有效。如果不是你本人操作，请忽略。</p>`})});
  if(!response.ok) {
    console.error('[auth-email] Resend rejected email',response.status);
    throw new Error(`验证码邮件发送失败（Resend ${response.status}），请检查发件域名、收件地址和账户状态`);
  }
  db.prepare('UPDATE codes SET consumed_at=? WHERE email=? AND consumed_at IS NULL').run(now,email);
  db.prepare('INSERT INTO codes(id,email,hash,expires_at,created_at,ip) VALUES (?,?,?,?,?,?)').run(id,email,digest(`${email}:${code}`),now+600_000,now,ip);
}
export function verifyCode(emailInput:unknown,codeInput:unknown):{userId:string;cookie:string} {
  const email=emailOf(emailInput),code=typeof codeInput==='string'?codeInput.trim():'';
  if(!email||!/^\d{6}$/.test(code)) throw new Error('验证码无效或已过期');
  const row=db.prepare('SELECT * FROM codes WHERE email=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1').get(email) as {id:string;hash:string;expires_at:number;attempts:number}|undefined;
  if(!row||row.expires_at<=Date.now()||row.attempts>=5) throw new Error('验证码无效或已过期');
  const actual=Buffer.from(digest(`${email}:${code}`),'hex'),expected=Buffer.from(row.hash,'hex');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){db.prepare('UPDATE codes SET attempts=attempts+1 WHERE id=?').run(row.id);throw new Error('验证码无效或已过期');}
  db.prepare('UPDATE codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(Date.now(),row.id);
  db.prepare('INSERT OR IGNORE INTO users(id,email,created_at) VALUES (?,?,?)').run(randomUUID(),email,Date.now());
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(email) as {id:string};
  const token=randomUUID();db.prepare('INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)').run(token,user.id,Date.now()+7*86400_000);
  return {userId:user.id,cookie:cookie(token,7*86400)};
}
export function logout(request:Request):string {const token=/\bstory_session=([0-9a-f-]{36})/.exec(request.headers.get('cookie')||'')?.[1];if(token)db.prepare('DELETE FROM sessions WHERE id=?').run(token);return cookie('',0);}

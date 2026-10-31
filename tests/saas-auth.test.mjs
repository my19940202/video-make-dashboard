import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';

const dir=mkdtempSync(join(tmpdir(),'story-auth-'));
process.env.STORY_MAKE_HOME=dir;
process.env.AUTH_CODE_SECRET='test-secret-with-at-least-thirty-two-characters';
process.env.RESEND_API_KEY='test';
process.env.AUTH_EMAIL_FROM='login@example.com';
await build({entryPoints:['src/mastra/ppt/auth.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'auth.mjs')});
const auth=await import(pathToFileURL(join(dir,'auth.mjs')));

test('邮箱验证码只可用一次，登录会话与项目归属隔离',async()=>{
  let sent;
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify({id:'mail-1'}),{status:200});};
  try{
    const request=new Request('https://example.com/auth/send-code',{headers:{'x-forwarded-for':'203.0.113.1'}});
    await auth.sendCode(request,'Alice@Example.com');
    const code=sent.html.match(/>(\d{6})</)?.[1];assert.ok(code);
    assert.throws(()=>auth.verifyCode('alice@example.com','000000'),/验证码无效/);
    const login=auth.verifyCode('alice@example.com',code);
    assert.throws(()=>auth.verifyCode('alice@example.com',code),/验证码无效/);
    const loggedIn=new Request('https://example.com',{headers:{cookie:login.cookie}});
    assert.equal(auth.userFor(loggedIn),login.userId);
    auth.ownProject(login.userId,'project-a');
    assert.equal(auth.ownsProject(login.userId,'project-a'),true);
    assert.equal(auth.ownsProject('other-user','project-a'),false);
    auth.logout(loggedIn);assert.equal(auth.userFor(loggedIn),null);
  }finally{globalThis.fetch=original;}
});

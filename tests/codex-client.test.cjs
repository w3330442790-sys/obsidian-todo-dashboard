const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { CodexClient } = require('../src/codex-client.cjs');

function fixture(options = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new PassThrough(); child.kills = 0; child.kill = () => { child.kills++; };
  const messages = []; let spawnArgs;
  child.stdin.on('data', data => {
    for (const line of data.toString().trim().split('\n')) {
      const msg = JSON.parse(line); messages.push(msg);
      if (msg.method === 'initialize') queueMicrotask(() => reply(msg.id, { userAgent: 'test' }));
    }
  });
  const reply = (id, result) => child.stdout.write(JSON.stringify({ id, result }) + '\n');
  const events = [];
  const client = new CodexClient({ executable: 'C:\\tools\\codex.exe', cwd: 'C:\\vault', timeoutMs: 80,
    spawn: (...args) => { spawnArgs = args; return child; }, onEvent: e => events.push(e), ...options });
  return { child, client, messages, events, reply, spawnArgs: () => spawnArgs };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('validates paths, spawns directly and handshakes exactly once', async () => {
  assert.throws(() => new CodexClient({ executable: 'codex', cwd: 'C:\\vault' }), /absolute/i);
  assert.throws(() => new CodexClient({ executable: 'C:\\codex.exe', cwd: 'relative' }), /absolute/i);
  const f = fixture(); await Promise.all([f.client.connect(), f.client.connect()]);
  assert.deepEqual(f.spawnArgs()[1], ['app-server', '--stdio']);
  assert.equal(f.spawnArgs()[2].shell, false); assert.equal(f.spawnArgs()[2].windowsHide, true);
  assert.deepEqual(f.messages.map(m => m.method), ['initialize', 'initialized']);
  f.client.close(); assert.equal(f.child.kills, 1);
});
test('correlates responses and parses split UTF-8 JSON lines and notifications', async () => {
  const f = fixture(); await f.client.connect();
  const a = f.client.request('one', {}), b = f.client.request('two', {});
  f.reply(f.messages.at(-1).id, 2); f.reply(f.messages.at(-2).id, 1);
  assert.deepEqual(await Promise.all([a,b]), [1,2]);
  const wire = Buffer.from(JSON.stringify({ method:'item/agentMessage/delta', params:{ delta:'中文' } })+'\n');
  const cut = wire.indexOf(Buffer.from('中')) + 1;
  f.child.stdout.write(wire.subarray(0,cut)); f.child.stdout.write(wire.subarray(cut));
  assert.equal(f.events.at(-1).params.delta, '中文'); f.client.close();
});
test('propagates RPC errors, request timeout, and child exit', async () => {
  const f = fixture(); await f.client.connect();
  const bad = f.client.request('bad'); f.child.stdout.write(JSON.stringify({id:f.messages.at(-1).id,error:{code:42,message:'denied'}})+'\n');
  await assert.rejects(bad, e => e.code === 42 && e.message === 'denied');
  await assert.rejects(f.client.request('timeout'), /timed out/i);
  const pending = f.client.request('pending'); f.child.emit('exit',1,null);
  await assert.rejects(pending,/exit/i); assert.equal(f.child.kills,1);
});
test('malformed and oversized protocol input fails closed; stderr is never forwarded', async () => {
  for (const wire of ['{invalid}\n', 'x'.repeat(1024*1024+1)]) {
    const f = fixture(); await f.client.connect();
    const pending = f.client.request('pending'); f.child.stderr.write('secret-token');
    f.child.stdout.write(wire); await assert.rejects(pending,/protocol|buffer/i);
    assert.equal(f.events.some(e => JSON.stringify(e).includes('secret-token')),false);
    assert.equal(f.child.kills,1);
  }
});
test('default approvals deny and unknown requests receive method not found', async () => {
  const f = fixture(); await f.client.connect();
  for (const [id,method] of [[10,'item/commandExecution/requestApproval'],[11,'item/fileChange/requestApproval'],[12,'item/permissions/requestApproval'],[13,'unknown']]) {
    f.child.stdout.write(JSON.stringify({id,method,params:{}})+'\n');
  }
  await tick();
  assert.deepEqual(f.messages.find(m => m.id===10).result,{decision:'decline'});
  assert.deepEqual(f.messages.find(m => m.id===11).result,{decision:'decline'});
  assert.deepEqual(f.messages.find(m => m.id===12).result,{permissions:{},scope:'turn'});
  assert.equal(f.messages.find(m => m.id===13).error.code,-32601); f.client.close();
});
test('approval callback is awaited; resolved and closed requests cannot approve late', async () => {
  let resolve;
  const f = fixture({onApproval: () => new Promise(r => {resolve=r;})}); await f.client.connect();
  f.child.stdout.write('{"id":99,"method":"item/fileChange/requestApproval","params":{}}\n');
  await tick(); assert.equal(f.messages.some(m => m.id===99),false);
  f.child.stdout.write('{"method":"serverRequest/resolved","params":{"requestId":99}}\n');
  resolve({decision:'accept'}); await tick(); assert.equal(f.messages.some(m => m.id===99),false);
  f.client.close();
});
test('explicit approval results are delivered; throwing callback denies safely', async () => {
  for (const [callback, expected] of [[async () => ({decision:'accept'}),'accept'], [async () => {throw Error('UI gone');},'decline']]) {
    const f=fixture({onApproval:callback}); await f.client.connect();
    f.child.stdout.write('{"id":77,"method":"item/fileChange/requestApproval","params":{}}\n'); await tick();
    assert.deepEqual(f.messages.find(m=>m.id===77).result,{decision:expected}); f.client.close();
  }
});
test('spawn failures, stream failure and missing handshake reject with cleanup', async () => {
  const f=fixture({spawn:()=>{throw Error('missing executable');}});
  await assert.rejects(f.client.connect(),/missing executable/);
  const g=fixture(); const connecting=g.client.connect(); await tick();
  await connecting;
  const pending=g.client.request('pending'); g.child.stdin.emit('error',Error('pipe contains secret'));
  await assert.rejects(pending,/stdio error/); assert.equal(g.child.kills,1);
  const child=new EventEmitter(); child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); let kills=0;child.kill=()=>{kills++;};
  const h=fixture({timeoutMs:10,spawn:()=>child});
  await assert.rejects(h.client.connect(),/timed out/); assert.equal(kills,1);
});
test('no approval is sent after close and rejected login URLs cannot launch local code', async () => {
  let resolve;
  const f=fixture({onApproval:()=>new Promise(r=>{resolve=r;})}); await f.client.connect();
  f.child.stdout.write('{"id":99,"method":"item/fileChange/requestApproval","params":{}}\n'); await tick();
  f.client.close(); resolve({decision:'accept'}); await tick();
  assert.equal(f.messages.some(m=>m.id===99),false);
  const g=fixture(); await g.client.connect(); const login=g.client.startLogin();
  g.reply(g.messages.at(-1).id,{authUrl:'file:///C:/Windows/cmd.exe'});
  await assert.rejects(login,/unsupported/); g.client.close();
});
test('thread start/resume and turn force vault, human approval, and explicit sandbox mode', async () => {
  const f=fixture(); await f.client.connect();
  for (const mode of ['readOnly','workspaceWrite']) {
    const start=f.client.startThread({mode,model:'chosen'}); const msg=f.messages.at(-1);
    assert.equal(msg.method,'thread/start'); assert.equal(msg.params.cwd,'C:\\vault');
    assert.equal(msg.params.approvalPolicy,'on-request'); assert.equal(msg.params.approvalsReviewer,'user');
    assert.equal(msg.params.sandbox, mode==='readOnly'?'read-only':'workspace-write');
    f.reply(msg.id,{thread:{id:'thread-1'}}); await start;
    const send=f.client.send('hello',{threadId:'thread-1',mode,model:'chosen'});
    const turn=f.messages.at(-1); assert.equal(turn.method,'turn/start');
    assert.equal(turn.params.sandboxPolicy.type,mode); assert.equal(turn.params.cwd,'C:\\vault');
    if(mode==='workspaceWrite') {assert.deepEqual(turn.params.sandboxPolicy.writableRoots,['C:\\vault']); assert.equal(turn.params.sandboxPolicy.networkAccess,false);}
    f.reply(turn.id,{turn:{id:'turn-1'}}); await send;
  }
  const resume=f.client.startThread({threadId:'old'}); assert.equal(f.messages.at(-1).method,'thread/resume');
  f.reply(f.messages.at(-1).id,{thread:{id:'old'}}); await resume;
  const stop=f.client.stop('old','turn-1'); assert.equal(f.messages.at(-1).method,'turn/interrupt');
  f.reply(f.messages.at(-1).id,{}); await stop;
  await assert.rejects(f.client.startThread({mode:'unsafe'}),/mode/i); f.client.close();
});
test('close rejects requests and ignores late approvals; stream errors do not escape', async () => {
  const f=fixture(); await f.client.connect(); const pending=f.client.request('pending');
  f.client.close(); f.client.close(); await assert.rejects(pending,/closed/i); assert.equal(f.child.kills,1);
  f.child.stdin.emit('error',Error('closed pipe'));
});
test('account and login helpers expose only public account information and auth URL', async () => {
  const f=fixture(); await f.client.connect();
  const account=f.client.readAccount(); assert.equal(f.messages.at(-1).method,'account/read');
  f.reply(f.messages.at(-1).id,{account:{type:'chatgpt',email:'a@b.c',planType:'plus',accessToken:'secret'},requiresOpenaiAuth:false,token:'secret'});
  assert.deepEqual(await account,{account:{type:'chatgpt',email:'a@b.c',planType:'plus'},requiresOpenaiAuth:false});
  const login=f.client.startLogin(); assert.deepEqual(f.messages.at(-1).params,{type:'chatgpt'});
  f.reply(f.messages.at(-1).id,{type:'chatgpt',authUrl:'https://auth.openai.com/authorize?state=public',accessToken:'secret'});
  assert.deepEqual(await login,{authUrl:'https://auth.openai.com/authorize?state=public'}); f.client.close();
});

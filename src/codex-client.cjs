'use strict';
const { spawn: nodeSpawn } = require('node:child_process');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const MAX_BUFFER = 1024 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const defaults = {
  'item/commandExecution/requestApproval': () => ({ decision: 'decline' }),
  'item/fileChange/requestApproval': () => ({ decision: 'decline' }),
  'item/permissions/requestApproval': () => ({ permissions: {}, scope: 'turn' }),
  'mcpServer/elicitation/request': () => ({ action: 'decline', content: null }),
  'item/tool/requestUserInput': () => ({ answers: {} }),
  execCommandApproval: () => ({ decision: 'denied' }),
  applyPatchApproval: () => ({ decision: 'denied' })
};

/** A private stdio process. No credentials, transcript or stderr are persisted. */
class CodexClient {
  constructor({ executable, cwd, onEvent, onApproval, spawn = nodeSpawn, timeoutMs = 30000 } = {}) {
    for (const [name, value] of Object.entries({ executable, cwd })) {
      if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value)) {
        throw new TypeError(`${name} must be an absolute path`);
      }
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid timeoutMs');
    this.executable = executable; this.cwd = cwd; this.onEvent = onEvent; this.onApproval = onApproval;
    this.spawn = spawn; this.timeoutMs = timeoutMs; this.pending = new Map(); this.approvals = new Map();
    this.nextId = 1; this.closed = false; this.ready = false; this.child = null;
    this.decoder = new StringDecoder('utf8'); this.buffer = '';
  }

  connect() {
    if (this.closed) return Promise.reject(new Error('Codex client is closed'));
    if (this.connection) return this.connection;
    // Assign before spawning/handshaking so concurrent callers share the same process.
    this.connection = Promise.resolve().then(async () => {
      if (this.closed) throw new Error('Codex client is closed');
      try {
        this.child = this.spawn(this.executable, ['app-server', '--stdio'], {
          cwd: this.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
        const fail = () => this._fail(new Error('Codex process or stdio error'));
        this.child.on('error', fail);
        this.child.on('exit', (code, signal) => this._fail(new Error(`Codex process exited (${code ?? signal ?? 'unknown'})`)));
        this.child.on('close', () => { if (!this.closed) this._fail(new Error('Codex process closed')); });
        this.child.stdout.on('data', chunk => this._data(chunk));
        this.child.stdout.on('error', fail); this.child.stdin.on('error', fail);
        // Drain without retaining or emitting potentially sensitive diagnostics.
        this.child.stderr.on('data', () => {}); this.child.stderr.on('error', fail);
        const result = await this.request('initialize', {
          clientInfo: { name: 'obsidian_todo_dashboard', title: 'Todo Dashboard', version: '0.2.0' },
          capabilities: { experimentalApi: false }
        });
        this.notify('initialized'); this.ready = true; return result;
      } catch (error) { this._fail(error); throw error; }
    });
    return this.connection;
  }

  request(method, params = {}) {
    if (this.closed || !this.child) return Promise.reject(new Error('Codex client is closed or disconnected'));
    if (!this.ready && method !== 'initialize') return Promise.reject(new Error('Codex handshake is incomplete'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this._write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method, params) {
    this._write(params === undefined ? { method } : { method, params });
  }

  _write(message) {
    if (this.closed || !this.child) throw new Error('Codex client is closed or disconnected');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > MAX_BUFFER) throw new Error('Codex outgoing protocol buffer exceeds limit');
    this.child.stdin.write(line, error => { if (error) this._fail(new Error('Codex stdio write failed')); });
  }

  _data(chunk) {
    if (this.closed) return;
    this.buffer += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      if (Buffer.byteLength(this.buffer.slice(0, index)) > MAX_BUFFER) return this._fail(new Error('Codex protocol buffer exceeds limit'));
      const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        this._message(message);
      } catch { this._fail(new Error('Invalid Codex protocol message')); return; }
      if (this.closed) return;
    }
    if (Buffer.byteLength(this.buffer) > MAX_BUFFER) this._fail(new Error('Codex protocol buffer exceeds limit'));
  }

  _message(message) {
    if (typeof message.method === 'string') {
      if (own(message, 'id')) { void this._approval(message); return; }
      if (message.method === 'serverRequest/resolved') this.approvals.delete(message.params?.requestId);
      this._event(message); return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || 'Codex request failed'); error.code = message.error.code;
      pending.reject(error);
    } else if (own(message, 'result')) pending.resolve(message.result);
    else pending.reject(new Error('Invalid Codex protocol response'));
  }

  async _approval({ id, method, params }) {
    if (!own(defaults, method)) {
      this._write({ id, error: { code: -32601, message: 'Unsupported server request' } }); return;
    }
    const marker = {}; this.approvals.set(id, marker);
    let result;
    try { result = this.onApproval ? await this.onApproval({ id, method, params }) : undefined; }
    catch { /* A failed or dismissed UI never approves. */ }
    if (this.closed || this.approvals.get(id) !== marker) return;
    this.approvals.delete(id);
    try { this._write({ id, result: result && typeof result === 'object' ? result : defaults[method]() }); }
    catch { this._fail(new Error('Codex approval response failed')); }
  }

  _event(event) { try { this.onEvent?.(event); } catch { /* UI failures cannot break protocol handling. */ } }
  _fail(error) {
    if (this.closed) return;
    this.close(error); this._event({ method: 'client/disconnected', params: { message: error.message } });
  }

  close(reason = new Error('Codex client closed')) {
    if (this.closed) return;
    this.closed = true; this.ready = false; this.buffer = ''; this.approvals.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(reason); }
    this.pending.clear();
    // Only the ChildProcess owned by this instance is signalled; never kill by image name.
    try { this.child?.stdin.end(); } catch { /* already gone */ }
    try { this.child?.kill(); } catch { /* already gone */ }
  }

  async readAccount() {
    const result = await this.request('account/read', { refreshToken: false });
    const account = result.account ? Object.fromEntries(['type', 'email', 'planType'].filter(k => own(result.account, k)).map(k => [k, result.account[k]])) : null;
    return { account, requiresOpenaiAuth: result.requiresOpenaiAuth };
  }
  listModels() { return this.request('model/list', {}); }
  async startLogin() {
    const result = await this.request('account/login/start', { type: 'chatgpt' });
    let url; try { url = new URL(result.authUrl); } catch { throw new Error('Codex returned no authentication URL'); }
    if (url.protocol !== 'https:' || !(url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com') || url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) || url.username || url.password) {
      throw new Error('Codex returned an unsupported authentication URL');
    }
    return { authUrl: result.authUrl };
  }

  _mode(mode) {
    if (!['readOnly', 'workspaceWrite'].includes(mode)) throw new TypeError('Unsupported Codex mode');
    return mode;
  }
  async startThread({ mode = 'readOnly', model, threadId, webSearch = false } = {}) {
    this._mode(mode);
    const params = { cwd: this.cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: mode === 'readOnly' ? 'read-only' : 'workspace-write' };
    if (model) params.model = model;
    if (webSearch) params.config = { web_search: 'live' };
    if (threadId) params.threadId = threadId;
    return this.request(threadId ? 'thread/resume' : 'thread/start', params);
  }
  async send(text, options = {}) { return this.startTurn(text, options); }
  async startTurn(text, { threadId, mode = 'readOnly', model, images = [] } = {}) {
    this._mode(mode);
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('Message is empty');
    if (typeof threadId !== 'string' || !threadId) throw new TypeError('threadId is required');
    const sandboxPolicy = mode === 'readOnly' ? { type: 'readOnly' } : {
      type: 'workspaceWrite', writableRoots: [this.cwd], networkAccess: false,
      excludeTmpdirEnvVar: true, excludeSlashTmp: true
    };
    if (!Array.isArray(images) || images.length > 12 || images.some(p => typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0') || path.relative(this.cwd,p).startsWith('..'))) throw new TypeError('Image paths must be inside the vault (maximum 12)');
    const params = { threadId, cwd: this.cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy, input: [{ type: 'text', text, text_elements: [] }, ...images.map(p => ({ type: 'localImage', path:p }))] };
    if (model) params.model = model;
    return this.request('turn/start', params);
  }
  stop(threadId, turnId) { return this.request('turn/interrupt', { threadId, turnId }); }
}

module.exports = { CodexClient };

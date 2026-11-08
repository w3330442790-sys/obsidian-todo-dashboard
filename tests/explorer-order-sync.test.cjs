'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ExplorerOrderSync} = require('../src/explorer-order-sync.cjs');
const {ExplorerOrder} = require('../src/explorer-order.cjs');

const ROOT = 'Todo工作台';
const DIR = ROOT + '/文件树排序';
const order = (folder, ...names) => names.map(name => folder + '/' + name);

function device(initial = {}, storage = new Map()) {
  const files = new Map();
  const listeners = new Map();
  const folder = {path: DIR, children: []};
  const plugin = {
    local: {...initial},
    app: {workspace: {}, vault: {
      getName: () => 'vault',
      getAbstractFileByPath: path => path === DIR && createdFolder ? folder : files.get(path),
      read: async file => file.raw,
      create: async (path, raw) => {
        if (!createdFolder || files.has(path)) throw Error('Cannot create ' + path);
        const file = {path, raw, extension: 'md'};
        files.set(path, file);
        folder.children.push(file);
        emit('create', file);
        return file;
      },
      on(event, callback) { listeners.set(event, callback); },
    }},
    store: {root: ROOT, async ensureFolder(path) {
      assert.equal(path, DIR);
      createdFolder = true;
    }},
    async saveLocal(patch) { Object.assign(plugin.local, patch); },
    registerEvent() {},
    run(callback) { return callback(); },
  };
  let createdFolder = false;
  const vault = plugin.app.vault;
  const browserStorage = {
    getItem: key => storage.get(key),
    setItem: (key, value) => storage.set(key, value)
  };
  const sync = new ExplorerOrderSync(plugin, {storage: browserStorage});

  function emit(event, file, from) { return listeners.get(event)?.(file, from); }
  async function receive(other, include = () => true, refresh = true) {
    await plugin.store.ensureFolder(DIR);
    for (const [path, file] of other.files) {
      if (include(file) && !files.has(path)) await vault.create(path, file.raw);
    }
    if (refresh) await sync.refresh();
  }
  return {sync, files, plugin, browserStorage, emit, receive, get createdFolder() { return createdFolder; }};
}

test('reads a new vault without creating its order folder or local data', async () => {
  const a = device();
  await a.sync.initialize();
  assert.equal(a.createdFolder, false);
  assert.deepEqual(a.sync.orders, {});
  assert.deepEqual(a.plugin.local, {});
});

test('migrates legacy order once and loads it on a second device', async () => {
  const original = {Work: order('Work', 'b.md', 'a.md')};
  const a = device({fileOrders: original});
  const b = device();
  await a.sync.initialize();
  await a.sync.initialize();
  assert.deepEqual(a.sync.orders, original);
  assert.deepEqual(a.plugin.local.fileOrders, {});
  assert.equal(a.files.size, 1);

  await b.receive(a);
  await b.sync.initialize();
  assert.deepEqual(b.sync.orders, original);
  assert.equal(b.sync.conflicts.length, 0);
  assert.equal(b.files.size, 1);
});

test('retries a partial legacy migration without duplicating existing revisions', async () => {
  const original = {Work: order('Work', 'b.md', 'a.md'), Home: order('Home', 'b.md', 'a.md')};
  const a = device({fileOrders: original});
  const create = a.plugin.app.vault.create;
  a.plugin.app.vault.create = async (...args) => {
    if (a.files.size) throw Error('write failed');
    return create(...args);
  };
  await assert.rejects(a.sync.initialize(), /write failed/);
  assert.deepEqual(a.plugin.local.fileOrders, original);
  assert.deepEqual(a.sync.orders, original);
  assert.equal(a.files.size, 1);
  a.plugin.app.vault.create = create;
  await a.sync.initialize();
  assert.deepEqual(a.sync.orders, original);
  assert.equal(a.files.size, 2);
  assert.deepEqual(a.plugin.local.fileOrders, {});
});

test('merges disjoint folder edits without prompting', async () => {
  const a = device();
  const b = device();
  await Promise.all([a.sync.initialize(), b.sync.initialize()]);
  const work = order('Work', 'b.md', 'a.md');
  const home = order('Home', 'a.md', 'b.md');
  await a.sync.setOrder('Work', work);
  await b.sync.setOrder('Home', home);
  await a.receive(b);
  await b.receive(a);
  assert.deepEqual(a.sync.orders, {Work: work, Home: home});
  assert.deepEqual(a.sync.orders, b.sync.orders);
  assert.equal(a.sync.conflicts.length, 0);
  assert.equal(b.sync.conflicts.length, 0);
});

test('keeps independent same-folder edits until a selected order resolves on both devices', async () => {
  const a = device();
  const b = device();
  await a.sync.initialize();
  const first = order('Work', 'a.md', 'b.md', 'c.md');
  await a.sync.setOrder('Work', first);
  await b.receive(a);
  await b.sync.initialize();

  const aOrder = order('Work', 'c.md', 'a.md', 'b.md');
  const bOrder = order('Work', 'b.md', 'c.md', 'a.md');
  await a.sync.setOrder('Work', aOrder);
  await b.sync.setOrder('Work', bOrder);
  await a.receive(b);
  await b.receive(a);

  const [conflict] = a.sync.conflicts;
  assert.equal(conflict.folder, 'Work');
  assert.deepEqual(a.sync.orders.Work, aOrder);
  assert.deepEqual(b.sync.orders.Work, bOrder);
  assert.deepEqual(conflict.options.find(option => option.local).paths, aOrder);
  assert.deepEqual(conflict.options.find(option => !option.local).paths, bOrder);
  await a.sync.resolve('Work', conflict.options.find(option => !option.local).id, conflict.token);
  await b.receive(a);
  assert.deepEqual(a.sync.orders.Work, bOrder);
  assert.deepEqual(b.sync.orders.Work, bOrder);
  assert.equal(a.sync.conflicts.length, 0);
  assert.equal(b.sync.conflicts.length, 0);
});

test('equivalent concurrent orders do not prompt and can be edited on either device', async () => {
  const a = device();
  const b = device();
  await Promise.all([a.sync.initialize(), b.sync.initialize()]);
  const first = order('Work', 'b.md', 'a.md');
  await a.sync.setOrder('Work', first);
  await b.sync.setOrder('Work', first);
  await a.receive(b);
  assert.equal(a.sync.conflicts.length, 0);
  const next = order('Work', 'a.md', 'b.md');
  await a.sync.setOrder('Work', next);
  await b.receive(a);
  assert.equal(b.sync.conflicts.length, 0);
  assert.deepEqual(b.sync.orders.Work, next);
});

test('an out-of-order resolution suppresses an ancestor even before its parent arrives', async () => {
  const a = device();
  const b = device();
  await a.sync.initialize();
  await a.sync.setOrder('Work', order('Work', 'a.md', 'b.md', 'c.md'));
  const oldest = [...a.files.keys()][0];
  await b.receive(a);
  await b.sync.initialize();

  await a.sync.setOrder('Work', order('Work', 'b.md', 'a.md', 'c.md'));
  await b.sync.setOrder('Work', order('Work', 'b.md', 'c.md', 'a.md'));
  await a.receive(b);
  const [conflict] = a.sync.conflicts;
  const chosen = conflict.options.find(option => option.local);
  await a.sync.resolve('Work', chosen.id, conflict.token);
  const resolved = [...a.files.keys()].at(-1);

  const c = device();
  await c.receive(a, file => [oldest, resolved].includes(file.path));
  assert.deepEqual(c.sync.orders.Work, chosen.paths);
  assert.equal(c.sync.conflicts.length, 0);
});

test('a stale choice cannot silently resolve a newly arrived competing order', async () => {
  const a = device();
  const b = device();
  const c = device();
  await Promise.all([a.sync.initialize(), b.sync.initialize(), c.sync.initialize()]);
  await a.sync.setOrder('Work', order('Work', 'a.md', 'b.md', 'c.md'));
  await b.sync.setOrder('Work', order('Work', 'b.md', 'a.md', 'c.md'));
  await c.sync.setOrder('Work', order('Work', 'c.md', 'b.md', 'a.md'));
  await a.receive(b);
  const [conflict] = a.sync.conflicts;
  await a.receive(c);
  const writes = a.files.size;
  await assert.rejects(a.sync.resolve('Work', conflict.options[0].id, conflict.token), /已变化/);
  assert.equal(a.files.size, writes);
  assert.equal(a.sync.conflicts[0].options.length, 3);
});

test('folder rename preserves concurrent child orders and deletion removes stale order positions', async () => {
  const a = device();
  const b = device();
  await Promise.all([a.sync.initialize(), b.sync.initialize()]);
  await a.sync.setOrder('Work', order('Work', 'a.md', 'b.md', 'c.md'));
  await b.sync.setOrder('Work', order('Work', 'b.md', 'c.md', 'a.md'));
  await a.sync.remap('Work', 'Projects');
  await a.receive(b);
  await b.receive(a);
  assert.equal(a.sync.orders.Work, undefined);
  assert.deepEqual(a.sync.orders.Projects, order('Projects', 'a.md', 'b.md', 'c.md'));
  assert.deepEqual(b.sync.orders.Projects, order('Projects', 'b.md', 'c.md', 'a.md'));
  assert.equal(a.sync.conflicts[0].folder, 'Projects');
  await a.sync.remap('Projects/b.md', null);
  await b.receive(a);
  assert.deepEqual(a.sync.orders.Projects, order('Projects', 'a.md', 'c.md'));
  assert.deepEqual(b.sync.orders.Projects, order('Projects', 'c.md', 'a.md'));
});

test('explorer reloads incoming orders from vault events and requests a native sort', async t => {
  const a = device();
  const b = device();
  await a.sync.initialize();
  const work = order('Work', 'b.md', 'a.md');
  await a.sync.setOrder('Work', work);

  let finish;
  const refreshed = new Promise(resolve => { finish = resolve; });
  b.plugin.run = async fn => { await fn(); finish(); };
  const explorer = new ExplorerOrder(b.plugin, {storage: b.browserStorage, icon() {}});
  explorer.start();
  await explorer.initialize();
  let sorted = 0;
  explorer.views.set({requestSort() { sorted++; }}, {restore() {}, detachDrag() {}});
  t.after(() => explorer.stop());
  await b.receive(a, undefined, false);
  await refreshed;
  assert.deepEqual(explorer.orders.Work, work);
  assert.equal(sorted, 1);
});

test('two copies of the same rename event do not remap a later reused folder path', async () => {
  const a = device();
  const b = device();
  await a.sync.initialize();
  const first = order('Work', 'b.md', 'a.md');
  await a.sync.setOrder('Work', first);
  await b.receive(a);
  await b.sync.initialize();
  await a.sync.remap('Work', 'Projects');
  await b.sync.remap('Work', 'Projects');
  const next = order('Work', 'y.md', 'x.md');
  await b.sync.setOrder('Work', next);
  await b.receive(a);
  assert.deepEqual(b.sync.orders.Work, next);
  assert.deepEqual(b.sync.orders.Projects, order('Projects', 'b.md', 'a.md'));
  assert.equal(b.sync.conflicts.length, 0);
});

test('invalid imported revisions are reported and a later repair is applied', async () => {
  const a = device();
  const b = device();
  await a.sync.initialize();
  const work = order('Work', 'b.md', 'a.md');
  await a.sync.setOrder('Work', work);
  await b.plugin.store.ensureFolder(DIR);
  const [valid] = a.files.values();
  const invalid = await b.plugin.app.vault.create(valid.path, 'incomplete upload');
  await b.sync.refresh();
  assert.equal(b.sync.errors[0].path, invalid.path);
  assert.deepEqual(b.sync.orders, {});
  invalid.raw = valid.raw;
  b.sync.invalidate(invalid.path);
  await b.sync.refresh();
  assert.equal(b.sync.errors.length, 0);
  assert.deepEqual(b.sync.orders.Work, work);
});

test('keeps a device’s own side visible after reloading with a conflict', async () => {
  const a = device();
  const b = device();
  await Promise.all([a.sync.initialize(), b.sync.initialize()]);
  const local = order('Work', 'a.md', 'b.md');
  await a.sync.setOrder('Work', local);
  await b.sync.setOrder('Work', order('Work', 'b.md', 'a.md'));
  await a.receive(b);
  const restarted = new ExplorerOrderSync(a.plugin, {storage: a.browserStorage});
  await restarted.initialize();
  assert.deepEqual(restarted.orders.Work, local);
  assert.deepEqual(restarted.conflicts[0].options.find(option => option.local).paths, local);
});

test('rename takes pending synced revisions into account before projecting their paths', async () => {
  const a = device();
  const b = device();
  await Promise.all([a.sync.initialize(), b.sync.initialize()]);
  const work = order('Work', 'b.md', 'a.md');
  await a.sync.setOrder('Work', work);
  await b.receive(a, undefined, false);
  b.sync.invalidate([...b.files.keys()][0]);
  await b.sync.remap('Work', 'Projects');
  await b.sync.refresh();
  assert.equal(b.sync.orders.Work, undefined);
  assert.deepEqual(b.sync.orders.Projects, order('Projects', 'b.md', 'a.md'));
});

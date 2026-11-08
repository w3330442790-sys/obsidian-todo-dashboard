'use strict';

const {uid} = require('./core.cjs');
const {parentPath, normalizeOrders, remapOrders} = require('./file-order.cjs');

const ID = /^[a-z0-9-]{8,64}$/;
const FILE = /^order-([a-z0-9-]{8,64})\.md$/;
const HEADER = '# Todo 工作台文件树排序\n\n```json\n';
const FOOTER = '\n```';
const SEQUENCE = value => Number.isSafeInteger(value) && value > 0;
const isId = value => typeof value === 'string' && ID.test(value);
const samePaths = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const isPath = value => typeof value === 'string' && !value.includes('\\') &&
  value.split('/').every(part => part && part !== '.' && part !== '..');

function decode(raw, id) {
  const text = raw.replace(/\r\n/g, '\n').trimEnd();
  if (!text.startsWith(HEADER) || !text.endsWith(FOOTER)) throw Error('文件树排序文件格式无效');
  const record = JSON.parse(text.slice(HEADER.length, -FOOTER.length));
  if (record?.version !== 1 || record.id !== id || !isId(record.author)) {
    throw Error('文件树排序记录格式无效');
  }
  if (record.kind === 'move' && SEQUENCE(record.level) && isPath(record.from) &&
      (record.to === null || isPath(record.to)) && record.from !== record.to) return record;
  if (record.kind === 'order' && (record.folder === '/' || isPath(record.folder)) &&
      Array.isArray(record.paths) && new Set(record.paths).size === record.paths.length &&
      record.paths.every(path => isPath(path) && parentPath(path) === record.folder) &&
      SEQUENCE(record.sequence) && Array.isArray(record.context) &&
      record.context.every(pair => Array.isArray(pair) && pair.length === 2 &&
        isId(pair[0]) && SEQUENCE(pair[1]) &&
        (pair[0] !== record.author || pair[1] < record.sequence)) &&
      Array.isArray(record.moves) && record.moves.every(isId)) return record;
  throw Error('文件树排序记录字段无效');
}

function include(clock, author, sequence) {
  clock.set(author, Math.max(clock.get(author) || 0, sequence));
}

function contextOf(records) {
  const clock = new Map();
  for (const record of records) {
    include(clock, record.author, record.sequence);
    for (const [author, sequence] of record.context) include(clock, author, sequence);
  }
  return clock;
}

function groupMoves(moves) {
  // Both devices can observe the same filesystem change before its record arrives.
  const groups = new Map();
  for (const {id, level, from, to} of moves) {
    const key = JSON.stringify([level, from, to]);
    if (!groups.has(key)) groups.set(key, {from, to, ids: []});
    groups.get(key).ids.push(id);
  }
  return [...groups.values()];
}

function project(record, moves) {
  if (!moves.length) return record;
  let {folder, paths} = record;
  const applied = new Set(record.moves);
  for (const {ids, from, to} of moves) {
    if (ids.some(id => applied.has(id))) continue;
    const before = {[folder]: paths};
    const next = remapOrders(before, from, to);
    if (next === before) continue;
    if (folder === from || folder.startsWith(from + '/')) {
      if (!to) return null;
      folder = to + folder.slice(from.length);
    }
    paths = next[folder] || [];
  }
  return {...record, folder, paths};
}

function visibleState(records, author) {
  // Each context also covers ancestors whose files have yet to arrive via EasySync.
  const replaced = new Map();
  for (const record of records) {
    for (const [writer, sequence] of record.context) include(replaced, writer, sequence);
  }
  const heads = records.filter(record => record.sequence > (replaced.get(record.author) || 0))
    .sort((a, b) => a.id.localeCompare(b.id));
  const distinct = new Map();
  for (const {id, paths, author: writer} of heads) {
    const key = JSON.stringify(paths);
    const existing = distinct.get(key);
    if (existing) existing.local ||= writer === author;
    else distinct.set(key, {id, paths, local: writer === author});
  }
  const options = [...distinct.values()];
  return {heads, options, preferred: options.find(option => option.local) || options[0]};
}

class ExplorerOrderSync {
  constructor(plugin, {storage = globalThis.localStorage, onChange = () => {}} = {}) {
    this.plugin = plugin;
    this.vault = plugin.app.vault;
    this.directory = plugin.store.root + '/文件树排序';
    this.storage = storage;
    this.storageKey = 'todo-dashboard:explorer-order:' + this.vault.getName?.() + ':' + plugin.store.root;
    try {
      const saved = this.storage?.getItem(this.storageKey);
      if (isId(saved)) this.author = saved;
    } catch {}
    this.onChange = onChange;
    this.queue = Promise.resolve();
    this.cache = new Map();
    this.dirty = new Set();
    this.states = new Map();
    this.moves = [];
    this.legacy = normalizeOrders(plugin.local.fileOrders);
    this.orders = this.legacy;
    this.conflicts = [];
    this.errors = [];
  }

  enqueue(callback) {
    const job = this.queue.then(callback);
    this.queue = job.catch(() => {});
    return job;
  }

  includes(path) {
    return path === this.directory || path?.startsWith(this.directory + '/');
  }

  invalidate(path) {
    if (this.includes(path)) this.dirty.add(path);
  }

  async load() {
    if (this.dirty.has(this.directory)) this.cache.clear();
    for (const path of this.dirty) this.cache.delete(path);
    this.dirty.clear();

    const folder = this.vault.getAbstractFileByPath(this.directory);
    if (folder && !Array.isArray(folder.children)) throw Error('文件树排序目录被同名文件占用');
    const present = new Set();
    for (const file of folder?.children || []) {
      const id = file.path.slice(this.directory.length + 1).match(FILE)?.[1];
      if (!id || file.extension !== 'md') continue;
      present.add(file.path);
      if (this.cache.has(file.path)) continue;
      try {
        this.cache.set(file.path, {record: decode(await this.vault.read(file), id)});
      } catch (error) {
        this.cache.set(file.path, {error: {path: file.path, message: error.message}});
      }
    }
    for (const path of this.cache.keys()) {
      if (!present.has(path)) this.cache.delete(path);
    }
  }

  rebuild() {
    const entries = [...this.cache.values()];
    const records = entries.flatMap(entry => entry.record ? [entry.record] : []);
    this.moves = records.filter(record => record.kind === 'move')
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
    const moves = groupMoves(this.moves);
    const grouped = new Map();
    for (const original of records) {
      if (original.kind !== 'order') continue;
      const record = project(original, moves);
      if (!record || this.includes(record.folder)) continue;
      if (!grouped.has(record.folder)) grouped.set(record.folder, []);
      grouped.get(record.folder).push(record);
    }
    const orders = new Map(Object.entries(this.legacy));
    const conflicts = [];
    this.states = new Map();
    for (const folder of [...grouped.keys()].sort()) {
      const state = visibleState(grouped.get(folder), this.author);
      this.states.set(folder, state);
      if (state.preferred?.paths.length) orders.set(folder, state.preferred.paths);
      else orders.delete(folder);
      if (state.options.length > 1) {
        const token = JSON.stringify(state.heads.map(({id, paths}) => [id, paths]));
        conflicts.push({folder, token, options: state.options});
      }
    }
    const errors = entries.flatMap(entry => entry.error ? [entry.error] : [])
      .sort((a, b) => a.path.localeCompare(b.path));
    const next = {orders: Object.fromEntries(orders), conflicts, errors};
    const previous = {orders: this.orders, conflicts: this.conflicts, errors: this.errors};
    Object.assign(this, next);
    if (JSON.stringify(previous) !== JSON.stringify(next)) this.onChange(next, previous);
  }

  refresh() {
    return this.enqueue(async () => {
      await this.load();
      this.rebuild();
    });
  }

  initialize() {
    return this.enqueue(async () => {
      if (this.ready) return;
      await this.load();
      this.rebuild();
      for (const [folder, paths] of Object.entries(this.legacy)) {
        if (this.includes(folder)) continue;
        const state = this.states.get(folder);
        if (state?.heads.some(record => record.author === this.author) ||
            state?.options.some(option => samePaths(option.paths, paths))) continue;
        await this.appendOrder(folder, paths, []);
      }
      if (this.plugin.local.fileOrders && Object.keys(this.plugin.local.fileOrders).length) {
        await this.plugin.saveLocal({fileOrders: {}});
      }
      this.legacy = {};
      this.rebuild();
      this.ready = true;
    });
  }

  getAuthor() {
    if (this.author) return this.author;
    const author = uid();
    if (!this.storage) throw Error('本机存储不可用，无法保存文件树排序');
    this.storage.setItem(this.storageKey, author);
    this.author = author;
    return author;
  }

  async append(fields) {
    const id = uid();
    const record = {version: 1, id, author: this.getAuthor(), ...fields};
    const path = this.directory + '/order-' + id + '.md';
    await this.plugin.store.ensureFolder(this.directory);
    await this.vault.create(path, HEADER + JSON.stringify(record, null, 2) + FOOTER + '\n');
    this.cache.set(path, {record});
    this.rebuild();
  }

  appendOrder(folder, paths, previous) {
    const author = this.getAuthor();
    const context = [...contextOf(previous)];
    let sequence = 0;
    for (const {record} of this.cache.values()) {
      if (record?.kind !== 'order') continue;
      if (record.author === author) sequence = Math.max(sequence, record.sequence);
      for (const [writer, seen] of record.context) {
        if (writer === author) sequence = Math.max(sequence, seen);
      }
    }
    if (!SEQUENCE(sequence + 1)) throw Error('文件树排序版本号超出范围');
    return this.append({kind: 'order', folder, paths, sequence: sequence + 1, context,
      moves: this.moves.map(move => move.id)});
  }

  setOrder(folder, paths) {
    if (this.includes(folder)) return Promise.resolve();
    const base = this.states.get(folder);
    return this.enqueue(async () => {
      if (base?.options.length > 1) throw Error('请先处理此目录的文件树排序冲突');
      if (base?.preferred && samePaths(base.preferred.paths, paths)) return;
      // Keep the order seen at drop time. A newer remote edit may still be in transit.
      const newerLocal = this.states.get(folder)?.heads.filter(record => record.author === this.author) || [];
      await this.appendOrder(folder, paths, [...(base?.heads || []), ...newerLocal]);
    });
  }

  resolve(folder, optionId, token) {
    return this.enqueue(async () => {
      await this.load();
      this.rebuild();
      const conflict = this.conflicts.find(conflict => conflict.folder === folder);
      const option = conflict?.options.find(option => option.id === optionId);
      if (!option || conflict.token !== token) throw Error('文件树排序冲突已变化，请重新查看');
      await this.appendOrder(folder, option.paths, this.states.get(folder).heads);
    });
  }

  remap(from, to) {
    return this.enqueue(async () => {
      if (!isPath(from) || (to !== null && !isPath(to)) || from === to ||
          this.includes(from) || this.includes(to)) return;
      if (this.dirty.size) {
        await this.load();
        this.rebuild();
      }
      for (const [folder, {heads}] of this.states) {
        if (heads.some(record => {
          const before = {[folder]: record.paths};
          return remapOrders(before, from, to) !== before;
        })) {
          await this.append({kind: 'move', from, to, level: (this.moves.at(-1)?.level || 0) + 1});
          return;
        }
      }
    });
  }
}

module.exports = {ExplorerOrderSync};

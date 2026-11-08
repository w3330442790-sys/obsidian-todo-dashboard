'use strict';

const {parentPath, moveItem, patchExplorerSort} = require('./file-order.cjs');
const {attachExplorerDrag} = require('./explorer-drag.cjs');
const {ExplorerOrderSync} = require('./explorer-order-sync.cjs');

class ExplorerOrder {
  constructor(plugin, {icon, storage, onConflicts, onErrors}) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.icon = icon;
    this.views = new Map();
    this.sync = new ExplorerOrderSync(plugin, {storage, onChange: (next, previous) => {
      if (this.stopped) return;
      if (JSON.stringify(next.orders) !== JSON.stringify(previous.orders)) {
        for (const view of this.views.keys()) view.requestSort?.();
      }
      if (JSON.stringify(next.conflicts) !== JSON.stringify(previous.conflicts)) onConflicts?.(next.conflicts);
      if (JSON.stringify(next.errors) !== JSON.stringify(previous.errors)) onErrors?.(next.errors);
    }});
  }

  get orders() { return this.sync.orders; }
  get conflicts() { return this.sync.conflicts; }

  async initialize() {
    await this.sync.initialize();
    if (this.sync.dirty.size) this.scheduleRefresh();
  }

  resolve(folder, optionId, token) {
    return this.sync.resolve(folder, optionId, token);
  }

  start() {
    const {plugin, app} = this;
    const workspace = app.workspace;
    if (typeof workspace.on === 'function') {
      plugin.registerEvent(workspace.on('layout-change', () => this.attach()));
    }
    for (const event of ['create', 'modify', 'rename', 'delete']) {
      plugin.registerEvent(app.vault.on(event, (file, oldPath) => {
        if (this.stopped) return;
        if (this.sync.includes(file.path) || this.sync.includes(oldPath)) {
          this.sync.invalidate(file.path);
          this.sync.invalidate(oldPath);
          if (this.sync.ready) this.scheduleRefresh();
        } else if (this.sync.ready && (event === 'rename' || event === 'delete')) {
          const from = event === 'rename' ? oldPath : file.path;
          const to = event === 'rename' ? file.path : null;
          if (from) plugin.run(() => this.sync.remap(from, to));
        }
      }));
    }
  }

  scheduleRefresh() {
    if (this.stopped) return;
    clearTimeout(this.refreshHandle);
    this.refreshHandle = setTimeout(() => this.plugin.run(() => this.sync.refresh()), 100);
  }

  attach() {
    if (this.stopped) return;
    const active = new Set((this.app.workspace.getLeavesOfType?.('file-explorer') || []).map(leaf => leaf.view));
    for (const [view, state] of this.views) {
      if (!active.has(view)) this.detach(view, state);
    }
    for (const view of active) {
      const list = view.navFileContainerEl;
      if (this.views.has(view) || !list?.parentElement) continue;
      const restore = patchExplorerSort(view, path => Object.hasOwn(this.orders, path) ? this.orders[path] : undefined);
      if (!restore) continue;
      const detachDrag = attachExplorerDrag(list, {
        icon: this.icon,
        move: (path, target, after) => this.plugin.run(() => this.dragSibling(view, path, target, after))
      });
      this.views.set(view, {restore, detachDrag});
      view.requestSort?.();
    }
  }

  async dragSibling(view, path, target, after) {
    if (!this.sync.ready) await this.initialize();
    const folderPath = parentPath(path);
    const vault = this.app.vault;
    const parent = folderPath === '/' ? vault.getRoot() : vault.getAbstractFileByPath(folderPath);
    if (this.stopped || !this.views.has(view) || !Array.isArray(parent?.children)) return;
    const paths = view.getSortedFolderItems(parent).map(row => row.file?.path).filter(Boolean);
    const next = moveItem(paths, path, target, after);
    if (next === paths || next.every((entry, index) => entry === paths[index])) return;
    await this.sync.setOrder(folderPath, next);
  }

  detach(view, state) {
    state.detachDrag();
    state.restore();
    view.requestSort?.();
    this.views.delete(view);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.refreshHandle);
    for (const [view, state] of this.views) this.detach(view, state);
  }
}

module.exports = {ExplorerOrder};

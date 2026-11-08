'use strict';

const {parentPath, normalizeOrders, moveItem, remapOrders, patchExplorerSort} = require('./file-order.cjs');
const {attachExplorerDrag} = require('./explorer-drag.cjs');

class ExplorerOrder {
  constructor(plugin, {icon}) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.icon = icon;
    this.views = new Map();
    this.orders = normalizeOrders(plugin.local.fileOrders);
    this.queue = Promise.resolve();
  }

  start() {
    const {plugin, app} = this;
    const workspace = app.workspace;
    if (typeof workspace.on !== 'function') return;
    plugin.registerEvent(workspace.on('layout-change', () => this.attach()));
    for (const event of ['rename', 'delete']) {
      plugin.registerEvent(app.vault.on(event, (file, oldPath) => {
        const from = event === 'rename' ? oldPath : file.path;
        const to = event === 'rename' ? file.path : null;
        if (from) plugin.run(() => this.save(orders => remapOrders(orders, from, to)));
      }));
    }
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

  save(transform) {
    const job = this.queue.then(async () => {
      const next = transform(this.orders);
      if (next === this.orders) return;
      await this.plugin.saveLocal({fileOrders: next});
      this.orders = next;
      for (const view of this.views.keys()) view.requestSort?.();
    });
    this.queue = job.catch(() => {});
    return job;
  }

  dragSibling(view, path, target, after) {
    return this.save(orders => {
      const folderPath = parentPath(path);
      const vault = this.app.vault;
      const parent = folderPath === '/' ? vault.getRoot() : vault.getAbstractFileByPath(folderPath);
      if (!this.views.has(view) || !Array.isArray(parent?.children)) return orders;
      const paths = view.getSortedFolderItems(parent).map(row => row.file?.path).filter(Boolean);
      const next = moveItem(paths, path, target, after);
      if (next === paths || next.every((entry, index) => entry === paths[index])) return orders;
      return normalizeOrders({...orders, [parent.path]: next});
    });
  }

  detach(view, state) {
    state.detachDrag();
    state.restore();
    view.requestSort?.();
    this.views.delete(view);
  }

  stop() {
    this.stopped = true;
    for (const [view, state] of this.views) this.detach(view, state);
  }
}

module.exports = {ExplorerOrder};

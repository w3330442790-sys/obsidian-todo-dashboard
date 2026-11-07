'use strict';

const V = require('./views.cjs');
const {parentPath, normalizeOrders, moveItem, remapOrders, patchExplorerSort} = require('./file-order.cjs');

class ExplorerOrder {
  constructor(plugin, {notice, icon}) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.notice = notice;
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
    plugin.registerEvent(workspace.on('file-menu', (menu, file, source, leaf) => {
      if (typeof source !== 'string' || !source.startsWith('file-explorer')) return;
      if (!this.views.size) return;
      const path = Array.isArray(file.children) ? file.path : file.parent?.path ?? parentPath(file.path);
      menu.addItem(item => item.setTitle('手动排序').setIcon('list-ordered').onClick(() => {
        const views = [...this.views.keys()];
        const origin = menu.parentEl;
        const view = (this.views.has(leaf?.view) && leaf.view) ||
          (origin && views.find(candidate => candidate.containerEl.contains(origin))) || views[0];
        this.edit(view, path);
      }));
    }));
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
      const header = view.containerEl?.querySelector('.nav-header .nav-buttons-container');
      const list = view.navFileContainerEl;
      if (this.views.has(view) || !header || !list?.parentElement) continue;
      const restore = patchExplorerSort(view, path => Object.hasOwn(this.orders, path) ? this.orders[path] : undefined);
      if (!restore) continue;
      const action = V.button(header, '', () => this.edit(view, '/'), 'td-explorer-sort-action');
      action.classList.add('clickable-icon', 'nav-action-button');
      this.icon(action, 'list-ordered');
      action.title = '手动排序笔记库根目录';
      action.setAttribute('aria-label', action.title);
      this.views.set(view, {restore, action, list});
      view.requestSort?.();
    }
  }

  folder(path) {
    return path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
  }

  items(view, folder) {
    return view.getSortedFolderItems(folder).map(row => row.file).filter(file => file?.path);
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

  edit(view, path) {
    const state = this.views.get(view);
    const folder = this.folder(path);
    if (!state || !Array.isArray(folder?.children)) return;
    if (state.panel?.getAttribute('data-folder') === path) return;
    this.close(state);
    const entries = this.items(view, folder);
    const files = new Map(entries.map(file => [file.path, file]));
    let paths = [...files.keys()];
    let dragged = null;
    let busy = false;

    const panel = V.el(state.list.parentElement, 'section', 'td-explorer-sort');
    panel.setAttribute('data-folder', path);
    panel.setAttribute('aria-label', '手动排序');
    state.list.before(panel);
    state.list.classList.add('td-explorer-list-hidden');
    state.panel = panel;

    const header = V.el(panel, 'div', 'td-explorer-sort-header');
    V.el(header, 'h3', '', '手动排序');
    const actions = V.el(header, 'div', 'td-explorer-sort-actions');
    const cancel = V.button(actions, '取消', () => this.close(state, true));
    const done = V.button(actions, '完成', () => commit(false), 'mod-cta');
    V.el(panel, 'p', 'td-explorer-folder', path === '/' ? '笔记库根目录' : path);
    V.el(panel, 'p', 'td-muted', '拖动把手或点按箭头调整同级顺序。');
    const list = V.el(panel, 'ol', 'td-explorer-sort-list');
    const status = V.el(panel, 'p', 'td-explorer-sort-status');
    status.setAttribute('role', 'status');
    const reset = V.button(panel, '恢复默认排序', () => commit(true));

    const clearDrop = () => {
      for (const row of list.querySelectorAll('[data-drop]')) delete row.dataset.drop;
    };

    const setIcon = this.icon;
    function render(focusPath, direction) {
      list.replaceChildren();
      paths.forEach((item, index) => {
        const file = files.get(item);
        const name = file.name || item.split('/').pop();
        const row = V.el(list, 'li', 'td-explorer-sort-row');
        row.dataset.path = item;
        const grip = V.el(row, 'span', 'td-explorer-grip');
        grip.draggable = true;
        grip.setAttribute('aria-hidden', 'true');
        setIcon(grip, 'grip-vertical');
        const icon = V.el(row, 'span', 'td-explorer-item-icon');
        setIcon(icon, Array.isArray(file.children) ? 'folder' : 'file-text');
        V.el(row, 'span', 'td-explorer-item-name', name).title = name;
        const buttons = V.el(row, 'div', 'td-explorer-sort-actions');
        for (const [label, title, step] of [['↑', '上移', -1], ['↓', '下移', 1]]) {
          const target = paths[index + step];
          const button = V.button(buttons, label, () => {
            paths = moveItem(paths, item, target, step > 0);
            render(item, step);
          });
          button.setAttribute('aria-label', title + ' ' + name);
          button.disabled = !target;
          if (item === focusPath && step === direction) {
            queueMicrotask(() => (button.disabled ? buttons.querySelector('button:not(:disabled)') : button)?.focus());
          }
        }

        grip.ondragstart = event => {
          if (busy) { event.preventDefault(); return; }
          dragged = item;
          event.dataTransfer.setData('text/plain', item);
          event.dataTransfer.effectAllowed = 'move';
        };
        grip.ondragend = () => { dragged = null; clearDrop(); };
        row.ondragover = event => {
          if (!dragged || dragged === item) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const bounds = row.getBoundingClientRect();
          clearDrop();
          row.dataset.drop = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
        };
        row.ondragleave = event => {
          if (!row.contains(event.relatedTarget)) delete row.dataset.drop;
        };
        row.ondrop = event => {
          if (!dragged || !row.dataset.drop) return;
          event.preventDefault();
          paths = moveItem(paths, dragged, item, row.dataset.drop === 'after');
          dragged = null;
          render();
        };
      });
      if (!paths.length) V.el(list, 'li', 'td-muted', '此文件夹没有可排序条目。');
    }

    const commit = async resetOrder => {
      if (busy) return;
      busy = true;
      cancel.disabled = done.disabled = reset.disabled = true;
      list.inert = true;
      status.textContent = '';
      try {
        await this.save(orders => {
          if (resetOrder) return Object.fromEntries(Object.entries(orders).filter(([key]) => key !== path));
          const current = this.folder(path);
          if (current !== folder || current.path !== path) throw Error('文件夹已变化，请重新打开排序。');
          const available = new Set(this.items(view, current).map(file => file.path));
          if (paths.some(item => !available.has(item))) throw Error('目录内容已变化，请重新打开排序。');
          for (const item of paths) available.delete(item);
          return normalizeOrders({...orders, [path]: [...paths, ...available]});
        });
        if (state.panel === panel) this.close(state, true);
      } catch (error) {
        status.textContent = '排序保存失败：' + error.message;
      } finally {
        busy = false;
        cancel.disabled = done.disabled = reset.disabled = false;
        list.inert = false;
      }
    };

    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        this.close(state, true);
      }
    });
    render();
    done.focus();
  }

  async openRoot() {
    const workspace = this.app.workspace;
    const leaf = workspace.getLeavesOfType('file-explorer')[0];
    if (leaf) await workspace.revealLeaf(leaf);
    this.attach();
    const view = leaf?.view;
    if (!this.views.has(view)) {
      this.notice('请先打开 Obsidian 文件管理器。若已打开，当前版本的文件树暂不支持手动排序。');
      return;
    }
    this.edit(view, '/');
  }

  close(state, focus = false) {
    state.panel?.remove();
    state.panel = null;
    state.list.classList.remove('td-explorer-list-hidden');
    if (focus) state.action.focus();
  }

  detach(view, state) {
    this.close(state);
    state.action.remove();
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

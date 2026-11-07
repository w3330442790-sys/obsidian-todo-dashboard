'use strict';

function parentPath(path) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/'))) || '/';
}

function normalizeOrders(raw) {
  return Object.fromEntries(Object.entries(raw || {}).filter(([folder, paths]) =>
    folder && Array.isArray(paths)).map(([folder, paths]) => [folder, [...new Set(paths.filter(
      path => typeof path === 'string' && path !== '/' && path && parentPath(path) === folder
    ))]]).filter(([, paths]) => paths.length));
}

function orderedItems(items, order) {
  if (!order?.length) return items;
  const positions = new Map(order.map((path, index) => [path, index]));
  return [...items].sort((a, b) => (positions.get(a.file?.path) ?? order.length) -
    (positions.get(b.file?.path) ?? order.length));
}

function moveItem(paths, path, target, after) {
  if (path === target || !paths.includes(path) || !paths.includes(target)) return paths;
  const next = paths.filter(value => value !== path);
  next.splice(next.indexOf(target) + Number(after), 0, path);
  return next;
}

function remapOrders(orders, oldPath, newPath) {
  const matches = path => path === oldPath || path.startsWith(oldPath + '/');
  const replace = path => newPath + path.slice(oldPath.length);
  const output = new Map();
  let changed = false;
  for (const [folder, paths] of Object.entries(orders)) {
    let destination = folder;
    if (matches(folder)) {
      changed = true;
      if (!newPath) continue;
      destination = replace(folder);
    }
    const entries = paths.flatMap(path => {
      if (!matches(path)) return [path];
      changed = true;
      if (!newPath) return [];
      const next = replace(path);
      return parentPath(next) === destination ? [next] : [];
    });
    if (entries.length) output.set(destination, entries);
  }
  return changed ? Object.fromEntries(output) : orders;
}

function patchExplorerSort(view, lookup) {
  const original = view.getSortedFolderItems;
  if (typeof original !== 'function') return null;
  const own = Object.hasOwn(view, 'getSortedFolderItems');
  const wrapped = function(folder, ...args) {
    const result = original.call(this, folder, ...args);
    return Array.isArray(result) ? orderedItems(result, lookup(folder.path || '/')) : result;
  };
  view.getSortedFolderItems = wrapped;
  return () => {
    if (view.getSortedFolderItems !== wrapped) return;
    if (own) view.getSortedFolderItems = original;
    else delete view.getSortedFolderItems;
  };
}

module.exports = {parentPath, normalizeOrders, orderedItems, moveItem, remapOrders, patchExplorerSort};

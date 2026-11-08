'use strict';

const {parentPath} = require('./file-order.cjs');

const ROW = ':is(.nav-file-title,.nav-folder-title)[data-path]';
const GRIP = '.td-explorer-row-grip';

function attachExplorerDrag(list, {icon, move}) {
  const doc = list.ownerDocument;
  const win = doc.defaultView;
  const listeners = new win.AbortController();
  const options = {capture: true, signal: listeners.signal};
  let drag = null;
  let frame = 0;

  function addGrip(row) {
    if (!row || !row.dataset.path || row.dataset.path === '/' || row.querySelector(GRIP)) return;
    const grip = doc.createElement('span');
    grip.className = 'td-explorer-row-grip';
    grip.title = '拖动调整同级顺序';
    grip.setAttribute('aria-hidden', 'true');
    icon(grip, 'grip-vertical');
    row.appendChild(grip);
  }

  list.querySelectorAll(ROW).forEach(addGrip);
  const observer = new win.MutationObserver(records => {
    for (const record of records) {
      addGrip(record.target.closest?.(ROW));
      for (const node of record.addedNodes) {
        if (node.matches?.(ROW)) addGrip(node);
        node.querySelectorAll?.(ROW).forEach(addGrip);
      }
    }
  });
  observer.observe(list, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-path']});

  function markTarget() {
    const row = doc.elementFromPoint(drag.x, drag.y)?.closest(ROW);
    const path = row?.dataset.path;
    const sibling = path && path !== drag.path && path !== '/' && list.contains(row) && parentPath(path) === drag.parent;
    const target = sibling ? row : null;
    if (drag.target && drag.target !== target) delete drag.target.dataset.tdExplorerDrop;
    drag.target = target;
    if (!target) return;
    const bounds = row.getBoundingClientRect();
    row.dataset.tdExplorerDrop = drag.y >= bounds.top + bounds.height / 2 ? 'after' : 'before';
  }

  function scrollNearEdge() {
    frame = 0;
    if (!drag?.started) return;
    const {left, right, top, bottom} = list.getBoundingClientRect();
    if (drag.x < left || drag.x > right || drag.y < top || drag.y > bottom) return;
    const speed = drag.y < top + 28 ? -8 : drag.y > bottom - 28 ? 8 : 0;
    if (!speed) return;
    const previous = list.scrollTop;
    list.scrollTop += speed;
    if (list.scrollTop !== previous) {
      markTarget();
      frame = win.requestAnimationFrame(scrollNearEdge);
    }
  }

  function cancel() {
    if (!drag) return;
    const {id, target} = drag;
    drag = null;
    if (target) delete target.dataset.tdExplorerDrop;
    win.cancelAnimationFrame(frame);
    frame = 0;
    if (list.hasPointerCapture(id)) list.releasePointerCapture(id);
  }

  list.addEventListener('pointerdown', event => {
    const grip = event.target.closest?.(GRIP);
    const path = grip?.closest(ROW)?.dataset.path;
    if (!path || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    list.setPointerCapture(event.pointerId);
    drag = {id: event.pointerId, path, parent: parentPath(path), startX: event.clientX, startY: event.clientY};
  }, options);

  list.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const {clientX: x, clientY: y} = event;
    if (!drag.started && Math.hypot(x - drag.startX, y - drag.startY) < 5) return;
    event.stopPropagation();
    Object.assign(drag, {x, y, started: true});
    markTarget();
    if (!frame) frame = win.requestAnimationFrame(scrollNearEdge);
  }, options);

  list.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    event.stopPropagation();
    if (drag.started) {
      Object.assign(drag, {x: event.clientX, y: event.clientY});
      markTarget();
    }
    const {path, target} = drag;
    const destination = target?.dataset.path;
    const after = target?.dataset.tdExplorerDrop === 'after';
    cancel();
    if (destination) move(path, destination, after);
  }, options);

  for (const type of ['pointercancel', 'lostpointercapture']) {
    list.addEventListener(type, event => { if (drag?.id === event.pointerId) cancel(); }, options);
  }
  for (const type of ['click', 'contextmenu']) {
    list.addEventListener(type, event => {
      if (!event.target.closest?.(GRIP)) return;
      event.preventDefault();
      event.stopPropagation();
    }, options);
  }
  win.addEventListener('keydown', event => {
    if (drag && event.key === 'Escape') {
      event.stopPropagation();
      cancel();
    }
  }, options);
  win.addEventListener('blur', cancel, options);

  return () => {
    cancel();
    listeners.abort();
    observer.disconnect();
    list.querySelectorAll(GRIP).forEach(grip => grip.remove());
  };
}

module.exports = {attachExplorerDrag};

import { act, cleanup, fireEvent } from './dom.mjs';
export function mobileViewportFixture(t) {
  const names = ["visualViewport", "innerHeight", "innerWidth", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame"];
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(window, name)]);
  const viewport = Object.assign(new window.EventTarget(), { height: 956, width: 440, offsetTop: 0, scale: 1 });
  let coarse = true;
  let nextId = 0;
  const frames = new Map();
  const values = { visualViewport: viewport, innerHeight: 956, innerWidth: 440,
    matchMedia: () => ({ matches: coarse }),
    requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id) };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(window, name, { configurable: true, writable: true, value });
  t.after(() => {
    cleanup();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else delete window[name];
    }
  });
  return { viewport, setCoarse: value => { coarse = value; }, pending: frames,
    async flush() { await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); }); },
    resize(values) { Object.assign(viewport, values); viewport.dispatchEvent(new window.Event("resize")); } };
}

export function splitTransfer(projectId, threadId) {
  const data = new Map([["application/x-bbdesk-thread", JSON.stringify({ projectId, threadId })]]);
  return { types: [...data.keys()], getData: type => data.get(type) ?? "", setData: (type, value) => data.set(type, value) };
}

export function dropSplit(slot, transfer) {
  const previous = window.DragEvent;
  window.DragEvent = window.MouseEvent;
  try { fireEvent.drop(splitPanes(slot)[0], { dataTransfer: transfer, clientX: 40 }); }
  finally { window.DragEvent = previous; }
}

export const splitPanes = slot => [...slot.container.querySelectorAll(".db-split-pane")];

export const splitIds = slot => splitPanes(slot).map(node => node.dataset.threadId);

export function dropTransfer(node, transfer) {
  const previous = window.DragEvent;
  window.DragEvent = window.MouseEvent;
  try { fireEvent.drop(node, { dataTransfer: transfer }); }
  finally { window.DragEvent = previous; }
}

export function dragFire(target, type, coords, dataTransfer) {
  fireEvent(target, Object.assign(new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...coords }), { dataTransfer }));
}

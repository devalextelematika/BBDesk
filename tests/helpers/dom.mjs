import '../../scripts/test-loader.mjs';
import { test as nodeTest, after } from 'node:test';
import { JSDOM } from 'jsdom';

// One DOM/runtime per test process; no app cache-busting or production seams.
export const dom = new JSDOM("<!doctype html><html lang='ru'><body></body></html>", { url: 'http://localhost' });
export { JSDOM };
const installed = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
const originalGlobals = installed.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
for (const name of installed.filter(name => !['navigator', 'IS_REACT_ACT_ENVIRONMENT'].includes(name))) {
  globalThis[name] = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sdk = await import('@get-bb/plugin-sdk/testing/app');
const rtl = await import('@testing-library/react');
export const { loadPluginApp } = sdk;
export const { fireEvent, within, act, waitFor } = rtl;
export const { createElement } = await import('react');
export const app = await loadPluginApp(() => import('../../app.tsx'));
const slots = new Set();

export function renderSlot(...args) {
  const slot = sdk.renderSlot(...args);
  const unmount = slot.lifecycle.unmount;
  slot.lifecycle.unmount = () => {
    try { unmount(); } finally { slots.delete(slot); }
  };
  slots.add(slot);
  return slot;
}

// Dispose SDK slots as well as React trees, including the navigation bridge.
export function cleanup() {
  try { for (const slot of [...slots].reverse()) slot.lifecycle.unmount(); }
  finally { rtl.cleanup(); }
}
function restore(target, descriptors) {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
  }
}
export async function withUiCleanup(context, run) {
  const globals = ['ResizeObserver', 'IntersectionObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const browser = ['localStorage', 'sessionStorage', 'DragEvent', 'visualViewport', 'innerWidth', 'innerHeight', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map(name => [name, Object.getOwnPropertyDescriptor(window, name)]);
  const language = document.documentElement.lang;
  try { return await run(context); }
  finally {
    try { await act(async () => cleanup()); }
    finally {
      restore(globalThis, globals);
      restore(window, browser);
      window.localStorage.clear();
      window.sessionStorage.clear();
      document.body.replaceChildren();
      document.documentElement.lang = language;
    }
  }
}

// Node restores context.mock timers/methods after this callback and its hooks.
export const test = (name, run) => nodeTest(name, { concurrency: false, timeout: 10_000 }, context => withUiCleanup(context, run));
after(async () => {
  try { await act(async () => cleanup()); dom.window.close(); }
  finally { restore(globalThis, originalGlobals); }
});

import { createElement, cleanup } from './dom.mjs';
import { thread } from './dashboard.mjs';
const { sharedPoolLimit } = await import('../../split-layout.ts');
export function poolLimitFixture(count = sharedPoolLimit) {
  const threads = Array.from({ length: sharedPoolLimit + 1 }, (_, index) => thread(`pinned-${index}`, "p1", `Pinned ${index}`));
  const entries = threads.slice(0, count).map(row => ({ projectId: row.projectId, threadId: row.id }));
  window.localStorage.setItem("bb-dashboard:shared-pool:v1", JSON.stringify({ entries, active: entries[0]?.threadId ?? "", sizes: {}, open: false }));
  return threads;
}

export const storedPool = () => JSON.parse(window.localStorage.getItem("bb-dashboard:shared-pool:v1"));

export function captureComposerRejections(context) {
  // The SDK fake drops the returned Promise. Observe rejections here, as the
  // real host does to retain the draft; do not change production submit logic.
  const runtime = globalThis.__bbPluginRuntime.pluginSdkApp;
  const Composer = runtime.experimental_NewThreadComposer;
  const failures = [];
  context.mock.method(runtime, "experimental_NewThreadComposer", props => createElement(Composer, {
    ...props, onSubmit: async request => { try { await props.onSubmit(request); } catch (cause) { failures.push(cause); } },
  }));
  context.after(cleanup);
  return failures;
}

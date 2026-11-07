import '../../scripts/test-loader.mjs';
export { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import { makeThreadResponse } from '@get-bb/plugin-sdk/testing';
export const { default: plugin } = await import('../../server.ts');
export const listRow = (changes = {}) => ({ ...makeThreadResponse({ id: "t1", projectId: "p1", status: "idle" }),
  latestAttentionAt: 200, queuedWork: "none", hasPendingInteraction: false, runtime: { displayStatus: "idle" },
  activity: { activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activeWorkflowCount: 0 }, ...changes });

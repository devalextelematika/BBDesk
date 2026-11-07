import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const id = z.string().min(1).max(200);
const projectSchema = z.object({ id, enabled: z.boolean(), connectedAt: z.number().nonnegative() });
export const configSchema = z.object({
  projects: z.array(projectSchema).refine(projects => projects.filter(project => project.enabled).length <= 100, "At most 100 projects can be enabled"),
  launcher: z.array(z.object({ id, label: z.string().min(1).max(200) })).max(100),
  sharedPool: z.boolean().default(true),
});
export const trackedSchema = z.object({ id, projectId: id, visible: z.boolean(), latestAttentionAt: z.number(), hiddenAttentionAt: z.number() });
export type DashboardConfig = z.infer<typeof configSchema>;
export type DashboardSnapshot = { config: DashboardConfig; tracked: z.infer<typeof trackedSchema>[]; syncError: string | null; syncedAt: number | null };

const kind = z.enum(["project", "app"]);
export const catalogChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), kind, id, label: z.string().trim().min(1).max(200).optional() }),
  z.object({ type: z.literal("remove"), kind, id }),
  z.object({ type: z.literal("move"), kind, id, targetId: id, after: z.boolean().default(false) }),
  z.object({ type: z.literal("restore"), kind, id, label: z.string().trim().min(1).max(200).optional(), previousId: id.optional(), nextId: id.optional() }),
  z.object({ type: z.literal("rename"), id, label: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("pool"), enabled: z.boolean() }),
]);
export type CatalogChange = z.infer<typeof catalogChangeSchema>;
export type CatalogKind = z.infer<typeof kind>;

export const rpcContract = defineRpcContract({
  snapshot: { input: z.null(), output: z.object({ config: configSchema, tracked: z.array(trackedSchema), syncError: z.string().nullable(), syncedAt: z.number().nullable() }) },
  projects_set: { input: z.object({ ids: z.array(id).max(100), sharedPool: z.boolean().optional() }), output: configSchema },
  launcher_set: { input: z.object({ items: configSchema.shape.launcher }), output: configSchema },
  catalog_change: { input: catalogChangeSchema, output: configSchema },
  thread_hide: { input: z.object({ threadId: id }), output: z.object({ hidden: z.boolean(), undoToken: z.string().optional() }) },
  thread_restore: { input: z.object({ threadId: id, undoToken: z.string().min(1).max(200) }), output: z.object({ restored: z.boolean() }) },
});

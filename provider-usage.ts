import { z } from "zod";

const windowSchema = z.object({
  label: z.string(),
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() }).nullish(),
});
const usageSchema = z.object({
  status: z.enum(["ok", "not_installed", "unauthenticated", "expired", "error"]),
  accountEmail: z.string().nullish(),
  planLabel: z.string().nullish(),
  windows: z.array(windowSchema).optional(),
  // Display only an explicit count. resetsAt is the automatic reset, a separate field.
  manualResetsAvailable: z.number().int().nonnegative().nullish(),
});
const providerSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  displayName: z.string(),
  accountLabel: z.string().nullable(),
  logoUrl: z.string().nullable(),
  icon: z.object({ glyph: z.string() }).nullable(),
  usage: usageSchema.nullable(),
});
const snapshotSchema = z.object({
  machines: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    status: z.enum(["connected", "disconnected"]),
    error: z.string().nullable(),
    providers: z.array(providerSchema),
  })),
});

export const minute = 60_000;

export const usageRequest = {
  pluginId: "bb--provider-usage",
  method: "getUsage",
  input: { force: false, machineIds: null, maxAgeMs: 5 * minute },
  outputSchema: snapshotSchema,
};

export type UsageSnapshot = z.infer<typeof snapshotSchema>;
export type UsageWindow = z.infer<typeof windowSchema>;
type Provider = z.infer<typeof providerSchema>;
type UsageSource = {
  key: string;
  machine: string;
  account: string | null;
  status: UsageSnapshot["machines"][number]["status"];
  usage: Provider["usage"];
};
export type UsageProvider = {
  id: string;
  displayName: string;
  logoUrl: string | null;
  icon: Provider["icon"];
  sources: UsageSource[];
};

export function groupProviderUsage(snapshot: UsageSnapshot | null) {
  const groups = new Map<string, UsageProvider>();
  for (const machine of snapshot?.machines ?? []) {
    for (const provider of machine.providers) {
      let group = groups.get(provider.providerId);
      if (!group) {
        group = { id: provider.providerId, displayName: provider.displayName, logoUrl: provider.logoUrl, icon: provider.icon, sources: [] };
        groups.set(group.id, group);
      }
      group.sources.push({
        key: JSON.stringify([machine.id, provider.id]), machine: machine.displayName,
        account: provider.accountLabel ?? provider.usage?.accountEmail ?? null, status: machine.status, usage: provider.usage,
      });
    }
  }
  return Array.from(groups.values());
}

export function resetTimestamp(window: UsageWindow): number {
  return window.resetsAt ? Date.parse(window.resetsAt) : NaN;
}

function* reportedWindows(provider: UsageProvider) {
  for (const source of provider.sources) {
    if (source.status !== "connected" || source.usage?.status !== "ok") continue;
    for (const window of source.usage.windows ?? []) {
      yield { source, window };
    }
  }
}

export function summaryWindow(provider: UsageProvider) {
  let summary: { source: UsageSource; window: UsageWindow } | undefined;
  for (const entry of reportedWindows(provider)) {
    if (!summary || entry.window.usedPercent > summary.window.usedPercent) summary = entry;
  }
  return summary;
}

const quotaPeriods = ["five-hour", "daily", "weekly", "monthly"];

export function quotaWindowKind(label: string) {
  return label.split("·", 1)[0].trim().toLowerCase();
}

export function summaryWindows(provider: UsageProvider) {
  const periods = new Map<string, { source: UsageSource; window: UsageWindow }>();
  for (const entry of reportedWindows(provider)) {
    const kind = quotaWindowKind(entry.window.label);
    const period = kind.replace(/ limit$/, "");
    const key = quotaPeriods.includes(period) ? period : entry.window.label.trim().toLowerCase();
    const previous = periods.get(key);
    if (!previous || entry.window.usedPercent > previous.window.usedPercent) periods.set(key, entry);
  }
  const order = (key: string) => {
    const index = quotaPeriods.indexOf(key);
    return index < 0 ? quotaPeriods.length : index;
  };
  return [...periods].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
}

export function usageRefreshInterval(snapshot: UsageSnapshot | null) {
  let highestUsage = 0;
  for (const provider of groupProviderUsage(snapshot)) {
    highestUsage = Math.max(highestUsage, summaryWindow(provider)?.window.usedPercent ?? 0);
  }
  if (highestUsage >= 90) return minute;
  if (highestUsage >= 80) return 3 * minute;
  return usageRequest.input.maxAgeMs;
}

export function hasPartialUsage(snapshot: UsageSnapshot) {
  return snapshot.machines.some(machine => machine.error !== null
    || machine.providers.some(provider => provider.usage?.status === "error"));
}

export function retainFailedUsage(previous: UsageSnapshot | null, incoming: UsageSnapshot): UsageSnapshot {
  if (!previous) return incoming;
  const previousMachines = new Map(previous.machines.map(machine => [machine.id, machine]));
  return { machines: incoming.machines.map(machine => {
    const oldMachine = previousMachines.get(machine.id);
    if (!oldMachine || machine.status !== "connected") return machine;
    const previousProviders = new Map(oldMachine.providers.map(provider => [provider.id, provider]));
    return { ...machine, providers: machine.providers.map(provider => {
      const failed = provider.usage?.status === "error" || (machine.error !== null && provider.usage === null);
      if (!failed) return provider;
      const oldProvider = previousProviders.get(provider.id);
      return oldProvider?.usage?.status === "ok"
        && oldProvider.providerId === provider.providerId
        && oldProvider.accountLabel === provider.accountLabel
        ? { ...provider, usage: oldProvider.usage } : provider;
    }) };
  }) };
}

export function usedPercent(window: UsageWindow) {
  return Math.floor(Math.max(0, window.usedPercent));
}

export function quotaLevel(percent: number) {
  if (percent >= 95) return "critical";
  if (percent >= 80) return "warning";
  return "normal";
}

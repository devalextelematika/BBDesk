import { useEffect, useId, useMemo, useRef, useState } from "react";
import { experimental_ProviderIcon as ProviderIcon, useSdk } from "@get-bb/plugin-sdk/app";
import { readStored, writeStored } from "../browser-storage";
import type { Language, MessageKey, Translator } from "../i18n";
import { groupProviderUsage, hasPartialUsage, quotaLevel, resetTimestamp, retainFailedUsage, summaryWindow,
  usageRequest, usedPercent, type UsageProvider, type UsageSnapshot } from "../provider-usage";
import { Icon } from "./ui/icon";

const openKey = "bb-dashboard:provider-usage-open:v1";
const minute = 60_000;
const windowLabels = new Map<string, MessageKey>([
  ["five-hour limit", "quotaFiveHours"],
  ["five-hour", "quotaFiveHours"],
  ["daily limit", "quotaDaily"],
  ["daily", "quotaDaily"],
  ["weekly limit", "quotaWeekly"],
  ["weekly", "quotaWeekly"],
  ["monthly limit", "quotaMonthly"],
  ["monthly", "quotaMonthly"],
  ["plan usage", "quotaPlanUsage"],
  ["chat messages", "quotaChatMessages"],
  ["code completions", "quotaCodeCompletions"],
]);

function windowLabel(label: string, tr: Translator) {
  const [kind = "", ...suffix] = label.split("·");
  const key = windowLabels.get(kind.trim().toLowerCase());
  return key ? [tr(key), ...suffix.map(part => part.trim())].join(" · ") : label;
}

function useProviderUsage(visible: boolean) {
  const sdk = useSdk();
  const [result, setResult] = useState<{
    snapshot: UsageSnapshot | null; state: "loading" | "ready" | "partial" | "error"; lastSuccess: number | null;
  }>({ snapshot: null, state: "loading", lastSuccess: null });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible) return;
    let pending: AbortController | null = null;
    let refreshTimer: number | undefined;
    let clockTimer: number | undefined;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      const request = new AbortController();
      pending = request;
      try {
        const rpc = { ...usageRequest, signal: request.signal };
        // An empty provider list reads the inventory and cache without collecting quotas.
        const inventory = await sdk.plugins.callRpc({ ...rpc, input: { ...rpc.input, providerIds: [] } });
        if (request.signal.aborted) return;
        const providerIds = [...new Set(inventory.machines
          .filter(machine => machine.status === "connected")
          .flatMap(machine => machine.providers.map(provider => provider.providerId)))];
        const data = providerIds.length > 0
          ? await sdk.plugins.callRpc({ ...rpc, input: { ...rpc.input, providerIds } })
          : inventory;
        if (request.signal.aborted) return;
        const partial = hasPartialUsage(data);
        const receivedAt = Date.now();
        setResult(previous => partial
          ? { ...previous, snapshot: retainFailedUsage(previous.snapshot, data), state: "partial" }
          : { snapshot: data, state: "ready", lastSuccess: receivedAt });
      } catch {
        if (!request.signal.aborted) setResult(previous => ({ ...previous, state: "error" }));
      } finally {
        if (pending === request) pending = null;
      }
    };
    const stop = () => {
      pending?.abort();
      pending = null;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
    const visibilityChanged = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      const tick = () => setNow(Date.now());
      tick();
      void refresh();
      refreshTimer = window.setInterval(refresh, usageRequest.input.maxAgeMs);
      clockTimer = window.setInterval(tick, minute);
    };
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [sdk, visible]);
  return { ...result, now };
}

function providerArtwork(provider: UsageProvider) {
  return <ProviderIcon providerKind="agent" provider={provider}
    fallback={provider.id === "acp-gh-copilot" ? "Github" : undefined} className="db-quota-icon" aria-hidden/>;
}

function durationLabel(minutes: number, language: Language, tr: Translator) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remainder = minutes % 60;
  const format = new Intl.NumberFormat(language);
  function unit(key: MessageKey, count: number) { return tr(key, { count, value: format.format(count) }); }
  return [days ? unit("quotaDays", days) : "", hours ? unit("quotaHours", hours) : "",
    remainder ? unit("quotaMinutes", remainder) : ""].filter(Boolean).join(" ");
}

function QuotaLine({ label, value, percent, tr, description }: {
  label: string; value?: number; percent: Intl.NumberFormat; tr: Translator; description?: string;
}) {
  const displayed = value === undefined ? tr("quotaUnavailableValue") : percent.format(value / 100);
  return <div className="db-quota-line" title={description}>
    <strong title={description ?? label}>{label}</strong>
    <span data-level={value === undefined ? undefined : quotaLevel(value)}>{displayed}</span>
    {value !== undefined && <progress value={Math.min(100, value)} max={100} data-level={quotaLevel(value)}
      aria-label={description ?? tr("quotaUsed", { name: label, percent: displayed })}/>}
  </div>;
}

function ProviderDetails({ provider, tr, language, now, percent }: {
  provider: UsageProvider; tr: Translator; language: Language; now: number; percent: Intl.NumberFormat;
}) {
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const numberFormat = new Intl.NumberFormat(language);
  const currency = new Intl.NumberFormat(language, { style: "currency", currency: "USD" });
  return <>
    <div className="db-quota-provider-name">{providerArtwork(provider)}<strong>{provider.displayName}</strong></div>
    {provider.sources.map(source => {
      const usage = source.usage;
      const windows = usage?.windows ?? [];
      const canShowWindows = source.status === "connected" && usage?.status === "ok";
      const unavailable = source.status === "disconnected" ? "quotaDisconnected"
        : usage?.status === "unauthenticated" ? "quotaSignIn"
        : usage?.status === "expired" ? "quotaSessionExpired"
        : usage?.status === "not_installed" ? "quotaNotInstalled"
        : usage?.status === "error" ? "quotaLoadError" : "quotaNoWindows";
      return <div key={source.key} className="db-quota-source">
        {(source.account || provider.sources.length > 1) && <div className="db-quota-subtitle">
          {[source.machine, source.account].filter(Boolean).join(" · ")}
        </div>}
        {canShowWindows && usage.planLabel && <div className="db-quota-subtitle">{tr("quotaPlan", { plan: usage.planLabel })}</div>}
        {canShowWindows && usage.manualResetsAvailable != null && <div className="db-quota-manual">
          <span>{tr("quotaManualResets")}</span><strong>{tr("quotaManualAvailable", { value: numberFormat.format(usage.manualResetsAvailable) })}</strong>
        </div>}
        {canShowWindows && windows.map((window, index) => {
          const label = windowLabel(window.label, tr);
          const value = usedPercent(window);
          const timestamp = resetTimestamp(window);
          const minutes = Math.ceil((timestamp - now) / minute);
          return <div className="db-quota-window" key={index}>
            <QuotaLine label={label} value={value} percent={percent} tr={tr}/>
            <div className="db-quota-subtitle">{tr("quotaRemaining", { percent: percent.format(Math.max(0, 100 - value) / 100) })}</div>
            <div className="db-quota-subtitle">{!Number.isFinite(timestamp) ? tr("quotaResetUnknown")
              : minutes > 0 ? tr("quotaResetsIn", { duration: durationLabel(minutes, language, tr), date: dateFormat.format(timestamp) })
              : tr("quotaResetAt", { date: dateFormat.format(timestamp) })}</div>
            {window.cost && <div className="db-quota-subtitle">{tr("quotaCost", {
              used: currency.format(window.cost.usedUsdCents / 100), limit: currency.format(window.cost.limitUsdCents / 100),
            })}</div>}
          </div>;
        })}
        {(!canShowWindows || windows.length === 0) && <div className="db-quota-subtitle">{tr(unavailable)}</div>}
      </div>;
    })}
  </>;
}

export function ProviderUsageDock({ visible, tr, language }: { visible: boolean; tr: Translator; language: Language }) {
  const { snapshot, state, now, lastSuccess } = useProviderUsage(visible);
  const [open, setOpen] = useState(() => readStored(openKey, raw => raw === true, false));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const selectors = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const focusAfterToggle = useRef(false);
  const panel = useId();
  const providers = useMemo(() => groupProviderUsage(snapshot), [snapshot]);
  const selected = providers.find(provider => provider.id === selectedId);
  const percent = useMemo(() => new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }), [language]);
  const summaries = providers.map(provider => {
    const summary = summaryWindow(provider);
    if (!summary) return { provider, value: undefined, description: tr("quotaProviderUnavailable", { name: provider.displayName }) };
    const { source, window } = summary;
    const value = usedPercent(window);
    return { provider, value, description: tr("quotaSummarySource", {
      usage: tr("quotaUsed", { name: provider.displayName, percent: percent.format(value / 100) }),
      window: windowLabel(window.label, tr),
      source: [source.machine, source.account].filter(Boolean).join(" · "),
    }) };
  });
  const status = state === "loading" ? "loading" : state === "error" ? (snapshot ? "quotaStale" : "quotaLoadError")
    : state === "partial" ? "quotaPartial"
    : providers.length === 0 ? "quotaNoProviders" : null;
  const warning = state === "error" || state === "partial";
  const lastSuccessMessage = warning && lastSuccess !== null ? tr("quotaLastSuccess", {
    date: new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(lastSuccess),
  }) : null;

  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    if (open) selectors.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    else toggle.current?.focus();
  }, [open]);

  function changeOpen(next: boolean) {
    focusAfterToggle.current = true;
    setOpen(next);
    writeStored(openKey, next);
  }
  function select(id: string | null) {
    setSelectedId(id);
    if (content.current) content.current.scrollTop = 0;
  }

  const compactLabel = [tr("quotaExpand"), ...summaries.map(item => item.description),
    status && tr(status), lastSuccessMessage].filter(Boolean).join(". ");

  return <section className="db-quota" aria-label={tr("quotaSection")} data-open={open}>
    {!open && <button type="button" ref={toggle} className="db-quota-toggle" aria-label={compactLabel}
      aria-expanded={false} aria-controls={panel} onClick={() => changeOpen(true)} onKeyDown={event => {
        const list = strip.current;
        if (!list || list.scrollWidth <= list.clientWidth || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        list.scrollLeft += event.key === "ArrowLeft" ? -44 : 44;
      }}>
      <Icon name="ChartColumn" className="db-quota-icon"/>
      <span ref={strip} className="db-quota-strip" aria-hidden="true">
        {summaries.map(({ provider, value, description }) => <span key={provider.id} className="db-quota-badge"
          data-level={value === undefined ? undefined : quotaLevel(value)} title={description}>
          {providerArtwork(provider)}{value === undefined ? tr("quotaUnavailableValue") : percent.format(value / 100)}
        </span>)}
      </span>
      {warning && status && <span className="db-quota-warning" title={[tr(status), lastSuccessMessage].filter(Boolean).join(" ")} aria-hidden>
        <Icon name="TriangleAlert" className="db-quota-icon"/>
      </span>}
    </button>}
    <div id={panel} className="db-quota-expanded" hidden={!open}>
      {open && <>
        <div className="db-quota-toolbar" ref={selectors}>
          <button type="button" className="db-quota-all" aria-pressed={!selected}
            onClick={() => select(null)}>{tr("quotaAll")}</button>
          <div className="db-quota-select" role="group" aria-label={tr("quotaProviders")}>
            {providers.map(provider => <button type="button" key={provider.id} aria-pressed={selected?.id === provider.id}
              aria-label={provider.displayName} title={provider.displayName} onClick={() => select(provider.id)}>
              {providerArtwork(provider)}
            </button>)}
          </div>
          <button type="button" aria-expanded="true" aria-controls={panel} className="db-quota-collapse"
            aria-label={tr("quotaCollapse")} title={tr("quotaCollapse")} onClick={() => changeOpen(false)}>
            <Icon name="ChevronDown" className="db-quota-icon"/>
          </button>
        </div>
        <div ref={content} className="db-quota-content">
          {selected ? <ProviderDetails provider={selected} tr={tr} language={language} now={now} percent={percent}/>
            : summaries.map(({ provider, value, description }) => <QuotaLine key={provider.id} label={provider.displayName} value={value}
              percent={percent} tr={tr} description={description}/>)}
          {!selected && summaries.some(item => item.value !== undefined) && <p className="db-quota-subtitle">{tr("quotaOverviewNote")}</p>}
          {status && <div role="status">
            <p className="db-quota-subtitle">{tr(status)}</p>
            {lastSuccessMessage && <p className="db-quota-subtitle">{lastSuccessMessage}</p>}
          </div>}
        </div>
      </>}
    </div>
  </section>;
}

import { useState } from "react";
import { useTranslation } from "./use-translation";

export interface ConversationItem { id: string; title: string; detail: string; updatedAt: number }

export function ConversationMetadata({ item }: { item: ConversationItem }) {
  const { language } = useTranslation();
  const date = item.updatedAt > 0 ? new Date(item.updatedAt) : null;
  return <span className="db-conversation-meta">
    {date && Number.isFinite(date.getTime()) && <time dateTime={date.toISOString()} title={new Intl.DateTimeFormat(language, { dateStyle: "full", timeStyle: "short" }).format(date)}>{new Intl.DateTimeFormat(language, { dateStyle: "short" }).format(date)}</time>}
    {item.detail && <span title={item.detail}>{item.detail}</span>}
  </span>;
}

export function ConversationResults({ items, selectedId, loading, failed, onSelect }: {
  items: ConversationItem[]; selectedId: string | null; loading: boolean; failed: boolean; onSelect: (id: string) => void;
}) {
  const { t: tr } = useTranslation();
  const [limit, setLimit] = useState(50);
  return <>
    {loading ? <p role="status" className="db-muted">{tr("loading")}</p>
      : failed ? <p role="alert" className="db-muted">{tr("searchUnavailable")}</p>
      : items.length === 0 ? <p role="status" className="db-muted">{tr("noMatches")}</p>
      : <div className="db-conversation-results">{items.slice(0, limit).map(item => <button key={item.id} type="button" className="db-history-thread"
          aria-label={item.title} aria-pressed={selectedId === item.id} title={item.title} onClick={() => onSelect(item.id)}>
          <span className="db-thread-title">{item.title}</span><ConversationMetadata item={item}/>
        </button>)}{items.length > limit && <button type="button" className="db-button" onClick={() => setLimit(previous => previous + 50)}>{tr("showMoreResults", { count: items.length - limit })}</button>}</div>}
  </>;
}

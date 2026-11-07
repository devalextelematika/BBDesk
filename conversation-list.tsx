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

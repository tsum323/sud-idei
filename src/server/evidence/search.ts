import "server-only";
import type { EvidenceType } from "@/shared/types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Адаптер веб-поиска. Результаты сохраняются как доказательства со ссылкой и датой проверки. */
export interface SearchProvider {
  readonly id: "tavily";
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

export class TavilySearch implements SearchProvider {
  readonly id = "tavily" as const;
  constructor(
    private apiKey: string,
    private timeoutMs = 20_000,
  ) {}

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Поиск вернул HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? [])
      .filter((r) => r.url && /^https?:\/\//.test(r.url))
      .map((r) => ({ title: (r.title ?? r.url!).slice(0, 200), url: r.url!, snippet: (r.content ?? "").slice(0, 500) }));
  }
}

export interface EvidenceQuery {
  query: string;
  type: EvidenceType;
  claim: string;
}

/** Небольшой фиксированный набор запросов на дело — без скрытых повторных поисков. */
export function buildQueries(title: string, audience?: string): EvidenceQuery[] {
  const subject = audience ? `${title} ${audience}` : title;
  return [
    { query: `${subject} аналоги конкуренты`, type: "competitor", claim: "Существующие решения и конкуренты" },
    { query: `${title} цены тарифы`, type: "pricing", claim: "Цены и способы монетизации аналогов" },
    { query: `${subject} рынок спрос`, type: "market", claim: "Сведения о рынке и спросе" },
  ];
}

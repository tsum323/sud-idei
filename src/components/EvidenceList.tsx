import { formatDate } from "@/shared/report";
import type { Evidence } from "@/shared/types";

export function EvidenceList({ evidence, searchConfigured }: { evidence: Evidence[]; searchConfigured: boolean }) {
  if (!evidence.length) {
    return (
      <p className="notice notice-warn">
        {searchConfigured
          ? "Веб-поиск не дал результатов для этого дела."
          : "Веб-поиск не настроен: актуальные данные о конкурентах, ценах и рынке не проверялись. Такие утверждения агентов — предположения."}
      </p>
    );
  }
  return (
    <ul className="evidence-list">
      {evidence.map((e) => (
        <li key={e.id}>
          <span className="tag">{e.ref}</span>{" "}
          <a href={e.sourceUrl} target="_blank" rel="noreferrer noopener">
            {e.sourceTitle}
          </a>
          <span className="muted small"> · {e.claim} · проверено {formatDate(e.checkedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { formatDate } from "@/shared/report";
import type { CaseStatus, CaseSummary } from "@/shared/types";
import { STATUS_TEXT } from "./labels";
import { Modal } from "./Modal";

type Filter = "active" | "all" | CaseStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "active", label: "Активные (без тюрьмы)" },
  { id: "all", label: "Все дела" },
  { id: "in_progress", label: STATUS_TEXT.in_progress },
  { id: "approved", label: STATUS_TEXT.approved },
  { id: "conditional", label: STATUS_TEXT.conditional },
  { id: "rework", label: STATUS_TEXT.rework },
  { id: "prison", label: STATUS_TEXT.prison },
  { id: "draft", label: STATUS_TEXT.draft },
];

interface Props {
  open: boolean;
  currentId: string | null;
  onClose: () => void;
  onOpenCase: (id: string) => void;
}

/** Архив дел: поиск по названию и фильтр по статусу. Открытие дела не вызывает модель. */
export function CaseArchivePanel({ open, currentId, onClose, onOpenCase }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [items, setItems] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api
        .listCases(query, filter === "active" ? "all" : filter)
        .then((list) => setItems(filter === "active" ? list.filter((c) => c.status !== "prison") : list))
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [open, query, filter]);

  return (
    <Modal open={open} title="АРХИВ ДЕЛ" onClose={onClose}>
      <div className="archive-controls">
        <input type="search" placeholder="Поиск по названию или №" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск по названию" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Фильтр по статусу">
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>
      {error && <p className="error-box">{error}</p>}
      {items === null && !error && <p className="muted">Загрузка…</p>}
      {items?.length === 0 && <p className="muted">Дел не найдено.</p>}
      <ul className="case-list">
        {items?.map((c) => (
          <li key={c.id}>
            <button type="button" className={`case-row${c.id === currentId ? " is-current" : ""}`} onClick={() => onOpenCase(c.id)}>
              <span className="case-num">№{c.number}</span>
              <span className="case-main">
                <span className="case-title">{c.title}</span>
                <span className="muted small">
                  создано {formatDate(c.createdAt)} · рассмотрено {formatDate(c.lastReviewedAt)}
                  {c.round > 1 ? ` · заседаний: ${c.round}` : ""}
                </span>
              </span>
              <span className={`badge badge-${c.status}`}>{STATUS_TEXT[c.status]}</span>
              <span className="case-score">{c.overallScore ?? "—"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

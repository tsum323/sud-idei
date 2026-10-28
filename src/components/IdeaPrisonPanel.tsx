"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { formatDate } from "@/shared/report";
import type { CaseSummary } from "@/shared/types";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenReport: (id: string) => void;
  onReopen: (c: CaseSummary) => void;
}

/** Тюрьма идей: отклонённые идеи хранятся отдельно от активных и не удаляются. */
export function IdeaPrisonPanel({ open, onClose, onOpenReport, onReopen }: Props) {
  const [items, setItems] = useState<CaseSummary[] | null>(null);
  const [showConditions, setShowConditions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.listCases("", "prison").then(setItems).catch((e) => setError(e.message));
  }, [open]);

  return (
    <Modal open={open} title="ТЮРЬМА ИДЕЙ" variant="prison" onClose={onClose}>
      <p className="muted small">
        Идеи, которые судья признал нецелесообразными при текущих условиях. Материалы дел сохранены. Вернуть идею на
        пересмотр можно только с новыми основаниями.
      </p>
      {error && <p className="error-box">{error}</p>}
      {items?.length === 0 && <p className="prison-empty">Камеры пусты. Ни одна идея пока не отклонена.</p>}
      <ul className="cells">
        {items?.map((c) => (
          <li key={c.id} className="cell">
            <div className="cell-bars" aria-hidden />
            <div className="cell-body">
              <p className="cell-num">ЗАКЛЮЧЁННАЯ №{c.number}</p>
              <h3 className="cell-title">{c.title}</h3>
              <p className="small">{c.headline ?? "Отклонена судьёй"}</p>
              <dl className="cell-facts">
                <dt>Дата решения</dt>
                <dd>{formatDate(c.lastReviewedAt)}</dd>
                <dt>Главный риск</dt>
                <dd>{c.topRisk ?? "—"}</dd>
              </dl>
              {showConditions === c.id && (
                <div className="cell-conditions">
                  <b>Условия пересмотра:</b>
                  <ul>{c.conditionsForReview.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              <div className="cell-actions">
                <button type="button" className="btn btn-small" onClick={() => onOpenReport(c.id)}>
                  Отчёт
                </button>
                <button type="button" className="btn btn-small btn-ghost" aria-expanded={showConditions === c.id} onClick={() => setShowConditions(showConditions === c.id ? null : c.id)}>
                  Условия пересмотра
                </button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => onReopen(c)}>
                  На пересмотр
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

"use client";

import { useEffect, useState } from "react";
import { LIMITS, ReopenSchema } from "@/shared/schemas";
import { Modal } from "./Modal";

export interface ReopenTarget {
  id: string;
  title: string;
  description?: string;
  conditions: string[];
  fromPrison: boolean;
}

interface Props {
  target: ReopenTarget | null;
  onClose: () => void;
  onSubmit: (grounds: string, description?: string) => Promise<void>;
}

/** Пересмотр дела требует новых оснований — без них идея не возвращается в суд. */
export function ReopenDialog({ target, onClose, onSubmit }: Props) {
  const [grounds, setGrounds] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setGrounds("");
    setDescription(target?.description ?? "");
    setError(null);
  }, [target]);

  const submit = async () => {
    const changed = description.trim() && description.trim() !== target?.description?.trim() ? description : undefined;
    const parsed = ReopenSchema.safeParse({ newGrounds: grounds, description: changed });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Проверьте данные");
    setSending(true);
    try {
      await onSubmit(parsed.data.newGrounds, parsed.data.description);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={!!target}
      title={target?.fromPrison ? "ВЕРНУТЬ ИЗ ТЮРЬМЫ" : "ПЕРЕСМОТР ДЕЛА"}
      variant="center"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={sending}>
            {sending ? "Открываем…" : "Открыть новое заседание"}
          </button>
        </>
      }
    >
      <p><b>{target?.title}</b></p>
      {!!target?.conditions.length && (
        <div className="notice">
          <b>Судья назвал условия пересмотра:</b>
          <ul>{target.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <label className="field">
        <span className="field-label">Что изменилось? (обязательно)</span>
        <textarea rows={3} maxLength={LIMITS.newGrounds} value={grounds} onChange={(e) => setGrounds(e.target.value)}
          placeholder="Например: провёл 15 интервью, 9 человек подтвердили проблему; сузил аудиторию до…" />
      </label>
      <label className="field">
        <span className="field-label">Обновлённое описание идеи (необязательно)</span>
        <textarea rows={4} maxLength={LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <p className="muted small">
        Прошлые заключения и вердикт останутся в истории дела. Новое заседание начнётся после нажатия «Продолжить заседание»
         — это новые запросы к модели.
      </p>
    </Modal>
  );
}

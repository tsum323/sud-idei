"use client";

import { useState } from "react";
import { LIMITS, NewIdeaSchema, OPTIONAL_CONTEXT_LABELS, type NewIdeaInput, type OptionalContext } from "@/shared/schemas";

const EMPTY_CTX: Record<keyof OptionalContext, string> = {
  audience: "",
  problem: "",
  monetization: "",
  resources: "",
  constraints: "",
  comments: "",
};

const EXAMPLE = {
  title: "Telegram-бот для учёта домашних расходов голосом",
  description:
    "Бот принимает голосовое сообщение «потратил 450 на продукты», распознаёт сумму и категорию и ведёт таблицу расходов. Раз в неделю присылает сводку и подсказывает, где можно сэкономить.",
  ctx: { ...EMPTY_CTX, audience: "Молодые семьи, которые пробовали вести бюджет, но бросили", monetization: "Бесплатно до 50 записей в месяц, далее 199 ₽/мес" },
};

interface Props {
  disabled: boolean;
  onSubmit: (idea: NewIdeaInput) => Promise<boolean>;
}

/** Подача идеи: достаточно названия и описания, остальные поля — по желанию. */
export function IdeaInput({ disabled, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ctx, setCtx] = useState(EMPTY_CTX);
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const idea = { title, description, optionalContext: ctx };
    const parsed = NewIdeaSchema.safeParse(idea);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[issue.path.join(".")] ??= issue.message;
      setErrors(errs);
      if (Object.keys(errs).some((k) => k.startsWith("optionalContext"))) setMore(true);
      return;
    }
    setErrors({});
    setSending(true);
    const ok = await onSubmit(idea);
    setSending(false);
    if (ok) {
      setTitle("");
      setDescription("");
      setCtx(EMPTY_CTX);
      setMore(false);
    }
  };

  return (
    <form className="idea-form" onSubmit={submit} noValidate>
      <div className="idea-row">
        <label className="field field-title">
          <span className="field-label">Название идеи</span>
          <input
            value={title}
            maxLength={LIMITS.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: AI-помощник для репетиторов"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "err-title" : undefined}
          />
          {errors.title && <span id="err-title" className="field-error">{errors.title}</span>}
        </label>
        <button type="button" className="link-btn" onClick={() => {
          setTitle(EXAMPLE.title);
          setDescription(EXAMPLE.description);
          setCtx(EXAMPLE.ctx);
        }}>
          Пример
        </button>
      </div>
      <label className="field">
        <span className="field-label">
          Описание <span className="counter">{description.length}/{LIMITS.description}</span>
        </span>
        <textarea
          value={description}
          maxLength={LIMITS.description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Что это, для кого и какую проблему решает"
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? "err-desc" : undefined}
        />
        {errors.description && <span id="err-desc" className="field-error">{errors.description}</span>}
      </label>

      <button type="button" className="link-btn" aria-expanded={more} onClick={() => setMore((m) => !m)}>
        {more ? "Скрыть дополнительные сведения ▲" : "Дополнительные сведения (необязательно) ▼"}
      </button>
      {more && (
        <div className="ctx-grid">
          {(Object.keys(OPTIONAL_CONTEXT_LABELS) as (keyof OptionalContext)[]).map((k) => (
            <label key={k} className="field">
              <span className="field-label">{OPTIONAL_CONTEXT_LABELS[k]}</span>
              <input
                value={ctx[k]}
                maxLength={LIMITS.optionalField}
                onChange={(e) => setCtx({ ...ctx, [k]: e.target.value })}
              />
              {errors[`optionalContext.${k}`] && <span className="field-error">{errors[`optionalContext.${k}`]}</span>}
            </label>
          ))}
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={disabled || sending}>
          {sending ? "Заводим дело…" : "⚖ Начать суд"}
        </button>
        <span className="muted small">Агенты отметят, каких сведений не хватило.</span>
      </div>
    </form>
  );
}

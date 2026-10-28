import type { AgentMeta } from "@/shared/agents";
import type { AnalysisStatus } from "@/shared/types";
import { PixelSprite } from "./PixelSprite";
import { AGENT_SPRITES, GAVEL_SPRITE, JUDGE_FACES, JUDGE_SPRITE } from "./sprites";

export const STATUS_LABEL: Record<AnalysisStatus, string> = {
  idle: "Ожидает",
  running: "Анализирует",
  done: "Готов",
  error: "Ошибка",
};

export function StatusChip({ status }: { status: AnalysisStatus }) {
  return (
    <span className={`status-chip status-${status}`}>
      <span className="status-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

interface AgentCharacterProps {
  meta: AgentMeta;
  status: AnalysisStatus;
  score?: number;
  open: boolean;
  onToggle: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

/** Персонаж-агент: кнопка со спрайтом, подписью роли и индикатором состояния. */
export function AgentCharacter({ meta, status, score, open, onToggle, buttonRef }: AgentCharacterProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`agent agent-${status}${open ? " is-open" : ""}`}
      style={{ "--accent": meta.visualStyle.accent } as React.CSSProperties}
      aria-expanded={open}
      aria-controls={open ? "speech-panel" : undefined}
      aria-label={`${meta.name}: ${STATUS_LABEL[status]}${score != null ? `, оценка ${score}` : ""}. Открыть заключение`}
      onClick={onToggle}
    >
      <span className="agent-sprite">
        <PixelSprite rows={AGENT_SPRITES[meta.id]} scale={4} className="sprite sprite-lg" />
        <PixelSprite rows={AGENT_SPRITES[meta.id]} scale={3} className="sprite sprite-sm" />
        {status === "running" && <span className="bubble bubble-thinking" aria-hidden>…</span>}
        {status === "done" && <span className="bubble bubble-done" aria-hidden>{score ?? "!"}</span>}
        {status === "error" && <span className="bubble bubble-error" aria-hidden>×</span>}
      </span>
      <span className="agent-name">{meta.short}</span>
      <StatusChip status={status} />
    </button>
  );
}

export type JudgeMood = "idle" | "thinking" | "verdict";

export function JudgeCharacter({ mood, caption }: { mood: JudgeMood; caption: string }) {
  const rows = [...JUDGE_SPRITE];
  [rows[5], rows[6]] = JUDGE_FACES[mood];
  return (
    <div className={`judge judge-${mood}`}>
      <div className="judge-figure">
        <PixelSprite rows={rows} scale={10} className="sprite sprite-lg" title="Главный судья — робот в парике" />
        <PixelSprite rows={rows} scale={7} className="sprite sprite-sm" title="Главный судья — робот в парике" />
      </div>
      <div className="judge-desk">
        <PixelSprite rows={GAVEL_SPRITE} scale={4} className="gavel" />
        <span className="desk-plate">ГЛАВНЫЙ СУДЬЯ</span>
      </div>
      <p className="judge-caption" aria-live="polite">
        {caption}
      </p>
    </div>
  );
}

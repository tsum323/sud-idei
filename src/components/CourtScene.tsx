"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AGENTS } from "@/shared/agents";
import type { CourtPlan } from "@/shared/courtPlan";
import type { AgentId, AnalysisStatus, CaseBundle } from "@/shared/types";
import { useMediaQuery } from "@/client/useMediaQuery";
import { AgentCharacter, JudgeCharacter, type JudgeMood } from "./Characters";
import { AgentSpeechPanel } from "./AgentSpeechPanel";

/** Позиции в сцене: галерея экспертов сверху, обвинение слева, защита справа. */
const AREA: Record<AgentId, string> = {
  market: "a1",
  finance: "a2",
  tech: "a3",
  growth: "a4",
  independent: "a5",
  prosecutor: "l1",
  risk: "l2",
  advocate: "r1",
  product: "r2",
};

const PANEL_WIDTH = 380;

interface Props {
  bundle: CaseBundle | null;
  plan: CourtPlan | null;
  inflight: Set<string>;
  isDemo: boolean;
  judgeCaption: string;
  verdictSlot?: React.ReactNode;
  canRun: boolean;
  onRetryAgent: (id: AgentId) => void;
}

export function CourtScene({ bundle, plan, inflight, isDemo, judgeCaption, verdictSlot, canRun, onRetryAgent }: Props) {
  const [openAgent, setOpenAgent] = useState<AgentId | null>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>();
  const sceneRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<AgentId, HTMLButtonElement>());
  const wide = useMediaQuery("(min-width: 1024px)");

  const statusOf = (id: AgentId): AnalysisStatus => {
    if (inflight.has(id)) return "running";
    return bundle?.analyses.find((a) => a.agentId === id)?.status ?? "idle";
  };

  const place = useCallback(() => {
    if (!wide || !openAgent || !sceneRef.current) return setPanelStyle(undefined);
    const btn = buttons.current.get(openAgent);
    if (!btn) return;
    const scene = sceneRef.current.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const area = AREA[openAgent];
    const maxLeft = scene.width - PANEL_WIDTH - 8;
    let left: number;
    let top: number;
    if (area.startsWith("l")) {
      left = r.right - scene.left + 8;
      top = r.top - scene.top;
    } else if (area.startsWith("r")) {
      left = r.left - scene.left - PANEL_WIDTH - 8;
      top = r.top - scene.top;
    } else {
      left = r.left - scene.left + r.width / 2 - PANEL_WIDTH / 2;
      top = r.bottom - scene.top + 8;
    }
    left = Math.max(8, Math.min(left, maxLeft));
    top = Math.max(8, top);
    setPanelStyle({ position: "absolute", left, top, width: PANEL_WIDTH, maxHeight: `calc(100% - ${top + 8}px)` });
  }, [openAgent, wide]);

  useLayoutEffect(() => {
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);

  const close = () => {
    const id = openAgent;
    setOpenAgent(null);
    if (id) buttons.current.get(id)?.focus();
  };

  const mood: JudgeMood = bundle?.verdict ? "verdict" : plan && plan.stage !== "submission" ? "thinking" : "idle";
  const meta = AGENTS.find((a) => a.id === openAgent);

  const panel = meta && (
    <AgentSpeechPanel
      meta={meta}
      analysis={bundle?.analyses.find((a) => a.agentId === meta.id)}
      running={statusOf(meta.id) === "running"}
      crossExaminations={bundle?.crossExaminations ?? []}
      evidence={bundle?.evidence ?? []}
      canRun={canRun}
      isDemo={isDemo}
      style={wide ? panelStyle : undefined}
      onClose={close}
      onRetry={() => onRetryAgent(meta.id)}
    />
  );

  return (
    <section className="court" aria-label="Зал суда">
      <div className="scene" ref={sceneRef}>
        <div className="scene-floor" aria-hidden />
        <div className="judge-area">
          <JudgeCharacter mood={mood} caption={judgeCaption} />
        </div>
        {AGENTS.map((a) => {
          const analysis = bundle?.analyses.find((x) => x.agentId === a.id);
          return (
            <div key={a.id} className={`seat seat-${AREA[a.id]}`}>
              <AgentCharacter
                meta={a}
                status={statusOf(a.id)}
                score={analysis?.status === "done" ? analysis.overallScore : undefined}
                open={openAgent === a.id}
                onToggle={() => setOpenAgent(openAgent === a.id ? null : a.id)}
                buttonRef={(el) => {
                  if (el) buttons.current.set(a.id, el);
                  else buttons.current.delete(a.id);
                }}
              />
            </div>
          );
        })}
        {wide && panel}
        {wide && verdictSlot && <div className="verdict-overlay">{verdictSlot}</div>}
      </div>
      {!wide && panel && <div className="panel-slot">{panel}</div>}
      {!wide && verdictSlot && <div className="panel-slot">{verdictSlot}</div>}
    </section>
  );
}

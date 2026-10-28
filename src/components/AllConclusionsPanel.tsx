"use client";

import { AGENTS } from "@/shared/agents";
import type { CaseBundle } from "@/shared/types";
import { StatusChip } from "./Characters";
import { Modal } from "./Modal";
import { PixelSprite } from "./PixelSprite";
import { AGENT_SPRITES } from "./sprites";

export function AllConclusionsPanel({ open, bundle, onClose }: { open: boolean; bundle: CaseBundle | null; onClose: () => void }) {
  return (
    <Modal open={open} title="ВСЕ ЗАКЛЮЧЕНИЯ" onClose={onClose}>
      <ul className="all-list">
        {AGENTS.map((m) => {
          const a = bundle?.analyses.find((x) => x.agentId === m.id);
          return (
            <li key={m.id} className="all-item">
              <PixelSprite rows={AGENT_SPRITES[m.id]} scale={2} />
              <div>
                <p className="all-head">
                  <b>{m.name}</b> <StatusChip status={a?.status ?? "idle"} />
                  {a?.status === "done" && <span className="tag">{a.overallScore}/100</span>}
                </p>
                <p className="small">{a?.status === "done" ? a.summary : a?.status === "error" ? a.error : "Заключения пока нет"}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

"use client";

import { useMemo, useState } from "react";
import { buildReport, formatDate } from "@/shared/report";
import { DECISION_LABEL } from "@/shared/scoring";
import type { CaseBundle } from "@/shared/types";
import { Modal } from "./Modal";

/** Минимальный рендер Markdown отчёта: заголовки, списки, цитаты, жирный текст. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/\S+)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a> : p,
  );
}

function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{renderInline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:-|\d+\.)\s+(.*)$/);
    if (li) { list.push(li[1]); continue; }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("### ")) blocks.push(<h4 key={blocks.length}>{line.slice(4)}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length}>{line.slice(3)}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={blocks.length} className="report-title">{line.slice(2)}</h2>);
    else if (line.startsWith("> ")) blocks.push(<p key={blocks.length} className="notice notice-warn">{renderInline(line.slice(2))}</p>);
    else if (/^_.*_$/.test(line)) blocks.push(<p key={blocks.length} className="muted small">{line.slice(1, -1)}</p>);
    else blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
  }
  flush();
  return <div className="report">{blocks}</div>;
}

interface Props {
  open: boolean;
  bundle: CaseBundle | null;
  onClose: () => void;
  onCopy: () => void;
}

export function ReportPanel({ open, bundle, onClose, onCopy }: Props) {
  const [tab, setTab] = useState<"report" | "history">("report");
  const report = useMemo(() => (bundle ? buildReport(bundle) : ""), [bundle]);
  return (
    <Modal
      open={open && !!bundle}
      title={bundle ? `ДЕЛО №${bundle.case.number}` : "ДЕЛО"}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onCopy}>Копировать отчёт</button>}
    >
      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}>Отчёт</button>
        <button type="button" role="tab" className="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>История</button>
      </div>
      {tab === "report" && <Markdown source={report} />}
      {tab === "history" && bundle && (
        <div className="history">
          {bundle.previousVerdicts.length > 0 && (
            <>
              <h3>Прошлые заседания</h3>
              <ul>
                {bundle.previousVerdicts.map((v) => (
                  <li key={v.id}>
                    Заседание {v.round}, {formatDate(v.createdAt)}: <b>{DECISION_LABEL[v.decision]}</b> ({v.overallScore}/100) — {v.headline}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Журнал событий</h3>
          <ol className="event-log">
            {bundle.events.map((e) => (
              <li key={e.id} className={`event event-${e.eventType}`}>
                <span className="muted small">{formatDate(e.createdAt)} · заседание {e.round}</span>
                <span>{e.description}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}

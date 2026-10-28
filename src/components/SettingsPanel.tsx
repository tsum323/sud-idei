"use client";

import type { Prefs } from "@/client/useCourt";
import type { AppSettings } from "@/shared/types";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  settings: AppSettings | null;
  prefs: Prefs;
  onChange: (p: Prefs) => void;
  onClose: () => void;
}

export function SettingsPanel({ open, settings, prefs, onChange, onClose }: Props) {
  return (
    <Modal open={open} title="НАСТРОЙКИ" variant="center" onClose={onClose}>
      {settings ? (
        <dl className="settings-list">
          <dt>AI-провайдер</dt>
          <dd>
            {settings.providerLabel}
            {settings.paid ? <span className="tag tag-paid">платно</span> : <span className="tag tag-demo">бесплатно</span>}
          </dd>
          {settings.model && (<><dt>Модель</dt><dd>{settings.model}, effort: {settings.effort}</dd></>)}
          <dt>Веб-поиск</dt>
          <dd>{settings.search.configured ? `Подключён (${settings.search.provider})` : "Не настроен — актуальные данные не проверяются"}</dd>
          <dt>Хранилище</dt>
          <dd><code>{settings.databasePath}</code> (SQLite)</dd>
        </dl>
      ) : (
        <p className="muted">Загрузка…</p>
      )}
      {settings?.configError && <p className="notice notice-warn">{settings.configError}</p>}
      {settings?.provider === "demo" && (
        <div className="notice">
          <b>Как подключить реальную модель.</b> Создайте ключ в Claude Console (console.anthropic.com) — доступ к API
          оплачивается отдельно от подписки Claude Pro/Max. Затем в файле <code>.env.local</code> укажите
          <code> AI_PROVIDER=anthropic</code> и <code>ANTHROPIC_API_KEY=…</code> и перезапустите сервер. Ключ хранится только на сервере.
        </div>
      )}

      <h3>Параметры запуска</h3>
      <label className="field field-inline">
        <span className="field-label">Параллельных вызовов агентов: {prefs.concurrency}</span>
        <input type="range" min={1} max={9} value={prefs.concurrency} onChange={(e) => onChange({ ...prefs, concurrency: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.confirmPaid} onChange={(e) => onChange({ ...prefs, confirmPaid: e.target.checked })} />
        Спрашивать подтверждение перед платным запуском
      </label>
    </Modal>
  );
}

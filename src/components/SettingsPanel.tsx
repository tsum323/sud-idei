"use client";

import type { Prefs } from "@/client/useCourt";
import type { AppSettings } from "@/shared/types";
import { Modal } from "./Modal";

function SetupSteps() {
  return (
    <ol className="setup-steps">
      <li>
        Создайте ключ API в Claude Console (console.anthropic.com → API Keys) и пополните баланс. Доступ к API
        оплачивается отдельно от подписки Claude Pro/Max.
      </li>
      <li>
        В папке проекта создайте файл <code>.env.local</code> со строкой <code>ANTHROPIC_API_KEY=sk-ant-…</code>
      </li>
      <li>Перезапустите сервер приложения. Ключ хранится только на сервере.</li>
    </ol>
  );
}

/** Карточка вместо формы подачи, пока не настроен ключ API. */
export function SetupNotice({ message, onOpenSettings }: { message: string | null; onOpenSettings: () => void }) {
  return (
    <div className="notice notice-warn setup-notice" role="status">
      <b>AI-провайдер не подключён — суд пока не может заседать.</b>
      {message && <p className="small">{message}</p>}
      <SetupSteps />
      <button type="button" className="link-btn" onClick={onOpenSettings}>
        Открыть настройки
      </button>
    </div>
  );
}

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
            {settings.configured && <span className="tag tag-paid">платно</span>}
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
      {settings && !settings.configured && (
        <div className="notice">
          <b>Как подключить Claude API</b>
          <SetupSteps />
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

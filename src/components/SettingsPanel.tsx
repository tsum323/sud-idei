"use client";

import type { Prefs } from "@/client/useCourt";
import type { AppSettings } from "@/shared/types";
import { Modal } from "./Modal";

function SetupSteps({ settings }: { settings: AppSettings }) {
  if (settings.provider === "anthropic-api") {
    return (
      <ol className="setup-steps">
        <li>Создайте ключ в Claude Console (console.anthropic.com → API Keys) и пополните баланс.</li>
        <li>
          Добавьте в <code>.env.local</code> строку <code>ANTHROPIC_API_KEY=sk-ant-…</code> и перезапустите сервер.
        </li>
      </ol>
    );
  }
  return (
    <ol className="setup-steps">
      <li>
        Установите Claude Code: <code>npm install -g @anthropic-ai/claude-code</code>
      </li>
      <li>
        Выполните в терминале <code>claude auth login</code> и войдите в аккаунт с подпиской Pro.
      </li>
      <li>Обновите эту страницу — перезапуск сервера не нужен.</li>
    </ol>
  );
}

/** Карточка вместо формы подачи, пока провайдер не готов. */
export function SetupNotice({ settings, onOpenSettings }: { settings: AppSettings; onOpenSettings: () => void }) {
  return (
    <div className="notice notice-warn setup-notice" role="status">
      <b>Суд пока не может заседать: не подключена модель Claude.</b>
      {settings.configError && <p className="small">{settings.configError}</p>}
      <SetupSteps settings={settings} />
      <button type="button" className="link-btn" onClick={onOpenSettings}>
        Открыть настройки
      </button>
    </div>
  );
}

const BILLING_TAG: Record<NonNullable<AppSettings["billing"]>, string> = {
  subscription: "лимиты подписки",
  api: "оплата по токенам",
};

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
          <dt>Модель</dt>
          <dd>
            {settings.providerLabel}
            {settings.billing && <span className="tag tag-paid">{BILLING_TAG[settings.billing]}</span>}
          </dd>
          {settings.effort && (<><dt>Effort</dt><dd>{settings.effort}</dd></>)}
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
          <b>Как подключить</b>
          <SetupSteps settings={settings} />
        </div>
      )}
      {settings?.billing === "subscription" && (
        <p className="muted small">
          Запросы идут через установленный у вас Claude Code и расходуют лимиты подписки, отдельной оплаты нет. Одно
          заседание — около 11 запросов. Если лимит исчерпан, агенты покажут ошибку, а заседание можно продолжить после сброса.
        </p>
      )}

      <h3>Параметры запуска</h3>
      <label className="field field-inline">
        <span className="field-label">Параллельных запросов агентов: {prefs.concurrency}</span>
        <input type="range" min={1} max={9} value={prefs.concurrency} onChange={(e) => onChange({ ...prefs, concurrency: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={prefs.confirmPaid} onChange={(e) => onChange({ ...prefs, confirmPaid: e.target.checked })} />
        Спрашивать подтверждение перед запуском запросов к модели
      </label>
    </Modal>
  );
}

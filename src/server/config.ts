import "server-only";
import type { AppSettings } from "@/shared/types";
import { AnthropicProvider, type Effort } from "./ai/anthropic";
import { checkClaudeAuth, ClaudeCodeProvider, type ClaudeAuthStatus } from "./ai/claudeCode";
import type { AIProvider } from "./ai/types";
import { databasePath } from "./db/db";
import { TavilySearch, type SearchProvider } from "./evidence/search";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export type ProviderKind = "claude-code" | "anthropic-api";

export interface ServerConfig {
  kind: ProviderKind;
  /** null — провайдер не готов: заседания не запускаются, пока он не настроен. */
  provider: AIProvider | null;
  search: SearchProvider | null;
  retries: number;
  timeoutMs: number;
  configError: string | null;
}

export const NOT_CONFIGURED_MESSAGE = "AI-провайдер не готов. Откройте настройки ⚙ — там описано, что сделать.";

export interface ConfigDeps {
  checkAuth?: (bin: string) => ClaudeAuthStatus;
}

/** Читает настройки из переменных окружения. Ключи и токены никогда не покидают сервер. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, deps: ConfigDeps = {}): ServerConfig {
  const kind: ProviderKind = (env.AI_PROVIDER ?? "claude-code").toLowerCase() === "anthropic-api" ? "anthropic-api" : "claude-code";
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || (kind === "claude-code" ? 300_000 : 180_000);
  const retries = Math.max(0, Math.min(5, Number(env.AI_MAX_RETRIES ?? 2) || 0));
  const effort = EFFORTS.includes(env.AI_EFFORT as Effort) ? (env.AI_EFFORT as Effort) : "medium";
  const errors: string[] = [];
  let provider: AIProvider | null = null;

  if (kind === "claude-code") {
    const bin = env.CLAUDE_BIN?.trim() || "claude";
    const status = (deps.checkAuth ?? checkClaudeAuth)(bin);
    if (!status.installed) {
      errors.push("Не найдена программа Claude Code. Установите её: npm install -g @anthropic-ai/claude-code");
    } else if (!status.loggedIn) {
      errors.push("Claude Code установлен, но вход не выполнен. Выполните в терминале: claude auth login");
    } else {
      provider = new ClaudeCodeProvider({ bin, model: env.AI_MODEL?.trim() || "sonnet", effort, timeoutMs });
    }
  } else {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (key) {
      provider = new AnthropicProvider({
        apiKey: key,
        model: env.AI_MODEL?.trim() || "claude-opus-5-5",
        effort,
        timeoutMs,
        fallbacks: (env.AI_FALLBACKS ?? "on").toLowerCase() !== "off",
      });
    } else {
      errors.push("AI_PROVIDER=anthropic-api, но не задан ANTHROPIC_API_KEY.");
    }
  }

  let search: SearchProvider | null = null;
  if ((env.SEARCH_PROVIDER || "none").toLowerCase() === "tavily") {
    if (env.TAVILY_API_KEY?.trim()) search = new TavilySearch(env.TAVILY_API_KEY.trim());
    else errors.push("SEARCH_PROVIDER=tavily, но TAVILY_API_KEY не задан — поиск отключён.");
  }

  return { kind, provider, search, retries, timeoutMs, configError: errors.length ? errors.join(" ") : null };
}

let cached: ServerConfig | null = null;

/**
 * Конфигурация процесса. Пока провайдер не готов, она перечитывается при каждом
 * обращении — после `claude auth login` достаточно обновить страницу.
 */
export function getConfig(): ServerConfig {
  if (!cached) cached = loadConfig();
  else if (!cached.provider) Object.assign(cached, loadConfig());
  return cached;
}

export function publicSettings(cfg: ServerConfig): AppSettings {
  const p = cfg.provider;
  const effort = p instanceof AnthropicProvider || p instanceof ClaudeCodeProvider ? p.effort : null;
  return {
    provider: cfg.kind,
    providerLabel: p ? p.label : cfg.kind === "claude-code" ? "Claude Code по подписке — не готов" : "Claude API — не настроен",
    billing: p ? (cfg.kind === "claude-code" ? "subscription" : "api") : null,
    model: p?.model ?? null,
    effort,
    paid: Boolean(p?.paid),
    configured: Boolean(p),
    configError: cfg.configError,
    search: { provider: cfg.search ? cfg.search.id : "none", configured: Boolean(cfg.search) },
    databasePath: databasePath(),
  };
}

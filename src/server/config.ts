import "server-only";
import type { AppSettings } from "@/shared/types";
import { AnthropicProvider, type Effort } from "./ai/anthropic";
import type { AIProvider } from "./ai/types";
import { databasePath } from "./db/db";
import { TavilySearch, type SearchProvider } from "./evidence/search";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ServerConfig {
  /** null — ключ не задан: заседания не запускаются, пока провайдер не настроен. */
  provider: AIProvider | null;
  search: SearchProvider | null;
  retries: number;
  timeoutMs: number;
  configError: string | null;
}

export const MISSING_KEY_MESSAGE =
  "Не задан ANTHROPIC_API_KEY. Добавьте ключ в файл .env.local и перезапустите сервер.";

/** Читает настройки из переменных окружения. Ключи никогда не покидают сервер. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || 180_000;
  const retries = Math.max(0, Math.min(5, Number(env.AI_MAX_RETRIES ?? 2) || 0));
  const errors: string[] = [];

  let provider: AIProvider | null = null;
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) {
    const effort = EFFORTS.includes(env.AI_EFFORT as Effort) ? (env.AI_EFFORT as Effort) : "medium";
    provider = new AnthropicProvider({
      apiKey: key,
      model: env.AI_MODEL?.trim() || "claude-opus-5-5",
      effort,
      timeoutMs,
      fallbacks: (env.AI_FALLBACKS ?? "on").toLowerCase() !== "off",
    });
  } else {
    errors.push(MISSING_KEY_MESSAGE);
  }

  let search: SearchProvider | null = null;
  if ((env.SEARCH_PROVIDER || "none").toLowerCase() === "tavily") {
    if (env.TAVILY_API_KEY?.trim()) search = new TavilySearch(env.TAVILY_API_KEY.trim());
    else errors.push("SEARCH_PROVIDER=tavily, но TAVILY_API_KEY не задан — поиск отключён");
  }

  return { provider, search, retries, timeoutMs, configError: errors.length ? errors.join(" ") : null };
}

let cached: ServerConfig | null = null;
export function getConfig(): ServerConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function publicSettings(cfg: ServerConfig): AppSettings {
  const p = cfg.provider;
  return {
    provider: p ? "anthropic" : null,
    providerLabel: p ? p.label : "Не настроен",
    model: p?.model ?? null,
    effort: p instanceof AnthropicProvider ? p.effort : null,
    paid: Boolean(p?.paid),
    configured: Boolean(p),
    configError: cfg.configError,
    search: { provider: cfg.search ? cfg.search.id : "none", configured: Boolean(cfg.search) },
    databasePath: databasePath(),
  };
}

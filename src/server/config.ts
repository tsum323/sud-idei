import "server-only";
import type { AppSettings } from "@/shared/types";
import { AnthropicProvider, type Effort } from "./ai/anthropic";
import { DemoProvider } from "./ai/demo";
import type { AIProvider } from "./ai/types";
import { databasePath } from "./db/db";
import { TavilySearch, type SearchProvider } from "./evidence/search";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ServerConfig {
  provider: AIProvider;
  search: SearchProvider | null;
  retries: number;
  timeoutMs: number;
  configError: string | null;
}

/** Читает настройки из переменных окружения. Ключи никогда не покидают сервер. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || 180_000;
  const retries = Math.max(0, Math.min(5, Number(env.AI_MAX_RETRIES ?? 2) || 0));
  let configError: string | null = null;
  let provider: AIProvider;

  const wanted = (env.AI_PROVIDER || "demo").toLowerCase();
  if (wanted === "anthropic") {
    const key = env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      configError = "AI_PROVIDER=anthropic, но ANTHROPIC_API_KEY не задан — включён демо-режим";
      provider = new DemoProvider({ latencyMs: Number(env.DEMO_LATENCY_MS ?? 900) });
    } else {
      const effort = EFFORTS.includes(env.AI_EFFORT as Effort) ? (env.AI_EFFORT as Effort) : "medium";
      provider = new AnthropicProvider({
        apiKey: key,
        model: env.AI_MODEL?.trim() || "claude-opus-5-5",
        effort,
        timeoutMs,
        fallbacks: (env.AI_FALLBACKS ?? "on").toLowerCase() !== "off",
      });
    }
  } else {
    if (wanted !== "demo") configError = `Неизвестный AI_PROVIDER «${wanted}» — включён демо-режим`;
    provider = new DemoProvider({
      latencyMs: Number(env.DEMO_LATENCY_MS ?? 900),
      failAgent: env.DEMO_FAIL_AGENT?.trim() || undefined,
    });
  }

  let search: SearchProvider | null = null;
  if ((env.SEARCH_PROVIDER || "none").toLowerCase() === "tavily") {
    if (env.TAVILY_API_KEY?.trim()) search = new TavilySearch(env.TAVILY_API_KEY.trim());
    else configError = [configError, "SEARCH_PROVIDER=tavily, но TAVILY_API_KEY не задан — поиск отключён"].filter(Boolean).join("; ");
  }

  return { provider, search, retries, timeoutMs, configError };
}

let cached: ServerConfig | null = null;
export function getConfig(): ServerConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function publicSettings(cfg: ServerConfig): AppSettings {
  const p = cfg.provider;
  return {
    provider: p.id,
    providerLabel: p.label,
    model: p.model,
    effort: p instanceof AnthropicProvider ? p.effort : null,
    paid: p.paid,
    configured: p.id === "anthropic",
    configError: cfg.configError,
    search: { provider: cfg.search ? cfg.search.id : "none", configured: Boolean(cfg.search) },
    databasePath: databasePath(),
  };
}

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AnthropicProvider, mapAnthropicError } from "@/server/ai/anthropic";
import { AIError } from "@/server/ai/errors";
import { loadConfig, publicSettings } from "@/server/config";
import { AgentOutputSchema } from "@/shared/schemas";
import Anthropic from "@anthropic-ai/sdk";

const SAMPLE = {
  summary: "Вывод", stance: "neutral", overallScore: 50, strengths: [], weaknesses: [], risks: [], claims: [],
  scorecard: [], confidence: "low", unknowns: [], recommendations: [], fullText: "Текст",
};

function fakeFetch(respond: (body: Record<string, unknown>, headers: Headers) => Response) {
  const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
  const f = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers as HeadersInit);
    calls.push({ body, headers });
    return respond(body, headers);
  }) as typeof fetch;
  return { f, calls };
}

const message = (text: string, stop_reason = "end_turn") =>
  new Response(
    JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, stop_sequence: null,
      content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const req = { input: {} as never, system: "sys", prompt: "prompt", schema: AgentOutputSchema, maxTokens: 1000 };

describe("адаптер Claude API", () => {
  it("отправляет структурированный запрос и разбирает ответ по схеме", async () => {
    const { f, calls } = fakeFetch(() => message(JSON.stringify(SAMPLE)));
    const p = new AnthropicProvider({ apiKey: "sk-test", model: "claude-opus-5-5", effort: "medium", timeoutMs: 1000, fallbacks: true, fetch: f });
    const out = await p.generate(req);
    expect(out.summary).toBe("Вывод");
    const { body, headers } = calls[0];
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.system).toBe("sys");
    expect((body.output_config as { effort: string }).effort).toBe("medium");
    expect((body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(headers.get("x-api-key") ?? headers.get("authorization")).toContain("sk-test");
  });

  it("отказ модели и обрезанный ответ превращаются в понятные ошибки", async () => {
    const refusal = fakeFetch(() => message("", "refusal"));
    const p1 = new AnthropicProvider({ apiKey: "k", model: "m", effort: "low", timeoutMs: 1000, fallbacks: false, fetch: refusal.f });
    await expect(p1.generate(req)).rejects.toMatchObject({ kind: "refusal" });
    expect(refusal.calls[0].body.fallbacks).toBeUndefined();

    const cut = fakeFetch(() => message('{"summary":', "max_tokens"));
    const p2 = new AnthropicProvider({ apiKey: "k", model: "m", effort: "low", timeoutMs: 1000, fallbacks: false, fetch: cut.f });
    await expect(p2.generate(req)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("HTTP-ошибки классифицируются для повторов", async () => {
    const mk = (status: number) =>
      new AnthropicProvider({
        apiKey: "k", model: "m", effort: "low", timeoutMs: 1000, fallbacks: false,
        fetch: fakeFetch(() => new Response(JSON.stringify({ type: "error", error: { type: "x", message: "m" } }), { status, headers: { "content-type": "application/json" } })).f,
      });
    await expect(mk(401).generate(req)).rejects.toMatchObject({ kind: "auth", retryable: false });
    await expect(mk(429).generate(req)).rejects.toMatchObject({ kind: "rate_limit", retryable: true });
    await expect(mk(529).generate(req)).rejects.toMatchObject({ kind: "server", retryable: true });
    await expect(mk(400).generate(req)).rejects.toMatchObject({ kind: "bad_request", retryable: false });
    expect(mapAnthropicError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ kind: "timeout" });
    expect(mapAnthropicError(new AIError("config"))).toMatchObject({ kind: "config" });
  });
});

describe("конфигурация и секреты", () => {
  const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
  const loggedIn = () => ({ installed: true, loggedIn: true });

  it("по умолчанию используется подписка через Claude Code", () => {
    const cfg = loadConfig(env({}), { checkAuth: loggedIn });
    expect(cfg.kind).toBe("claude-code");
    expect(cfg.provider?.id).toBe("claude-code");
    expect(publicSettings(cfg)).toMatchObject({ billing: "subscription", configured: true, paid: false });
  });

  it("без установленного Claude Code или без входа провайдер не готов и объясняет, что сделать", () => {
    const notInstalled = loadConfig(env({}), { checkAuth: () => ({ installed: false, loggedIn: false }) });
    expect(notInstalled.provider).toBeNull();
    expect(notInstalled.configError).toMatch(/npm install -g @anthropic-ai\/claude-code/);
    const notLogged = loadConfig(env({}), { checkAuth: () => ({ installed: true, loggedIn: false }) });
    expect(notLogged.configError).toMatch(/claude auth login/);
    expect(publicSettings(notLogged)).toMatchObject({ configured: false, billing: null });
  });

  it("вариант с ключом API требует ключ", () => {
    const cfg = loadConfig(env({ AI_PROVIDER: "anthropic-api" }));
    expect(cfg.provider).toBeNull();
    expect(cfg.configError).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("публичные настройки не содержат ключей API", () => {
    const secret = "sk-ant-SECRET-123";
    const cfg = loadConfig(env({ AI_PROVIDER: "anthropic-api", ANTHROPIC_API_KEY: secret, SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "tvly-SECRET" }));
    expect(cfg.provider?.id).toBe("anthropic");
    const json = JSON.stringify(publicSettings(cfg));
    expect(json).not.toContain(secret);
    expect(json).not.toContain("tvly-SECRET");
    expect(publicSettings(cfg)).toMatchObject({ billing: "api", paid: true });
  });

  it("клиентский код не обращается к серверным модулям и переменным окружения", () => {
    const root = path.resolve(import.meta.dirname, "../src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const clientSide = files.filter((f) => f.includes(`${path.sep}components${path.sep}`) || f.includes(`${path.sep}client${path.sep}`) || f.includes(`${path.sep}shared${path.sep}`));
    expect(clientSide.length).toBeGreaterThan(10);
    for (const f of clientSide) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from ["']@\/server/);
      expect(src, f).not.toMatch(/process\.env/);
    }
    // Модули, которые читают переменные окружения или используют Node, защищены от попадания в браузер.
    const sensitive = files.filter((f) => /process\.env|from "node:|@anthropic-ai\/sdk/.test(fs.readFileSync(f, "utf8")) && f.includes(`${path.sep}server${path.sep}`));
    expect(sensitive.length).toBeGreaterThan(4);
    for (const f of sensitive) expect(fs.readFileSync(f, "utf8"), f).toMatch(/import "server-only"/);
    // Версия для claude.ai не должна тянуть такие модули.
    for (const f of files.filter((f) => f.includes(`${path.sep}artifact${path.sep}`))) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/process\.env|from "node:|@\/server\/(config|instance|http|db\/db|db\/repo|ai\/anthropic|ai\/claudeCode)"/);
    }
  });
});

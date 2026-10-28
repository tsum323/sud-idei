import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { spawn } from "node:child_process";
import { checkClaudeAuth, classifyCliError, ClaudeCodeProvider, subscriptionEnv } from "@/server/ai/claudeCode";
import { AgentOutputSchema } from "@/shared/schemas";

const SAMPLE = {
  summary: "Вывод", stance: "neutral", overallScore: 50, strengths: [], weaknesses: [], risks: [], claims: [],
  scorecard: [], confidence: "low", unknowns: [], recommendations: [], fullText: "Текст",
};

interface Call { bin: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; stdin: string }

/** Подменяет запуск процесса claude: отдаёт заданный stdout и код выхода. */
function fakeSpawn(behave: { stdout?: string; code?: number; error?: NodeJS.ErrnoException; hang?: boolean }) {
  const calls: Call[] = [];
  const fn = ((bin: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit("close", null);
    const call: Call = { bin, args, env: opts.env, cwd: opts.cwd, stdin: "" };
    calls.push(call);
    child.stdin.on("data", (d) => (call.stdin += d));
    setTimeout(() => {
      if (behave.error) return child.emit("error", behave.error);
      if (behave.hang) return;
      child.stdout.write(behave.stdout ?? "");
      child.emit("close", behave.code ?? 0);
    }, 5);
    return child;
  }) as unknown as typeof spawn;
  return { fn, calls };
}

const result = (extra: Record<string, unknown>) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", ...extra });

const req = { input: {} as never, system: "Ты прокурор", prompt: "Идея: тест", schema: AgentOutputSchema, maxTokens: 1000 };
const make = (spawnFn: typeof spawn, timeoutMs = 2000) =>
  new ClaudeCodeProvider({ bin: "claude", model: "sonnet", effort: "medium", timeoutMs, spawnFn });

describe("провайдер Claude Code (подписка)", () => {
  it("вызывает claude -p без инструментов и ключа API и разбирает structured_output", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    try {
      const { fn, calls } = fakeSpawn({ stdout: result({ structured_output: SAMPLE }) });
      const out = await make(fn).generate(req);
      expect(out.summary).toBe("Вывод");
      const c = calls[0];
      expect(c.bin).toBe("claude");
      expect(c.args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
      expect(c.args[c.args.indexOf("--tools") + 1]).toBe("");
      expect(c.args[c.args.indexOf("--setting-sources") + 1]).toBe("");
      expect(c.args).toContain("--strict-mcp-config");
      expect(c.args[c.args.indexOf("--system-prompt") + 1]).toBe("Ты прокурор");
      expect(JSON.parse(c.args[c.args.indexOf("--json-schema") + 1]).type).toBe("object");
      expect(c.stdin).toBe("Идея: тест");
      expect(c.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("исчерпанный лимит подписки — отдельная ошибка без автоповторов", async () => {
    const { fn } = fakeSpawn({ stdout: result({ is_error: true, subtype: "success", result: "Claude AI usage limit reached|1793250000" }), code: 1 });
    await expect(make(fn).generate(req)).rejects.toMatchObject({ kind: "quota", retryable: false });
  });

  it("отсутствие входа, программы, тайм-аут и неверный ответ классифицируются", async () => {
    await expect(make(fakeSpawn({ stdout: result({ is_error: true, result: "Not logged in · Please run /login" }), code: 1 }).fn).generate(req))
      .rejects.toMatchObject({ kind: "auth" });
    const enoent = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    await expect(make(fakeSpawn({ error: enoent }).fn).generate(req)).rejects.toMatchObject({ kind: "config" });
    await expect(make(fakeSpawn({ hang: true }).fn, 50).generate(req)).rejects.toMatchObject({ kind: "timeout", retryable: true });
    await expect(make(fakeSpawn({ stdout: result({ structured_output: { summary: 1 } }) }).fn).generate(req)).rejects.toMatchObject({ kind: "invalid_output" });
    await expect(make(fakeSpawn({ stdout: "not json", code: 2 }).fn).generate(req)).rejects.toMatchObject({ kind: "server" });
  });

  it("классификатор ошибок", () => {
    expect(classifyCliError("API Error: 529 Overloaded")).toMatchObject({ kind: "server", retryable: true });
    expect(classifyCliError("x", 429)).toMatchObject({ kind: "rate_limit" });
    expect(classifyCliError("Invalid API key · Please run /login")).toMatchObject({ kind: "auth" });
  });

  it("проверка входа и окружение без ключей", () => {
    expect(checkClaudeAuth("claude", () => '{"loggedIn":true,"authMethod":"claude.ai"}')).toEqual({ installed: true, loggedIn: true, authMethod: "claude.ai" });
    expect(checkClaudeAuth("claude", () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); })).toMatchObject({ installed: false });
    expect(checkClaudeAuth("claude", () => { throw Object.assign(new Error("x"), { status: 1, stdout: '{"loggedIn":false}' }); })).toMatchObject({ installed: true, loggedIn: false });
    const env = subscriptionEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" } as unknown as NodeJS.ProcessEnv);
    expect(env).toEqual({ PATH: "/bin" });
  });
});

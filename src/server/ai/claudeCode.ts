import "server-only";
import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { AIError } from "./errors";
import { toPlainJsonSchema } from "./jsonSchema";
import type { AIProvider, AIRequest } from "./types";

export interface ClaudeCodeOptions {
  /** Путь к программе claude (по умолчанию ищется в PATH). */
  bin: string;
  model: string;
  effort: string;
  timeoutMs: number;
  /** Подмена запуска процесса — только для тестов. */
  spawnFn?: typeof spawn;
}

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  stop_reason?: string | null;
  api_error_status?: number | null;
}

/**
 * Окружение дочернего процесса без ключей API: иначе Claude Code предпочёл бы ключ
 * и вызовы оплачивались бы по токенам, а не из подписки.
 */
export function subscriptionEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  return out;
}

/** Пустая рабочая папка, чтобы Claude Code не подхватывал файлы и CLAUDE.md проекта. */
function workDir(): string {
  const dir = path.join(os.tmpdir(), "ai-court-claude");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Классифицирует текст ошибки Claude Code: от типа зависит, повторять ли вызов. */
export function classifyCliError(text: string, status?: number | null): AIError {
  const t = text.slice(0, 300);
  if (/usage limit|limit reached|limit will reset|out of (extra )?usage|weekly limit/i.test(text)) return new AIError("quota", t);
  if (/log ?in|logged|authenticat|oauth|credential|invalid api key|unauthori[sz]ed/i.test(text) || status === 401 || status === 403) {
    return new AIError("auth", t);
  }
  if (/not a valid JSON Schema|unknown option|error: option|invalid value for/i.test(text)) return new AIError("bad_request", t);
  if (status === 429 || /rate.?limit|too many requests/i.test(text)) return new AIError("rate_limit", t);
  if (/overloaded|timed? ?out|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(text) || (status != null && status >= 500)) {
    return new AIError("server", t);
  }
  return new AIError("server", t || "Claude Code завершился с ошибкой");
}

/**
 * Провайдер на базе подписки Claude Pro/Max: вызывает установленную программу
 * Claude Code в неинтерактивном режиме (`claude -p`). Инструменты, MCP-серверы,
 * пользовательские настройки и хуки отключены — модель только рассуждает и
 * возвращает JSON по схеме. Учётные данные приложение не читает и не хранит.
 */
export class ClaudeCodeProvider implements AIProvider {
  readonly id = "claude-code";
  readonly paid = false;
  readonly label: string;
  readonly model: string;
  readonly effort: string;

  constructor(private opts: ClaudeCodeOptions) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.label = `Claude Code по подписке (${opts.model})`;
  }

  args(system: string, schema: z.ZodType): string[] {
    return [
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(toPlainJsonSchema(schema)),
      "--system-prompt", system,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--no-session-persistence",
      "--model", this.opts.model,
      "--effort", this.opts.effort,
    ];
  }

  async generate<T>(req: AIRequest<T>): Promise<T> {
    const stdout = await this.run(this.args(req.system, req.schema), req.prompt);
    const res = parseCliOutput(stdout);
    if (!res) throw new AIError("invalid_output", "Claude Code вернул нераспознанный ответ");
    if (res.is_error || (res.subtype && res.subtype !== "success")) {
      if (res.subtype === "error_max_structured_output_retries") throw new AIError("invalid_output", "ответ не соответствует схеме");
      throw classifyCliError(res.result ?? res.subtype ?? "", res.api_error_status);
    }
    if (res.structured_output == null) {
      if (res.stop_reason === "refusal") throw new AIError("refusal");
      throw new AIError("invalid_output", "нет структурированного ответа");
    }
    const parsed = req.schema.safeParse(res.structured_output);
    if (!parsed.success) throw new AIError("invalid_output", "ответ не соответствует схеме");
    return parsed.data;
  }

  private run(args: string[], input: string): Promise<string> {
    const spawnFn = this.opts.spawnFn ?? spawn;
    const options: SpawnOptions = { cwd: workDir(), env: subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"] };
    return new Promise((resolve, reject) => {
      const child = spawnFn(this.opts.bin, args, options);
      let out = "";
      let err = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        // Сначала фиксируем тайм-аут, затем завершаем процесс: его «close» уже ничего не изменит.
        finish(() => reject(new AIError("timeout")));
        child.kill("SIGTERM");
      }, this.opts.timeoutMs);

      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (err += d));
      child.on("error", (e: NodeJS.ErrnoException) =>
        finish(() =>
          reject(
            e.code === "ENOENT"
              ? new AIError("config", "программа claude не найдена — установите Claude Code")
              : new AIError("server", e.message),
          ),
        ),
      );
      child.on("close", (code) =>
        finish(() => {
          // При сбое внутри запуска Claude Code тоже печатает JSON-результат в stdout.
          if (parseCliOutput(out)) return resolve(out);
          if (code !== 0) return reject(classifyCliError(err || out));
          resolve(out);
        }),
      );
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    });
  }
}

export function parseCliOutput(stdout: string): CliResult | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const v = JSON.parse(line) as CliResult;
      if (v && typeof v === "object" && (v.type === "result" || "structured_output" in v || "is_error" in v)) return v;
    } catch {
      /* не JSON — пропускаем */
    }
  }
  return null;
}

export interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  authMethod?: string;
  error?: string;
}

/** Проверка `claude auth status`. Ничего не тратит из лимитов. */
export function checkClaudeAuth(bin: string, run = defaultExec): ClaudeAuthStatus {
  try {
    const out = run(bin, ["auth", "status"]);
    const j = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string };
    return { installed: true, loggedIn: Boolean(j.loggedIn), authMethod: j.authMethod };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string };
    if (err.code === "ENOENT") return { installed: false, loggedIn: false };
    // Некоторые версии печатают статус и выходят с ненулевым кодом, если вход не выполнен.
    try {
      const j = JSON.parse(String(err.stdout ?? "")) as { loggedIn?: boolean };
      return { installed: true, loggedIn: Boolean(j.loggedIn) };
    } catch {
      return { installed: true, loggedIn: false, error: err.message };
    }
  }
}

/** Синхронный запуск: занимает доли секунды и выполняется только при проверке настроек. */
function defaultExec(bin: string, args: string[]): string {
  return execFileSync(bin, args, { env: subscriptionEnv(), timeout: 15_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

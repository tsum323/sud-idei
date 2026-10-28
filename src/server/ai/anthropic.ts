import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIError } from "./errors";
import type { AIProvider, AIRequest } from "./types";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  timeoutMs: number;
  /** Серверный fallback на другую модель при отказе классификатора безопасности. */
  fallbacks: boolean;
  /** Подмена HTTP-клиента — только для тестов. */
  fetch?: typeof fetch;
}

/** Переводит ошибки SDK в собственные типы — от типа зависит, повторять ли вызов. */
export function mapAnthropicError(e: unknown): AIError {
  if (e instanceof AIError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AIError("timeout");
  if (e instanceof Anthropic.APIConnectionError) return new AIError("network", e.message);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AIError("auth", e.message);
  }
  if (e instanceof Anthropic.RateLimitError) return new AIError("rate_limit");
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
    return new AIError("bad_request", e.message);
  }
  if (e instanceof Anthropic.APIError) {
    // 5xx и 529 (перегрузка) — временные ошибки
    return new AIError("server", `HTTP ${e.status ?? "?"}`);
  }
  if (e instanceof SyntaxError || (e instanceof Error && e.name === "ZodError")) {
    return new AIError("invalid_output", e.message.slice(0, 200));
  }
  return new AIError("server", e instanceof Error ? e.message : String(e));
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly paid = true;
  readonly label: string;
  readonly model: string;
  readonly effort: Effort;
  private client: Anthropic;

  constructor(private opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.effort = opts.effort;
    this.label = `Claude API (${opts.model})`;
    // Повторы выполняет собственный withRetry, чтобы их число было явным и проверяемым.
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 0, fetch: opts.fetch });
  }

  async generate<T>(req: AIRequest<T>): Promise<T> {
    let response;
    try {
      // create(), а не parse(): сначала проверяем stop_reason, иначе отказ или
      // обрезанный ответ проявились бы как невнятная ошибка разбора JSON.
      response = await this.client.beta.messages.create({
        model: this.opts.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: {
          effort: this.opts.effort,
          format: betaZodOutputFormat(req.schema),
        },
        ...(this.opts.fallbacks
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
    } catch (e) {
      throw mapAnthropicError(e);
    }

    if (response.stop_reason === "refusal") {
      throw new AIError("refusal", response.stop_details?.explanation ?? undefined);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIError("invalid_output", "ответ обрезан по лимиту токенов");
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AIError("invalid_output", "ответ не является JSON");
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new AIError("invalid_output", "ответ не соответствует схеме");
    return parsed.data;
  }
}

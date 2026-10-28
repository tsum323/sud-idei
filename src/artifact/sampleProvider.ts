import { AIError } from "@/server/ai/errors";
import { toPlainJsonSchema } from "@/server/ai/jsonSchema";
import type { AIProvider, AIRequest } from "@/server/ai/types";
import type { SampleError, SampleFn, SampleOptions } from "./runtime";

export interface SampleTuning {
  /** Экономный режим: агенты на быстрой модели, судья с низким effort. */
  economy: boolean;
}

/** Переводит коды ошибок claude.ai в типы ошибок суда: от них зависят повторы и подсказки. */
export function mapSampleError(e: unknown): AIError {
  const err = e as Partial<SampleError> | undefined;
  switch (err?.code) {
    case "rate_limited":
      return new AIError("quota", "лимит подписки или частоты запросов — повторите позже");
    case "not_granted":
      return new AIError("config", "странице не разрешено обращаться к Claude — разрешите доступ в меню разрешений страницы");
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      return new AIError("config", "Claude недоступен на этой странице для вашего аккаунта");
    case "session_expired":
      return new AIError("auth", "сессия claude.ai истекла — войдите снова и обновите страницу");
    case "refused":
      return new AIError("refusal");
    case "invalid_json":
    case "empty_completion":
      return new AIError("invalid_output", "ответ не является JSON");
    case "prompt_too_large":
      return new AIError("bad_request", "слишком длинный запрос — сократите описание идеи");
    case "cancelled":
      return new AIError("timeout", "запрос прерван");
    default:
      return new AIError("server", err?.message?.slice(0, 200));
  }
}

/**
 * Модель через claude.ai: страница вызывает Claude от имени того, кто её
 * открыл, и запросы расходуют лимиты его подписки. Ключи не нужны.
 * У этого способа нет системного промпта — инструкции идут в начале запроса.
 */
export class SampleProvider implements AIProvider {
  readonly id = "claude-artifact";
  readonly paid = false;
  readonly label = "Claude по вашей подписке (claude.ai)";
  readonly model = null;

  constructor(
    private sample: SampleFn,
    private tuning: () => SampleTuning,
  ) {}

  options(task: AIRequest<unknown>["input"]["task"]): SampleOptions {
    const { economy } = this.tuning();
    // Повторный запуск должен давать новый ответ, поэтому кеш ответов отключён.
    if (!economy) return { modelTier: "default", cache: false };
    return task === "verdict" ? { modelTier: "default", effort: "low", cache: false } : { modelTier: "quick", cache: false };
  }

  prompt(req: AIRequest<unknown>): string {
    return [
      "<instructions>",
      req.system,
      "</instructions>",
      "",
      req.prompt,
      "",
      "Ответь ОДНИМ JSON-объектом строго по этой JSON Schema — без пояснений и без Markdown.",
      "Все текстовые поля пиши на русском языке.",
      JSON.stringify(toPlainJsonSchema(req.schema)),
    ].join("\n");
  }

  async generate<T>(req: AIRequest<T>): Promise<T> {
    let raw: unknown;
    try {
      raw = await this.sample.json(this.prompt(req as AIRequest<unknown>), this.options(req.input.task));
    } catch (e) {
      throw mapSampleError(e);
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new AIError("invalid_output", "ответ не соответствует схеме");
    return parsed.data;
  }
}

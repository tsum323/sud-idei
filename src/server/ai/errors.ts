export type AIErrorKind =
  | "config"
  | "auth"
  | "bad_request"
  | "rate_limit"
  | "timeout"
  | "network"
  | "server"
  | "refusal"
  | "invalid_output";

const RETRYABLE: Record<AIErrorKind, boolean> = {
  config: false,
  auth: false,
  bad_request: false,
  rate_limit: true,
  timeout: true,
  network: true,
  server: true,
  refusal: false,
  invalid_output: true,
};

export const AI_ERROR_MESSAGE: Record<AIErrorKind, string> = {
  config: "AI-провайдер не настроен",
  auth: "Ключ API отклонён — проверьте ANTHROPIC_API_KEY",
  bad_request: "Провайдер отклонил запрос",
  rate_limit: "Превышен лимит запросов провайдера",
  timeout: "Превышено время ожидания ответа",
  network: "Сетевая ошибка при обращении к провайдеру",
  server: "Временная ошибка на стороне провайдера",
  refusal: "Модель отказалась отвечать на запрос",
  invalid_output: "Модель вернула ответ в неверном формате",
};

export class AIError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly kind: AIErrorKind,
    detail?: string,
  ) {
    super(detail ? `${AI_ERROR_MESSAGE[kind]}: ${detail}` : AI_ERROR_MESSAGE[kind]);
    this.name = "AIError";
    this.retryable = RETRYABLE[kind];
  }
}

export function describeError(e: unknown): string {
  if (e instanceof AIError) return e.message;
  if (e instanceof Error) return `Непредвиденная ошибка: ${e.message}`;
  return "Непредвиденная ошибка";
}

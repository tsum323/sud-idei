import { describe, expect, it } from "vitest";
import { mapSampleError, SampleProvider } from "@/artifact/sampleProvider";
import type { SampleFn, SampleOptions } from "@/artifact/runtime";
import { AgentOutputSchema } from "@/shared/schemas";

const SAMPLE = {
  summary: "Вывод", stance: "neutral", overallScore: 50, strengths: [], weaknesses: [], risks: [], claims: [],
  scorecard: [], confidence: "low", unknowns: [], recommendations: [], fullText: "Текст",
};

function fake(reply: () => unknown) {
  const calls: { input: string; opts?: SampleOptions }[] = [];
  const fn = (async () => ({ text: "", truncated: false })) as unknown as SampleFn;
  fn.json = (async (input: string, opts?: SampleOptions) => {
    calls.push({ input, opts });
    return reply();
  }) as SampleFn["json"];
  return { fn, calls };
}

const req = (task: "agent" | "verdict") => ({
  input: (task === "agent" ? { task, agentId: "market" } : { task }) as never,
  system: "Ты рыночный аналитик",
  prompt: "<idea>Тест</idea>",
  schema: AgentOutputSchema,
  maxTokens: 1000,
});

describe("провайдер страницы claude.ai", () => {
  it("кладёт инструкции и схему в запрос, отключает кеш и проверяет ответ", async () => {
    const { fn, calls } = fake(() => SAMPLE);
    const p = new SampleProvider(fn, () => ({ economy: false }));
    expect((await p.generate(req("agent"))).summary).toBe("Вывод");
    expect(calls[0].input).toContain("Ты рыночный аналитик");
    expect(calls[0].input).toContain("<idea>Тест</idea>");
    expect(calls[0].input).toContain('"overallScore"');
    expect(calls[0].opts).toEqual({ modelTier: "default", cache: false });
  });

  it("экономный режим: агенты на быстрой модели, судья с низким effort", () => {
    const p = new SampleProvider(fake(() => SAMPLE).fn, () => ({ economy: true }));
    expect(p.options("agent")).toEqual({ modelTier: "quick", cache: false });
    expect(p.options("verdict")).toEqual({ modelTier: "default", effort: "low", cache: false });
  });

  it("ответ не по схеме — ошибка формата", async () => {
    const p = new SampleProvider(fake(() => ({ summary: 1 })).fn, () => ({ economy: false }));
    await expect(p.generate(req("agent"))).rejects.toMatchObject({ kind: "invalid_output", retryable: true });
  });

  it("коды ошибок claude.ai", () => {
    expect(mapSampleError({ code: "rate_limited" })).toMatchObject({ kind: "quota", retryable: false });
    expect(mapSampleError({ code: "not_granted" })).toMatchObject({ kind: "config", retryable: false });
    expect(mapSampleError({ code: "refused" })).toMatchObject({ kind: "refusal" });
    expect(mapSampleError({ code: "invalid_json" })).toMatchObject({ kind: "invalid_output", retryable: true });
    expect(mapSampleError({ code: "upstream_error" })).toMatchObject({ kind: "server", retryable: true });
    expect(mapSampleError({ code: "session_expired" })).toMatchObject({ kind: "auth" });
  });
});

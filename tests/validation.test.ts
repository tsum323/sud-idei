import { describe, expect, it } from "vitest";
import { LIMITS, NewIdeaSchema, ReopenSchema } from "@/shared/schemas";

describe("валидация новой идеи", () => {
  it("принимает минимальный ввод: название и описание", () => {
    const r = NewIdeaSchema.safeParse({ title: "  Идея  ", description: "Описание идеи длиной больше двадцати символов" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe("Идея");
      expect(r.data.optionalContext).toEqual({});
    }
  });

  it("отклоняет слишком короткие название и описание", () => {
    expect(NewIdeaSchema.safeParse({ title: "Я", description: "Достаточно длинное описание идеи" }).success).toBe(false);
    expect(NewIdeaSchema.safeParse({ title: "Идея", description: "коротко" }).success).toBe(false);
  });

  it("ограничивает размер описания", () => {
    const r = NewIdeaSchema.safeParse({ title: "Идея", description: "а".repeat(LIMITS.description + 1) });
    expect(r.success).toBe(false);
  });

  it("пустые дополнительные поля превращаются в undefined, длинные отклоняются", () => {
    const r = NewIdeaSchema.parse({
      title: "Идея",
      description: "Описание идеи длиной больше двадцати символов",
      optionalContext: { audience: "   ", problem: "Нет времени" },
    });
    expect(r.optionalContext.audience).toBeUndefined();
    expect(r.optionalContext.problem).toBe("Нет времени");
    expect(
      NewIdeaSchema.safeParse({
        title: "Идея",
        description: "Описание идеи длиной больше двадцати символов",
        optionalContext: { comments: "x".repeat(LIMITS.optionalField + 1) },
      }).success,
    ).toBe(false);
  });

  it("пересмотр требует новых оснований", () => {
    expect(ReopenSchema.safeParse({ newGrounds: "" }).success).toBe(false);
    expect(ReopenSchema.safeParse({ newGrounds: "Провёл 12 интервью, 8 подтвердили проблему" }).success).toBe(true);
  });
});

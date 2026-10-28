import { z } from "zod";

/** JSON Schema ответа для промпта или CLI: draft-7, без метки $schema. */
export function toPlainJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

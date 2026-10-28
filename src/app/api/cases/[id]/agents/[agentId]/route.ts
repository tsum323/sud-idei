import { getService } from "@/server/instance";
import { fail, ok, readJson } from "@/server/http";
import type { AgentId } from "@/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Запуск (или повтор) анализа одного агента. Готовый результат без force не пересчитывается. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; agentId: string }> }) {
  try {
    const { id, agentId } = await ctx.params;
    const body = await readJson(req);
    const analysis = await getService().runAgent(id, agentId as AgentId, { force: body.force === true });
    return ok(analysis);
  } catch (e) {
    return fail(e);
  }
}

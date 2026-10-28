import { getService } from "@/server/instance";
import { fail, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Полное дело из хранилища — без обращения к модели. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return ok(getService().bundle(id));
  } catch (e) {
    return fail(e);
  }
}

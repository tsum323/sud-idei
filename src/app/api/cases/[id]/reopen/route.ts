import { getService } from "@/server/instance";
import { fail, ok, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Повторное рассмотрение: требует новых оснований, открывает новое заседание. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    getService().reopen(id, await readJson(req));
    return ok(getService().bundle(id));
  } catch (e) {
    return fail(e);
  }
}

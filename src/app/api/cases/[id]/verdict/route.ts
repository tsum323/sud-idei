import { getService } from "@/server/instance";
import { fail, ok, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(req);
    await getService().runVerdict(id, { allowPartial: body.allowPartial === true });
    return ok(getService().bundle(id));
  } catch (e) {
    return fail(e);
  }
}

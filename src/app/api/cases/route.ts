import { getService } from "@/server/instance";
import { fail, ok, readJson } from "@/server/http";
import type { CaseStatus } from "@/shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Архив: список дел с поиском по названию и фильтром по статусу. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") ?? "all") as CaseStatus | "all";
    return ok(getService().list({ query: url.searchParams.get("q") ?? undefined, status }));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const c = getService().createCase(await readJson(req));
    return ok(getService().bundle(c.id), 201);
  } catch (e) {
    return fail(e);
  }
}

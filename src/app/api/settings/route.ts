import { getConfig, publicSettings } from "@/server/config";
import { ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Публичные настройки. Ключи API здесь не возвращаются. */
export async function GET() {
  return ok(publicSettings(getConfig()));
}

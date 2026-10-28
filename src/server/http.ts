import "server-only";
import { NextResponse } from "next/server";
import { CourtError } from "./court/service";
import { CaseNotFoundError } from "./db/repo";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Единый формат ошибок API: { error, details? }. */
export function fail(e: unknown) {
  if (e instanceof CourtError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof CaseNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  console.error(e);
  return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

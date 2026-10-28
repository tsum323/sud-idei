import type { AgentAnalysis, AgentId, AppSettings, CaseBundle, CaseStatus, CaseSummary } from "@/shared/types";
import type { NewIdeaInput } from "@/shared/schemas";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером приложения");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Ошибка ${res.status}`, (data as { details?: unknown }).details);
  return data as T;
}

const post = <T>(url: string, body: unknown = {}) => request<T>(url, { method: "POST", body: JSON.stringify(body) });

export const api = {
  settings: () => request<AppSettings>("/api/settings"),
  listCases: (q = "", status: CaseStatus | "all" = "all") =>
    request<CaseSummary[]>(`/api/cases?${new URLSearchParams({ q, status })}`),
  getCase: (id: string) => request<CaseBundle>(`/api/cases/${id}`),
  createCase: (idea: NewIdeaInput) => post<CaseBundle>("/api/cases", idea),
  evidence: (id: string) => post<CaseBundle>(`/api/cases/${id}/evidence`),
  runAgent: (id: string, agentId: AgentId, force = false) => post<AgentAnalysis>(`/api/cases/${id}/agents/${agentId}`, { force }),
  crossExam: (id: string, force = false) => post<CaseBundle>(`/api/cases/${id}/cross-exam`, { force }),
  verdict: (id: string, allowPartial = false) => post<CaseBundle>(`/api/cases/${id}/verdict`, { allowPartial }),
  reopen: (id: string, newGrounds: string, description?: string) =>
    post<CaseBundle>(`/api/cases/${id}/reopen`, { newGrounds, description }),
};

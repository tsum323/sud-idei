/**
 * Минимальные типы среды claude.ai, которыми пользуется страница-артефакт:
 * `sample` (запрос к Claude от имени зрителя) и `db` (хранилище артефакта).
 */
export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export interface SampleOptions {
  modelTier?: "quick" | "default" | "complex";
  effort?: "low" | "medium" | "high";
  cache?: boolean;
  signal?: AbortSignal;
}

export interface SampleFn {
  (input: string, options?: SampleOptions): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
}

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocRef {
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
}

export interface CollectionRef {
  get(): Promise<{ docs: DocSnapshot[] }>;
  doc(id: string): DocRef;
}

export interface ArtifactDb {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
}

interface ClaudeRuntime {
  use(name: "sample"): Promise<SampleFn | null>;
  use(name: "db"): Promise<ArtifactDb | null>;
}

export function runtime(): ClaudeRuntime | null {
  const c = (globalThis as unknown as { claude?: ClaudeRuntime }).claude;
  return c && typeof c.use === "function" ? c : null;
}

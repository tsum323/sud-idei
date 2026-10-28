import "server-only";
import { getConfig } from "./config";
import { CourtService } from "./court/service";
import { getDb } from "./db/db";
import { CourtRepo } from "./db/repo";

const g = globalThis as unknown as { __aiCourtService?: CourtService };

export function getService(): CourtService {
  if (!g.__aiCourtService) {
    const cfg = getConfig();
    // «Зависшим» считается вызов, превысивший все тайм-ауты и повторы с запасом.
    const staleMs = (cfg.timeoutMs + 5_000) * (cfg.retries + 1) + 60_000;
    g.__aiCourtService = new CourtService(new CourtRepo(getDb(), staleMs), cfg);
  }
  return g.__aiCourtService;
}

import type { CaseStatus } from "@/shared/types";

export const STATUS_TEXT: Record<CaseStatus, string> = {
  draft: "Черновик",
  in_progress: "Идёт заседание",
  approved: "Допущена",
  conditional: "Условный допуск",
  rework: "На доработке",
  prison: "В Тюрьме идей",
};

import { describe, expect, it } from "vitest";
import { AGENT_SPRITES, GAVEL_SPRITE, JUDGE_FACES, JUDGE_SPRITE, PALETTE } from "@/components/sprites";
import { AGENT_IDS } from "@/shared/agents";

function check(rows: string[], width: number) {
  for (const r of rows) {
    expect(r.length, r).toBe(width);
    for (const ch of r) if (ch !== ".") expect(PALETTE[ch], `цвет «${ch}»`).toBeDefined();
  }
}

describe("пиксельные спрайты", () => {
  it("у каждого агента свой спрайт 16×16 из общей палитры", () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_SPRITES[id]).toHaveLength(16);
      check(AGENT_SPRITES[id], 16);
    }
    const unique = new Set(AGENT_IDS.map((id) => AGENT_SPRITES[id].join("")));
    expect(unique.size).toBe(AGENT_IDS.length);
  });

  it("спрайты судьи и молотка корректны", () => {
    check(JUDGE_SPRITE, 16);
    for (const f of Object.values(JUDGE_FACES)) check(f, 16);
    check(GAVEL_SPRITE, 10);
  });
});

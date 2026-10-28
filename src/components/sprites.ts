import type { AgentId } from "@/shared/types";

/**
 * Пиксельные спрайты 16×16. Каждый символ — один пиксель, «.» — прозрачный.
 * Палитра общая, поэтому все персонажи выдержаны в одном стиле.
 */
export const PALETTE: Record<string, string> = {
  K: "#1a1026", // контур
  O: "#f08a3c", // тёплое оранжевое тело
  D: "#b85a24", // тень
  L: "#ffc07a", // блик
  W: "#fff4e0", // белки глаз, жабо
  P: "#1a1026", // зрачок
  m: "#6a1f2b", // рот
  R: "#e2483d",
  B: "#4f8fe8",
  Y: "#f2c443",
  G: "#57c26b",
  C: "#3fc1c9",
  V: "#b07be8",
  M: "#ff7fb0",
  S: "#d9d3c4", // седина, парик
  g: "#3b3352", // экран робота
  N: "#2b2346", // мантия
  w: "#7a4a2a", // дерево, волосы
};

const BASE_LEGS = ["..KKDDDDDDDDKK..", ".KOKDDDDDDDDKOK.", ".KK.KDDDDDDK.KK.", "....KDK..KDK....", "....KK....KK...."];

export const AGENT_SPRITES: Record<AgentId, string[]> = {
  prosecutor: [
    "................",
    "....K..K..K.....",
    "....KKKKKKKK....",
    "...KOOOOOOOOK...",
    "...KOLOOOOOOK...",
    "...KKOOOOOOKK...",
    "...KOKKOOKKOK...",
    "...KOWPOOPWOK...",
    "...KOOOOOOOOK...",
    "...KOOKKKKOOK...",
    "...KDOOOOOODK...",
    "..KKDDDRRDDDKK..",
    ".KOKDDDRRDDDKOK.",
    ".KK.KDDRRDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
  advocate: [
    "................",
    "................",
    ".....KKKKKK.....",
    "....KwwwwwOK....",
    "...KwwwwOOOOK...",
    "...KOOOOOOOOK...",
    "...KOWWOOWWOK...",
    "...KOWPOOWPOK...",
    "...KLOOOOOOLK...",
    "...KOKOOOOKOK...",
    "...KDOKKKKODK...",
    "..KKDBBKKBBDKK..",
    ".KOKDDDDDDDDKOK.",
    ".KK.KDDDDDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
  market: [
    "........K.......",
    ".......KOK......",
    ".....KKKKKKK....",
    "....KOOOOOOOK...",
    "...KOLOOOOOOK...",
    "...KOOOOOOOOK...",
    "...KCCCOOCCCK...",
    "...KCPCCOCPCK...",
    "...KCCCOOCCCK...",
    "...KOOOKKOOOK...",
    "...KDOOOOOODK...",
    ...BASE_LEGS,
  ],
  finance: [
    "................",
    "................",
    ".....KKKKKK.....",
    "....KGGGGGGK....",
    "..KGGGGGGGGGGK..",
    "...KKKKKKKKKK...",
    "...KOWWOOWWOK...",
    "...KOWPOOWPOK...",
    "...KOOOOOOOOK...",
    "...KOOOKKOOOK...",
    "...KDOOOOOODK...",
    "..KKDDDDDDDDKK..",
    ".KOKDDDYYDDDKOK.",
    ".KK.KDDYYDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
  tech: [
    "................",
    ".....KKKKKK.....",
    "....KYYYYYYK....",
    "...KYYLYYYYYK...",
    "..KKKKKKKKKKKK..",
    "...KOOOOOOOOK...",
    "...KOWWOOWWOK...",
    "...KOWPOOWPOK...",
    "...KOOOOOOOOK...",
    "...KOOOmmOOOK...",
    "...KDOOOOOODK...",
    "..KKDDDDDDDDKK..",
    ".KOKSSSSSSSSKOK.",
    ".KK.KDDDDDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
  product: [
    ".........KK.....",
    ".....KKKKVVK....",
    "...KKVVVVVVVKK..",
    "..KVVVVVVVVVVVK.",
    "...KOOOOOOOOK...",
    "...KOWWOOWWOK...",
    "...KOPWOOPWOK...",
    "...KOOOOOOOOK...",
    "...KOOOOKKOOK...",
    "...KDOOOOOODK...",
    "..KKDDDDDDDDKK..",
    ".KOKDDDVVDDDKOK.",
    ".KK.KDDDDDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
    "................",
  ],
  growth: [
    "................",
    ".....KKKKKK.....",
    "....KMMMMMMK....",
    "...KMMMMMMMMMMK.",
    "...KKKKKKKKKK...",
    "...KOOOOOOOOK...",
    "...KOWWOOWWOK...",
    "...KOWPOOWPOK...",
    "...KOOOOOOOOK.KK",
    "...KOOKmmKOOKKMK",
    "...KDOKKKKODKKMK",
    "..KKDDDDDDDDKKKK",
    ".KOKDDDDDDDDKOK.",
    ".KK.KDDDDDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
  risk: [
    "................",
    ".....KKKKKK.....",
    "....KRRWWRRK....",
    "...KRRWWRRWWK...",
    "...KKKKKKKKKK...",
    "...KOOKOOKOOK...",
    "...KOWWOOWWOK...",
    "...KOWPOOWPOK...",
    "...KOOOOOOOOKC..",
    "...KOKOKKOKOK...",
    "...KDOOOOOODK...",
    "..KKDDDKKDDDKK..",
    ".KOKDDDYYDDDKOK.",
    ".KK.KDDDDDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
  independent: [
    ".....KKKKKK.....",
    ".....KggggK.....",
    ".....KRRRRK.....",
    "...KKKKKKKKKK...",
    "...KSOOOOOOSK...",
    "...KSKKOOKKSK...",
    "...KOWPOYWPYK...",
    "...KOOOOOOOYK...",
    "...KSSSSSSSSK...",
    "...KSSSKKSSSK...",
    "...KSSSSSSSSK...",
    "..KKDSSSSSSDKK..",
    ".KOKDDSSSSDDKOK.",
    ".KK.KDDSSDDK.KK.",
    "....KDK..KDK....",
    "....KK....KK....",
  ],
};

/** Робот-судья в напудренном парике. Нижняя часть скрыта судейским столом. */
export const JUDGE_SPRITE = [
  ".......YY.......",
  ".......KK.......",
  "..SSKKKKKKKKSS..",
  ".SSSKOOOOOOKSSS.",
  ".SSKOKKKKKKOKSS.",
  ".SSKOKCggCKOKSS.",
  ".SSKOKgCCgKOKSS.",
  ".SSKOKKKKKKOKSS.",
  "..SKOOOOOOOOKS..",
  "..SSKKKKKKKKSS..",
  "...KNNNWWNNNK...",
  "..KNNNNWWNNNNK..",
  "..KNNNNNNNNNNK..",
  "..KNNNNNNNNNNK..",
];

/** Глаза судьи в разных состояниях (строки 5–6 спрайта). */
export const JUDGE_FACES: Record<"idle" | "thinking" | "verdict", [string, string]> = {
  idle: [".SSKOKCggCKOKSS.", ".SSKOKgCCgKOKSS."],
  thinking: [".SSKOKggCCKOKSS.", ".SSKOKgggCKOKSS."],
  verdict: [".SSKOKYggYKOKSS.", ".SSKOKYYYYKOKSS."],
};

export const GAVEL_SPRITE = [
  ".KKKK.....",
  "KwLwwK....",
  "KwwwwKKKKK",
  "KwwwwKwwwK",
  ".KKKK.KKKK",
];

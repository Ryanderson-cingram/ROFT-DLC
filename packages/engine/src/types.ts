export type Phase = "lobby" | "dealing" | "turnStart" | "play" | "afterPlay" | "finished";

export type RulePack = "base" | "gods";
/** 房间配置。由 Edge 在建房时写进 `GameState`，引擎不查库（S1：技能获取 MVP 只有抽 3 选 1）。 */
export interface RoomConfig { rulePack: RulePack; skillDraft: "draft3" }
export type Color = "R" | "G" | "B" | "Y";
/** 牌面。数字牌 0–9；功能牌 +2/停/转；无色牌 变色/+4；诸神包 毒/洗牌。 */
export type Face =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "+2" | "skip" | "rev"
  | "wild" | "+4"
  | "poison" | "shuffle";
/** `color === null` = 无色牌（变色 / +4 / 毒 / 洗牌）。`id` 在一副牌内唯一。 */
export interface Card { id: string; color: Color | null; face: Face }

export interface PendingWindow {
  type: string;
  actors: number[];          // seat 下标
  deadline: string;          // ISO 时间戳（由 Edge 注入的 ctx.now 计算）
  defaultChoice: string;
  resume: Phase;
}
/** 一局开跑后的牌桌。`lobby` 阶段没有牌桌，故 `GameState.board` 可选。 */
export interface Board {
  rulePack: RulePack;
  drawPile: Card[];
  /** `[0]` 是弃牌堆顶。 */
  discardPile: Card[];
  /** 按座位下标。 */
  hands: Card[][];
  /** 跟色比的是这个，不是牌堆顶那张牌的原色（打过变色牌后两者不同）。 */
  activeColor: Color | null;
  currentSeat: number;
  direction: 1 | -1;
  saidUno: boolean[];
  /** S2 一人一技能：持有的技能 id，未持有为 null。持有 ≠ 亮出。 */
  skills: (string | null)[];
  /** V3/V4：亮出后被动才生效、主动才可发动。未亮出的技能对局面毫无影响。 */
  revealed: boolean[];
  /**
   * V7：本回合已发动过一条主动的座位。V6 亮出不占次数、V8 被动触发不占次数，
   * 所以只有「发动」写这里。回合切换时清空。
   */
  activatedThisTurn: boolean[];
  /**
   * 通用计数标记（03 §5）：魂/盗/异/形/颠/陨。按座位存，键是标记名。
   * 做成通用表而不是每技能一个计数器，是因为「颠可当作异/盗/魂/形」本身就要求它们同构。
   */
  marks: Record<string, number>[];
  /**
   * 状态（03 §4）：五彩/恋战/心盲/领域/同命/封印…按座位存。
   * 03 §4 的「负面三者互斥、不叠层」由 statuses 原语统一实施，不在各技能里重复判断。
   */
  statuses: string[][];
  /** U1：刚摸到且可打的那张牌；非 null 时本回合只能打它或结束回合。 */
  drawnPlayable?: Card | null;
  punish?: PunishChain;
  winner?: number;
}
/** P6：每段贡献在打出进链时结算，只作用于自己那一张，所以逐段存。 */
export interface PunishSegment { seat: number; face: "+2" | "+4"; draw: number }
export interface PunishChain { initiator: number; segments: PunishSegment[]; total: number }
export interface GameState {
  version: number;
  phase: Phase;
  seats: { userId: string }[];
  /** 建房时写入。缺省（老房间）按基础包处理。 */
  config?: RoomConfig;
  pendingWindow?: PendingWindow;
  board?: Board;
}
export type Action =
  | { type: "startGame"; seat: number }
  | { type: "playCards"; seat: number; cardIds: string[]; chosenColor?: Color }
  | { type: "drawCard"; seat: number }
  | { type: "endTurn"; seat: number }
  | { type: "claimTimeout"; seat: number; windowId: string }
  | { type: "respond"; seat: number; windowId: string; choice: string }
  /** V1：默认只能在己方回合亮出；V2 的白名单例外由技能定义的 reveal_window 放行。 */
  | { type: "revealSkill"; seat: number }
  /** V7：发动一条主动。`effectKey` 对应 04 标注里的 ①②③，同回合只能选一条。 */
  | { type: "activateSkill"; seat: number; effectKey: string };
export interface EngineEvent {
  type: string;
  public: Record<string, unknown>;
  /** 只给这个座位看的信息（如他摸到的牌）。落 room_events.private_payload，列级 grant 已排除 authenticated。 */
  private?: { seat: number; payload: Record<string, unknown> };
  /**
   * 谁都不发，只为审计与重放留档——典型是洗牌后的牌序。
   * 调研 §4（Fowler: "the response to every external query needs to be remembered"）：
   * 随机的**结果**必须入事件流，否则重放要重新掷骰，历史对不上。
   * 绝不能放进 `public`：那等于把整个牌堆的顺序告诉所有人。
   */
  audit?: Record<string, unknown>;
}
/** 他人只剩公开计数——手牌牌面不进这个结构。 */
export interface SnapshotPlayer {
  seat: number;
  userId: string;
  handCount: number;
  saidUno: boolean;
  /** 本轮恒为 null / 0：技能与神化是下一个计划的事。 */
  skillId: string | null;
  ascensions: number;
}
/** 发给单个座位的视角快照；客户端只渲染它，永远不自己判规则。 */
export interface ClientSnapshot {
  version: number;
  phase: Phase;
  youSeat: number;
  yourHand: Card[];
  players: SnapshotPlayer[];
  currentSeat: number | null;
  direction: 1 | -1;
  activeColor: Color | null;
  discardTop: Card | null;
  drawPileCount: number;
  drawnPlayable?: Card | null;
  punish?: PunishChain;
  pendingWindow?: PendingWindow;
  windowId?: string;
  winner?: number;
  legalActions: Action[];
  /** 按 action 类型给出的「为什么现在不能」人话（UI 的 L2 层）。 */
  disabledReasons: Record<string, string>;
}
export interface Ctx { rng: () => number; now: string }
export interface ApplyResult { state: GameState; events: EngineEvent[]; rejected?: { reason: string } }

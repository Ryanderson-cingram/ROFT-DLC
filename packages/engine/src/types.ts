// ============================================================================
// 引擎共享契约。前端与引擎并行开发的唯一接口面 —— 改这里等于改两边，
// 必须先在这里改（并知会对方），不要在任一侧私自扩字段。
// 规则锚点：docs/knowledge-base/01-decided-rules.md（括号里的 ID 如 U1/P3/G1）
// ============================================================================

// ---------- 牌 ----------
// 牌用紧凑字符串编码，手牌是多重集合（同一张牌可有多张，不需要实例 id）。
// 四色牌：`${Color}${Face}`，如 "R7" "B+2" "Gskip" "Yrev"
// 无色牌：直接是牌种，如 "wild" "+4" "shuffle" "poison"
export type Color = "R" | "B" | "Y" | "G";
export type NumberFace = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type ColoredFace = NumberFace | "+2" | "skip" | "rev";
export type WildCard = "wild" | "+4" | "shuffle" | "poison";
export type Card = `${Color}${ColoredFace}` | WildCard;

// 牌组构成见 05-gods-omens-deck.md §3（满编 172 张）。
// rulePack "base" = 172 − 毒5 − 洗牌3 = 164 张；"gods" 才含毒与洗牌。
export type RulePack = "base" | "gods";
export interface RoomConfig {
  rulePack: RulePack;
  skillDraft: "draft3";        // 抽 3 选 1（S1）；MVP 只有这一种
}

// ---------- 反应窗口（spec §5.2）----------
// 惩罚叠链只是 type 的一种，不做特殊 phase。
export type WindowType = "punishStack" | "interrupt" | "respondReveal" | "pinPoint";
export interface PendingWindow {
  id: string;                  // 确定性生成 `w${version}:${type}`，不用随机数
  type: WindowType;
  actors: number[];            // 待决座位；多人时先到先得（spec §5.2）
  deadline: string;            // ISO；由 ctx.now + 窗口时长算出
  defaultChoice: string;       // 超时/全弃权的解法，一律 = 不响应
  resume: Phase;               // 结算后回到的主流程位置
}

// ---------- 惩罚叠链（P1–P13）----------
export interface PunishSegment {
  seat: number;                // 打出这张的人
  card: "+2" | "+4";
  draw: number;                // 这一段的摸牌数；贡献只作用于自己这张（P6）
}
export interface PunishStack {
  segments: PunishSegment[];
  total: number;               // = sum(draw)，UI 直接显示「累计 N 张」
  initiator: number;           // 链首发起者（P8 血棘 / P12 近卫交牌都认这个）
}

// ---------- 状态 ----------
export type Phase = "lobby" | "dealing" | "turnStart" | "play" | "afterPlay" | "finished";

export interface Seat {
  userId: string;
  name: string;                // 由 Edge 从 profiles 注入；引擎不查库
  hand: Card[];
  saidUno: boolean;
  apotheosis: number;          // 神化枚数 = 本回合额外出牌轮次（G1）
  skillId: string | null;      // 已亮出的技能；未亮出为 null。本轮不实现技能行为
}

export interface GameState {
  version: number;
  phase: Phase;
  config: RoomConfig;
  seats: Seat[];
  currentSeat: number;
  direction: 1 | -1;           // 转牌翻向
  drawPile: Card[];
  discardPile: Card[];         // 末元素为牌顶
  activeColor: Color | null;   // 打出变色/+4 后由打出者指定；数字牌时 = 牌顶颜色
  roundsLeft: number;          // 本回合还剩几轮出牌（神化，G1）
  drawnPlayable: Card | null;  // 摸牌后可立即打出的那一张（U1），否则 null
  punish: PunishStack | null;
  pendingWindow: PendingWindow | null;
  winner: number | null;
}

// ---------- 动作 ----------
// 每个 action 都带 seat（发起者），校验管道统一取用（spec §5.4）。
export type Action =
  | { type: "ping"; seat: number }                                   // 走通骨架用，真实动作齐了就删
  | { type: "startGame"; seat: number; seats: { userId: string; name: string }[]; config: RoomConfig }
  | { type: "playCards"; seat: number; cards: Card[]; chosenColor?: Color }  // 变色/+4 的定色随牌一起提交，不开窗口
  | { type: "drawCard"; seat: number }                               // 无牌可出或选择不打（U1）
  | { type: "endTurn"; seat: number }                                // 摸到的牌不打，结束回合
  | { type: "callUno"; seat: number }
  | { type: "respond"; seat: number; windowId: string; choice: string; cards?: Card[]; chosenColor?: Color }
  | { type: "claimTimeout"; seat: number; windowId: string };        // 客户端催促超时（spec §7）

// ---------- 事件 ----------
// 随机结果一律落事件，重放时读事件不重掷（spec §5.1）。
export interface EngineEvent {
  type: string;
  public: Record<string, unknown>;
  private?: { seat: number; payload: Record<string, unknown> };
}

export interface Ctx {
  rng: () => number;           // Edge 注入的服务端 CSPRNG；引擎自己不产生随机数
  now: string;                 // ISO；引擎不读系统时钟
}

export interface ApplyResult {
  state: GameState;
  events: EngineEvent[];
  rejected?: { reason: string };
}

// ---------- 客户端视角（projectView 的产物）----------
// 这是前端唯一的数据来源。绝不含他人手牌。
export interface PlayerView {
  seat: number;
  name: string;
  handCount: number;
  saidUno: boolean;
  apotheosis: number;
  skillId: string | null;
  isCurrent: boolean;
}

export interface ClientSnapshot {
  version: number;
  phase: Phase;
  youSeat: number;
  config: RoomConfig;
  players: PlayerView[];
  yourHand: Card[];
  discardTop: Card | null;
  activeColor: Color | null;
  direction: 1 | -1;
  drawPileCount: number;
  roundsLeft: number;
  punish: PunishStack | null;
  pendingWindow: (PendingWindow & { youAreActor: boolean }) | null;
  legalActions: Action[];      // HUD 据此高亮可打的牌与可用按钮
  disabledReasons: Record<string, string>;  // 置灰按钮的 L2 文案，如 { callUno: "剩 2 张牌时才需要喊" }
  winner: number | null;
}

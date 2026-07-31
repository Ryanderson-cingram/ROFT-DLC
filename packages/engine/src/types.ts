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
  /**
   * 冻结的窗口 id。缺席 = 按 `windowIdOf` 的默认（由 version 派生）。
   * 只有 U6/U7 那两个「涨版本但保留窗口」的动作会写它，免得抓一次漏喊就把全场
   * 正在响应的人打成 `stale_window`（见 legal.ts::windowIdOf）。
   */
  id?: string;
}
/** 一局开跑后的牌桌。`lobby` 阶段没有牌桌，故 `GameState.board` 可选。 */
export interface Board {
  rulePack: RulePack;
  drawPile: Card[];
  /** 出牌堆：正常打出的牌，`[0]` 是牌顶（跟牌目标）。03 §1 / 06-Q55：牌河分堆。 */
  playedPile: Card[];
  /** 弃牌堆：被技能等弃掉的牌。不影响牌顶与跟色；洗回时与出牌堆（除顶）一起回摸牌堆。 */
  discardPile: Card[];
  /**
   * U8：本局已经洗回摸牌堆几次。缺席 = 0。上限 `MAX_RESHUFFLES`（2）——
   * 洗满之后摸牌堆再见底就是平局（`phase: "finished"` 且 `winner` 缺席）。
   */
  reshuffles?: number;
  /** 按座位下标。 */
  hands: Card[][];
  /** 跟色比的是这个，不是牌堆顶那张牌的原色（打过变色牌后两者不同）。 */
  activeColor: Color | null;
  /**
   * 跟的**牌面**比的是这个。缺席/null = 跟牌堆顶那张牌的牌面（单张出牌一律如此）。
   * 并列♥4 的 4 张/6 张形状里跟牌目标不是堆顶那张（04 ♥4：4 张跟所打的数、6 张跟其中最大的数），
   * 所以要像 `activeColor` 一样显式记一笔，而不是让每个判定点自己去猜堆顶。
   */
  activeFace?: Face | null;
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
   * `once: "once"` 的子效果用掉没有（01-S15 影歌①「整局一次」）。按座位存 effectKey 集合。
   * 缺席 = 谁都还没用过。S18c「重新获得技能则次数重置」到时候清这个座位的表即可。
   */
  usedOnce?: Record<string, true>[];
  /**
   * 状态（03 §4）：五彩/恋战/心盲/领域/同命/封印…按座位存。
   * 03 §4 的「负面三者互斥、不叠层」由 statuses 原语统一实施，不在各技能里重复判断。
   */
  statuses: string[][];
  /**
   * 血棘♦2 的封印记账：谁封的我（null / 缺席 = 没被封）。压制层读的真相仍是
   * `statuses` 里的 `"封印"`，这里只为 01-P14 的两条解除条件服务——「同一血棘至多罩一人」
   * 与「被封者链首打出 +2/+4 才解封」都要知道**是谁封的**，光看状态数组答不出来。
   * 两处同进同出（见 actions/bloodthorn.ts）。
   */
  sealedBy?: (number | null)[];
  /** U1：刚摸到且可打的那张牌；非 null 时本回合只能打它或结束回合。 */
  drawnPlayable?: Card | null;
  punish?: PunishChain;
  /** 影歌①的攒魂窗口挂着时才有；一圈结完即删除。 */
  soulHarvest?: SoulHarvest;
  /** 司夜②的还牌窗口挂着时才有；还完即删除。 */
  swap?: PendingSwap;
  /** 并列♥4 摆到一半被劫营♦10 的窗口打断时才有；摆完或被截即删除。 */
  parallelPending?: ParallelPending;
  /** 洗牌牌（05 §2b）结算到一半时才有；重分完 / 弃完 / 被取消即删除。 */
  shufflePending?: ShufflePending;
  /** 单张出牌摆下之后、结算之前挂着劫营♦10 的窗口时才有；结算或被截即删除。 */
  playPending?: PlayPending;
  /** 缺席 + `phase: "finished"` = **平局**（U8：洗满 2 次后牌堆再度见底且无人打完）。 */
  winner?: number;
  /**
   * S1 抽 3 选 1：`dealing` 阶段每个座位的候选技能 id。选完置空数组；
   * 全员选完整个字段删除。池子小于 3×人数时候选会不足 3 个，甚至为空（该座位无技能开局）。
   */
  draftOptions?: string[][];
}
/**
 * 影歌♦3① 攒魂窗口的上下文（04 ♦3，2026-07-30 补齐）。挂在牌桌上而不是窗口上，
 * 是因为它跨多次 respond 存活（每个响应者结完，窗口重建、上下文顺延），结算后整个删除。
 * 里面没有暗信息：宣言当众、队列与已摸张数都是公开的。
 */
export interface SoulHarvest {
  /** 发动者 */
  seat: number;
  /** 发动者指定的比对牌：色 + 数。不要求他手里真有这张牌，也与牌顶无关。 */
  declared: { color: Color; face: Face };
  /** 还没响应的座位，按行动顺序；`[0]` 是当前 actor。 */
  queue: number[];
  /** 本轮**实际**摸到的总张数（含恩惠减免、含牌堆见底摸不足，06-Q46 口径）。 */
  drawn: number;
  /** 发动的是哪条子效果——数值（摸几张、魂上限）要按它从定义里读。 */
  effectKey: string;
}
/**
 * 司夜♣3② 盲抽之后、还牌之前的上下文（04 ♣3 的 2026-07-30 补齐流程）。
 * 挂在牌桌上而不是窗口上：`cardId` 是**暗信息**（抽到哪张只有双方知道），
 * 而 `PendingWindow` 整个进快照，写进去就等于当众念出来了。
 */
export interface PendingSwap {
  /** 司夜者 */
  seat: number;
  /** 被抽的那个人；还的那张牌回到他手里 */
  target: number;
  /** 刚盲抽走的那张——超时默认还它 */
  cardId: string;
}
/**
 * 并列♥4「先声明、逐张摆」的中间态（01 号 spec 的 2026-07-30 裁定）。
 * 只有被劫营♦10 的 `interrupt` 窗口打断时才存在——场上没有可截的劫营者时整组在一次
 * apply 内摆完，这个字段从头到尾不出现。
 *
 * 挂在牌桌上而不是窗口上：`remaining` 是**还在手上**的牌（未摆的不离手），属暗信息，
 * 而 `PendingWindow` 整个进快照——写进去就等于把并列者剩下要摆什么当众念出来了（同 `PendingSwap`）。
 */
export interface ParallelPending {
  /** 打并列的那个人 */
  seat: number;
  /** 已声明但还没摆的牌 id，按提交顺序；这些牌仍在 `hands[seat]` 里 */
  remaining: string[];
  /** 全部摆完之后的跟牌目标（三形状表算好的）。被截则作废，跟牌目标改由劫营那张定。 */
  follow: { color: Color | null; face: Face | null };
  /**
   * 声明整组时带的定色，续摆要原样透传：它要跟着续摆的 `cardPlayed` 一起发，
   * 否则事件流与牌桌对不上、重放走样。
   * （`sayUno` 曾经也在这里搬运。2026-08-01 二次澄清后「与出牌同时喊」这一档整个不存在了，已删。）
   */
  declared?: { chosenColor?: Color };
}
/**
 * 洗牌牌卡面三选一里能从 `playCards` 打出的两个（05 §2b）。
 * 选项③「取消」是**响应**，只能从 `shuffleCancel` 窗口打出，所以不在这个联合里。
 */
export type ShuffleChoice = "shuffle" | "drawDiscard";
/**
 * 洗牌牌（05 §2b）结算到一半的中间态。挂在**牌桌**上而不是 `PendingWindow` 上：
 * `drawnId` 是暗信息（刚摸到哪张只有自己知道），而 `PendingWindow` 整个进快照，
 * 写进去就等于当众念出来了（同 `PendingSwap`）。
 */
export interface ShufflePending {
  /** 打出洗牌牌的那个人 */
  seat: number;
  /** 打出时选的那一项。摸到牌之后就用不上了，所以选项②开窗口时不再带。 */
  choice?: ShuffleChoice;
  /** 选项②刚摸那张牌的 id——超时默认弃它。 */
  drawnId?: string;
}
/**
 * 单张出牌被劫营♦10 截住之前的中间态（2026-07-31 裁定：任何人打出任何一张牌都可能被截）。
 * 牌已经在 `playedPile[0]` 了，所以只需记住是谁打的、以及强袭①这次要掷几颗骰——
 * 窗口 pass 之后 `play-cards.ts::settlePlay` 拿它把这次出牌的其余结算跑完。
 */
export interface PlayPending { seat: number; dice: number }
/**
 * 挂起的掷骰（强袭♦1② 的接管窗口，04 ♦1 / 06-Q40）。任何一次掷骰之后强袭者都能重掷
 * 同数量并采用他的结果，所以掷骰的动作不能一口气把骰子消费掉——骰子先落在这里，
 * 窗口结算后再按 `resume` 续跑。挂在 `GameState` 上而不是牌桌上：它是流程的挂起点，
 * 与窗口同生共死。里面没有暗信息（骰子当众掷）。
 */
export interface PendingDice {
  /** 原掷骰者 */
  seat: number;
  /** 同 `diceRolled.reason` 的短字符串 */
  reason: string;
  /** 当前结果——被接管后就是接管者掷出的那一组 */
  values: number[];
  resume: ResumeSpec;
}
/**
 * 骰子定了之后要干什么。**必须是可序列化的数据**（不是闭包）：GameState 要存库、要重放。
 * 每个用到掷骰的技能加一个成员，并在 `actions/dice.ts::runResume` 里加一个 case。
 */
export type ResumeSpec =
  /** 强袭①：`seat` 打出的那张 `face` 的段贡献 = 面值 × 点数，进链后照常开惩罚窗口。 */
  | { kind: "assault"; seat: number; face: "+2" | "+4" }
  /**
   * 司夜①：`seat` 打出无色牌后按点数获「盗」。`face: "+4"` = 那张是 +4，获盗结算完
   * 接着开惩罚窗口（窗口只能有一个，所以顺序写死在续跑里）；null = 变色牌，直接交回合。
   */
  | { kind: "nightlord"; seat: number; face: "+4" | null }
  /** 血棘①：`seat` 掷骰放血，`target`（被他封印的那个人）摸等量。 */
  | { kind: "bloodthorn"; seat: number; target: number };
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
  /** 挂起的掷骰。只在 `diceTakeover` 窗口挂着时存在，结算即清。 */
  pendingDice?: PendingDice;
  board?: Board;
}
export type Action =
  | { type: "startGame"; seat: number }
  /**
   * `useSkill`：这次出牌要动用自己的技能才合法（精英♥3 把数字牌当作大 1 点）。
   * 是个显式开关而不是自动生效——精英是**主动**（2026-07-29 裁定，原 Q45），
   * 用不用玩家自己决定，而且要占 V7 的每回合一条主动。牌本来就能打时这个开关无效果。
   */
  /**
   * `useAssault`：这张 +2/+4 的段贡献改由掷骰定倍率（强袭♦1①，面值 × 0/1/2）。
   * 与 `useSkill` 同风格——提交时声明，不做服务端窗口；不带 = 按面值进链。
   * 强袭①不占 V7 的每回合一条主动（06-Q34）。
   */
  /**
   * `shuffleChoice`：洗牌牌的卡面三选一（05 §2b）。与 `chosenColor` 同性质——提交前的
   * 客户端模态，不是服务端窗口，所以不进 `legalActions`。打洗牌**必须**带；别的牌带了是伪造。
   */
  | {
      type: "playCards";
      seat: number;
      cardIds: string[];
      chosenColor?: Color;
      shuffleChoice?: ShuffleChoice;
      useSkill?: boolean;
      useAssault?: boolean;
    }
  /**
   * 司夜♣3②：花 1 盗与 `target` 盲换 1 张（阶段 1，同一阶段可连发多次）。
   * 不是「发动」（06-Q57）：不占 V7 额度、不发 skillActivated——但换不换、和谁换是玩家的选择，
   * 所以引擎上仍是一个动作。还哪张是第二步，走 `swapReturn` 窗口。
   */
  | { type: "stealSwap"; seat: number; target: number }
  /** U6 补喊：不限回合、不被反应窗口挡。 */
  | { type: "callUno"; seat: number }
  /** U7 抓漏喊：任何人不限回合；被抓者摸 2（非惩罚）。 */
  | { type: "catchUno"; seat: number; target: number }
  | { type: "drawCard"; seat: number }
  | { type: "endTurn"; seat: number }
  | { type: "claimTimeout"; seat: number; windowId: string }
  /**
   * `cardIds`：这个选择要连带交出的牌（影歌①亮牌、洗牌③的取消牌）。跟 `chosenColor` 一样是提交前的客户端选择。
   * `chosenColor`：响应里打出的无色牌同样要定色（洗牌③的取消牌，卡面「三选一并决定颜色」）。
   */
  | {
      type: "respond";
      seat: number;
      windowId: string;
      choice: string;
      cardIds?: string[];
      chosenColor?: Color;
    }
  /** V1：默认只能在己方回合亮出；V2 的白名单例外由技能定义的 reveal_window 放行。 */
  | { type: "revealSkill"; seat: number }
  /**
   * V7：发动一条主动。`effectKey` 对应 04 标注里的 ①②③，同回合只能选一条。
   * `cardIds` 是为付代价挑的手牌（恒心弃 1）——跟无色牌的 `chosenColor` 一样，
   * 是提交前的客户端选择，不是服务端窗口；不需要代价的效果不带它。
   */
  /**
   * `declared`：发动时当众宣言的一张「色 + 数」（影歌①的比对对象）。**不要求发动者手里有它**，
   * 也与牌顶无关；限数字牌。要求宣言的效果缺了它 → `declaration_required`。
   */
  | {
      type: "activateSkill";
      seat: number;
      effectKey: string;
      cardIds?: string[];
      declared?: { color: Color; face: Face };
    };
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
  /** 自己的技能自己总看得见（含未亮出）；别人的只有亮出后才非 null。 */
  skillId: string | null;
  /** 亮没亮出是公开信息（亮出动作本身有公开事件）。 */
  revealed: boolean;
  /** 03 §5 的计数标记（魂/盗/…）。获得与花费都有公开事件，所以计数本身是公开信息。 */
  marks: Record<string, number>;
  /** 03 §4 的状态（封印/五彩/…）。赋予与解除都有公开事件，所以状态本身是公开信息。 */
  statuses: string[];
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
  playedTop: Card | null;
  /**
   * 跟牌目标的**牌面**：并列♥4 的 4 张/6 张打完后它不等于 `playedTop.face`
   * （6 张同色跟最大数、4 张同数跟打出者定的色）。UI 拿它写提示，别自己从堆顶推。
   */
  followFace: Face;
  /**
   * 你此刻能不能一次打多张（并列♥4 已亮出且没被压制）。
   * 合法的多张组合会组合爆炸，`legalActions` 不枚举它们——所以这个能力位是 UI
   * 唯一的合法信号。没有它，客户端只能自己判「我有没有并列」，那就破了「客户端零规则」。
   */
  canPlayMultiple: boolean;
  /** 弃牌堆全公开（02 §5），完整给：旧在前、新在后。 */
  discardPile: Card[];
  drawPileCount: number;
  drawnPlayable?: Card | null;
  punish?: PunishChain;
  pendingWindow?: PendingWindow;
  /** 挂起的掷骰：骰子当众掷，点数全公开。`resume` 不进快照——那是引擎的续跑指令。 */
  dice?: { seat: number; reason: string; values: number[] };
  windowId?: string;
  /** `phase === "finished"` 且这里缺席 = 平局，UI 要按「无赢家」写文案（U8）。 */
  winner?: number;
  /** `dealing` 阶段自己的候选技能 id——只有自己的，别人的候选不进快照。 */
  draftOptions?: string[];
  legalActions: Action[];
  /** 按 action 类型给出的「为什么现在不能」人话（UI 的 L2 层）。 */
  disabledReasons: Record<string, string>;
}
export interface Ctx { rng: () => number; now: string }
export interface ApplyResult { state: GameState; events: EngineEvent[]; rejected?: { reason: string } }

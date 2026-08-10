"use client";

import {
  loadedSkills,
  type Action,
  type Card,
  type ClientSnapshot,
  type Color,
  type ShuffleChoice,
} from "@roft/engine";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PileKey } from "@/components/game/card-river";
import { Dock } from "@/components/game/dock";
import { DraftSheet } from "@/components/game/draft-sheet";
import { ErrorModal } from "@/components/game/error-modal";
import { GameOver } from "@/components/game/game-over";
import { LogDrawer } from "@/components/game/log-drawer";
import { PileModal } from "@/components/game/modal";
import { DECLARABLE, PickSheet } from "@/components/game/pick-sheet";
import { Sheet } from "@/components/game/sheet";
import { SkillModal } from "@/components/game/skill-modal";
import { GameTable } from "@/components/game/table";
import { callEdge, humanReason, newIdempotencyKey } from "@/lib/api";
import { isWildCard } from "@/lib/cards";
import { wildColorLockFor } from "@/lib/legal";
import { dockSlots } from "@/lib/dock-slots";
import { buttonLabel } from "@/lib/hud-copy";
import { needsDeclaration } from "@/lib/skills";
import { useGameChannel } from "@/lib/game-channel";
import { createClient } from "@/lib/supabase/client";
import "./game.css";

/** 随出牌一起提交的旗标（提交前的客户端选择，不是服务端窗口）。 */
type PlayFlags = { useSkill?: boolean; useAssault?: boolean; shuffleChoice?: ShuffleChoice };

type Respond = Extract<Action, { type: "respond" }>;

/**
 * **一个待补完的提交**（spec §3.3）：弹一块客户端界面收最后一个输入，收完 `send()` 一次，然后归零。
 *
 * 从前这是五个各自独立的 `useState`——类型上 2^5 = 32 种组合合法、其中 31 种非法，
 * 「至多一个面板」只是调用路径的巧合。收成一个可辨识联合之后它是**类型事实**，
 * 渲染也从五段 `{x && …}` 变成一个 `switch`。
 *
 * 两条不在这里的：
 * - 司夜②还牌 / 洗牌②弃牌也是「从手牌里挑一张」，但它们的真相在**快照**里
 *   （`pendingWindow` + `legalActions` 给的 respond，choice 就是牌 id），
 *   由 `<Hand>` 直接消费，不需要也不该再存一份本地态。
 * - 定色不是独立的一态：`color` / `cancelColor` 两种都由坞的中槽收（`pickColor`）。
 */
type Pending =
  /** 变色 / +4（单张），以及并列 4 张同数：色由打出者选，随 playCards 一起提交。 */
  | { kind: "color"; cards: Card[]; extra?: PlayFlags }
  /** 洗牌牌的卡面三选一：选完接着走定色，两个一起随 playCards 提交。 */
  | { kind: "shuffleChoice"; cards: Card[]; extra?: PlayFlags }
  /** 洗牌③的取消牌也要定色：存下 legalActions 给的那条 respond，选完色再补 chosenColor。 */
  | { kind: "cancelColor"; action: Respond }
  /** 恒心♠1 的弃 1 代价：手牌区直接点选，**不弹面板**（spec §3.4）。 */
  | { kind: "pickFromHand"; effectKey: string }
  /** 影歌♦3①：当众宣言一张色 + 数。 */
  | { kind: "declare"; effectKey: string }
  /**
   * 手牌多选（本地态）：并列♥4 的「多张一起打」与摸 N 弃 N 的「挑 N 张弃掉」共用一个。
   * 两者互斥——弃牌窗口挂着时打不出牌，所以提交口由**窗口类型**决定，不必分成两态。
   */
  | { kind: "pickMany"; picked: string[] };

/** 弹窗类的纯视图态（不含任何待提交的输入）。抽屉常驻 DOM，所以它自己一个 state。 */
type View = { kind: "skill"; seat: number } | { kind: "pile"; which: PileKey } | null;

/** 洗牌牌的卡面三选一里能主动打出的两个（③取消是响应，只能从 shuffleCancel 窗口出）。 */
const SHUFFLE_CHOICES: { value: ShuffleChoice; title: string; note: string }[] = [
  { value: "shuffle", title: "① 洗牌", note: "全体手牌合并打乱，从你的下家起逐张轮流发回。手上有洗牌牌的人可以取消。" },
  { value: "drawDiscard", title: "② 摸一弃一", note: "先摸 1 张，再从手牌里挑 1 张弃进弃牌堆（摸 N 弃 N 的 N = 1）。" },
];

export default function GamePage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();
  const supabase = useMemo(() => createClient(), []);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [view, setView] = useState<View>(null);
  const [logOpen, setLogOpen] = useState(false);

  const { snapshot, error, loaded, send, clearError, reload } = useGameChannel(roomId);

  // 昵称不在快照里（展示数据不进规则层），自己从 room_seats join profiles 取。
  useEffect(() => {
    (async () => {
      const { data: room } = await supabase
        .from("rooms")
        .select("id, status")
        .eq("code", code)
        .maybeSingle();
      if (!room) {
        setMissing(true);
        return;
      }
      if (room.status === "lobby") {
        router.replace(`/room/${code}`);
        return;
      }
      setRoomId(room.id);
      const { data: seats } = await supabase.from("room_seats").select("user_id").eq("room_id", room.id);
      const { data: people } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", (seats ?? []).map((s) => s.user_id));
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.username])));
    })();
  }, [code, router, supabase]);

  /*
    别人点了「再开一局」时，这一页要**自己**回等候室——上面那个 status 检查只在进页面时跑一次。
    `rooms` 已经在 realtime 的 publication 里（0002），RLS 照旧生效（非成员订阅不到）。
  */
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`room-status:${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        ({ new: row }: { new: { status: string } }) => {
          if (row.status === "lobby") router.replace(`/room/${code}`);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, code, router, supabase]);

  if (missing)
    return (
      <main className="wrap stack">
        <h1>没找到这一桌</h1>
        <p className="hint">房间码 {code} 不存在，或者你不在这一桌。</p>
        <p>
          <Link href="/">← 回大厅</Link>
        </p>
      </main>
    );

  if (!snapshot)
    return (
      <main className="wrap stack">
        {/* 还没有牌桌可画时不弹窗：这一页整个就是那句话，弹窗盖上去只会挡住「回等候室」 */}
        <p className="hint">{loaded ? (error?.text ?? "这一桌还没开局。") : "载入牌桌…"}</p>
        <p>
          <Link href={`/room/${code}`}>← 回等候室</Link>
        </p>
      </main>
    );

  /**
   * 再来一局：房间号不变、人不动，上一局的记录清空（spec `2026-08-02-rematch-and-retention`）。
   * 走 `room-action` 但**不是引擎动作**——它在 Edge 里就岔开了，所以不能借 `send()`。
   *
   * 409 = 别人抢先点了：结果一模一样（房间已经回到等候室），所以照样往下走，不当错误报。
   * 成功之后自己 push；其余三个人靠 `rooms` 的 realtime 订阅被动回去。
   *
   * 乐观锁用 `snapshot.version` 而不是另存一份 `rooms.version`：两者**恒等**——
   * `apply_room_action` 与 `restart_room` 都在同一个事务里把 `rooms.version` 与
   * `state.version` 写成同一个数。多存一份只会多一个会过期的副本。
   */
  const restartGame = async () => {
    const res = await callEdge<{ version: number }>("room-action", {
      roomId,
      expectedVersion: snapshot.version,
      idempotencyKey: newIdempotencyKey(),
      action: { type: "restartGame", seat: snapshot.youSeat },
    });
    if (!res.ok && res.status !== 409) throw new Error(humanReason(res.reason));
    router.push(`/room/${code}`);
  };

  /** 返回大厅 = 退出房间：座位交还服务端（防幽灵座位），成功才导航。此刻 status 是 finished，退得掉。 */
  const leaveRoom = async () => {
    const res = await callEdge("leave-room", { roomId });
    if (!res.ok) throw new Error(humanReason(res.reason));
    router.push("/");
  };

  /** 提交并归零——每条待补完的提交都以这一句收场。 */
  const commit = (a: Action) => {
    setPending(null);
    send(a);
  };

  // 变色 / +4 与并列 4 张同数要先在本地定色，颜色随 playCards 一起提交，不额外发请求。
  const submitPlay = (cards: Card[], extra?: PlayFlags) => {
    // 洗牌牌先问卡面三选一（引擎缺了它就拒 shuffle_choice_required），选完再落到下面的定色
    if (cards.length === 1 && cards[0].face === "shuffle" && !extra?.shuffleChoice)
      setPending({ kind: "shuffleChoice", cards, extra });
    else if (cards.length === 4 || (cards.length === 1 && isWildCard(cards[0])))
      setPending({ kind: "color", cards, extra });
    else commit({ type: "playCards", seat: snapshot.youSeat, cardIds: cards.map((c) => c.id), ...extra });
  };

  const nameOf = (seat: number) => names[snapshot.players[seat]?.userId ?? ""] ?? `座位 ${seat + 1}`;

  // 牌桌（轨上的抓漏喊）与命令坞交上来的动作走同一条路：要补客户端输入的先收输入，其余直接发。
  const handleAction = (a: Action) => {
    // 强袭①的「掷骰打」是一条 playCards 动作，走的还是同一条出牌路（+4 照样要先定色）
    if (a.type === "playCards")
      return submitPlay(
        a.cardIds.map((id) => snapshot.yourHand.find((c) => c.id === id)!),
        { useSkill: a.useSkill, useAssault: a.useAssault },
      );
    // 洗牌③：取消牌同样要定色，选色的地方是坞的中槽（不再是模态）
    if (a.type === "respond" && a.choice === "cancel") return setPending({ kind: "cancelColor", action: a });
    // 带弃牌代价的发动（恒心弃 1）先在手牌里挑一张，要宣言的（影歌①）先开宣言盘
    if (a.type === "activateSkill") {
      const skillId = snapshot.players[snapshot.youSeat]?.skillId;
      const eff = skillId
        ? loadedSkills.byId.get(skillId)?.effects?.find((e) => e.key === a.effectKey)
        : undefined;
      // ponytail: 目前只有「弃 1」的代价（恒心）；出现弃 N 的技能时再做多选
      if ((eff?.values?.discard ?? 0) > 0) return setPending({ kind: "pickFromHand", effectKey: a.effectKey });
      if (skillId && needsDeclaration(skillId, a.effectKey))
        return setPending({ kind: "declare", effectKey: a.effectKey });
    }
    send(a);
  };

  /** 定色锁：判据整条来自快照，`lib/legal.ts` 里那一句纯函数（本页零规则）。 */
  const lockedTo = (card?: Card) => wildColorLockFor(snapshot, card);

  /**
   * 定色不弹模态：待定色的那一手交给坞，中槽整个换成四个色块，手牌全程可见（spec §3.4）。
   * `color`（变色 / +4 / 并列 4 张同数）与 `cancelColor`（洗牌③的取消牌）是同一个出口。
   */
  const pickColor =
    pending?.kind === "color" ?
      {
        card: pending.cards[0],
        lockedTo: lockedTo(pending.cards[0]),
        onPick: (color: Color) =>
          commit({
            type: "playCards",
            seat: snapshot.youSeat,
            cardIds: pending.cards.map((c) => c.id),
            chosenColor: color,
            ...pending.extra,
          }),
        onCancel: () => setPending(null),
      }
    : pending?.kind === "cancelColor" ?
      {
        card: snapshot.yourHand.find((c) => c.id === pending.action.cardIds![0])!,
        lockedTo: lockedTo(snapshot.yourHand.find((c) => c.id === pending.action.cardIds![0])),
        onPick: (color: Color) => commit({ ...pending.action, chosenColor: color }),
        onCancel: () => setPending(null),
      }
    : null;

  /** 恒心的弃 1 代价：手牌全部可点，点哪张就随 activateSkill 一起提交。 */
  const costPick =
    pending?.kind === "pickFromHand" ?
      {
        onPick: (card: Card) =>
          commit({
            type: "activateSkill",
            seat: snapshot.youSeat,
            effectKey: pending.effectKey,
            cardIds: [card.id],
          }),
        onCancel: () => setPending(null),
      }
    : null;

  /**
   * 升起面板（`<Sheet>`）开着的两态。`.scrim--table` 只是**视觉上**盖住牌桌，
   * 键盘照样 Tab 得到座位卡的技能徽与抓漏喊按钮——所以这一半整块 `inert`。
   * **底坞不关**：手牌与三槽必须一直可点，那是 `<Sheet>` 之所以非模态的全部理由（spec §3.4）。
   * 全屏的那几个是原生 `<dialog>`，背景 inert 由浏览器负责，不走这条。
   */
  const sheetOpen = pending?.kind === "shuffleChoice" || pending?.kind === "declare";

  return (
    <div className="game-page">
      <GameTable
        snapshot={snapshot}
        nameOf={nameOf}
        names={names}
        roomId={roomId}
        onSkillClick={(seat) => setView({ kind: "skill", seat })}
        onOpenPile={(which) => setView({ kind: "pile", which })}
        inert={sheetOpen}
      />
      <Dock
        snapshot={snapshot}
        nameOf={nameOf}
        onPlay={(card, useSkill) => submitPlay([card], useSkill ? { useSkill: true } : undefined)}
        onPlayMany={(cards) => submitPlay(cards)}
        onAction={handleAction}
        pickColor={pickColor}
        costPick={costPick}
        picked={pending?.kind === "pickMany" ? pending.picked : null}
        onPicked={(picked) => setPending(picked === null ? null : { kind: "pickMany", picked })}
        onSkillClick={() => setView({ kind: "skill", seat: snapshot.youSeat })}
        onExpire={() =>
          snapshot.windowId &&
          send({ type: "claimTimeout", seat: snapshot.youSeat, windowId: snapshot.windowId })
        }
      />
      <LogDrawer
        open={logOpen}
        onOpen={() => setLogOpen(true)}
        onClose={() => setLogOpen(false)}
        roomId={roomId}
        snapshot={snapshot}
        names={names}
      />
      {/* 报错走弹窗。从前这里是一行 `.wrap.hint` 小字，而它排在粘性底坞之后 →
          落在坞下方，手机上要滚到页面最底才看得见（2026-08-10 的真机反馈）。 */}
      {error && <ErrorModal error={error} onClose={clearError} onReload={reload} />}
      {snapshot.phase === "dealing" && (
        <DraftSheet
          options={snapshot.draftOptions ?? []}
          picked={!snapshot.pendingWindow?.actors.includes(snapshot.youSeat)}
          deadline={snapshot.pendingWindow?.deadline}
          onPick={(skillId) =>
            snapshot.windowId &&
            send({ type: "respond", seat: snapshot.youSeat, windowId: snapshot.windowId, choice: skillId })
          }
          onExpire={() =>
            snapshot.windowId &&
            send({ type: "claimTimeout", seat: snapshot.youSeat, windowId: snapshot.windowId })
          }
        />
      )}

      {/* 一个 Pending 一个出口。定色与弃代价已经在坞里收掉了，剩下的两个是升起面板。 */}
      {pending?.kind === "shuffleChoice" && (
        <Sheet
          eyebrow="洗牌"
          title="三选一，然后定色"
          lead="卡面「三选一并决定颜色」。③取消只能在别人打出①时响应，不能主动打。"
          onCancel={() => setPending(null)}
        >
          {SHUFFLE_CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => submitPlay(pending.cards, { ...pending.extra, shuffleChoice: c.value })}
            >
              {c.title}：{c.note}
            </button>
          ))}
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setPending(null)}>
            先不打这张
          </button>
        </Sheet>
      )}
      {pending?.kind === "declare" && (
        <PickSheet
          eyebrow="发动技能"
          title="当众指定一张牌"
          lead="其他人自你的下家起依次比对这张牌：亮同色同数不摸牌，亮同色或同数摸 1 张，不亮摸 3 张。你手里有没有这张牌都可以指定，和牌顶也没关系。"
          cards={DECLARABLE}
          onPick={(card) =>
            commit({
              type: "activateSkill",
              seat: snapshot.youSeat,
              effectKey: pending.effectKey,
              declared: { color: card.color!, face: card.face },
            })
          }
          onCancel={() => setPending(null)}
        />
      )}

      {view?.kind === "skill" && (
        <SkillModal
          {...skillModalProps(snapshot, view.seat, nameOf, (a) => {
            setView(null);
            handleAction(a);
          })}
          nameOf={nameOf}
          onClose={() => setView(null)}
        />
      )}
      {/* 收场弹窗压在最后：它不给 onClose，开着就没得关，别的弹窗留在底下也无所谓 */}
      {snapshot.phase === "finished" && (
        <GameOver
          snapshot={snapshot}
          nameOf={nameOf}
          onRestart={restartGame}
          onLeave={leaveRoom}
          roomHref={`/room/${code}`}
        />
      )}

      {view?.kind === "pile" && (
        <PileModal
          playedPile={snapshot.playedPile}
          discardPile={snapshot.discardPile}
          initial={view.which === "played" ? "play" : "discard"}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}

/**
 * 技能弹窗的入参。别人的那一枚只有信息，自己的那一枚还带发动按钮——
 * 按钮与理由**照抄坞左槽**（`dockSlots`），所以两个入口永远说同一句话、给同一组动作。
 */
function skillModalProps(
  s: ClientSnapshot,
  seat: number,
  nameOf: (seat: number) => string,
  run: (a: Action) => void,
) {
  const p = s.players.find((x) => x.seat === seat);
  const slot = seat === s.youSeat ? dockSlots(s, nameOf).skill : null;
  return {
    skillId: p?.skillId ?? null,
    revealed: !!p?.revealed,
    activatedThisTurn: !!p?.activatedThisTurn,
    marks: p?.marks ?? {},
    marksSpent: p?.marksSpent,
    marksCap: s.marksCap,
    sealedBy: p?.sealedBy,
    reason: slot?.disabled ? slot.reason : undefined,
    actions: (slot?.actions ?? []).map((a, i) => ({
      key: `${a.type}:${i}`,
      label: buttonLabel(a, s, nameOf),
      primary: i === 0,
      onActivate: () => run(a),
    })),
  };
}

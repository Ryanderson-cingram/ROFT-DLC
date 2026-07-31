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
import { ColorSheet } from "@/components/game/color-sheet";
import { DraftSheet } from "@/components/game/draft-sheet";
import { Hud } from "@/components/game/hud";
import { DECLARABLE, PickSheet } from "@/components/game/pick-sheet";
import { isWildCard } from "@/lib/cards";
import { needsDeclaration } from "@/lib/skills";
import { LogPanel } from "@/components/game/log-panel";
import { useGameChannel } from "@/lib/game-channel";
import { createClient } from "@/lib/supabase/client";
import "./game.css";

/** 随出牌一起提交的旗标（提交前的客户端选择，不是服务端窗口）。 */
type PlayFlags = { useSkill?: boolean; useAssault?: boolean; shuffleChoice?: ShuffleChoice };

/** 洗牌牌的卡面三选一里能主动打出的两个（③取消是响应，只能从 shuffleCancel 窗口出）。 */
const SHUFFLE_CHOICES: { value: ShuffleChoice; title: string; note: string }[] = [
  { value: "shuffle", title: "① 洗牌", note: "全体手牌合并打乱，从你的下家起逐张轮流发回。手上有洗牌牌的人可以取消。" },
  { value: "drawDiscard", title: "② 摸一弃一", note: "先摸 1 张，再从手牌里挑 1 张弃进弃牌堆。" },
];

/**
 * 窗口里「可选的是哪几张」一律来自 `legalActions`（choice 就是牌 id）。
 * 司夜②还牌与洗牌②弃牌两个窗口的动作逐字相同，所以共用这一条。
 */
const respondCards = (s: ClientSnapshot): Card[] =>
  s.legalActions.flatMap((a) =>
    a.type === "respond" ? [s.yourHand.find((c) => c.id === a.choice)].filter((c) => !!c) : [],
  );

export default function GamePage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();
  const supabase = useMemo(() => createClient(), []);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  // 要先在本地定色再提交的那一手：变色 / +4（单张），以及并列 4 张同数（色由打出者选）。
  // `extra` 是随这一手一起提交的旗标（精英 useSkill / 强袭 useAssault），定色不能把它弄丢。
  const [wild, setWild] = useState<{ cards: Card[]; extra?: PlayFlags } | null>(null);
  // 发动要付弃牌代价的技能（恒心）：先在本地挑弃哪张，随 activateSkill 一起提交
  const [payingFor, setPayingFor] = useState<string | null>(null);
  // 发动要当众宣言一张色+数的技能（影歌①）：同样是提交前的本地选择
  const [declaring, setDeclaring] = useState<string | null>(null);
  // 洗牌牌的卡面三选一：选完接着走定色，两个一起随 playCards 提交
  const [shuffleAsk, setShuffleAsk] = useState<{ cards: Card[]; extra?: PlayFlags } | null>(null);
  // 洗牌③的取消牌也要定色：先存下 legalActions 给的那条 respond，选完色再补 chosenColor 提交
  const [cancelling, setCancelling] = useState<Extract<Action, { type: "respond" }> | null>(null);

  const { snapshot, error, loaded, send } = useGameChannel(roomId);

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
        <p className="hint">{loaded ? (error ?? "这一桌还没开局。") : "载入牌桌…"}</p>
        <p>
          <Link href={`/room/${code}`}>← 回等候室</Link>
        </p>
      </main>
    );

  // 变色 / +4 与并列 4 张同数要先在本地定色，颜色随 playCards 一起提交，不额外发请求。
  const submitPlay = (cards: Card[], extra?: PlayFlags) => {
    // 洗牌牌先问卡面三选一（引擎缺了它就拒 shuffle_choice_required），选完再落到下面的定色
    if (cards.length === 1 && cards[0].face === "shuffle" && !extra?.shuffleChoice)
      setShuffleAsk({ cards, extra });
    else if (cards.length === 4 || (cards.length === 1 && isWildCard(cards[0]))) setWild({ cards, extra });
    else send({ type: "playCards", seat: snapshot.youSeat, cardIds: cards.map((c) => c.id), ...extra });
  };

  return (
    <div className="game-page">
      <div className="layout">
      <Hud
        snapshot={snapshot}
        names={names}
        onPlay={(card, useSkill) => submitPlay([card], useSkill ? { useSkill: true } : undefined)}
        onPlayMany={(cards) => submitPlay(cards)}
        onAction={(a) => {
          // 强袭①的「掷骰打」是一条 playCards 动作，走的还是同一条出牌路（+4 照样要先定色）
          if (a.type === "playCards")
            return submitPlay(
              a.cardIds.map((id) => snapshot.yourHand.find((c) => c.id === id)!),
              { useSkill: a.useSkill, useAssault: a.useAssault },
            );
          // 洗牌③：取消牌同样要定色，先弹定色模态再把 chosenColor 补进这条 respond
          if (a.type === "respond" && a.choice === "cancel") return setCancelling(a);
          // 带弃牌代价的发动（恒心弃 1）先弹选牌，不带代价的直接发
          if (a.type === "activateSkill") {
            const skillId = snapshot.players[snapshot.youSeat]?.skillId;
            const eff = skillId
              ? loadedSkills.byId.get(skillId)?.effects?.find((e) => e.key === a.effectKey)
              : undefined;
            if ((eff?.values?.discard ?? 0) > 0) {
              setPayingFor(a.effectKey);
              return;
            }
            if (skillId && needsDeclaration(skillId, a.effectKey)) {
              setDeclaring(a.effectKey);
              return;
            }
          }
          send(a);
        }}
        onExpire={() =>
          snapshot.windowId &&
          send({ type: "claimTimeout", seat: snapshot.youSeat, windowId: snapshot.windowId })
        }
      />
      {roomId && <LogPanel roomId={roomId} snapshot={snapshot} names={names} />}
      </div>
      {error && (
        <p className="wrap hint" role="alert" style={{ color: "var(--danger-text)" }}>
          {error}
        </p>
      )}
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
      {/* 司夜♣3②的还牌 */}
      {snapshot.pendingWindow?.type === "swapReturn" &&
        snapshot.pendingWindow.actors.includes(snapshot.youSeat) && (
          <PickSheet
            eyebrow="司夜 · 花盗换牌"
            title="挑一张还给对方"
            lead="刚从对方手里盲抽的那张已经在你手上了。还哪张只有你和对方知道，别人只看得到「换了 1 张」。"
            cards={respondCards(snapshot)}
            onPick={(card) =>
              snapshot.windowId &&
              send({
                type: "respond",
                seat: snapshot.youSeat,
                windowId: snapshot.windowId,
                choice: card.id,
              })
            }
          />
        )}
      {/* 洗牌②的弃牌 */}
      {snapshot.pendingWindow?.type === "shuffleDiscard" &&
        snapshot.pendingWindow.actors.includes(snapshot.youSeat) && (
          <PickSheet
            eyebrow="洗牌 · 摸一弃一"
            title="挑一张牌弃掉"
            lead="刚摸的那张已经在你手上了，弃哪张随你。弃掉的牌进弃牌堆，不改牌顶、不改跟色。不选的话，到点就默认弃掉刚摸的那张。"
            cards={respondCards(snapshot)}
            onPick={(card) =>
              snapshot.windowId &&
              send({
                type: "respond",
                seat: snapshot.youSeat,
                windowId: snapshot.windowId,
                choice: card.id,
              })
            }
          />
        )}
      {shuffleAsk && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="shuffle-title">
          <div className="sheet">
            <p className="eyebrow">洗牌</p>
            <h2 id="shuffle-title">三选一，然后定色</h2>
            <p className="lead">卡面「三选一并决定颜色」。③取消只能在别人打出①时响应，不能主动打。</p>
            {SHUFFLE_CHOICES.map((c) => (
              <button
                key={c.value}
                className="btn btn--primary btn--block"
                onClick={() => {
                  setShuffleAsk(null);
                  submitPlay(shuffleAsk.cards, { ...shuffleAsk.extra, shuffleChoice: c.value });
                }}
              >
                {c.title}：{c.note}
              </button>
            ))}
            <button className="btn btn--ghost btn--block" onClick={() => setShuffleAsk(null)}>
              先不打这张
            </button>
          </div>
        </div>
      )}
      {/* ponytail: 目前只有「弃 1」的代价（恒心）；出现弃 N 的技能时再做多选 */}
      {payingFor && (
        <PickSheet
          eyebrow="发动技能"
          title="挑一张牌弃掉"
          lead="弃掉的牌进弃牌堆，不改牌顶、不改跟色。"
          cards={snapshot.yourHand}
          onPick={(card) => {
            send({
              type: "activateSkill",
              seat: snapshot.youSeat,
              effectKey: payingFor,
              cardIds: [card.id],
            });
            setPayingFor(null);
          }}
          onCancel={() => setPayingFor(null)}
        />
      )}
      {declaring && (
        <PickSheet
          eyebrow="发动技能"
          title="当众指定一张牌"
          lead="其他人自你的下家起依次比对这张牌：亮同色同数不摸牌，亮同色或同数摸 1 张，不亮摸 3 张。你手里有没有这张牌都可以指定，和牌顶也没关系。"
          cards={DECLARABLE}
          layout="declare"
          onPick={(card) => {
            send({
              type: "activateSkill",
              seat: snapshot.youSeat,
              effectKey: declaring,
              declared: { color: card.color!, face: card.face },
            });
            setDeclaring(null);
          }}
          onCancel={() => setDeclaring(null)}
        />
      )}
      {wild && (
        <ColorSheet
          card={wild.cards[0]}
          onPick={(color: Color) => {
            send({
              type: "playCards",
              seat: snapshot.youSeat,
              cardIds: wild.cards.map((c) => c.id),
              chosenColor: color,
              ...wild.extra,
            });
            setWild(null);
          }}
          onCancel={() => setWild(null)}
        />
      )}
      {cancelling && (
        <ColorSheet
          card={snapshot.yourHand.find((c) => c.id === cancelling.cardIds![0])!}
          onPick={(color: Color) => {
            send({ ...cancelling, chosenColor: color });
            setCancelling(null);
          }}
          onCancel={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

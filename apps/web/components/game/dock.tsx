"use client";

import type { Action, Card, ClientSnapshot } from "@roft/engine";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { DockSlots, type PickColor, type Ring } from "./dock-slots";
import { Hand } from "./hand";
import { dockSlots } from "@/lib/dock-slots";
import { buttonLabel, handHint, sayFor, type NameOf } from "@/lib/hud-copy";
import { playableIds } from "@/lib/legal";
import { skillById } from "@/lib/skills";
import { useBump } from "@/lib/use-bump";

type Props = {
  snapshot: ClientSnapshot;
  nameOf: NameOf;
  onPlay: (card: Card, useSkill?: boolean) => void;
  /** 并列♥4：一次多张。合不合形状由服务端判，这里只把选中的牌按点选顺序交上去。 */
  onPlayMany: (cards: Card[]) => void;
  onAction: (action: Action) => void;
  /** 窗口到点：任意成员都能催（spec §7），每个窗口只发一次。 */
  onExpire?: () => void;
  /** 左槽技能徽 → 技能弹窗。 */
  onSkillClick?: () => void;
  /** 待定色的那一手：中槽换成四个色块，手牌全程可见。 */
  pickColor?: PickColor | null;
  /**
   * 并列多打的已选牌 id（按点选顺序）。`null` = 没在多选。
   * 状态住在 `page.tsx` 的 `Pending` 联合里：它决定 `onPlayMany` 的 payload，
   * 那是**提交语义**不是显示语义（spec §3.3）。
   */
  picked: string[] | null;
  onPicked: (picked: string[] | null) => void;
  /** 恒心♠1 的弃 1 代价：手牌进 `pickFromHand` 态，**不弹面板**（spec §3.4）。 */
  costPick?: { onPick: (card: Card) => void; onCancel: () => void } | null;
};

const msLeft = (deadline: string) => Math.max(0, Date.parse(deadline) - Date.now());

/**
 * 倒计时（spec §2 bug 1）。旧实现是 `@keyframes drain 12s` 压住内联宽度，
 * 于是惩罚窗口永远演 12 秒、反应窗口永远演 8 秒，跟真实截止时间没关系。
 * 现在两个读数（坞顶那条线的 `--w`、主按钮外圈的 `--p`）都由 `deadline` 现算，CSS 动画整个删掉。
 */
function useCountdown(deadline: string | undefined, onExpire?: () => void): Ring | null {
  // 服务端预渲染时秒数必然和客户端对不上（时间在走），所以挂载前不出数字。
  const [now, setNow] = useState<number | null>(null);
  // 分母 = 第一次看到这个窗口时的剩余时间（中途进来也有个像样的比例）
  const total = useRef(1);
  const fired = useRef<string | null>(null);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (!deadline) return;
    total.current = Math.max(1, msLeft(deadline));
    setNow(Date.now());
    const tick = setInterval(() => {
      setNow(Date.now());
      // 每个窗口只催一次（去重键就是 deadline）；谁先到谁生效，服务端有乐观锁兜底
      if (msLeft(deadline) === 0 && fired.current !== deadline) {
        fired.current = deadline;
        expire.current?.();
      }
    }, 250);
    return () => clearInterval(tick);
  }, [deadline]);

  if (!deadline) return null;
  if (now === null) return { pct: 100, secs: null, urgent: false };
  const left = Math.max(0, Date.parse(deadline) - now);
  return {
    pct: Math.min(100, (left / total.current) * 100),
    secs: Math.ceil(left / 1000),
    urgent: left <= 5_000,
  };
}

/**
 * 倒计时的语音播报（spec §7.3）：**进入最后 10 秒时只播一次**。
 * 每秒念一遍等于把屏幕阅读器刷屏，读屏用户反而听不清别的；
 * 秒数本身留在 `.ring__secs` 里给眼睛看（那一格是 `aria-hidden`）。
 *
 * 换一个窗口先把上一句清空——两个窗口念出同一句时 live region 的内容没变，
 * 不清空就一个字都播不出来。
 */
function useLastCall(deadline: string | undefined, secs: number | null) {
  const [notice, setNotice] = useState("");
  const fired = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (fired.current !== deadline) {
      fired.current = undefined;
      setNotice("");
    }
    if (deadline === undefined || secs === null || secs > 10 || fired.current === deadline) return;
    fired.current = deadline;
    setNotice(`还剩 ${secs} 秒`);
  }, [deadline, secs]);

  return notice;
}

/**
 * U7b 补喊宽限：交回合后 1 秒内，刚交出回合的那个座位抓不得。返回**此刻仍在宽限里**的座位号
 * （没有就 `undefined`），到点用一次性定时器重渲染，抓按钮自己浮出来。
 *
 * 这不是把规则搬到客户端：引擎的 `catchUno` 另有一道 `uno_grace` 硬拒，这里只是别让一个
 * 按不动的按钮在那一秒里晃。之所以非要客户端接，是因为**宽限到期不改变任何服务端状态**——
 * 没有新快照会被推下来，光等 `legalActions` 那个按钮永远不会出现。
 * 同 `useCountdown`：deadline 进快照，读秒归客户端。
 */
function useUnoGrace(grace: ClientSnapshot["unoGrace"]): number | undefined {
  const until = grace ? Date.parse(grace.until) : 0;
  // `null` = 还没挂载。**render 里一次 `Date.now()` 都不许有**——服务端与客户端的时钟
  // 必然不同，一读就是水合失配。所以首帧两边一律按「还在宽限里」画（宁可按钮晚一帧出来），
  // 真正的时间比较全在 effect 之后。同 `useCountdown` 的 `now === null` 那一档。
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const left = until - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(t);
  }, [until]);

  if (!grace) return undefined;
  return now === null || now < until ? grace.seat : undefined;
}

/**
 * 坞的真实像素高度写回 `--dock-h`（设计稿里的 `syncDockH()`）：
 * 坞顶那条读条、窄屏的堆扇形、只盖牌桌的遮罩都贴着它。值不准 = 这几个元素一起错位。
 *
 * `ResizeObserver` 是主力：**中文 webfont 加载完导致坞变高**是最常见的触发场景，
 * 而 `resize` 事件对它一无所知。`resize` 照旧留着——手机地址栏收放不改坞的尺寸，
 * 只改视口，那一条 RO 也看不见。两个并存，各管各的失败模式。
 */
function useDockHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => {
      const h = ref.current?.offsetHeight;
      if (h != null) document.documentElement.style.setProperty("--dock-h", `${h}px`);
    };
    sync();
    window.addEventListener("resize", sync);
    // ponytail: jsdom 没有 ResizeObserver，测试里退化成「挂载时同步一次 + resize」
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    if (ref.current) ro?.observe(ref.current);
    return () => {
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, []);
  return ref;
}

/**
 * 命令坞（design/mockups/game.html 的 `.dockwrap`）：
 * 手牌 + 一句人话 + 三个固定槽位 + 右上角常驻的 UNO。
 *
 * 页面上唯一的操作区。它自己就是最强的状态提示（坞顶一条状态色的线 + 坞内底色），
 * 所以倒计时不占顶栏，只贴决策点。客户端零规则：能不能点一律看 `legalActions`。
 */
export function Dock({
  snapshot: s,
  nameOf,
  onPlay,
  onPlayMany,
  onAction,
  onExpire,
  onSkillClick,
  pickColor,
  picked,
  onPicked,
  costPick,
}: Props) {
  const w = s.pendingWindow;
  const youAreActor = !!w?.actors.includes(s.youSeat);
  // 抽技能是全屏模态的活，坞歇着（也就不该有倒计时）
  const deadline = w && w.type !== "skillDraft" ? w.deadline : undefined;
  const ring = useCountdown(deadline, onExpire);
  const lastCall = useLastCall(deadline, ring?.secs ?? null);
  const ref = useDockHeight();
  const handCount = useBump(s.yourHand.length);

  const you = s.players.find((p) => p.seat === s.youSeat);
  const skill = skillById(you?.skillId ?? null);
  const sealed = !!you?.statuses.includes("封印");
  // 挑代价牌是**提交前的本地态**，快照里没有，所以 `dockSlots()` 看不见它——
  // 手牌旁那句 `hint` 认得它（`handHint` 收了 costPick），坞里的状态文字就这一处，够了。
  const hint = handHint(s, picked !== null, !!costPick);
  const slots = dockSlots(s, nameOf);
  const say = sayFor(s, nameOf);
  const alert = !!w && w.type !== "skillDraft" && youAreActor;

  // 三档回合状态（令牌里 `body[data-turn]` 驱动坞的边色与呼吸）
  const turn = alert ? "alert" : s.currentSeat === s.youSeat && !w ? "you" : "idle";
  useEffect(() => {
    document.body.dataset.turn = turn;
  }, [turn]);

  /*
    U6（2026-08-01 二次澄清）：喊 UNO 只有两态——已喊 → 静态徽记；未喊 → 常亮可点。
    引擎不做资格拦截，按下即受理，**当场不判也不罚**——它只记下「这回合喊过」。
    唯一的结算在**交回合那一刻**：恰 1 张则成立，不是 1 张则作废 + 罚摸 2（U6 2026-08-02 改判）。
    所以 `risky` 说的是「照现在的手牌数，这一声到回合末会不作数」，是**预警**不是即时代价；
    按钮上那行「罚 2」的小字同日撤掉了（定点上挤着抓漏喊按钮，再加一截就糊成一团），
    提示改由 `aria-label` 承担（读屏照旧听得到）。
    `yourHand.length` 只决定显示哪一态，不参与任何合法性判断。
  */
  const callUno = s.legalActions.find((a) => a.type === "callUno");
  const risky = s.yourHand.length !== 1;
  // 抓漏喊与喊 UNO 是同一件事的正反面，所以贴在同一个定点上（原来长在座位卡里，
  // 那是轨上唯一的按钮，窄屏得先横划找到人才点得到）。有几条画几条，一律看 legalActions——
  // 唯一的例外是 U7b 那 1 秒补喊宽限，见 `useUnoGrace`。
  const graced = useUnoGrace(s.unoGrace);
  const catches = s.legalActions.filter((a) => a.type === "catchUno" && a.target !== graced);

  const submitMany = () => onPlayMany(picked!.map((id) => s.yourHand.find((c) => c.id === id)!));

  return (
    <>
      {/* 坞顶那条读条：position: fixed; bottom: var(--dock-h)，宽度就是剩余时间 */}
      {ring && (
        <div
          className="tickline"
          style={{ "--w": `${ring.pct}%` } as CSSProperties}
          data-urgent={ring.urgent ? "" : undefined}
          aria-hidden="true"
        />
      )}

      <div className="dockwrap" ref={ref}>
        <div className="dockwrap__in">
          <div className="unobar">
            {catches.map((a) => {
              const label = buttonLabel(a, s, nameOf);
              return (
                <button key={label} type="button" className="btn btn--danger" onClick={() => onAction(a)}>
                  {label}
                </button>
              );
            })}
            {you?.saidUno ?
              <span className="uno" data-state="said">
                已喊 UNO
              </span>
            : callUno ?
              <button
                type="button"
                className="uno"
                data-state={risky ? "risky" : undefined}
                aria-label={risky ? "喊 UNO！照现在的手牌数，回合结束时这一声不作数，要罚摸 2 张" : "喊 UNO！"}
                onClick={() => onAction(callUno)}
              >
                UNO!
              </button>
            : null}
          </div>

          <div className="hand-meta">
            <span>
              你的手牌 <b {...handCount}>{s.yourHand.length}</b>
            </span>
            <span>{hint}</span>
          </div>

          <Hand
            snapshot={s}
            picked={picked}
            onPickToggle={(id) =>
              onPicked(picked!.includes(id) ? picked!.filter((x) => x !== id) : [...picked!, id])
            }
            onPickCost={costPick?.onPick}
            onPlay={onPlay}
            onAction={onAction}
          />

          {/* 一句人话是页面唯一的 live region（spec §7.3）。
              外壳固定、只让里面那句随 `key` 重挂：`key={say}` 是「文本一换就重播动效」的
              React 版 display 切换（spec §6），但 aria-live 的元素**自己**被换掉时多数读屏
              不会播——所以 aria-live 挂在常驻的外壳上，重挂的只是它的子节点。 */}
          <div aria-live="polite">
            <p className={`dock__say${alert ? " dock__say--alert" : ""}`} key={say}>
              {say}
            </p>
          </div>
          {/* 倒计时只在最后 10 秒播一次；平时是空的，不占任何视觉空间 */}
          <p className="sr-only" aria-live="polite">
            {lastCall}
          </p>

          <DockSlots
            slots={slots}
            skill={skill}
            sealed={sealed}
            onSkillClick={onSkillClick}
            ring={ring}
            pickColor={pickColor}
            onAction={onAction}
            mainExtra={
              // 弃代价牌：手牌全部可点，中槽只留一条退路（面板与遮罩都没有了）
              costPick ?
                <button type="button" className="btn btn--ghost" onClick={costPick.onCancel}>
                  先不发动
                </button>
                // 并列多打：legalActions 不枚举组合（会爆炸），能不能多打由引擎的 canPlayMultiple 说了算
              : picked === null ?
                s.canPlayMultiple &&
                playableIds(s).size > 0 && (
                  <button type="button" className="btn" onClick={() => onPicked([])}>
                    多张一起打
                  </button>
                )
              : <>
                  {picked.length > 0 && (
                    <button type="button" className="btn btn--primary" onClick={submitMany}>
                      打出 {picked.length} 张
                    </button>
                  )}
                  <button type="button" className="btn btn--ghost" onClick={() => onPicked(null)}>
                    取消多打
                  </button>
                </>
            }
          />
        </div>
      </div>
    </>
  );
}

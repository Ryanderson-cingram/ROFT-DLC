import { describe, expect, it } from "vitest";
import { myUnlockedIds } from "./unlocks";

const row = (p: Record<string, unknown> | null) => ({ public_payload: p });

describe("本局解锁的封泥（挑出属于我的那些）", () => {
  it("按座位挑：别人的那条一枚都不算我的", () => {
    const rows = [row({ seat: 1, ids: ["deflect"] }), row({ seat: 0, ids: ["swift", "faceless"] })];
    expect(myUnlockedIds(rows, 0)).toEqual(["swift", "faceless"]);
    expect(myUnlockedIds(rows, 1)).toEqual(["deflect"]);
    expect(myUnlockedIds(rows, 2)).toEqual([]);
  });

  // payload 的形状变了（引擎改过一次 cardPlayed 的 card → cards）也不许抛：
  // 这份数据画在收场弹窗里，抛一次 = 打完一局整页白屏
  it("payload 缺席 / 不是数组 / 不是字符串都不抛", () => {
    expect(myUnlockedIds([row(null), row({ seat: 0 }), row({ seat: 0, ids: "swift" })], 0)).toEqual([]);
    expect(myUnlockedIds([row({ seat: 0, ids: [1, "swift"] })], 0)).toEqual(["1", "swift"]);
  });

  it("同一枚只算一次", () => {
    const rows = [row({ seat: 0, ids: ["swift"] }), row({ seat: 0, ids: ["swift", "abyss"] })];
    expect(myUnlockedIds(rows, 0)).toEqual(["swift", "abyss"]);
  });
});

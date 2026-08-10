import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext · 开放重定向的闸门", () => {
  it("站内路径原样放行（连着 query 和 hash）", () => {
    expect(safeNext("/room/KX7Q2M")).toBe("/room/KX7Q2M");
    expect(safeNext("/game/KX7Q2M?a=1#b")).toBe("/game/KX7Q2M?a=1#b");
  });

  it("空的落到 fallback", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext(undefined, "/lobby")).toBe("/lobby");
  });

  it("站外地址一律拦下", () => {
    for (const evil of [
      "https://evil.com",
      "http://evil.com",
      "//evil.com",
      "\\\\evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "evil.com",
    ]) {
      expect(safeNext(evil)).toBe("/");
    }
  });

  it("空白与控制字符不能用来偷渡协议相对地址", () => {
    // 浏览器解析 URL 时会把 TAB/LF/CR 删掉，这几个到了地址栏都会变回 //evil.com
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext(" //evil.com")).toBe("/");
    expect(safeNext("\t\thttps://evil.com")).toBe("/");
  });
});

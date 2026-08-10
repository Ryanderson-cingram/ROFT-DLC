import { describe, expect, it } from "vitest";
import { authMessage } from "./auth-copy";

describe("authMessage", () => {
  it("按 code 出人话", () => {
    expect(authMessage({ code: "invalid_credentials", message: "Invalid login credentials" }))
      .toBe("邮箱或密码不对。");
  });

  it("登录失败不透露邮箱存不存在", () => {
    // 同一个 code 同一句话——分开说就等于给了一个查号台
    expect(authMessage({ code: "invalid_credentials", message: "no user" }))
      .toBe(authMessage({ code: "invalid_credentials", message: "wrong password" }));
  });

  it("没有 code 的（断网 / 服务没起来）说网络", () => {
    expect(authMessage({ message: "Failed to fetch" })).toBe("连不上服务器，检查一下网络再试。");
    expect(authMessage(null)).toBe("登录没成功，稍后再试一次。");
  });

  it("邮件额度与请求频率是两个窗口，不能共用一句话", () => {
    // 邮件那条是「每小时 2 封」；说成「等一分钟」会让人一分钟后再点、再吃一个 429
    expect(authMessage({ code: "over_email_send_rate_limit" })).toContain("每小时");
    expect(authMessage({ code: "over_email_send_rate_limit" })).not.toBe(
      authMessage({ code: "over_request_rate_limit" }),
    );
  });

  it("认不出的 code 兜住，但把原文带上", () => {
    expect(authMessage({ code: "mfa_challenge_expired", message: "MFA challenge expired" }))
      .toBe("登录没成功：MFA challenge expired");
  });

  it("一句英文都不许漏出去（已知 code 那一档）", () => {
    for (const code of ["invalid_credentials", "user_already_exists", "weak_password"]) {
      expect(authMessage({ code, message: "SOME ENGLISH" })).not.toContain("SOME ENGLISH");
    }
  });
});

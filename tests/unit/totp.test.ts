import { describe, expect, it } from "vitest";
import "../helpers";
import { base32Decode, base32Encode, hotp, verifyTotp, currentStep, generateSecret } from "@/modules/mfa/totp";

describe("TOTP (RFC 6238 / RFC 4226)", () => {
  const key = Buffer.from("12345678901234567890");
  it("vetores oficiais de HOTP (RFC 4226, apêndice D)", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });
  it("vetores oficiais de TOTP SHA-1 (RFC 6238, 8 dígitos)", () => {
    expect(hotp(key, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(key, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(hotp(key, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });
  it("base32 ida e volta", () => {
    expect(base32Decode(base32Encode(key)).equals(key)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
  it("aceita ±30s, rejeita fora da janela, formato inválido e reuso", () => {
    const secret = generateSecret();
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const code = hotp(base32Decode(secret), step);
    expect(verifyTotp(secret, code, { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, code, { nowMs: now + 30_000 })).toBe(step);
    expect(verifyTotp(secret, code, { nowMs: now + 90_000 })).toBeNull();
    expect(verifyTotp(secret, "12345", { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, code, { nowMs: now, lastStep: step })).toBeNull();
  });
});

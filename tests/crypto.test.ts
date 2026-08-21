import { describe, expect, it } from "vitest";
import { decrypt, encrypt, redactSecrets, safeEqual } from "@/lib/crypto";

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "EAABsbCS1i...a-real-looking-meta-token";
    const { cipher } = encrypt(token);
    expect(cipher).not.toContain(token);
    expect(decrypt(cipher)).toBe(token);
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fresh IV per encryption; identical tokens must not produce identical
    // rows, which would leak that two accounts share a credential.
    const a = encrypt("same-token").cipher;
    const b = encrypt("same-token").cipher;
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("rejects tampered ciphertext instead of returning garbage", () => {
    const { cipher } = encrypt("sensitive");
    const parts = cipher.split(".");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = (data[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64")].join(".");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("embeds the key id so keys can be rotated", () => {
    expect(encrypt("x").cipher.startsWith("vv1.")).toBe(true);
  });
});

describe("redactSecrets", () => {
  it("removes credential-shaped keys", () => {
    const redacted = redactSecrets({
      access_token: "secret-value",
      nested: { client_secret: "another", safe: "keep" },
    });
    expect(JSON.stringify(redacted)).not.toContain("secret-value");
    expect(JSON.stringify(redacted)).not.toContain("another");
    expect(redacted.nested.safe).toBe("keep");
  });

  it("redacts tokens embedded in URL strings", () => {
    const redacted = redactSecrets(
      "https://graph.facebook.com/me?access_token=EAAB123&fields=id",
    );
    expect(redacted).not.toContain("EAAB123");
    expect(redacted).toContain("fields=id");
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal values", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

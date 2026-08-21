import { describe, expect, it } from "vitest";
import { instagramAccountsFrom } from "@/platforms/meta/instagram";
import { facebookAccountsFrom } from "@/platforms/meta/facebook";
import type { MetaPage } from "@/platforms/meta/connect";

/**
 * A Meta login with Facebook Pages but no linked Instagram account is a normal,
 * workable state: Page publishing does not involve Instagram. These assert that
 * such a login still produces usable Facebook connections rather than being
 * rejected wholesale.
 */

const expiresAt = new Date("2026-10-20T00:00:00Z");

const pageWithInstagram: MetaPage = {
  id: "page-1",
  name: "העסק שלי",
  accessToken: "page-token-1",
  instagram: { id: "ig-1", username: "my_business", name: "My Business", avatarUrl: null },
};

const pageWithoutInstagram: MetaPage = {
  id: "page-2",
  name: "עמוד נוסף",
  accessToken: "page-token-2",
};

describe("Meta login mapping", () => {
  it("connects every page, with or without a linked Instagram account", () => {
    const accounts = facebookAccountsFrom([pageWithInstagram, pageWithoutInstagram], expiresAt);
    expect(accounts.map((a) => a.externalId)).toEqual(["page-1", "page-2"]);
    expect(accounts[0]!.tokens.accessToken).toBe("page-token-1");
    expect(accounts[1]!.tokens.expiresAt).toBe(expiresAt);
  });

  it("returns no Instagram accounts, rather than failing, when none are linked", () => {
    // The regression this guards: throwing here discarded the Facebook Pages
    // from the same login, blocking Page publishing over a missing Instagram
    // link that Page publishing does not need.
    expect(instagramAccountsFrom([pageWithoutInstagram], expiresAt)).toEqual([]);
    expect(facebookAccountsFrom([pageWithoutInstagram], expiresAt)).toHaveLength(1);
  });

  it("carries the linked page through onto the Instagram account", () => {
    // Instagram publishing is authorised by the page token, so the association
    // has to survive the mapping.
    const [account] = instagramAccountsFrom([pageWithInstagram, pageWithoutInstagram], expiresAt);
    expect(account).toBeDefined();
    expect(account!.externalId).toBe("ig-1");
    expect(account!.username).toBe("my_business");
    expect(account!.linkedPageId).toBe("page-1");
    expect(account!.tokens.accessToken).toBe("page-token-1");
  });

  it("requests the configured scopes on both platforms", () => {
    const [fb] = facebookAccountsFrom([pageWithInstagram], expiresAt);
    const [ig] = instagramAccountsFrom([pageWithInstagram], expiresAt);
    expect(fb!.tokens.scopes).toContain("pages_manage_posts");
    expect(ig!.tokens.scopes).toContain("instagram_content_publish");
  });
});

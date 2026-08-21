import { afterEach, describe, expect, it } from "vitest";
import { META_SCOPES, metaScopes, metaScopeString } from "@/platforms/meta/scopes";

const original = process.env.META_SCOPES;
afterEach(() => {
  if (original === undefined) delete process.env.META_SCOPES;
  else process.env.META_SCOPES = original;
});

describe("Meta scope configuration", () => {
  it("requests the full documented set by default", () => {
    delete process.env.META_SCOPES;
    expect(metaScopes()).toEqual([...META_SCOPES]);
  });

  it("never requests permissions beyond what publishing and insights need", () => {
    // Least privilege is a stated guarantee, so assert the exact list rather
    // than trusting review to catch a scope quietly added later.
    delete process.env.META_SCOPES;
    expect(metaScopes()).not.toContain("pages_manage_metadata");
    expect(metaScopes()).not.toContain("pages_manage_engagement");
    expect(metaScopes()).not.toContain("business_management");
    expect(metaScopes()).not.toContain("publish_video");
  });

  it("honours a narrowed override, so a login can succeed while permissions are still being enabled", () => {
    process.env.META_SCOPES = "instagram_basic,pages_show_list";
    expect(metaScopes()).toEqual(["instagram_basic", "pages_show_list"]);
    expect(metaScopeString()).toBe("instagram_basic,pages_show_list");
  });

  it("tolerates spaces and trailing commas in the override", () => {
    process.env.META_SCOPES = " instagram_basic , pages_show_list ,, ";
    expect(metaScopes()).toEqual(["instagram_basic", "pages_show_list"]);
  });

  it("falls back to the default when the override is blank", () => {
    process.env.META_SCOPES = "   ";
    expect(metaScopes()).toEqual([...META_SCOPES]);
  });
});

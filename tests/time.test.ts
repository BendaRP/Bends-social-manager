import { describe, expect, it } from "vitest";
import { localParts, parseLocalInput, formatAudience } from "@/lib/time";

describe("Israel timezone handling", () => {
  it("treats Friday and Saturday as the weekend", () => {
    // 2026-08-21 is a Friday, 2026-08-22 a Saturday, 2026-08-23 a Sunday.
    const friday = localParts(new Date("2026-08-21T09:00:00Z"));
    const saturday = localParts(new Date("2026-08-22T09:00:00Z"));
    const sunday = localParts(new Date("2026-08-23T09:00:00Z"));

    expect(friday.dayOfWeek).toBe(5);
    expect(friday.isWeekend).toBe(true);
    expect(saturday.isWeekend).toBe(true);
    // Sunday is a normal working day in Israel and must not be bucketed as
    // weekend — the mistake most scheduling tools make.
    expect(sunday.dayOfWeek).toBe(0);
    expect(sunday.isWeekend).toBe(false);
  });

  it("applies daylight saving time rather than a fixed offset", () => {
    // Israel is UTC+3 in August (IDT) and UTC+2 in January (IST).
    const summer = localParts(new Date("2026-08-21T09:00:00Z"));
    const winter = localParts(new Date("2026-01-21T09:00:00Z"));

    expect(summer.hour).toBe(12);
    expect(winter.hour).toBe(11);
  });

  it("interprets a scheduling input as local wall-clock time", () => {
    // 19:30 in Israel during summer is 16:30 UTC.
    const scheduled = parseLocalInput("2026-08-21T19:30");
    expect(scheduled.toISOString()).toBe("2026-08-21T16:30:00.000Z");

    // And the round trip puts it back where the user typed it.
    expect(localParts(scheduled).hour).toBe(19);
    expect(localParts(scheduled).minute).toBe(30);
  });

  it("keeps a winter schedule at the requested local hour", () => {
    const scheduled = parseLocalInput("2026-01-21T19:30");
    expect(scheduled.toISOString()).toBe("2026-01-21T17:30:00.000Z");
    expect(localParts(scheduled).hour).toBe(19);
  });

  it("formats for display in the audience timezone", () => {
    expect(formatAudience(new Date("2026-08-21T16:30:00Z"), { timeStyle: "short" }))
      .toContain("19:30");
  });
});

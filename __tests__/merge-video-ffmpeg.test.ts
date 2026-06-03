import { describe, it, expect } from "vitest";
import { buildXfadeFilterGraph } from "../trigger/merge-video-ffmpeg";

describe("buildXfadeFilterGraph", () => {
  it("includes acrossfade audio chain when any input has audio", () => {
    const { filterComplex, includeAudio } = buildXfadeFilterGraph(
      [10, 12],
      [true, true],
      "fade"
    );
    expect(includeAudio).toBe(true);
    expect(filterComplex).toContain("xfade=transition=fade");
    expect(filterComplex).toContain("acrossfade=d=1");
    expect(filterComplex).toContain("[aout]");
  });

  it("uses anullsrc for clips without audio", () => {
    const { filterComplex, includeAudio } = buildXfadeFilterGraph(
      [8, 9],
      [true, false],
      "dissolve"
    );
    expect(includeAudio).toBe(true);
    expect(filterComplex).toContain("anullsrc");
    expect(filterComplex).toContain("xfade=transition=dissolve");
  });

  it("omits audio when no inputs have audio tracks", () => {
    const { filterComplex, includeAudio } = buildXfadeFilterGraph(
      [5, 6],
      [false, false],
      "fade"
    );
    expect(includeAudio).toBe(false);
    expect(filterComplex).not.toContain("acrossfade");
    expect(filterComplex).toContain("[vout]");
  });
});

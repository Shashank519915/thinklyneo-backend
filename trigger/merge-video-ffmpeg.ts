/**
 * Pure FFmpeg filter helpers for merge-video (no Trigger/Prisma imports — unit-testable).
 */

export const MERGE_VIDEO_XFADE_DURATION_SEC = 1;

/** Build xfade (video) + acrossfade (audio) filter graph for fade/dissolve merges. */
export function buildXfadeFilterGraph(
  durations: number[],
  hasAudio: boolean[],
  transition: "fade" | "dissolve"
): { filterComplex: string; includeAudio: boolean } {
  const xfadeName = transition === "dissolve" ? "dissolve" : "fade";
  const filterParts: string[] = [];

  let prevVideo = "0:v";
  let offset = Math.max(0, durations[0]! - MERGE_VIDEO_XFADE_DURATION_SEC);
  for (let i = 1; i < durations.length; i++) {
    const outLabel = i === durations.length - 1 ? "vout" : `vx${i}`;
    filterParts.push(
      `[${prevVideo}][${i}:v]xfade=transition=${xfadeName}:duration=${MERGE_VIDEO_XFADE_DURATION_SEC}:offset=${offset}[${outLabel}]`
    );
    prevVideo = outLabel;
    offset += Math.max(0, durations[i]! - MERGE_VIDEO_XFADE_DURATION_SEC);
  }

  const includeAudio = hasAudio.some(Boolean);
  if (includeAudio) {
    for (let i = 0; i < durations.length; i++) {
      const label = `a${i}`;
      if (hasAudio[i]) {
        filterParts.push(
          `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[${label}]`
        );
      } else {
        filterParts.push(
          `anullsrc=r=48000:cl=stereo,atrim=end=${durations[i]},asetpts=PTS-STARTPTS[${label}]`
        );
      }
    }

    let prevAudio = "a0";
    for (let i = 1; i < durations.length; i++) {
      const outLabel = i === durations.length - 1 ? "aout" : `ax${i}`;
      filterParts.push(
        `[${prevAudio}][a${i}]acrossfade=d=${MERGE_VIDEO_XFADE_DURATION_SEC}:c1=tri:c2=tri[${outLabel}]`
      );
      prevAudio = outLabel;
    }
  }

  return { filterComplex: filterParts.join(";"), includeAudio };
}

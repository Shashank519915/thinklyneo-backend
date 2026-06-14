import { NextResponse } from "next/server";
import { blueprintSchema } from "./blueprint";
import { validateBlueprintGraph } from "./blueprint-validate";

export type BlueprintPersistResult =
  | { ok: true; blueprint: ReturnType<typeof blueprintSchema.parse> }
  | { ok: false; response: NextResponse };

/** Validate blueprint JSON before any DB write. */
export function validateBlueprintForPersist(
  raw: unknown,
  opts?: { allowInvalid?: boolean },
): BlueprintPersistResult {
  const parsed = blueprintSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Blueprint invalid", issues: parsed.error.issues },
        { status: 400 },
      ),
    };
  }

  const validation = validateBlueprintGraph(parsed.data, parsed.data.openQuestions);
  if (!validation.valid && !opts?.allowInvalid) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Blueprint graph validation failed",
          issues: validation.issues,
          openQuestions: validation.annotatedOpenQuestions,
        },
        { status: 400 },
      ),
    };
  }

  const blueprint = {
    ...parsed.data,
    openQuestions: validation.annotatedOpenQuestions,
    confidence: validation.valid ? parsed.data.confidence : "draft",
  };

  return { ok: true, blueprint };
}

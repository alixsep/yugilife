import { callSync } from "./core/sync"

import type { RichTextDocument, RichTextLength, RichTextParseResult } from "./contracts/index.js"

export function parseRichText(source: string): RichTextParseResult {
  return callSync("parseRichText", { source })
}

export function plainTextFromRichText(document: RichTextDocument): string {
  return callSync("plainTextFromRichText", { document })
}

export function hasLeadingAuthoredLineFitSplit(source: string | RichTextDocument): boolean {
  return callSync(
    "hasLeadingAuthoredLineFitSplit",
    typeof source === "string" ? { source } : { document: source },
  )
}

export function graphemeCount(text: string): number {
  return callSync("graphemeCount", { text })
}

export function richTextLineLengths(source: string): readonly number[] {
  return callSync("richTextLineLengths", { source })
}

export function richTextHasFormatting(document: RichTextDocument): boolean {
  return callSync("richTextHasFormatting", { document })
}

export function parseRichTextLength(
  value: string,
  allowNegative = false,
): RichTextLength | undefined {
  return (
    callSync<RichTextLength | null>("parseRichTextLength", { allowNegative, value }) ?? undefined
  )
}

export function parseRichTextScale(value: string): number | undefined {
  return callSync<number | null>("parseRichTextScale", { value }) ?? undefined
}

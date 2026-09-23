import type { CardData, CardFieldValue } from "yugilife-core"

const catalogSchemaVersion = 2
const frames = [
  "normal",
  "effect",
  "ritual",
  "fusion",
  "synchro",
  "xyz",
  "link",
  "token",
  "spell",
  "trap",
  "normal_pendulum",
  "effect_pendulum",
  "ritual_pendulum",
  "fusion_pendulum",
  "synchro_pendulum",
  "xyz_pendulum",
] as const
const attributes = ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"] as const
const subtypes = [
  "Normal",
  "Continuous",
  "Counter",
  "Equip",
  "Field",
  "Quick-Play",
  "Ritual",
] as const
const arrowValues = [
  "left-center",
  "top-left",
  "top-center",
  "top-right",
  "right-center",
  "bottom-right",
  "bottom-center",
  "bottom-left",
] as const

type CatalogFrame = (typeof frames)[number]

export interface CardCatalogEntry {
  artworkIds: readonly number[]
  attack?: number
  attribute?: (typeof attributes)[number]
  defense?: number
  description: string
  frame: CatalogFrame
  konamiCid?: number
  level?: number
  linkArrowMask?: number
  name: string
  passcode?: string
  pendulumEffect?: string
  scale?: number
  subtype?: (typeof subtypes)[number]
  sourceId: number
  types?: readonly string[]
}

export interface CardCatalog {
  entries: readonly CardCatalogEntry[]
}

function failure(message: string): never {
  throw new Error(`Invalid card catalog: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    failure(`${context} has unexpected keys`)
  }
}

function safeInteger(value: unknown, context: string, minimum = 0, maximum = 999_999_999) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    failure(`${context} must be an integer from ${minimum} through ${maximum}`)
  }
  return Number(value)
}

function optionalInteger(value: unknown, context: string, minimum = 0, maximum = 99_999) {
  return value === null ? undefined : safeInteger(value, context, minimum, maximum)
}

function stringValue(value: unknown, context: string, maximumLength = 20_000) {
  if (typeof value !== "string" || value.length > maximumLength) {
    failure(`${context} must be a string no longer than ${maximumLength} characters`)
  }
  return value
}

function dictionary(value: unknown, expected: readonly string[] | undefined, context: string) {
  if (!Array.isArray(value) || value.length === 0) failure(`${context} must be a non-empty array`)
  const entries = value.map((entry, index) => stringValue(entry, `${context}[${index}]`, 100))
  if (new Set(entries).size !== entries.length) failure(`${context} contains duplicates`)
  if (
    expected &&
    (entries.length !== expected.length ||
      entries.some((entry, index) => entry !== expected[index]))
  ) {
    failure(`${context} does not match schema ${catalogSchemaVersion}`)
  }
  return entries
}

function rowHead(row: unknown, context: string) {
  if (!Array.isArray(row)) failure(`${context} must be an array`)
  const sourceId = safeInteger(row[0], `${context}[0]`)
  const name = stringValue(row[1], `${context}[1]`, 500)
  if (!name) failure(`${context}[1] must not be empty`)
  return { name, row, sourceId }
}

function lookup<T>(values: readonly T[], index: unknown, context: string): T {
  return values[safeInteger(index, context, 0, values.length - 1)] as T
}

function optionalLookup<T>(values: readonly T[], index: unknown, context: string): T | undefined {
  return index === null ? undefined : lookup(values, index, context)
}

function typeValues(typeDictionary: readonly string[], value: unknown, context: string) {
  if (!Array.isArray(value) || value.length > 16) {
    failure(`${context} must contain no more than 16 type IDs`)
  }
  const result = value.map((entry, index) => lookup(typeDictionary, entry, `${context}[${index}]`))
  if (new Set(result).size !== result.length) failure(`${context} contains duplicates`)
  return result
}

function decodeRow(
  frame: CatalogFrame,
  value: unknown,
  typeDictionary: readonly string[],
  identitiesBySourceId: ReadonlyMap<number, { artworkIds: readonly number[]; konamiCid: number }>,
  index: number,
): CardCatalogEntry {
  const context = `g.${frame}[${index}]`
  const { name, row, sourceId } = rowHead(value, context)
  const identity = identitiesBySourceId.get(sourceId)
  const base = {
    artworkIds: identity?.artworkIds ?? [],
    description: "",
    frame,
    ...(identity ? { konamiCid: identity.konamiCid } : {}),
    name,
    ...(sourceId <= 99_999_999 ? { passcode: displayId(sourceId) } : {}),
    sourceId,
  }

  if (frame === "spell" || frame === "trap") {
    if (row.length !== 4) failure(`${context} must contain 4 values`)
    return {
      ...base,
      description: stringValue(row[3], `${context}[3]`),
      subtype: lookup(subtypes, row[2], `${context}[2]`),
    }
  }
  if (frame === "token") {
    if (row.length !== 3) failure(`${context} must contain 3 values`)
    return { ...base, description: stringValue(row[2], `${context}[2]`) }
  }

  const pendulum = frame.endsWith("_pendulum")
  const link = frame === "link"
  const expectedLength = link ? 7 : pendulum ? 10 : 8
  if (row.length !== expectedLength) failure(`${context} must contain ${expectedLength} values`)
  const attack = optionalInteger(row[5], `${context}[5]`, -1)
  const attribute = optionalLookup(attributes, row[2], `${context}[2]`)
  const common = {
    ...base,
    description: stringValue(row[4], `${context}[4]`),
    types: typeValues(typeDictionary, row[3], `${context}[3]`),
    ...(attack === undefined ? {} : { attack }),
    ...(attribute === undefined ? {} : { attribute }),
  }
  if (link) {
    return {
      ...common,
      linkArrowMask: safeInteger(row[6], `${context}[6]`, 1, 255),
    }
  }
  const defense = optionalInteger(row[6], `${context}[6]`, -1)
  const level = optionalInteger(row[7], `${context}[7]`, 0, 99)
  return {
    ...common,
    ...(defense === undefined ? {} : { defense }),
    ...(level === undefined ? {} : { level }),
    ...(pendulum
      ? {
          pendulumEffect: stringValue(row[9], `${context}[9]`),
          scale: safeInteger(row[8], `${context}[8]`, 0, 99),
        }
      : {}),
  }
}

export function parseCardCatalog(source: string, expectedRecordCount?: number): CardCatalog {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    failure("document is not valid JSON")
  }
  if (!isRecord(parsed)) failure("document must be an object")
  exactKeys(parsed, ["v", "a", "s", "t", "g", "i"], "document")
  if (parsed.v !== catalogSchemaVersion) failure(`unsupported schema version ${String(parsed.v)}`)
  dictionary(parsed.a, attributes, "a")
  dictionary(parsed.s, subtypes, "s")
  const typeDictionary = dictionary(parsed.t, undefined, "t")
  if (!isRecord(parsed.g)) failure("g must be an object")
  exactKeys(parsed.g, frames, "g")
  if (!isRecord(parsed.i)) failure("i must be an object")

  const identitiesBySourceId = new Map<
    number,
    { artworkIds: readonly number[]; konamiCid: number }
  >()
  const assignedArtworkIds = new Set<number>()
  for (const [rawId, rawIdentity] of Object.entries(parsed.i)) {
    if (!/^(0|[1-9]\d*)$/.test(rawId)) failure(`i.${rawId} is not a canonical source ID`)
    const sourceId = safeInteger(Number(rawId), `i.${rawId}`)
    if (!Array.isArray(rawIdentity) || rawIdentity.length !== 2) {
      failure(`i.${rawId} must contain a Konami CID and artwork IDs`)
    }
    const konamiCid = safeInteger(rawIdentity[0], `i.${rawId}[0]`, 1)
    const rawArtworkIds: unknown = rawIdentity[1]
    if (!Array.isArray(rawArtworkIds)) failure(`i.${rawId}[1] must be an artwork ID array`)
    const artworkIds = rawArtworkIds.map((value, index) =>
      safeInteger(value, `i.${rawId}[1][${index}]`, 1),
    )
    if (new Set(artworkIds).size !== artworkIds.length) {
      failure(`i.${rawId} contains a duplicate artwork ID`)
    }
    for (const artworkId of artworkIds) {
      if (assignedArtworkIds.has(artworkId)) {
        failure(`artwork ID ${artworkId} is assigned to more than one card`)
      }
      assignedArtworkIds.add(artworkId)
    }
    identitiesBySourceId.set(sourceId, { artworkIds, konamiCid })
  }

  const entries: CardCatalogEntry[] = []
  const ids = new Set<number>()
  const names = new Set<string>()
  const normalizedNames = new Set<string>()
  for (const frame of frames) {
    const rows = parsed.g[frame]
    if (!Array.isArray(rows)) failure(`g.${frame} must be an array`)
    rows.forEach((row, index) => {
      const entry = decodeRow(frame, row, typeDictionary, identitiesBySourceId, index)
      if (ids.has(entry.sourceId)) failure(`duplicate source ID ${entry.sourceId}`)
      if (names.has(entry.name)) failure(`duplicate card name ${entry.name}`)
      const normalizedName = entry.name.normalize("NFKC").toLocaleLowerCase("en-US")
      if (normalizedNames.has(normalizedName)) {
        failure(`duplicate normalized card name ${entry.name}`)
      }
      ids.add(entry.sourceId)
      names.add(entry.name)
      normalizedNames.add(normalizedName)
      entries.push(entry)
    })
  }
  if (expectedRecordCount !== undefined && entries.length !== expectedRecordCount) {
    failure(`expected ${expectedRecordCount} records but found ${entries.length}`)
  }
  for (const sourceId of identitiesBySourceId.keys()) {
    if (!ids.has(sourceId)) failure(`artwork mapping references missing source ID ${sourceId}`)
  }
  return { entries }
}

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function displayId(id: number) {
  const value = String(id)
  return value.length <= 8 ? value.padStart(8, "0") : value
}

interface SearchableEntry {
  entry: CardCatalogEntry
  identifiers: readonly string[]
  name: string
}

export interface CardCatalogSearch {
  search: (query: string, limit?: number) => readonly CardCatalogEntry[]
}

export function createCardCatalogSearch(catalog: CardCatalog): CardCatalogSearch {
  const entries: SearchableEntry[] = catalog.entries.map((entry) => ({
    entry,
    identifiers: [
      String(entry.sourceId),
      ...(entry.passcode ? [entry.passcode] : []),
      ...(entry.konamiCid === undefined ? [] : [String(entry.konamiCid)]),
    ],
    name: normalized(entry.name),
  }))
  return {
    search(query, limit = 30) {
      const trimmed = query.trim()
      if (!trimmed || limit <= 0) return []
      if (/^\d+$/.test(trimmed)) {
        const matches = entries
          .filter((entry) => entry.identifiers.some((id) => id.startsWith(trimmed)))
          .sort(
            (left, right) =>
              Number(right.identifiers.includes(trimmed)) -
                Number(left.identifiers.includes(trimmed)) ||
              left.entry.sourceId - right.entry.sourceId,
          )
        return matches.slice(0, limit).map(({ entry }) => entry)
      }

      const needle = normalized(trimmed)
      if (!needle) return []
      return entries
        .flatMap((candidate) => {
          if (candidate.name === needle) return [{ candidate, score: 0 }]
          if (candidate.name.startsWith(needle)) return [{ candidate, score: 1 }]
          if (candidate.name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(needle))) {
            return [{ candidate, score: 2 }]
          }
          return candidate.name.includes(needle) ? [{ candidate, score: 3 }] : []
        })
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.candidate.name.localeCompare(right.candidate.name) ||
            left.candidate.entry.sourceId - right.candidate.entry.sourceId,
        )
        .slice(0, limit)
        .map(({ candidate }) => candidate.entry)
    },
  }
}

function statText(value: number | undefined) {
  if (value === undefined) return ""
  return value === -1 ? "?" : String(value)
}

function arrowsFromMask(mask: number) {
  return arrowValues.filter((_arrow, index) => (mask & (128 >> index)) !== 0)
}

function bitCount(value: number) {
  let remaining = value
  let count = 0
  while (remaining !== 0) {
    count += remaining & 1
    remaining >>>= 1
  }
  return count
}

/**
 * Replaces only the artwork pair, preserving every authored text field. Field names stay in this
 * adapter so the catalog UI never needs to know the active template's vocabulary.
 */
export function cardCatalogArtworkPatch(
  artwork: Blob | "" = "",
): Readonly<Record<string, CardFieldValue>> {
  return { artwork, artworkOverlay: "" }
}

export function cardCatalogEntryPatch(
  entry: CardCatalogEntry,
  artwork: Blob | "" = "",
  artworkMask: Blob | "" = "",
): CardData {
  const cardVariant = entry.frame.replace("_pendulum", "")
  const common: CardData = {
    artwork,
    artworkOverlay: artworkMask,
    cardCode: "",
    cardVariant,
    edition: "",
    name: entry.name,
    serialNumber: entry.passcode ?? "",
  }
  if (entry.frame === "spell" || entry.frame === "trap") {
    return {
      ...common,
      description: entry.description,
      spellTrapType: entry.subtype?.toLocaleLowerCase("en-US"),
    }
  }
  if (entry.frame === "token") return { ...common, description: entry.description }

  const monster: CardData = {
    ...common,
    attack: statText(entry.attack),
    attribute: entry.attribute,
    description: entry.description,
    pendulum: entry.frame.endsWith("_pendulum"),
    types: [...(entry.types ?? [])],
  }
  if (entry.frame === "link") {
    const linkArrows = arrowsFromMask(entry.linkArrowMask ?? 0)
    return { ...monster, link: bitCount(entry.linkArrowMask ?? 0), linkArrows }
  }
  const levelField = cardVariant === "xyz" ? "rank" : "level"
  return {
    ...monster,
    defense: statText(entry.defense),
    [levelField]: entry.level,
    ...(entry.frame.endsWith("_pendulum")
      ? {
          pendulumEffect: entry.pendulumEffect ?? "",
          scales: [entry.scale, entry.scale],
        }
      : {}),
  }
}

export { catalogSchemaVersion, displayId }

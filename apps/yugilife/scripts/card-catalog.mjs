import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib"

const format = "yugilife/card-catalog"
const schemaVersion = 2
const frameOrder = [
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
]
const supportedFrames = new Set(frameOrder)
const knownUnsupportedFrames = new Set(["skill"])
const attributes = ["DARK", "LIGHT", "EARTH", "WATER", "FIRE", "WIND", "DIVINE"]
const subtypes = ["Normal", "Continuous", "Counter", "Equip", "Field", "Quick-Play", "Ritual"]
const arrowOrder = [
  "Left",
  "Top-Left",
  "Top",
  "Top-Right",
  "Right",
  "Bottom-Right",
  "Bottom",
  "Bottom-Left",
]
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const defaultInput = join(repositoryRoot, "materials/db/yugioh_cards.json")
const defaultArtworkIndex = join(repositoryRoot, "materials/db/artwork-index.json")
const defaultPublicDirectory = join(repositoryRoot, "apps/yugilife/public/card-catalog")
const defaultReport = join(repositoryRoot, "apps/yugilife/generated/card-catalog-report.json")

function fail(message) {
  throw new Error(message)
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value, field, card, maximumLength = 20_000) {
  if (typeof value !== "string") fail(`${card.name || card.id}: ${field} must be a string`)
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
  if (normalized.length > maximumLength) {
    fail(`${card.name || card.id}: ${field} exceeds ${maximumLength} characters`)
  }
  return normalized
}

function integer(
  value,
  field,
  card,
  { maximum = 999_999_999, minimum = 0, nullable = false } = {},
) {
  if (nullable && value == null) return null
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${card.name || card.id}: ${field} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function stableCompare(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function subtypeFor(card, anomalies) {
  if (subtypes.includes(card.race)) return card.race
  const match =
    typeof card.humanReadableCardType === "string"
      ? subtypes.find(
          (subtype) =>
            card.humanReadableCardType ===
            `${subtype} ${card.frameType === "spell" ? "Spell" : "Trap"}`,
        )
      : undefined
  if (!match)
    fail(`${card.name}: unsupported ${card.frameType} subtype ${JSON.stringify(card.race)}`)
  anomalies.push({
    id: card.id,
    kind: "inferred-subtype",
    message: `Used ${match} from humanReadableCardType because race was missing.`,
    name: card.name,
  })
  return match
}

// YGOPRODeck wraps Normal Monster flavor text in a pair of apostrophes that the printed card does
// not have. Only a complete, unambiguous wrapper is removed, so quotation marks and apostrophes that
// belong to the flavor text itself survive.
function flavorText(value, card, anomalies) {
  const trimmed = value.trim()
  if (!trimmed.startsWith("''") || !trimmed.endsWith("''") || trimmed.length < 4) return value
  const inner = trimmed.slice(2, -2)
  if (inner.includes("''")) return value
  anomalies.push({
    id: card.id,
    kind: "unwrapped-flavor-text",
    message: "Removed the source's apostrophe wrapper from Normal Monster flavor text.",
    name: card.name,
  })
  return inner.trim()
}

function linkMask(card) {
  if (!Array.isArray(card.linkmarkers) || card.linkmarkers.length === 0) {
    fail(`${card.name}: Link card has no linkmarkers`)
  }
  const unique = new Set(card.linkmarkers)
  if (unique.size !== card.linkmarkers.length) fail(`${card.name}: duplicate Link marker`)
  let mask = 0
  for (const marker of unique) {
    const index = arrowOrder.indexOf(marker)
    if (index < 0) fail(`${card.name}: unsupported Link marker ${JSON.stringify(marker)}`)
    mask |= 128 >> index
  }
  const linkValue = integer(card.linkval, "linkval", card, { maximum: 8 })
  if (linkValue !== unique.size) {
    fail(`${card.name}: linkval ${card.linkval} does not match ${unique.size} unique markers`)
  }
  return mask
}

function validatedImages(card) {
  if (
    !Array.isArray(card.card_images) ||
    card.card_images.length === 0 ||
    card.card_images.length > 32
  ) {
    fail(`${card.name}: card_images must contain the primary artwork ID`)
  }
  const ids = card.card_images.map((image, index) => {
    if (!isRecord(image)) fail(`${card.name}: card_images[${index}] must be an object`)
    return integer(image.id, `card_images[${index}].id`, card)
  })
  if (ids[0] !== card.id) fail(`${card.name}: primary artwork ID does not match card ID`)
  if (new Set(ids).size !== ids.length) fail(`${card.name}: duplicate artwork ID`)
  return ids
}

function artworkMappings(sourceBytes, acceptedIds) {
  let parsed
  try {
    parsed = JSON.parse(sourceBytes.toString("utf8"))
  } catch (error) {
    fail(
      `Unable to parse artwork index JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== "yugilife/artwork-mapping" ||
    parsed.schemaVersion !== 2 ||
    !Array.isArray(parsed.cards) ||
    !Array.isArray(parsed.artworks)
  ) {
    fail("Artwork index must be a yugilife/artwork-mapping schemaVersion 2 document")
  }
  if (parsed.artworks.length > 100_000) fail("Artwork index contains more than 100,000 rows")

  const seenArtworkIds = new Set()
  const mappings = new Map()
  const absentPasscodes = new Set()
  let unavailableCount = 0
  for (const [index, row] of parsed.cards.entries()) {
    const context = `cards[${index}]`
    if (!isRecord(row)) fail(`${context} must be an object`)
    if (typeof row.konamiCid !== "string" || !/^[1-9]\d{0,8}$/.test(row.konamiCid)) {
      fail(`${context}.konamiCid must be a canonical positive integer string`)
    }
    if (row.passcode === null) continue
    if (typeof row.passcode !== "string" || !/^\d{8}$/.test(row.passcode)) {
      fail(`${context}.passcode must be null or exactly eight digits`)
    }
    const passcode = Number(row.passcode)
    if (!acceptedIds.has(passcode)) continue
    if (mappings.has(passcode)) fail(`Artwork index contains duplicate passcode ${row.passcode}`)
    mappings.set(passcode, { artworkIds: [], cardCid: Number(row.konamiCid) })
  }
  for (const [index, row] of parsed.artworks.entries()) {
    const context = `artworks[${index}]`
    if (!isRecord(row)) fail(`${context} must be an object`)
    if (typeof row.artworkId !== "string" || !/^[1-9]\d{0,8}$/.test(row.artworkId)) {
      fail(`${context}.artworkId must be a canonical positive integer string`)
    }
    const artworkId = Number(row.artworkId)
    if (!Number.isSafeInteger(artworkId))
      fail(`${context}.artworkId exceeds the safe integer range`)
    if (seenArtworkIds.has(artworkId))
      fail(`Artwork index contains duplicate artwork ID ${artworkId}`)
    seenArtworkIds.add(artworkId)
    if (typeof row.cardCid !== "string" || !/^[1-9]\d{0,8}$/.test(row.cardCid)) {
      fail(`${context}.cardCid must be a canonical positive integer string`)
    }
    const cardCid = Number(row.cardCid)
    if (!Number.isSafeInteger(cardCid)) fail(`${context}.cardCid exceeds the safe integer range`)
    if (typeof row.passcode !== "string" || !/^\d{8}$/.test(row.passcode)) {
      fail(`${context}.passcode must contain exactly eight digits`)
    }
    if (typeof row.mediaReady !== "boolean" || typeof row.classification !== "string") {
      fail(`${context} must contain mediaReady and classification values`)
    }
    if (!row.mediaReady || row.classification !== "processable") {
      unavailableCount += 1
      continue
    }
    const passcode = Number(row.passcode)
    if (!acceptedIds.has(passcode)) {
      absentPasscodes.add(row.passcode)
      continue
    }
    const existing = mappings.get(passcode)
    if (!existing) fail(`${context} has no matching card identity row`)
    if (existing && existing.cardCid !== cardCid) {
      fail(`passcode ${row.passcode} maps to conflicting Konami CIDs`)
    }
    existing.artworkIds.push(artworkId)
  }
  const encoded = {}
  for (const [passcode, value] of [...mappings].sort(([left], [right]) => left - right)) {
    encoded[passcode] = [value.cardCid, value.artworkIds.sort((left, right) => left - right)]
  }
  return {
    absentPasscodes: [...absentPasscodes].sort(stableCompare),
    encoded,
    includedCount: [...mappings.values()].reduce(
      (total, value) => total + value.artworkIds.length,
      0,
    ),
    recordCount: parsed.artworks.length,
    unavailableCount,
  }
}

function transformSource(sourceBytes, artworkIndexBytes) {
  let parsed
  try {
    parsed = JSON.parse(sourceBytes.toString("utf8"))
  } catch (error) {
    fail(`Unable to parse source JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data))
    fail("Source must be an object with a data array")
  if (parsed.data.length > 100_000) fail("Source contains more than 100,000 cards")

  const seenIds = new Set()
  const seenNames = new Set()
  const normalizedNames = new Set()
  const accepted = []
  const rejected = []
  const anomalies = []

  for (const [index, card] of parsed.data.entries()) {
    if (!isRecord(card)) fail(`data[${index}] must be an object`)
    const id = integer(card.id, "id", card)
    const name = text(card.name, "name", card, 500)
    if (!name) fail(`${id}: name must not be empty`)
    const frameType = text(card.frameType, "frameType", card, 100)
    if (seenIds.has(id)) fail(`${name}: duplicate ID ${id}`)
    seenIds.add(id)
    if (seenNames.has(name)) fail(`${name}: duplicate exact name`)
    seenNames.add(name)
    const normalizedName = name.normalize("NFKC").toLocaleLowerCase("en-US")
    if (normalizedNames.has(normalizedName)) fail(`${name}: duplicate normalized name`)
    normalizedNames.add(normalizedName)

    if (knownUnsupportedFrames.has(frameType)) {
      rejected.push({ frameType, id, name, reason: "unsupported-frame" })
      continue
    }
    if (!supportedFrames.has(frameType))
      fail(`${name}: unknown frameType ${JSON.stringify(frameType)}`)

    const images = validatedImages(card)
    accepted.push({ ...card, card_images: images, frameType, id, name })
  }

  accepted.sort((left, right) => stableCompare(left.name, right.name) || left.id - right.id)
  const types = [
    ...new Set(
      accepted.flatMap((card) => {
        if (card.typeline === undefined) return []
        if (!Array.isArray(card.typeline)) fail(`${card.name}: typeline must be an array`)
        return card.typeline
          .map((type) => {
            if (typeof type !== "string" || type.length > 100)
              fail(`${card.name}: typeline values must be strings no longer than 100 characters`)
            return type
          })
          .filter(Boolean)
      }),
    ),
  ].sort(stableCompare)
  if (types.length > 256) fail("Source contains more than 256 monster type values")
  const attributeIds = new Map(attributes.map((value, index) => [value, index]))
  const subtypeIds = new Map(subtypes.map((value, index) => [value, index]))
  const typeIds = new Map(types.map((value, index) => [value, index]))
  const groups = Object.fromEntries(frameOrder.map((frame) => [frame, []]))

  for (const card of accepted) {
    const pendulum = card.frameType.endsWith("_pendulum")
    const baseFrame = card.frameType.replace("_pendulum", "")
    const description = text(card.desc, "desc", card)
    let row

    if (baseFrame === "spell" || baseFrame === "trap") {
      const subtype = subtypeFor(card, anomalies)
      row = [card.id, card.name, subtypeIds.get(subtype), description]
    } else if (baseFrame === "token") {
      row = [card.id, card.name, description]
    } else {
      let attributeId = null
      if (card.attribute == null || card.attribute === "") {
        anomalies.push({
          id: card.id,
          kind: "missing-attribute",
          message: "The source has no attribute; autocomplete will clear the field.",
          name: card.name,
        })
      } else {
        attributeId = attributeIds.get(card.attribute)
        if (attributeId === undefined)
          fail(`${card.name}: unsupported attribute ${JSON.stringify(card.attribute)}`)
      }
      const cardTypes = Array.isArray(card.typeline) ? card.typeline.filter(Boolean) : []
      if (cardTypes.length > 16) fail(`${card.name}: typeline contains more than 16 values`)
      if (cardTypes.length === 0) {
        anomalies.push({
          id: card.id,
          kind: "missing-typeline",
          message: "The source has no monster types; autocomplete will clear the field.",
          name: card.name,
        })
      }
      const cardTypeIds = cardTypes.map((type) => {
        const typeId = typeIds.get(type)
        if (typeId === undefined)
          fail(`${card.name}: unknown typeline value ${JSON.stringify(type)}`)
        return typeId
      })
      if (new Set(cardTypeIds).size !== cardTypeIds.length)
        fail(`${card.name}: duplicate typeline value`)
      const attack = integer(card.atk, "atk", card, {
        maximum: 99_999,
        minimum: -1,
        nullable: true,
      })
      const sourceMonsterDescription =
        pendulum && card.monster_desc != null
          ? text(card.monster_desc, "monster_desc", card)
          : description
      const monsterDescription =
        baseFrame === "normal"
          ? flavorText(sourceMonsterDescription, card, anomalies)
          : sourceMonsterDescription
      const common = [card.id, card.name, attributeId, cardTypeIds, monsterDescription, attack]

      if (baseFrame === "link") {
        row = [...common, linkMask(card)]
      } else {
        const defense = integer(card.def, "def", card, {
          maximum: 99_999,
          minimum: -1,
          nullable: true,
        })
        const level = integer(card.level, "level", card, { maximum: 99, nullable: true })
        if (level === null) {
          anomalies.push({
            id: card.id,
            kind: "missing-level",
            message: "The source has no level/rank; autocomplete will clear the field.",
            name: card.name,
          })
        }
        row = [...common, defense, level]
        if (pendulum) {
          const scale = integer(card.scale, "scale", card, { maximum: 99 })
          const pendulumEffect =
            card.pend_desc == null ? "" : text(card.pend_desc, "pend_desc", card)
          if (card.monster_desc == null || card.pend_desc == null) {
            anomalies.push({
              id: card.id,
              kind: "missing-pendulum-split",
              message: "Used desc as monster text and an empty missing Pendulum effect.",
              name: card.name,
            })
          }
          row.push(scale, pendulumEffect)
        }
      }
    }

    groups[card.frameType].push(row)
  }

  const artwork = artworkMappings(artworkIndexBytes, new Set(accepted.map(({ id }) => id)))

  const catalog = {
    v: schemaVersion,
    a: attributes,
    s: subtypes,
    t: types,
    g: groups,
    i: artwork.encoded,
  }
  const catalogText = JSON.stringify(catalog)
  const catalogBytes = Buffer.from(catalogText)
  const catalogHash = sha256(catalogBytes)
  const compressedCatalog = brotliCompressSync(catalogBytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  })
  const artifactHash = sha256(compressedCatalog)
  const sourceHash = sha256(sourceBytes)
  const artworkSourceHash = sha256(artworkIndexBytes)
  const catalogFile = `catalog-${artifactHash.slice(0, 16)}.bin`
  const manifest = {
    format,
    schemaVersion,
    source: {
      name: "YGOPRODeck API v7",
      sha256: sourceHash,
      recordCount: parsed.data.length,
    },
    artworkSource: {
      name: "YugiLife audited artwork mapping",
      sha256: artworkSourceHash,
      recordCount: artwork.recordCount,
      includedCount: artwork.includedCount,
    },
    catalog: {
      file: catalogFile,
      encoding: "br",
      artifactSha256: artifactHash,
      compressedBytes: compressedCatalog.length,
      sha256: catalogHash,
      recordCount: accepted.length,
      uncompressedBytes: catalogBytes.length,
    },
    rejectedCount: rejected.length,
  }
  const report = {
    format: `${format}-report`,
    schemaVersion,
    sourceSha256: sourceHash,
    artworkSourceSha256: artworkSourceHash,
    artworkRecordCount: artwork.recordCount,
    includedArtworkCount: artwork.includedCount,
    unavailableArtworkCount: artwork.unavailableCount,
    artworkPasscodesAbsentFromCatalog: artwork.absentPasscodes,
    catalogSha256: catalogHash,
    artifactSha256: artifactHash,
    acceptedCount: accepted.length,
    rejected,
    anomalies,
  }
  return {
    catalogFile,
    catalogBytes,
    catalogText,
    compressedCatalog,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    reportText: `${JSON.stringify(report, null, 2)}\n`,
  }
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, contents)
  await rename(temporary, path)
}

async function generate({ artworkIndex, input, publicDirectory, report }) {
  const sourceBytes = await readFile(input)
  const artworkIndexBytes = await readFile(artworkIndex)
  const result = transformSource(sourceBytes, artworkIndexBytes)
  await mkdir(publicDirectory, { recursive: true })
  await writeAtomic(join(publicDirectory, result.catalogFile), result.compressedCatalog)
  await writeAtomic(join(publicDirectory, "manifest.json"), result.manifestText)
  await writeAtomic(report, result.reportText)
  for (const file of await readdir(publicDirectory)) {
    if (
      /^catalog-[a-f0-9]{16}(?:\.bin|\.json(?:\.br)?)$/.test(file) &&
      file !== result.catalogFile
    ) {
      await rm(join(publicDirectory, file))
    }
  }
  return result
}

async function checkGenerated({ artworkIndex, input, publicDirectory, report }) {
  const manifestPath = join(publicDirectory, "manifest.json")
  const manifestText = await readFile(manifestPath, "utf8")
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    fail(`${manifestPath} is not valid JSON`)
  }
  if (
    !isRecord(manifest) ||
    manifest.format !== format ||
    manifest.schemaVersion !== schemaVersion ||
    !isRecord(manifest.source) ||
    !/^[a-f0-9]{64}$/.test(manifest.source.sha256) ||
    !Number.isSafeInteger(manifest.source.recordCount) ||
    !isRecord(manifest.artworkSource) ||
    manifest.artworkSource.name !== "YugiLife audited artwork mapping" ||
    !/^[a-f0-9]{64}$/.test(manifest.artworkSource.sha256) ||
    !Number.isSafeInteger(manifest.artworkSource.recordCount) ||
    !Number.isSafeInteger(manifest.artworkSource.includedCount) ||
    manifest.artworkSource.includedCount > manifest.artworkSource.recordCount ||
    !isRecord(manifest.catalog) ||
    !/^catalog-[a-f0-9]{16}\.bin$/.test(manifest.catalog.file) ||
    manifest.catalog.encoding !== "br" ||
    !/^[a-f0-9]{64}$/.test(manifest.catalog.artifactSha256) ||
    !Number.isSafeInteger(manifest.catalog.compressedBytes) ||
    !/^[a-f0-9]{64}$/.test(manifest.catalog.sha256) ||
    !Number.isSafeInteger(manifest.catalog.recordCount) ||
    !Number.isSafeInteger(manifest.catalog.uncompressedBytes) ||
    !Number.isSafeInteger(manifest.rejectedCount)
  ) {
    fail(`${manifestPath} does not match catalog manifest schema ${schemaVersion}`)
  }
  const catalogPath = join(publicDirectory, manifest.catalog.file)
  const compressedCatalog = await readFile(catalogPath)
  if (compressedCatalog.length !== manifest.catalog.compressedBytes)
    fail(`${catalogPath} compressed byte count does not match its manifest`)
  if (sha256(compressedCatalog) !== manifest.catalog.artifactSha256)
    fail(`${catalogPath} artifact SHA-256 does not match its manifest`)
  let catalogBytes
  try {
    catalogBytes = brotliDecompressSync(compressedCatalog)
  } catch {
    fail(`${catalogPath} is not a valid Brotli artifact`)
  }
  if (catalogBytes.length !== manifest.catalog.uncompressedBytes)
    fail(`${catalogPath} byte count does not match its manifest`)
  if (sha256(catalogBytes) !== manifest.catalog.sha256)
    fail(`${catalogPath} SHA-256 does not match its manifest`)
  const reportText = await readFile(report, "utf8")
  const parsedReport = JSON.parse(reportText)
  if (
    parsedReport?.format !== `${format}-report` ||
    parsedReport?.schemaVersion !== schemaVersion ||
    parsedReport?.sourceSha256 !== manifest.source.sha256 ||
    parsedReport?.artworkSourceSha256 !== manifest.artworkSource.sha256 ||
    parsedReport?.artworkRecordCount !== manifest.artworkSource.recordCount ||
    parsedReport?.includedArtworkCount !== manifest.artworkSource.includedCount ||
    parsedReport?.catalogSha256 !== manifest.catalog.sha256 ||
    parsedReport?.artifactSha256 !== manifest.catalog.artifactSha256 ||
    parsedReport?.acceptedCount !== manifest.catalog.recordCount ||
    parsedReport?.rejected?.length !== manifest.rejectedCount
  ) {
    fail(`${report} does not match the generated manifest`)
  }
  const catalog = JSON.parse(catalogBytes.toString("utf8"))
  const count = isRecord(catalog?.g)
    ? Object.values(catalog.g).reduce(
        (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
        0,
      )
    : -1
  if (catalog?.v !== schemaVersion || count !== manifest.catalog.recordCount) {
    fail(`${catalogPath} does not match catalog schema ${schemaVersion}`)
  }

  if (input && artworkIndex) {
    const expected = transformSource(await readFile(input), await readFile(artworkIndex))
    if (!expected.compressedCatalog.equals(compressedCatalog))
      fail(`${catalogPath} is stale; run the card catalog generator`)
    if (expected.manifestText !== manifestText)
      fail(`${manifestPath} is stale; run the card catalog generator`)
    if (expected.reportText !== reportText)
      fail(`${report} is stale; run the card catalog generator`)
  }
}

function parseArguments(argv) {
  const command = argv[0]
  if (command !== "generate" && command !== "check") {
    fail(
      "Usage: card-catalog.mjs <generate|check> [--input path] [--artwork-index path] [--public-dir path] [--report path]",
    )
  }
  const values = {
    command,
    input: command === "generate" ? defaultInput : undefined,
    artworkIndex: command === "generate" ? defaultArtworkIndex : undefined,
    publicDirectory: defaultPublicDirectory,
    report: defaultReport,
  }
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value) fail(`${flag} requires a value`)
    if (flag === "--input") values.input = value
    else if (flag === "--artwork-index") values.artworkIndex = value
    else if (flag === "--public-dir") values.publicDirectory = value
    else if (flag === "--report") values.report = value
    else fail(`Unknown option ${flag}`)
  }
  if (Boolean(values.input) !== Boolean(values.artworkIndex)) {
    fail("--input and --artwork-index must be supplied together")
  }
  return {
    ...values,
    ...(values.input ? { input: resolve(values.input) } : {}),
    ...(values.artworkIndex ? { artworkIndex: resolve(values.artworkIndex) } : {}),
    publicDirectory: resolve(values.publicDirectory),
    report: resolve(values.report),
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.command === "generate") {
    const result = await generate(options)
    const size = await stat(join(options.publicDirectory, result.catalogFile))
    console.log(`Generated ${result.catalogFile} (${size.size.toLocaleString("en-US")} bytes).`)
  } else {
    await checkGenerated(options)
    console.log("Card catalog artifacts are valid and current.")
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

export { checkGenerated, frameOrder, generate, schemaVersion, transformSource }

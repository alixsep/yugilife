interface ZipFile {
  data: Blob | Uint8Array | string
  name: string
}

const encoder = new TextEncoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function uint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

async function bytes(value: ZipFile["data"]) {
  if (typeof value === "string") return encoder.encode(value)
  if (value instanceof Uint8Array) return value
  return new Uint8Array(await value.arrayBuffer())
}

/** Creates a standards-compliant uncompressed ZIP without adding a runtime compression dependency. */
export async function createZipBlob(files: readonly ZipFile[]) {
  const now = dosDateTime(new Date())
  const localParts: ArrayBuffer[] = []
  const centralParts: ArrayBuffer[] = []
  let localOffset = 0

  const ownedBuffer = (value: Uint8Array) => value.slice().buffer

  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = await bytes(file.data)
    const checksum = crc32(data)
    const local = new ArrayBuffer(30)
    const localView = new DataView(local)
    uint32(localView, 0, 0x04034b50)
    uint16(localView, 4, 20)
    uint16(localView, 6, 0x0800)
    uint16(localView, 8, 0)
    uint16(localView, 10, now.time)
    uint16(localView, 12, now.date)
    uint32(localView, 14, checksum)
    uint32(localView, 18, data.length)
    uint32(localView, 22, data.length)
    uint16(localView, 26, name.length)

    const central = new ArrayBuffer(46)
    const centralView = new DataView(central)
    uint32(centralView, 0, 0x02014b50)
    uint16(centralView, 4, 20)
    uint16(centralView, 6, 20)
    uint16(centralView, 8, 0x0800)
    uint16(centralView, 10, 0)
    uint16(centralView, 12, now.time)
    uint16(centralView, 14, now.date)
    uint32(centralView, 16, checksum)
    uint32(centralView, 20, data.length)
    uint32(centralView, 24, data.length)
    uint16(centralView, 28, name.length)
    uint32(centralView, 42, localOffset)

    localParts.push(local, ownedBuffer(name), ownedBuffer(data))
    centralParts.push(central, ownedBuffer(name))
    localOffset += local.byteLength + name.length + data.length
  }

  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0)
  const end = new ArrayBuffer(22)
  const endView = new DataView(end)
  uint32(endView, 0, 0x06054b50)
  uint16(endView, 8, files.length)
  uint16(endView, 10, files.length)
  uint32(endView, 12, centralSize)
  uint32(endView, 16, localOffset)
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" })
}

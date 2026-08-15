const activeCardKey = "yugilife.inventory.active-card"

let memoryActiveCardId: string | undefined

export function readActiveInventoryCardId() {
  try {
    const value = localStorage.getItem(activeCardKey)
    if (value) memoryActiveCardId = value
  } catch {
    // The in-memory value keeps navigation coherent when localStorage is unavailable.
  }
  return memoryActiveCardId
}

export function writeActiveInventoryCardId(id: string) {
  memoryActiveCardId = id
  try {
    localStorage.setItem(activeCardKey, id)
  } catch {
    // Inventory persistence has its own fallback; this setting is only a navigation preference.
  }
}

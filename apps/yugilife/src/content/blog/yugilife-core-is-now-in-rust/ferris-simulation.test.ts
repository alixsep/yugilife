import { describe, expect, it } from "vitest"

import {
  callCrab,
  CARD_WIDTH,
  CRAB_REACH,
  createWorld,
  grabCard,
  petCrab,
  releaseCard,
  RUN_SPEED,
  SLEEP_AFTER,
  step,
  WALK_SPEED,
} from "./ferris-simulation"

import type { World } from "./ferris-simulation"

/** A small deterministic generator so every run plays out the same way. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function run(world: World, seconds: number, each?: () => boolean | void) {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    step(world, 1 / 60)
    if (each?.() === true) return true
  }
  return false
}

describe("Ferris playground simulation", () => {
  it("starts with three cards in hand and tosses them up", () => {
    const world = createWorld(900, seeded(7))
    expect(world.cards).toHaveLength(3)
    expect(world.crab.plan.kind).toBe("opening")
    expect(world.cards.every((card) => card.holder === "crab")).toBe(true)
    run(world, 0.5)
    expect(world.cards.every((card) => card.holder === "crab")).toBe(true)

    let rose = false
    run(world, 0.6, () => {
      rose ||= world.cards.every((card) => card.holder === "none" && card.vy > 0)
    })
    expect(rose).toBe(true)
    // Tossed out to their own sides of the fan.
    const [left, middle, right] = world.cards.map((card) => card.x)
    expect(left).toBeLessThan(middle ?? 0)
    expect(right).toBeGreaterThan(middle ?? 0)
  })

  it("tosses the rest of the hand when the opening is interrupted", () => {
    const world = createWorld(900, seeded(8))
    run(world, 0.2)
    grabCard(world, 1, 450, 150)
    run(world, 1 / 60)
    expect(world.cards.map((card) => card.holder)).toEqual(["none", "pointer", "none"])
  })

  it("starts with the cards on the floor under reduced motion", () => {
    const world = createWorld(900, seeded(9), true)
    expect(world.crab.plan.kind).toBe("idle")
    expect(world.cards.every((card) => card.grounded && card.holder === "none")).toBe(true)
  })

  it("keeps cards below the ceiling", () => {
    const world = createWorld(900, seeded(10), true, 200)
    grabCard(world, 0, 300, 900)
    expect(world.cards[0]?.y).toBe(200)
    releaseCard(world, 0, 0, 1600)
    run(world, 3, () => {
      expect(world.cards[0]?.y ?? 0).toBeLessThanOrEqual(200)
    })
  })

  it("walks to a nearby spot and runs to a far one", () => {
    const world = createWorld(1000, seeded(1), true)
    let fastest = 0
    callCrab(world, 600)
    expect(world.crab.plan).toMatchObject({ kind: "walk", run: false })
    run(world, 3, () => {
      fastest = Math.max(fastest, Math.abs(world.crab.vx))
    })
    expect(Math.abs(world.crab.x - 600)).toBeLessThan(6)
    expect(fastest).toBeLessThanOrEqual(WALK_SPEED)

    fastest = 0
    callCrab(world, 100)
    expect(world.crab.plan).toMatchObject({ kind: "walk", run: true })
    run(world, 3, () => {
      fastest = Math.max(fastest, Math.abs(world.crab.vx))
    })
    expect(Math.abs(world.crab.x - 100)).toBeLessThan(6)
    expect(fastest).toBeGreaterThan(WALK_SPEED * 2)
    expect(fastest).toBeLessThanOrEqual(RUN_SPEED)
  })

  it("chases a thrown card and catches it", () => {
    const world = createWorld(1000, seeded(2), true)
    grabCard(world, 0, 300, 80)
    expect(world.crab.plan.kind).toBe("watch")
    releaseCard(world, 0, 420, 520)
    expect(world.crab.plan).toMatchObject({ cardId: 0, kind: "fetch" })
    expect(run(world, 6, () => world.crab.held === 0)).toBe(true)
  })

  it("keeps thrown cards on stage until they come to rest", () => {
    const world = createWorld(500, seeded(3), true)
    for (const card of world.cards) {
      grabCard(world, card.id, card.x, 60)
      releaseCard(world, card.id, card.id % 2 === 0 ? -1400 : 1400, 900)
    }
    run(world, 10, () => {
      for (const card of world.cards) {
        expect(card.x).toBeGreaterThanOrEqual(CARD_WIDTH / 2)
        expect(card.x).toBeLessThanOrEqual(500 - CARD_WIDTH / 2)
      }
      expect(world.crab.x).toBeGreaterThanOrEqual(CRAB_REACH)
      expect(world.crab.x).toBeLessThanOrEqual(500 - CRAB_REACH)
    })
    for (const card of world.cards) {
      expect(card.grounded || card.holder === "crab").toBe(true)
    }
  })

  it("stays put with reduced motion until asked to move", () => {
    const world = createWorld(800, seeded(4), true)
    run(world, 20)
    expect(world.crab.x).toBe(400)
    expect(world.cards.every((card) => card.grounded)).toBe(true)
  })

  it("plays on its own, then falls asleep and wakes up when petted", () => {
    const world = createWorld(800, seeded(5))
    const start = world.cards.map((card) => card.x)
    run(world, 20)
    const moved = world.cards.some((card, index) => card.x !== start[index]) || world.crab.x !== 400
    expect(moved).toBe(true)
    expect(run(world, SLEEP_AFTER + 30, () => world.crab.plan.kind === "sleep")).toBe(true)
    petCrab(world)
    expect(world.crab.plan.kind).toBe("idle")
    expect(world.crab.alert).toBeGreaterThan(0)
  })

  it("hops happily when petted, however often, without particles", () => {
    const world = createWorld(800, seeded(6), true)
    petCrab(world)
    expect(world.crab.vy).toBeGreaterThan(0)
    expect(world.crab.happy).toBeGreaterThan(0)
    for (let pet = 0; pet < 4; pet++) {
      run(world, 0.1)
      petCrab(world)
    }
    expect(world.particles).toHaveLength(0)
  })
})

// The world behind the post's hero: Ferris the crab and a handful of toy cards on a floor. Pure
// state and a fixed-step `step`, so the behavior can be tested without a browser. Coordinates are
// pixels: x from the stage's left edge, y upward from the floor line.

export const GRAVITY = 1500
export const WALK_SPEED = 120
export const RUN_SPEED = 420
export const CARD_WIDTH = 46
export const CARD_HEIGHT = 66
/** Half of Ferris's width; keeps the whole crab on stage. */
export const CRAB_REACH = 62
/** Height of a held card's center above Ferris's feet. */
export const HOLD_HEIGHT = 122
/** Without any interaction for this long, Ferris goes to sleep. */
export const SLEEP_AFTER = 45

const PICK_RANGE = 14
const CATCH_RANGE = 38
const MAX_PARTICLES = 40
const TURN = Math.PI * 2
/** How long Ferris shows the opening hand before tossing it up. */
const OPENING = 0.9

/** The three cards, by id. Ferris starts holding them as a fanned hand. */
export const CARD_IDS: readonly number[] = [0, 1, 2]

export interface PlayCard {
  readonly id: number
  /** 0 to 1: how far toward the viewer the card lies on the floor. */
  readonly depth: number
  x: number
  /** Height of the card's center; 0 while it lies on the floor. */
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
  /** Rotation around the card's vertical axis; the back shows while its cosine is negative. */
  flip: number
  flipSpeed: number
  /** 0 upright, 1 lying flat on the floor. */
  lie: number
  holder: "crab" | "none" | "pointer"
  grounded: boolean
}

export type CrabPlan =
  | { readonly kind: "fetch"; readonly cardId: number; readonly tosses: number }
  | { readonly kind: "idle"; readonly until: number }
  | { readonly kind: "opening"; readonly until: number }
  | {
      readonly kind: "juggle"
      readonly cardId: number
      readonly tosses: number
      readonly until: number
    }
  | { readonly kind: "sleep" }
  | { readonly kind: "walk"; readonly run: boolean; readonly x: number }
  | { readonly kind: "watch" }

export interface Crab {
  x: number
  y: number
  vx: number
  vy: number
  plan: CrabPlan
  held: number | null
  /** Walk-cycle phase in radians. */
  stride: number
  facing: -1 | 1
  /** Where the eyes look, each -1 to 1 (y upward). */
  lookX: number
  lookY: number
  glanceX: number
  glanceY: number
  glanceUntil: number
  /** Seconds until the next blink; negative while blinking. */
  blink: number
  happy: number
  alert: number
  /** Remaining time of a claw snap. */
  snap: number
  dustClock: number
  sleepClock: number
}

export interface Particle {
  kind: "dust" | "z"
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
}

export interface Keys {
  readonly left: boolean
  readonly right: boolean
  readonly run: boolean
}

export interface World {
  width: number
  /** The highest a card's center may fly, so cards stay near the stage. */
  ceiling: number
  time: number
  /** Seconds since the last interaction. */
  idle: number
  /** Reduced motion: Ferris only moves when asked to. */
  calm: boolean
  crab: Crab
  cards: PlayCard[]
  particles: Particle[]
  pointer: { x: number; y: number } | null
  keys: Keys
  random: () => number
}

const noKeys: Keys = { left: false, right: false, run: false }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function moveToward(value: number, target: number, delta: number) {
  return value < target ? Math.min(target, value + delta) : Math.max(target, value - delta)
}

function crabMin() {
  return CRAB_REACH
}

function crabMax(world: World) {
  return Math.max(CRAB_REACH, world.width - CRAB_REACH)
}

function cardMax(world: World) {
  return Math.max(CARD_WIDTH / 2, world.width - CARD_WIDTH / 2)
}

function grounded(crab: Crab) {
  return crab.y === 0 && crab.vy === 0
}

/**
 * Ferris starts in the middle holding the cards as a fanned hand and tosses them up a moment
 * later. With reduced motion there is no opening: the cards start on the floor.
 */
export function createWorld(
  width: number,
  random: () => number,
  calm = false,
  ceiling = Number.POSITIVE_INFINITY,
): World {
  const cards = CARD_IDS.map((id, index): PlayCard => {
    // On the floor, spread the cards out and leave the middle to Ferris.
    const lane = (index + 0.5) / CARD_IDS.length
    const side = lane < 0.5 ? lane * 0.8 : 0.2 + lane * 0.8
    return {
      angle: 0,
      depth: random(),
      flip: 0,
      flipSpeed: 0,
      grounded: calm,
      holder: calm ? "none" : "crab",
      id,
      lie: calm ? 1 : 0,
      spin: 0,
      vx: 0,
      vy: 0,
      x: calm
        ? clamp(
            width * (0.06 + side * 0.88),
            CARD_WIDTH / 2,
            Math.max(CARD_WIDTH / 2, width - CARD_WIDTH / 2),
          )
        : width / 2,
      y: calm ? 0 : HOLD_HEIGHT,
    }
  })
  return {
    calm,
    cards,
    ceiling,
    crab: {
      alert: 0,
      blink: 2,
      dustClock: 0,
      facing: 1,
      glanceUntil: 0,
      glanceX: 0,
      glanceY: 0,
      happy: 0,
      held: null,
      lookX: 0,
      lookY: 0,
      plan: calm ? { kind: "idle", until: 1.2 } : { kind: "opening", until: OPENING },
      sleepClock: 0,
      snap: 0,
      stride: 0,
      vx: 0,
      vy: 0,
      x: width / 2,
      y: 0,
    },
    idle: 0,
    keys: noKeys,
    particles: [],
    pointer: null,
    random,
    time: 0,
    width,
  }
}

export function findCard(world: World, id: number) {
  return world.cards.find((card) => card.id === id)
}

/** Keeps everything on stage after the stage changes size. */
export function resizeWorld(world: World, width: number, ceiling = world.ceiling) {
  world.width = width
  world.ceiling = ceiling
  world.crab.x = clamp(world.crab.x, crabMin(), crabMax(world))
  for (const card of world.cards) card.x = clamp(card.x, CARD_WIDTH / 2, cardMax(world))
}

function spawn(world: World, particle: Omit<Particle, "age">) {
  if (world.particles.length >= MAX_PARTICLES) world.particles.shift()
  world.particles.push({ ...particle, age: 0 })
}

function dustBurst(world: World, x: number, count: number) {
  if (world.calm) return
  for (let index = 0; index < count; index++) {
    spawn(world, {
      kind: "dust",
      life: 0.45 + world.random() * 0.25,
      size: 6 + world.random() * 6,
      vx: (world.random() - 0.5) * 160,
      vy: 20 + world.random() * 40,
      x,
      y: 2,
    })
  }
}

/** Any interaction resets the sleep timer and wakes Ferris up. */
function wake(world: World) {
  world.idle = 0
  const { crab } = world
  if (crab.plan.kind === "sleep") {
    crab.plan = { kind: "idle", until: world.time + 0.6 }
    crab.alert = 0.8
  }
}

export function lookAt(world: World, point: { x: number; y: number } | null) {
  world.pointer = point
  if (point) world.idle = Math.min(world.idle, SLEEP_AFTER - 1)
}

export function grabCard(world: World, id: number, x: number, y: number) {
  wake(world)
  const card = findCard(world, id)
  if (!card) return
  const { crab } = world
  if (crab.held === id) crab.held = null
  card.holder = "pointer"
  card.grounded = false
  card.vx = 0
  card.vy = 0
  card.spin = 0
  card.flipSpeed = 0
  dragCard(world, id, x, y)
  crab.plan = { kind: "watch" }
  crab.alert = 0.9
}

export function dragCard(world: World, id: number, x: number, y: number) {
  const card = findCard(world, id)
  if (card?.holder !== "pointer") return
  card.x = clamp(x, CARD_WIDTH / 2, cardMax(world))
  card.y = clamp(y, 0, world.ceiling)
}

export function releaseCard(world: World, id: number, vx: number, vy: number) {
  wake(world)
  const card = findCard(world, id)
  if (card?.holder !== "pointer") return
  card.holder = "none"
  card.grounded = false
  card.vx = clamp(vx, -1400, 1400)
  card.vy = clamp(vy, -1400, 1600)
  card.spin = clamp(card.vx / 140, -12, 12)
  card.flipSpeed = clamp(Math.hypot(card.vx, card.vy) / 90, 0, 14) * (world.random() < 0.5 ? -1 : 1)
  world.crab.plan = { cardId: id, kind: "fetch", tosses: 1 + Math.floor(world.random() * 2) }
  world.crab.alert = 0.7
}

export function petCrab(world: World) {
  const wasAsleep = world.crab.plan.kind === "sleep"
  wake(world)
  const { crab } = world
  if (wasAsleep) return
  crab.happy = 1.6
  if (grounded(crab)) crab.vy = 380
}

export function callCrab(world: World, x: number) {
  wake(world)
  const { crab } = world
  const target = clamp(x, crabMin(), crabMax(world))
  crab.plan = { kind: "walk", run: Math.abs(target - crab.x) > 160, x: target }
  crab.alert = 0.5
}

export function setKeys(world: World, keys: Keys) {
  world.keys = keys
  if (keys.left || keys.right) wake(world)
}

export function jumpCrab(world: World) {
  wake(world)
  if (grounded(world.crab)) world.crab.vy = 470
}

/** Throws the held card ahead, or goes to fetch the nearest card. */
export function tossOrFetch(world: World) {
  wake(world)
  const { crab } = world
  if (crab.held !== null) {
    const id = crab.held
    throwHeld(world, crab.facing, true)
    crab.plan = { cardId: id, kind: "fetch", tosses: 0 }
    return
  }
  let nearest: PlayCard | undefined
  for (const card of world.cards) {
    if (card.holder !== "none") continue
    if (!nearest || Math.abs(card.x - crab.x) < Math.abs(nearest.x - crab.x)) nearest = card
  }
  if (nearest) crab.plan = { cardId: nearest.id, kind: "fetch", tosses: 1 }
}

/** A card's place in the opening hand: -1 left, 0 middle, 1 right. */
function handSlot(card: PlayCard) {
  return CARD_IDS.indexOf(card.id) - (CARD_IDS.length - 1) / 2
}

/** Tosses a card from the opening hand up and out to its side of the fan. */
function tossFromHand(world: World, card: PlayCard) {
  const { random } = world
  const slot = handSlot(card)
  card.holder = "none"
  card.grounded = false
  card.vx = slot * 170 + (random() - 0.5) * 60
  card.vy = 620 + random() * 140
  card.spin = slot * 3 + (random() - 0.5) * 6
  card.flipSpeed = (random() < 0.5 ? -1 : 1) * (6 + random() * 6)
}

function throwHeld(world: World, direction: number, far: boolean) {
  const { crab, random } = world
  const card = crab.held === null ? undefined : findCard(world, crab.held)
  crab.held = null
  if (!card) return
  card.holder = "none"
  card.grounded = false
  card.x = crab.x
  card.y = crab.y + HOLD_HEIGHT
  if (far) {
    card.vx = direction * (220 + random() * 240)
    card.vy = 480 + random() * 180
    card.spin = direction * (4 + random() * 8)
    card.flipSpeed = (random() < 0.5 ? -1 : 1) * (6 + random() * 8)
  } else {
    card.vx = (random() - 0.5) * 50
    card.vy = 560 + random() * 160
    card.spin = (random() - 0.5) * 6
    card.flipSpeed = (random() < 0.5 ? -1 : 1) * (8 + random() * 6)
  }
}

/** Where a falling card will be when it comes down to Ferris's claws (or the floor). */
export function landingX(world: World, card: PlayCard) {
  const catchDisc = card.vy * card.vy + 2 * GRAVITY * (card.y - HOLD_HEIGHT)
  const floorDisc = card.vy * card.vy + 2 * GRAVITY * card.y
  const time =
    catchDisc >= 0
      ? (card.vy + Math.sqrt(catchDisc)) / GRAVITY
      : (card.vy + Math.sqrt(Math.max(0, floorDisc))) / GRAVITY
  return clamp(card.x + card.vx * time, crabMin(), crabMax(world))
}

function approach(dx: number, run: boolean) {
  return Math.sign(dx) * Math.min(run ? RUN_SPEED : WALK_SPEED, Math.abs(dx) * 5)
}

function chooseNext(world: World) {
  const { crab, random } = world
  if (world.idle > SLEEP_AFTER) {
    crab.plan = { kind: "sleep" }
    return
  }
  const free = world.cards.filter((card) => card.grounded && card.holder === "none")
  const roll = random()
  const card = free[Math.floor(random() * free.length)]
  if (roll < 0.45 && card) {
    crab.plan = { cardId: card.id, kind: "fetch", tosses: 1 + Math.floor(random() * 3) }
  } else if (roll < 0.75) {
    const x = crabMin() + random() * (crabMax(world) - crabMin())
    crab.plan = { kind: "walk", run: random() < 0.3, x }
  } else if (roll < 0.9) {
    crab.snap = 0.4
    crab.glanceUntil = 0
    crab.plan = { kind: "idle", until: world.time + 1 + random() * 2 }
  } else {
    crab.vy = 330
    crab.plan = { kind: "idle", until: world.time + 1.5 }
  }
}

/** Advances the plan and returns the velocity Ferris wants. */
function think(world: World, dt: number): number {
  const { crab, keys, random } = world
  if (keys.left !== keys.right) {
    if (crab.plan.kind !== "idle") crab.plan = { kind: "idle", until: world.time + 1.5 }
    else crab.plan = { kind: "idle", until: Math.max(crab.plan.until, world.time + 1.5) }
    return (keys.right ? 1 : -1) * (keys.run ? RUN_SPEED : WALK_SPEED)
  }
  const plan = crab.plan
  switch (plan.kind) {
    case "sleep": {
      crab.sleepClock -= dt
      if (crab.sleepClock <= 0) {
        crab.sleepClock = 1.4
        spawn(world, {
          kind: "z",
          life: 2.2,
          size: 14,
          vx: 14,
          vy: 26,
          x: crab.x + 34,
          y: crab.y + 70,
        })
      }
      return 0
    }
    case "watch": {
      if (!world.cards.some((card) => card.holder === "pointer")) {
        crab.plan = { kind: "idle", until: world.time + 0.8 }
      } else if (!world.calm && grounded(crab) && random() < dt * 1.5) {
        crab.vy = 200
      }
      return 0
    }
    case "walk": {
      const dx = plan.x - crab.x
      if (Math.abs(dx) < 4) {
        crab.plan =
          crab.held === null
            ? { kind: "idle", until: world.time + 1 + random() * 2.5 }
            : { cardId: crab.held, kind: "juggle", tosses: 1, until: world.time + 0.4 }
        return 0
      }
      return approach(dx, plan.run)
    }
    case "fetch": {
      const card = findCard(world, plan.cardId)
      if (!card || card.holder === "pointer") {
        crab.plan = card ? { kind: "watch" } : { kind: "idle", until: world.time + 1 }
        return 0
      }
      if (card.holder === "crab") {
        crab.plan = {
          cardId: card.id,
          kind: "juggle",
          tosses: plan.tosses,
          until: world.time + 0.4,
        }
        return 0
      }
      const target = card.grounded
        ? clamp(card.x, crabMin(), crabMax(world))
        : landingX(world, card)
      const dx = target - crab.x
      return approach(dx, !card.grounded || Math.abs(dx) > 160)
    }
    case "juggle": {
      if (crab.held === null) {
        crab.plan = { kind: "idle", until: world.time + 1 }
        return 0
      }
      if (world.time < plan.until) return 0
      if (plan.tosses > 0) {
        throwHeld(world, 0, false)
        crab.plan = { cardId: plan.cardId, kind: "fetch", tosses: plan.tosses - 1 }
      } else {
        // Throw toward the side with more room, and sometimes chase it right away.
        throwHeld(world, crab.x < world.width / 2 ? 1 : -1, true)
        crab.plan =
          !world.calm && random() < 0.4
            ? { cardId: plan.cardId, kind: "fetch", tosses: Math.floor(random() * 3) }
            : { kind: "idle", until: world.time + 1.2 + random() * 2 }
      }
      return 0
    }
    case "idle": {
      if (world.time >= plan.until && !world.calm) chooseNext(world)
      return 0
    }
    case "opening": {
      if (world.time < plan.until) return 0
      // updateCards tosses every card left in the hand once the opening is over.
      crab.happy = 0.6
      if (grounded(crab)) crab.vy = 220
      crab.plan = { kind: "idle", until: world.time + 1.8 }
      return 0
    }
  }
}

function moveCrab(world: World, dt: number) {
  const { crab } = world
  const desired = think(world, dt)
  const running = Math.abs(desired) > WALK_SPEED * 1.2
  crab.vx = moveToward(crab.vx, desired, (running ? 2400 : 1000) * dt)
  crab.x += crab.vx * dt
  const min = crabMin()
  const max = crabMax(world)
  if (crab.x < min || crab.x > max) {
    crab.x = clamp(crab.x, min, max)
    crab.vx = 0
  }
  if (Math.abs(crab.vx) > 8) crab.facing = crab.vx > 0 ? 1 : -1
  if (crab.y > 0 || crab.vy !== 0) {
    crab.vy -= GRAVITY * dt
    crab.y += crab.vy * dt
    if (crab.y <= 0) {
      if (crab.vy < -300) dustBurst(world, crab.x, 5)
      crab.y = 0
      crab.vy = 0
    }
  }
  crab.stride += Math.abs(crab.vx) * dt * 0.085
  if (grounded(crab) && Math.abs(crab.vx) > WALK_SPEED * 1.6) {
    crab.dustClock -= dt
    if (crab.dustClock <= 0) {
      crab.dustClock = 0.07
      if (!world.calm) {
        spawn(world, {
          kind: "dust",
          life: 0.5,
          size: 6 + world.random() * 5,
          vx: -crab.facing * (20 + world.random() * 40),
          vy: 10 + world.random() * 30,
          x: crab.x - crab.facing * 34,
          y: 2,
        })
      }
    }
  }
}

function settle(value: number, period: number, rate: number) {
  const target = Math.round(value / period) * period
  return value + (target - value) * Math.min(1, rate)
}

function updateCards(world: World, dt: number) {
  const { crab } = world
  const max = cardMax(world)
  for (const card of world.cards) {
    // A card from the opening hand that Ferris is not holding on its own. It stays fanned while
    // the opening lasts and is tossed up as soon as anything ends it, an interaction included.
    if (card.holder === "crab" && card.id !== crab.held) {
      if (crab.plan.kind === "opening") {
        const slot = handSlot(card)
        card.x = crab.x + slot * 13
        card.y = crab.y + HOLD_HEIGHT - Math.abs(slot) * 4
        card.angle = slot * 0.22
        continue
      }
      tossFromHand(world, card)
    }
    if (card.holder === "crab") {
      card.x = crab.x
      card.y = crab.y + HOLD_HEIGHT
      card.vx = 0
      card.vy = 0
      card.angle = settle(card.angle, TURN, dt * 12)
      card.flip = settle(card.flip, TURN, dt * 12)
      card.lie = moveToward(card.lie, 0, dt * 8)
      continue
    }
    if (card.holder === "pointer") {
      card.angle = settle(card.angle, TURN, dt * 10)
      card.lie = moveToward(card.lie, 0, dt * 8)
      continue
    }
    if (!card.grounded) {
      card.vy -= GRAVITY * dt
      card.vx *= 1 - 0.15 * dt
      card.x += card.vx * dt
      card.y += card.vy * dt
      card.angle += card.spin * dt
      card.flip += card.flipSpeed * dt
      card.lie = moveToward(card.lie, 0, dt * 6)
      if (card.x < CARD_WIDTH / 2 || card.x > max) {
        card.x = clamp(card.x, CARD_WIDTH / 2, max)
        card.vx = -card.vx * 0.6
        card.spin = -card.spin
      }
      // A soft ceiling: the card stops rising and drifts back down.
      if (card.y > world.ceiling) {
        card.y = world.ceiling
        if (card.vy > 0) card.vy = -card.vy * 0.25
      }
      if (card.y <= 0) {
        card.y = 0
        if (card.vy < -260) {
          card.vy = -card.vy * 0.32
          card.vx *= 0.6
          card.spin *= 0.5
          card.flipSpeed *= 0.4
        } else {
          card.vy = 0
          card.grounded = true
          dustBurst(world, card.x, 2)
        }
      }
      continue
    }
    card.vx = moveToward(card.vx, 0, 900 * dt)
    card.x = clamp(card.x + card.vx * dt, CARD_WIDTH / 2, max)
    card.angle = settle(card.angle, Math.PI, dt * 10)
    card.flip = settle(card.flip, Math.PI, dt * 10)
    card.spin = 0
    card.flipSpeed = 0
    card.lie = moveToward(card.lie, 1, dt * 6)
  }
}

function catchCards(world: World) {
  const { crab } = world
  const plan = crab.plan
  if (crab.held !== null || plan.kind !== "fetch") return
  const card = findCard(world, plan.cardId)
  if (card?.holder !== "none") return
  // Ferris stops short of the walls, but the claws still reach a card lying against one.
  const dx = Math.abs(clamp(card.x, crabMin(), crabMax(world)) - crab.x)
  const height = card.y - crab.y
  const caught = card.grounded
    ? dx < PICK_RANGE && grounded(crab)
    : card.vy < 0 && dx < CATCH_RANGE && height > HOLD_HEIGHT - 40 && height < HOLD_HEIGHT + 30
  if (!caught) return
  card.holder = "crab"
  card.grounded = false
  card.spin = 0
  card.flipSpeed = 0
  crab.held = card.id
  crab.happy = Math.max(crab.happy, 0.7)
  crab.plan = {
    cardId: card.id,
    kind: "juggle",
    tosses: plan.tosses,
    until: world.time + 0.35 + world.random() * 0.5,
  }
  if (grounded(crab) && !world.calm) crab.vy = 180
}

function updateFace(world: World, dt: number) {
  const { crab, random } = world
  const dragged = world.cards.find((card) => card.holder === "pointer")
  const chased = crab.plan.kind === "fetch" ? findCard(world, crab.plan.cardId) : undefined
  const hand = crab.plan.kind === "opening" ? { x: crab.x, y: crab.y + HOLD_HEIGHT } : undefined
  const target =
    dragged ??
    hand ??
    (chased && !chased.grounded ? chased : undefined) ??
    world.pointer ??
    (Math.abs(crab.vx) > 20 ? { x: crab.x + Math.sign(crab.vx) * 200, y: 40 } : undefined)
  let lookX: number
  let lookY: number
  if (target) {
    lookX = clamp((target.x - crab.x) / 140, -1, 1)
    lookY = clamp((target.y - (crab.y + 50)) / 140, -1, 1)
  } else {
    if (world.time >= crab.glanceUntil) {
      crab.glanceX = (random() - 0.5) * 1.6
      crab.glanceY = (random() - 0.3) * 0.8
      crab.glanceUntil = world.time + 1.5 + random() * 3
    }
    lookX = crab.glanceX
    lookY = crab.glanceY
  }
  const ease = Math.min(1, dt * 10)
  crab.lookX += (lookX - crab.lookX) * ease
  crab.lookY += (lookY - crab.lookY) * ease

  crab.blink -= dt
  if (crab.blink < -0.12) crab.blink = 1.6 + random() * 4
  crab.happy = Math.max(0, crab.happy - dt)
  crab.alert = Math.max(0, crab.alert - dt)
  crab.snap = Math.max(0, crab.snap - dt)
  if (crab.plan.kind === "idle" && !world.calm && crab.snap === 0 && random() < dt * 0.2) {
    crab.snap = 0.4
  }
}

function updateParticles(world: World, dt: number) {
  let kept = 0
  for (const particle of world.particles) {
    particle.age += dt
    if (particle.age >= particle.life) continue
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    if (particle.kind === "dust") {
      particle.vx *= 1 - 3 * dt
      particle.vy *= 1 - 2 * dt
    } else if (particle.kind === "z") {
      particle.vx = Math.sin(particle.age * 3) * 18
    }
    world.particles[kept++] = particle
  }
  world.particles.length = kept
}

export function step(world: World, dt: number) {
  world.time += dt
  world.idle += dt
  moveCrab(world, dt)
  updateCards(world, dt)
  catchCards(world)
  updateFace(world, dt)
  updateParticles(world, dt)
}

export interface DeviceTilt {
  x: number
  y: number
}

type DeviceTiltSubscriber = (tilt: DeviceTilt) => void

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>
}

const subscribers = new Set<DeviceTiltSubscriber>()
let baseline: { beta: number; gamma: number } | undefined
let listening = false
let permission: "idle" | "requesting" | "granted" | "denied" = "idle"
let gestureListening = false

const clamp = (value: number) => Math.min(1, Math.max(-1, value))

function screenAngle() {
  const angle = window.screen.orientation?.angle
  if (typeof angle === "number") return angle
  const legacyAngle = (window as Window & { orientation?: number }).orientation
  return typeof legacyAngle === "number" ? legacyAngle : 0
}

export function normalizeDeviceTilt(
  beta: number,
  gamma: number,
  origin: { beta: number; gamma: number },
  angle: number,
): DeviceTilt {
  const portraitX = clamp((gamma - origin.gamma) / 24)
  const portraitY = clamp((beta - origin.beta) / 24)
  const normalizedAngle = ((angle % 360) + 360) % 360
  if (normalizedAngle === 90) return { x: portraitY, y: -portraitX }
  if (normalizedAngle === 270) return { x: -portraitY, y: portraitX }
  if (normalizedAngle === 180) return { x: -portraitX, y: -portraitY }
  return { x: portraitX, y: portraitY }
}

function handleOrientation(event: DeviceOrientationEvent) {
  if (event.beta === null || event.gamma === null) return
  baseline ??= { beta: event.beta, gamma: event.gamma }
  const tilt = normalizeDeviceTilt(event.beta, event.gamma, baseline, screenAngle())
  subscribers.forEach((subscriber) => subscriber(tilt))
}

function resetBaseline() {
  baseline = undefined
}

function startListening() {
  if (listening || typeof window === "undefined") return
  listening = true
  permission = "granted"
  baseline = undefined
  window.addEventListener("deviceorientation", handleOrientation, { passive: true })
  window.screen.orientation?.addEventListener("change", resetBaseline)
  window.addEventListener("orientationchange", resetBaseline)
}

function stopGestureListener() {
  if (!gestureListening || typeof window === "undefined") return
  gestureListening = false
  window.removeEventListener("pointerdown", requestPermissionFromGesture, true)
}

function requestPermissionFromGesture() {
  if (permission !== "idle" || typeof window === "undefined") return
  const OrientationEvent = window.DeviceOrientationEvent as OrientationEventConstructor
  if (typeof OrientationEvent.requestPermission !== "function") {
    startListening()
    return
  }

  permission = "requesting"
  OrientationEvent.requestPermission()
    .then((result) => {
      permission = result === "granted" ? "granted" : "denied"
      if (result === "granted") startListening()
      stopGestureListener()
    })
    .catch(() => {
      // A rejected request can mean the browser did not accept this specific
      // interaction as activation. Leave it retryable on the next gesture.
      permission = "idle"
    })
}

function ensureDeviceTiltStarted() {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return
  const OrientationEvent = window.DeviceOrientationEvent as OrientationEventConstructor
  if (permission === "granted") {
    startListening()
  } else if (typeof OrientationEvent.requestPermission !== "function") {
    startListening()
  } else if (!gestureListening && permission === "idle") {
    gestureListening = true
    // Capture the first interaction anywhere in the app. iOS requires the
    // permission call to happen synchronously inside a user gesture.
    window.addEventListener("pointerdown", requestPermissionFromGesture, {
      capture: true,
      passive: true,
    })
  }
}

export function subscribeDeviceTilt(subscriber: DeviceTiltSubscriber) {
  subscribers.add(subscriber)
  ensureDeviceTiltStarted()
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) stopGestureListener()
  }
}

import { useEffect, useId, useRef, useState } from "react"

import { Slider } from "@/components/ui/slider"

import attributeDark from "./assets/exploded-view/attribute-dark.webp"
import border from "./assets/exploded-view/border.webp"
import effectBoxTexture from "./assets/exploded-view/effect-box-texture.webp"
import glyphAtk from "./assets/exploded-view/glyph-atk.svg"
import glyphAtkLabel from "./assets/exploded-view/glyph-atkLabel.svg"
import glyphAttribute from "./assets/exploded-view/glyph-attribute.svg"
import glyphAttributeGlyph from "./assets/exploded-view/glyph-attributeGlyph.svg"
import glyphCardCode from "./assets/exploded-view/glyph-cardCode.svg"
import glyphCopyright from "./assets/exploded-view/glyph-copyright.svg"
import glyphDef from "./assets/exploded-view/glyph-def.svg"
import glyphDefLabel from "./assets/exploded-view/glyph-defLabel.svg"
import glyphDescription from "./assets/exploded-view/glyph-description.svg"
import glyphEdition from "./assets/exploded-view/glyph-edition.svg"
import glyphName from "./assets/exploded-view/glyph-name.svg"
import glyphPendulumEffect from "./assets/exploded-view/glyph-pendulumEffect.svg"
import glyphPendulumScaleLeft from "./assets/exploded-view/glyph-pendulumScaleLeft.svg"
import glyphPendulumScaleRight from "./assets/exploded-view/glyph-pendulumScaleRight.svg"
import glyphSerialNumber from "./assets/exploded-view/glyph-serialNumber.svg"
import glyphTypeLine from "./assets/exploded-view/glyph-typeLine.svg"
import artwork from "./assets/exploded-view/odd-eyes-rebellion-dragon.webp"
import pendulumArtworkMask from "./assets/exploded-view/pendulum-artwork-mask.webp"
import pendulumBorder from "./assets/exploded-view/pendulum-border-medium.webp"
import pendulumEffectTexture from "./assets/exploded-view/pendulum-effect-texture.webp"
import pendulumFrameBottomMask from "./assets/exploded-view/pendulum-frame-bottom-mask.webp"
import pendulumScaleLeft from "./assets/exploded-view/pendulum-scale-left.webp"
import pendulumScaleRight from "./assets/exploded-view/pendulum-scale-right.webp"
import pendulumSpellTexture from "./assets/exploded-view/pendulum-spell-texture.webp"
import starRank from "./assets/exploded-view/star-rank.webp"
import xyzTexture from "./assets/exploded-view/xyz-texture.webp"

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react"

import "./exploded-view.css"

const GLYPH_LAYERS = [
  ["attributeGlyph", glyphAttributeGlyph],
  ["attribute", glyphAttribute],
  ["name", glyphName],
  ["pendulumScaleLeft", glyphPendulumScaleLeft],
  ["pendulumScaleRight", glyphPendulumScaleRight],
  ["pendulumEffect", glyphPendulumEffect],
  ["typeLine", glyphTypeLine],
  ["description", glyphDescription],
] as const

const STAT_GLYPH_LAYERS = [
  ["atkLabel", glyphAtkLabel],
  ["atk", glyphAtk],
  ["defLabel", glyphDefLabel],
  ["def", glyphDef],
  ["cardCode", glyphCardCode],
  ["serialNumber", glyphSerialNumber],
  ["edition", glyphEdition],
  ["copyright", glyphCopyright],
] as const

const LAYER_COUNT = 31
const LAYER_CENTER = (LAYER_COUNT - 1) / 2
const DEPTH_SPREAD = 18

type Rotation = { x: number; y: number }
type Point = { x: number; y: number }
type TrackedPointer = Point & { pointerType: string }
type Gesture =
  | (Rotation & { mode: "rotate"; pointerId: number; pointerX: number; pointerY: number })
  | (Point & {
      mode: "pan"
      pointerIds: readonly number[]
      pointerX: number
      pointerY: number
    })

function layerStyle(index: number, explosion: number, zoom: number): CSSProperties {
  const amount = (explosion / 100) * 5
  const depth = (index - LAYER_CENTER) * DEPTH_SPREAD * amount * zoom

  return {
    transform: `translate3d(0, 0, ${depth}px)`,
    zIndex: index + 1,
  }
}

function GlyphLayer({ id, src, style }: { id: string; src: string; style: CSSProperties }) {
  return (
    <div className="exploded-view__layer" data-layer={id} style={style}>
      <img alt="" draggable={false} src={src} />
    </div>
  )
}

export function ExplodedView() {
  const [explosion, setExplosion] = useState(28)
  const [zoom, setZoom] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef<Rotation>({ x: -5, y: 14 })
  const panRef = useRef<Point>({ x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, TrackedPointer>())
  const gestureRef = useRef<Gesture | null>(null)
  const idPrefix = useId().replaceAll(":", "")
  let layerIndex = 0

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((current) =>
        Math.max(0.55, Math.min(1.8, current * Math.exp(-event.deltaY * 0.0012))),
      )
    }

    stage.addEventListener("wheel", handleWheel, { passive: false })
    return () => stage.removeEventListener("wheel", handleWheel)
  }, [])

  const nextLayerStyle = () => layerStyle(layerIndex++, explosion, zoom)
  const svgId = (name: string) => `${idPrefix}-${name}`

  const updateRotation = (rotation: Rotation) => {
    rotationRef.current = rotation
    sceneRef.current?.style.setProperty("--rotate-x", `${rotation.x}deg`)
    sceneRef.current?.style.setProperty("--rotate-y", `${rotation.y}deg`)
  }

  const updatePan = (pan: Point) => {
    panRef.current = pan
    sceneRef.current?.style.setProperty("--pan-x", `${pan.x}px`)
    sceneRef.current?.style.setProperty("--pan-y", `${pan.y}px`)
  }

  const beginTouchGesture = () => {
    const touches = [...pointersRef.current.entries()].filter(
      ([, pointer]) => pointer.pointerType === "touch",
    )

    if (touches.length >= 2) {
      const firstTouch = touches[0]
      const secondTouch = touches[1]
      if (!firstTouch || !secondTouch) return
      const [firstId, first] = firstTouch
      const [secondId, second] = secondTouch
      gestureRef.current = {
        mode: "pan",
        pointerIds: [firstId, secondId],
        pointerX: (first.x + second.x) / 2,
        pointerY: (first.y + second.y) / 2,
        ...panRef.current,
      }
      return
    }

    const firstTouch = touches[0]
    if (firstTouch) {
      const [pointerId, pointer] = firstTouch
      gestureRef.current = {
        mode: "rotate",
        pointerId,
        pointerX: pointer.x,
        pointerY: pointer.y,
        ...rotationRef.current,
      }
      return
    }

    gestureRef.current = null
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" && event.button !== 0 && event.button !== 2) return

    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = "true"

    if (event.pointerType === "touch") {
      pointersRef.current.set(event.pointerId, {
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      })
      beginTouchGesture()
      return
    }

    gestureRef.current =
      event.button === 2
        ? {
            mode: "pan",
            pointerIds: [event.pointerId],
            pointerX: event.clientX,
            pointerY: event.clientY,
            ...panRef.current,
          }
        : {
            mode: "rotate",
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            ...rotationRef.current,
          }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" && pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, {
        pointerType: event.pointerType,
        x: event.clientX,
        y: event.clientY,
      })
    }

    const gesture = gestureRef.current
    if (!gesture) return

    if (gesture.mode === "rotate") {
      if (gesture.pointerId !== event.pointerId) return
      updateRotation({
        x: Math.max(-70, Math.min(70, gesture.x - (event.clientY - gesture.pointerY) * 0.38)),
        y: gesture.y + (event.clientX - gesture.pointerX) * 0.38,
      })
      return
    }

    if (!gesture.pointerIds.includes(event.pointerId)) return
    let pointerX = event.clientX
    let pointerY = event.clientY
    if (gesture.pointerIds.length >= 2) {
      const first = pointersRef.current.get(gesture.pointerIds[0]!)
      const second = pointersRef.current.get(gesture.pointerIds[1]!)
      if (!first || !second) return
      pointerX = (first.x + second.x) / 2
      pointerY = (first.y + second.y) / 2
    }

    updatePan({
      x: gesture.x + pointerX - gesture.pointerX,
      y: gesture.y + pointerY - gesture.pointerY,
    })
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    pointersRef.current.delete(event.pointerId)

    if (event.pointerType === "touch") {
      beginTouchGesture()
    } else if (
      gestureRef.current?.mode === "rotate"
        ? gestureRef.current.pointerId === event.pointerId
        : gestureRef.current?.pointerIds.includes(event.pointerId)
    ) {
      gestureRef.current = null
    }

    if (!gestureRef.current) delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section className="exploded-view" aria-label="Exploded view of a Yugilife card template">
      <div
        ref={stageRef}
        className="exploded-view__stage"
        aria-label="Drag to rotate the card layers, right-drag or use two fingers to move, and scroll to zoom"
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
      >
        <div
          ref={sceneRef}
          className="exploded-view__scene"
          style={{ "--zoom": zoom } as CSSProperties}
        >
          <div
            className="exploded-view__layer"
            data-layer="cardBackground"
            style={nextLayerStyle()}
          >
            <div className="exploded-view__card-surface" />
          </div>

          <div className="exploded-view__layer" data-layer="border" style={nextLayerStyle()}>
            <img alt="" draggable={false} src={border} />
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumXyzFrameTexture"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <defs>
                <filter id={svgId("invert-artwork-mask")} colorInterpolationFilters="sRGB">
                  <feComponentTransfer>
                    <feFuncR type="table" tableValues="1 0" />
                    <feFuncG type="table" tableValues="1 0" />
                    <feFuncB type="table" tableValues="1 0" />
                    <feFuncA type="identity" />
                  </feComponentTransfer>
                </filter>
                <mask
                  id={svgId("xyz-artwork-cutout")}
                  height="1185"
                  maskUnits="userSpaceOnUse"
                  width="813"
                  x="0"
                  y="0"
                >
                  <image
                    filter={`url(#${svgId("invert-artwork-mask")})`}
                    height="1185"
                    href={pendulumArtworkMask}
                    width="813"
                    x="0"
                    y="0"
                  />
                </mask>
              </defs>
              <g mask={`url(#${svgId("xyz-artwork-cutout")})`}>
                <image height="1128" href={xyzTexture} width="757" x="28" y="28" />
              </g>
            </svg>
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumSpellFrameTexture"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <defs>
                <mask
                  id={svgId("spell-frame-bottom-mask")}
                  height="1185"
                  maskUnits="userSpaceOnUse"
                  width="813"
                  x="0"
                  y="0"
                >
                  <image height="1185" href={pendulumFrameBottomMask} width="813" x="0" y="0" />
                </mask>
              </defs>
              <g mask={`url(#${svgId("spell-frame-bottom-mask")})`}>
                <image height="1128" href={pendulumSpellTexture} width="757" x="28" y="28" />
              </g>
            </svg>
          </div>

          <div className="exploded-view__layer" data-layer="frameBevel" style={nextLayerStyle()}>
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <defs>
                <filter id={svgId("frame-bevel-invert-mask")} colorInterpolationFilters="sRGB">
                  <feComponentTransfer>
                    <feFuncR type="table" tableValues="1 0" />
                    <feFuncG type="table" tableValues="1 0" />
                    <feFuncB type="table" tableValues="1 0" />
                    <feFuncA type="identity" />
                  </feComponentTransfer>
                </filter>
                <mask
                  id={svgId("frame-bevel-xyz-mask")}
                  height="1185"
                  maskUnits="userSpaceOnUse"
                  width="813"
                  x="0"
                  y="0"
                >
                  <image
                    filter={`url(#${svgId("frame-bevel-invert-mask")})`}
                    height="1185"
                    href={pendulumArtworkMask}
                    width="813"
                    x="0"
                    y="0"
                  />
                </mask>
                <mask
                  id={svgId("frame-bevel-spell-mask")}
                  height="1185"
                  maskUnits="userSpaceOnUse"
                  width="813"
                  x="0"
                  y="0"
                >
                  <image height="1185" href={pendulumFrameBottomMask} width="813" x="0" y="0" />
                </mask>
              </defs>
              <g mask={`url(#${svgId("frame-bevel-xyz-mask")})`}>
                <path d="M28 28H785V31H28ZM28 28H31V1156H28Z" fill="#efdfdf52" />
                <path d="M28 1153H785V1156H28ZM782 28H785V1156H782Z" fill="#5a47475e" />
              </g>
              <g mask={`url(#${svgId("frame-bevel-spell-mask")})`}>
                <path d="M28 28H785V31H28ZM28 28H31V1156H28Z" fill="#ffffff52" />
                <path d="M28 1153H785V1156H28ZM782 28H785V1156H782Z" fill="#0000005e" />
              </g>
            </svg>
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumArtwork"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <defs>
                <clipPath id={svgId("pendulum-artwork-region")}>
                  <rect height="903" width="703" x="55" y="212" />
                </clipPath>
                <mask
                  id={svgId("pendulum-artwork-mask")}
                  height="1185"
                  maskUnits="userSpaceOnUse"
                  width="813"
                  x="0"
                  y="0"
                >
                  <image height="1185" href={pendulumArtworkMask} width="813" x="0" y="0" />
                </mask>
              </defs>
              <image
                clipPath={`url(#${svgId("pendulum-artwork-region")})`}
                height="899.56"
                href={artwork}
                mask={`url(#${svgId("pendulum-artwork-mask")})`}
                preserveAspectRatio="none"
                width="703"
                x="55"
                y="212"
              />
            </svg>
          </div>

          <div
            className="exploded-view__layer"
            data-layer="effectBoxTexture"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <image height="237" href={effectBoxTexture} width="709" x="52" y="882" />
            </svg>
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumEffectTexture"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <defs>
                <mask
                  id={svgId("pendulum-effect-box-medium")}
                  height="1185"
                  maskUnits="userSpaceOnUse"
                  width="813"
                  x="0"
                  y="0"
                >
                  <rect fill="#000" height="1185" width="813" />
                  <rect fill="#fff" height="148" width="709" x="52" y="737" />
                </mask>
              </defs>
              <image
                height="237"
                href={pendulumEffectTexture}
                mask={`url(#${svgId("pendulum-effect-box-medium")})`}
                width="709"
                x="52"
                y="645"
              />
            </svg>
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumBorder"
            style={nextLayerStyle()}
          >
            <img alt="" draggable={false} src={pendulumBorder} />
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumScaleMarkerLeft"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <image height="39" href={pendulumScaleLeft} width="51" x="59" y="769" />
            </svg>
          </div>

          <div
            className="exploded-view__layer"
            data-layer="pendulumScaleMarkerRight"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <image height="39" href={pendulumScaleRight} width="51" x="704" y="769" />
            </svg>
          </div>

          <div className="exploded-view__layer" data-layer="titleBevel" style={nextLayerStyle()}>
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <path d="M45 47.5H769L761.5 55H52.5ZM45 47.5V138.5L52.5 131V55Z" fill="#efdfdf52" />
              <path
                d="M45 138.5H769L761.5 131H52.5ZM769 47.5V138.5L761.5 131V55Z"
                fill="#5a47475e"
              />
            </svg>
          </div>

          <div className="exploded-view__layer" data-layer="rankStar" style={nextLayerStyle()}>
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              {[89.6, 143.2, 196.8, 250.4, 304, 357.6, 411.2].map((x) => (
                <image key={x} height="49" href={starRank} width="49" x={x} y="145" />
              ))}
            </svg>
          </div>

          <div className="exploded-view__layer" data-layer="attributeDark" style={nextLayerStyle()}>
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <image height="76" href={attributeDark} width="76" x="678" y="55" />
            </svg>
          </div>

          {GLYPH_LAYERS.map(([id, src]) => (
            <GlyphLayer key={id} id={id} src={src} style={nextLayerStyle()} />
          ))}

          <div
            className="exploded-view__layer"
            data-layer="statsSeparator"
            style={nextLayerStyle()}
          >
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 813 1185">
              <rect fill="#151515" height="2" width="683" x="65" y="1076" />
            </svg>
          </div>

          {STAT_GLYPH_LAYERS.map(([id, src]) => (
            <GlyphLayer key={id} id={id} src={src} style={nextLayerStyle()} />
          ))}
        </div>
      </div>

      <div className="exploded-view__controls">
        <Slider
          formatValue={(value) => `${value}%`}
          label="Explosion"
          max={100}
          min={0}
          value={explosion}
          variant="scrubber"
          onChange={setExplosion}
        />
        <p className="exploded-view__hint">
          Drag to rotate · right-drag or use two fingers to move · scroll to zoom
        </p>
      </div>
    </section>
  )
}

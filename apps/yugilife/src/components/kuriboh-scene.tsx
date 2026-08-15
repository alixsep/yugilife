// The scene is a deliberately isolated port of the supplied vanilla Three.js
// prototype. Its procedural object graph is runtime-owned by R3F rather than
// exposed as application data, so keep the prototype's dynamic graph local.
/* eslint-disable */
// @ts-nocheck
import { useEffect, useMemo, useRef } from "react"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Bloom, EffectComposer } from "@react-three/postprocessing"
import * as THREE from "three"

import { subscribeDeviceTilt } from "@/lib/device-tilt"

const settings = {
  scene: { exposure: 0.92, bloom: 0.09, bloomRadius: 0.28, fov: 34, bgBrightness: 1 },
  body: { size: 0.8, width: 1, height: 1, depth: 1, fluff: 1, tilt: -0.1 },
  face: { eyeSize: 0.51, eyeSpread: 0.62, eyeY: 0.21, iris: 3.1 },
  paws: { spread: 1, y: -0.02, size: 0.66, angle: 0.77, clawFan: 1.64, clawLength: 0.98 },
  feet: { spread: 1.25, y: 0.42, size: 1, angle: 0.3, clawFan: 1.56, clawLength: 0.95 },
  hat: {
    size: 1.14,
    tilt: 0.01,
    x: 0.02,
    y: 0.29,
    z: -0.16,
    stripes: 1,
    tailLength: 1,
    tailCurl: 1,
    globeSize: 1.01,
    globeReach: 0.2,
    globeX: -0.51,
    globeY: -0.85,
    globeZ: -0.79,
    starSize: 1.62,
  },
  motion: {
    floatAmp: 0.09,
    floatSpeed: 1.4,
    squash: 0.01,
    squashSpeed: 1.7,
    tilt: 0.02,
    tiltSpeed: 0.95,
  },
  lights: { hemi: 0.95, key: 1.2, fill: 0.45, rim: 0.62, lift: 0.3, shadows: true },
  fx: {
    depth: -1,
    sparkSize: 1,
    sparkIntensity: 1,
    sparkSpeed: 1,
    sparkLight: 1,
    bokeh: 1.32,
    flares: 0.99,
    motion: 1,
    enabled: true,
  },
}

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext("2d")!, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeSoftGlowTexture(rgb = "255,245,220") {
  return canvasTexture(128, 128, (ctx, width, height) => {
    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      width / 2,
    )
    gradient.addColorStop(0, `rgba(${rgb},0.96)`)
    gradient.addColorStop(0.25, `rgba(${rgb},0.40)`)
    gradient.addColorStop(0.65, `rgba(${rgb},0.12)`)
    gradient.addColorStop(1, `rgba(${rgb},0.0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  })
}

function makeEyeFrontTexture(
  irisScale = THREE.MathUtils.clamp(settings.face.iris / 1.94, 0.8, 1.6),
) {
  // `iris` is an authored texture scale, not a 3D object scale. The original
  // prototype used it on the whole front mesh, which made the textured face
  // grow beyond the sclera when the value was increased.
  const irisCenterX = 0.5
  const irisCenterY = 0.5
  return canvasTexture(384, 384, (ctx, width, height) => {
    ctx.fillStyle = "#d45857"
    ctx.beginPath()
    ctx.ellipse(
      width * irisCenterX,
      height * irisCenterY,
      width * 0.26 * irisScale,
      height * 0.29 * irisScale,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    ctx.fillStyle = "#2b0d10"
    ctx.beginPath()
    ctx.ellipse(
      width * irisCenterX,
      height * (irisCenterY + 0.06 * irisScale),
      width * 0.14 * irisScale,
      height * 0.15 * irisScale,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    ctx.strokeStyle = "#120b0b"
    ctx.lineWidth = 24 * (width / 768) * irisScale
    ctx.beginPath()
    ctx.ellipse(
      width * irisCenterX,
      height * irisCenterY,
      width * 0.26 * irisScale,
      height * 0.29 * irisScale,
      0,
      0,
      Math.PI * 2,
    )
    ctx.stroke()

    ctx.fillStyle = "rgba(255,255,255,0.98)"
    ctx.beginPath()
    ctx.ellipse(
      width * (irisCenterX - 0.11 * irisScale),
      height * (irisCenterY - 0.19 * irisScale),
      width * 0.09 * irisScale,
      height * 0.13 * irisScale,
      -0.35,
      0,
      Math.PI * 2,
    )
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(
      width * (irisCenterX - 0.02 * irisScale),
      height * (irisCenterY - 0.12 * irisScale),
      width * 0.04 * irisScale,
      height * 0.06 * irisScale,
      -0.15,
      0,
      Math.PI * 2,
    )
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(
      width * (irisCenterX + 0.11 * irisScale),
      height * (irisCenterY + 0.14 * irisScale),
      width * 0.045 * irisScale,
      height * 0.06 * irisScale,
      -0.1,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  })
}

function makeStripeTexture() {
  const textureSize = 512
  return canvasTexture(textureSize, textureSize, (ctx, width, height) => {
    ctx.fillStyle = "#2ab081"
    ctx.fillRect(0, 0, width, height)
    const period = (220 * textureSize) / 2048 / settings.hat.stripes
    for (let x = -height; x < width + height; x += period) {
      ctx.save()
      ctx.translate(x, 0)
      ctx.rotate(-0.34)
      ctx.fillStyle = "#111111"
      ctx.fillRect(0, -height, period * 0.62, height * 3)
      ctx.fillStyle = "#d63b39"
      ctx.fillRect(period * 0.09, -height, period * 0.44, height * 3)
      ctx.restore()
    }
    const gloss = ctx.createLinearGradient(0, 0, 0, height)
    gloss.addColorStop(0, "rgba(255,255,255,0.10)")
    gloss.addColorStop(0.28, "rgba(255,255,255,0.03)")
    gloss.addColorStop(1, "rgba(255,255,255,0.00)")
    ctx.fillStyle = gloss
    ctx.fillRect(0, 0, width, height)
  })
}

function makeBackgroundTexture() {
  return canvasTexture(900, 600, (ctx, width, height) => {
    const burstX = width * 0.5
    const burstY = height * 0.82
    const rayCount = 24
    const rayStep = (Math.PI * 2) / rayCount
    const rayRadius = Math.hypot(width, height) * 1.4

    ctx.fillStyle = "#244c35"
    ctx.fillRect(0, 0, width, height)

    // Crisp alternating wedges create the vintage screen-printed sunburst.
    for (let index = 0; index < rayCount; index += 1) {
      const start = -Math.PI / 2 + index * rayStep - rayStep * 0.5
      const end = start + rayStep
      ctx.fillStyle = index % 2 === 0 ? "#3f9b61" : "#b4404b"
      ctx.beginPath()
      ctx.moveTo(burstX, burstY)
      ctx.arc(burstX, burstY, rayRadius, start, end)
      ctx.closePath()
      ctx.fill()
    }

    // Warm focal glow softens the convergence point without blurring the rays.
    const centerGlow = ctx.createRadialGradient(burstX, burstY, 0, burstX, burstY, height * 0.42)
    centerGlow.addColorStop(0, "rgba(255,235,145,0.78)")
    centerGlow.addColorStop(0.16, "rgba(255,218,117,0.28)")
    centerGlow.addColorStop(0.56, "rgba(255,214,115,0.04)")
    centerGlow.addColorStop(1, "rgba(255,214,115,0)")
    ctx.fillStyle = centerGlow
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = "rgba(28,35,25,0.22)"
    ctx.lineWidth = 3
    for (let index = 0; index < rayCount; index += 1) {
      const angle = -Math.PI / 2 + index * rayStep - rayStep * 0.5
      ctx.beginPath()
      ctx.moveTo(burstX, burstY)
      ctx.lineTo(burstX + Math.cos(angle) * rayRadius, burstY + Math.sin(angle) * rayRadius)
      ctx.stroke()
    }

    ;[
      [0.08, 0.18, 0.42],
      [0.92, 0.22, 0.38],
      [0.12, 0.86, 0.32],
      [0.88, 0.78, 0.3],
    ].forEach(([x, y, radius]) => {
      const gradient = ctx.createRadialGradient(
        x * width,
        y * height,
        0,
        x * width,
        y * height,
        width * radius,
      )
      gradient.addColorStop(0, "rgba(255,92,92,0.36)")
      gradient.addColorStop(0.45, "rgba(210,38,58,0.14)")
      gradient.addColorStop(1, "rgba(140,18,32,0)")
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    })

    const zigzags = [
      {
        points: [
          [0.1, 0.19],
          [0.15, 0.1],
          [0.2, 0.2],
          [0.26, 0.08],
          [0.32, 0.18],
          [0.38, 0.07],
        ],
        color: "rgba(174,255,120,0.42)",
      },
      {
        points: [
          [0.64, 0.16],
          [0.7, 0.07],
          [0.76, 0.18],
          [0.82, 0.06],
          [0.88, 0.16],
          [0.95, 0.05],
        ],
        color: "rgba(255,116,132,0.38)",
      },
      {
        points: [
          [0.12, 0.74],
          [0.18, 0.64],
          [0.24, 0.76],
          [0.3, 0.62],
          [0.37, 0.73],
        ],
        color: "rgba(174,255,120,0.38)",
      },
      {
        points: [
          [0.64, 0.8],
          [0.7, 0.68],
          [0.76, 0.81],
          [0.83, 0.66],
          [0.9, 0.77],
        ],
        color: "rgba(255,116,132,0.36)",
      },
      {
        points: [
          [0.44, 0.11],
          [0.49, 0.04],
          [0.54, 0.12],
          [0.58, 0.03],
        ],
        color: "rgba(255,208,120,0.32)",
      },
    ]
    zigzags.forEach(({ points, color }) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 3.2
      ctx.beginPath()
      points.forEach(([x, y], index) => {
        const px = x * width
        const py = y * height
        if (index) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      })
      ctx.stroke()
    })

    function dashedStar(
      cx: number,
      cy: number,
      outer: number,
      inner: number,
      rotation = 0,
      color = "rgba(174,255,126,0.72)",
    ) {
      ctx.save()
      ctx.setLineDash([12, 10])
      ctx.strokeStyle = color
      ctx.lineWidth = 2.4
      ctx.beginPath()
      for (let index = 0; index < 10; index += 1) {
        const angle = rotation + (index * Math.PI) / 5 - Math.PI / 2
        const radius = index % 2 === 0 ? outer : inner
        const x = cx + Math.cos(angle) * radius
        const y = cy + Math.sin(angle) * radius
        if (index) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
    }

    ;[
      [0.16, 0.16, 52, 21, 0.12, "rgba(174,255,126,0.60)"],
      [0.82, 0.18, 60, 23, -0.18, "rgba(255,128,146,0.52)"],
      [0.28, 0.82, 44, 18, 0.15, "rgba(174,255,126,0.58)"],
      [0.72, 0.72, 54, 20, -0.12, "rgba(255,128,146,0.52)"],
      [0.5, 0.12, 32, 13, 0.06, "rgba(245,255,205,0.46)"],
      [0.92, 0.56, 30, 12, 0.2, "rgba(174,255,126,0.46)"],
      [0.08, 0.54, 34, 14, -0.2, "rgba(255,128,146,0.44)"],
    ].forEach(([x, y, outer, inner, rotation, color]) =>
      dashedStar(x * width, y * height, outer, inner, rotation, color),
    )

    ctx.save()
    ctx.filter = "blur(12px)"
    const circles = [
      [0.1, 0.12, 85, "rgba(208,255,190,0.46)"],
      [0.24, 0.12, 60, "rgba(208,255,190,0.28)"],
      [0.83, 0.16, 74, "rgba(255,165,165,0.24)"],
      [0.92, 0.14, 95, "rgba(255,165,165,0.22)"],
      [0.15, 0.84, 80, "rgba(208,255,190,0.24)"],
      [0.9, 0.82, 100, "rgba(255,165,165,0.20)"],
      [0.72, 0.64, 65, "rgba(208,255,190,0.22)"],
      [0.36, 0.8, 60, "rgba(255,165,165,0.18)"],
      [0.56, 0.18, 72, "rgba(208,255,190,0.28)"],
      [0.67, 0.24, 58, "rgba(255,165,165,0.20)"],
      [0.28, 0.42, 52, "rgba(208,255,190,0.18)"],
      [0.48, 0.72, 48, "rgba(255,165,165,0.16)"],
    ]
    circles.forEach(([x, y, radius, color]) => {
      const gradient = ctx.createRadialGradient(
        x * width,
        y * height,
        0,
        x * width,
        y * height,
        radius,
      )
      gradient.addColorStop(0, color)
      gradient.addColorStop(0.45, color.replace(/0\.\d+\)$/, "0.10)"))
      gradient.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = gradient
      ctx.fillRect(x * width - radius, y * height - radius, radius * 2, radius * 2)
    })
    ctx.restore()

    for (let index = 0; index < 260; index += 1) {
      const x = Math.random() * width
      const y = Math.random() * height
      const radius = 0.8 + Math.random() * 2.4
      const green = Math.random() < 0.55
      ctx.fillStyle = green
        ? `rgba(${(185 + Math.random() * 40) | 0},255,${(120 + Math.random() * 90) | 0},${0.16 + Math.random() * 0.32})`
        : `rgba(255,${(100 + Math.random() * 90) | 0},${(120 + Math.random() * 80) | 0},${0.12 + Math.random() * 0.26})`
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    for (let index = 0; index < 64; index += 1) {
      const x = Math.random() * width
      const y = Math.random() * height
      const size = 6 + Math.random() * 18
      ctx.strokeStyle = Math.random() < 0.5 ? "rgba(236,255,220,0.86)" : "rgba(255,182,192,0.68)"
      ctx.lineWidth = 1.5
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(x - size, y)
      ctx.lineTo(x + size, y)
      ctx.moveTo(x, y - size)
      ctx.lineTo(x, y + size)
      ctx.stroke()
    }
  })
}

function starShapeMesh(size = 0.28, depth = 0.1, color = 0xffd52a) {
  const shape = new THREE.Shape()
  for (let index = 0; index < 10; index += 1) {
    const angle = (index * Math.PI) / 5 - Math.PI / 2
    const radius = index % 2 === 0 ? size : size * 0.42
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: size * 0.05,
    bevelThickness: depth * 0.45,
  })
  geometry.center()
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive: 0xffe67d,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    }),
  )
}

function createEyeDomeGeometry(radius = 0.52, depth = 0.09, radialSegments = 64, rings = 12) {
  const positions = [0, 0, depth]
  const normals = [0, 0, 1]
  const uvs = [0.5, 0.5]
  const indices = []

  for (let ring = 1; ring <= rings; ring += 1) {
    const radialDistance = (radius * ring) / rings
    const domeDepth = depth * Math.sqrt(Math.max(0, 1 - (radialDistance / radius) ** 2))
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2
      const x = Math.cos(angle) * radialDistance
      const y = Math.sin(angle) * radialDistance
      positions.push(x, y, domeDepth)
      normals.push(x / radius, y / radius, depth / radius)
      uvs.push(0.5 + x / (radius * 2), 0.5 + y / (radius * 2))
    }
  }

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments
    indices.push(0, 1 + segment, 1 + next)
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const currentStart = 1 + (ring - 1) * radialSegments
    const nextStart = currentStart + radialSegments
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      indices.push(currentStart + segment, nextStart + segment, nextStart + next)
      indices.push(currentStart + segment, nextStart + next, currentStart + next)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function createEye(side: number) {
  const group = new THREE.Group()
  const sclera = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 36, 32),
    new THREE.MeshToonMaterial({ color: 0xffffff }),
  )
  sclera.scale.set(1.02, 1.16, 0.3)
  group.add(sclera)

  const outline = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 30, 26),
    new THREE.MeshBasicMaterial({ color: 0x120b0b, side: THREE.BackSide }),
  )
  outline.scale.set(1.08, 1.22, 0.36)
  group.add(outline)

  const irisTexture = makeEyeFrontTexture(1.4)
  const front = new THREE.Mesh(
    createEyeDomeGeometry(0.6),
    new THREE.MeshBasicMaterial({
      map: irisTexture,
      transparent: true,
      depthWrite: false,
    }),
  )
  // The dome follows the sclera's usable face; iris sizing happens in the texture above.
  front.position.set(0.02, -0.01, 0.1)
  group.add(front)
  group.userData = { front, side, irisBasePosition: front.position.clone() }
  return group
}

function createClawMesh() {
  const group = new THREE.Group()
  const geometry = new THREE.ConeGeometry(0.11, 0.46, 18)
  geometry.translate(0, 0.23, 0)
  const core = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: "#ead8ad" }))
  core.castShadow = true
  group.add(core)
  const outline = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({ color: 0x2a180f, side: THREE.BackSide }),
  )
  outline.scale.setScalar(1.1)
  group.add(outline)
  return group
}

function createPaw(side: number) {
  const group = new THREE.Group()
  const material = new THREE.MeshToonMaterial({ color: "#9aa887" })
  const dark = new THREE.MeshBasicMaterial({ color: 0x2a180f, side: THREE.BackSide })
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.46, 30, 24), material)
  palm.scale.set(0.85, 1.12, 0.55)
  palm.rotation.z = side * 0.26
  palm.castShadow = true
  group.add(palm)
  const thumbPad = new THREE.Mesh(new THREE.SphereGeometry(0.23, 22, 18), material)
  thumbPad.scale.set(1, 0.78, 0.5)
  thumbPad.position.set(side * -0.1, -0.1, 0.12)
  thumbPad.rotation.z = side * 0.4
  thumbPad.castShadow = true
  group.add(thumbPad)
  const outline = new THREE.Mesh(new THREE.SphereGeometry(0.46, 26, 20), dark)
  outline.scale.set(0.89, 1.16, 0.6)
  outline.rotation.z = side * 0.26
  group.add(outline)
  const claws = [createClawMesh(), createClawMesh(), createClawMesh()]
  claws.forEach((claw) => group.add(claw))
  group.userData = { side, claws }
  return group
}

function createFoot(side: number) {
  const group = new THREE.Group()
  const material = new THREE.MeshToonMaterial({ color: "#98a985" })
  const dark = new THREE.MeshBasicMaterial({ color: 0x2a180f, side: THREE.BackSide })
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.34, 26, 20), material)
  pad.scale.set(1.05, 0.68, 0.58)
  pad.castShadow = true
  group.add(pad)
  const outline = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 18), dark)
  outline.scale.set(1.11, 0.73, 0.63)
  group.add(outline)
  const claws = [createClawMesh(), createClawMesh(), createClawMesh()]
  claws.forEach((claw) => group.add(claw))
  group.userData = { side, claws }
  return group
}

function buildBodyGeometry() {
  const geometry = new THREE.SphereGeometry(1.62 * settings.body.size, 64, 48)
  const position = geometry.attributes.position
  const vector = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 1) {
    vector.fromBufferAttribute(position, index)
    const length = vector.length()
    const y01 = (vector.y / length + 1) * 0.5
    const angle = Math.atan2(vector.z, vector.x)
    const widthCurve = 1 + 0.08 * Math.exp(-(((y01 - 0.55) / 0.26) ** 2))
    const topNarrow = 1 - 0.18 * Math.exp(-(((y01 - 0.86) / 0.15) ** 2))
    const bottomBulb = 1 + 0.12 * Math.exp(-(((y01 - 0.18) / 0.12) ** 2))
    const noise =
      0.025 * settings.body.fluff * Math.sin(angle * 6 + y01 * 12) +
      0.018 * settings.body.fluff * Math.sin(angle * 11 - y01 * 7)
    vector.x *= settings.body.width * widthCurve * topNarrow * bottomBulb * (1 + noise)
    vector.z *=
      settings.body.depth *
      (0.96 + 0.04 * Math.cos(angle * 2)) *
      widthCurve *
      topNarrow *
      (1 + noise * 0.8)
    vector.y *= settings.body.height * (1.02 + 0.04 * Math.exp(-(((y01 - 0.72) / 0.18) ** 2)))
    position.setXYZ(index, vector.x, vector.y, vector.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

function cylinderBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const direction = new THREE.Vector3().subVectors(b, a)
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 8),
    material,
  )
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  return mesh
}

function addInstanceOpacityAttribute(
  geometry: THREE.InstancedBufferGeometry | THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  useInstanceEmissive = false,
) {
  const opacity = new Float32Array(count).fill(1)
  const attribute = new THREE.InstancedBufferAttribute(opacity, 1)
  attribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute("instanceOpacity", attribute)

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = [
      "attribute float instanceOpacity;",
      "varying float vInstanceOpacity;",
      useInstanceEmissive ? "attribute float instanceEmissive;" : "",
      useInstanceEmissive ? "varying float vInstanceEmissive;" : "",
      shader.vertexShader,
    ]
      .join("\n")
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "vInstanceOpacity = instanceOpacity;",
          useInstanceEmissive ? "vInstanceEmissive = instanceEmissive;" : "",
        ].join("\n"),
      )
    shader.fragmentShader = [
      "varying float vInstanceOpacity;",
      useInstanceEmissive ? "varying float vInstanceEmissive;" : "",
      shader.fragmentShader,
    ]
      .join("\n")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.a *= vInstanceOpacity;",
      )
    if (useInstanceEmissive) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "vec3 totalEmissiveRadiance = emissive;",
        "vec3 totalEmissiveRadiance = emissive * vInstanceEmissive;",
      )
    }
  }
  material.customProgramCacheKey = () =>
    useInstanceEmissive ? "yugilife-instance-opacity-emissive" : "yugilife-instance-opacity"
  material.needsUpdate = true
  return attribute
}

function createInstancedFxBatch(source: THREE.Mesh, count: number, useInstanceEmissive = false) {
  const material = source.material as THREE.Material & {
    opacity?: number
    emissiveIntensity?: number
  }
  if (material.opacity !== undefined) material.opacity = 1
  if (useInstanceEmissive && material.emissiveIntensity !== undefined) {
    material.emissiveIntensity = 1
  }
  const mesh = new THREE.InstancedMesh(source.geometry, material, count)
  mesh.frustumCulled = false
  const opacity = addInstanceOpacityAttribute(
    source.geometry as THREE.InstancedBufferGeometry,
    material,
    count,
    useInstanceEmissive,
  )
  let emissive: THREE.InstancedBufferAttribute | undefined
  if (useInstanceEmissive) {
    emissive = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    emissive.setUsage(THREE.DynamicDrawUsage)
    source.geometry.setAttribute("instanceEmissive", emissive)
  }
  return { mesh, opacity, emissive }
}

function createDashedStar3D(scale: number, color = 0x99ff72) {
  const group = new THREE.Group()
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = (index * Math.PI) / 5 - Math.PI / 2
    const radius = index % 2 === 0 ? 1 : 0.42
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
  })
  const dashData = []
  for (let index = 0; index < 10; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % 10]
    for (const [from, to] of [
      [0.08, 0.27],
      [0.39, 0.58],
      [0.7, 0.89],
    ]) {
      const a = new THREE.Vector3().lerpVectors(start, end, from)
      const b = new THREE.Vector3().lerpVectors(start, end, to)
      const direction = new THREE.Vector3().subVectors(b, a)
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      )
      dashData.push({
        center: a.clone().add(b).multiplyScalar(0.5),
        quaternion,
        scale: new THREE.Vector3(1, direction.length(), 1),
      })
    }
  }
  const dashGeometry = new THREE.CylinderGeometry(0.03, 0.03, 1, 8)
  const dashMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.2,
    roughness: 0.3,
    transparent: true,
    opacity: 0.92,
  })
  const dashMesh = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashData.length)
  const dashOpacity = addInstanceOpacityAttribute(dashGeometry, dashMaterial, dashData.length)
  const dashOrder = dashData.map((_, index) => index)
  const dashMatrix = new THREE.Matrix4()
  dashData.forEach((data: any, index: number) => {
    dashMatrix.compose(data.center, data.quaternion, data.scale)
    dashMesh.setMatrixAt(index, dashMatrix)
  })
  dashMesh.instanceMatrix.needsUpdate = true
  dashMesh.computeBoundingSphere()
  group.add(dashMesh)
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 18, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  group.add(glow)
  const light = new THREE.PointLight(color, 0.16, 2.6, 2)
  group.add(light)
  group.scale.setScalar(scale)
  return {
    group,
    dashMesh,
    dashMaterial,
    dashOpacity,
    dashData,
    dashOrder,
    dashMatrix,
    glow,
    light,
  }
}

function createGlitterShard(scale: number, color = 0xfff2a6) {
  const group = new THREE.Group()
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.1),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.4,
      roughness: 0.2,
      transparent: true,
      opacity: 0.95,
    }),
  )
  core.scale.set(0.65, 1.55, 0.65)
  group.add(core)
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  group.add(halo)
  group.scale.setScalar(scale)
  return { group, core, halo }
}

function createGlowOrb(scale: number, opacity: number, color = 0xffdd83) {
  const group = new THREE.Group()
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 18, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opacity * 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 20, 18),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opacity * 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  const outer = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 20, 18),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opacity * 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  const light = new THREE.PointLight(color, 0.16, 2.8, 2)
  group.add(core, shell, outer)
  group.scale.setScalar(scale)
  return { group, core, shell, outer, light }
}

function createVolumetricSpark(scale: number, opacity: number, variant = 0) {
  const group = new THREE.Group()
  const palettes = [
    { core: 0xfffbef, emissive: 0xffd567, shell: 0xffd36b, outer: 0xffefb8, ring: 0xffe4a0 },
    { core: 0xe6fff0, emissive: 0x8fffa5, shell: 0xb5ff75, outer: 0xe9ffd2, ring: 0xc8ff87 },
    { core: 0xffffff, emissive: 0xffef9c, shell: 0xffe08a, outer: 0xfff6d5, ring: 0xfff1bc },
  ]
  const palette = palettes[variant % palettes.length]
  const geometries = [
    new THREE.OctahedronGeometry(0.17),
    new THREE.TetrahedronGeometry(0.19),
    new THREE.IcosahedronGeometry(0.15),
  ]
  const core = new THREE.Mesh(
    geometries[variant % 3],
    new THREE.MeshStandardMaterial({
      color: palette.core,
      emissive: palette.emissive,
      emissiveIntensity: 2.5,
      roughness: 0.18,
    }),
  )
  core.scale.set(0.95, 1.35, 0.95)
  const inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.09),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  )
  const spike = (
    axis: "x" | "y" | "z",
    length: number,
    radius: number,
    color: number,
    opacityValue: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 18, 14),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: opacityValue,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    if (axis === "x") mesh.scale.set(length, radius, radius)
    if (axis === "y") mesh.scale.set(radius, length, radius)
    if (axis === "z") mesh.scale.set(radius, radius, length)
    return mesh
  }
  const spikeX = spike("x", 2.8, 0.26, palette.shell, opacity * 0.34)
  const spikeY = spike("y", 3.2, 0.24, palette.shell, opacity * 0.42)
  const spikeZ = spike("z", 2, 0.22, palette.outer, opacity * 0.18)
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 18, 16),
    new THREE.MeshBasicMaterial({
      color: palette.shell,
      transparent: true,
      opacity: opacity * 0.46,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  const outerShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 18, 16),
    new THREE.MeshBasicMaterial({
      color: palette.outer,
      transparent: true,
      opacity: opacity * 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.03, 10, 30),
    new THREE.MeshBasicMaterial({
      color: palette.ring,
      transparent: true,
      opacity: opacity * 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  ring.rotation.x = Math.PI * 0.5
  const light = new THREE.PointLight(palette.emissive, 0.4, 3.6, 2)
  group.add(core, inner, spikeX, spikeY, spikeZ, shell, outerShell, ring)
  group.scale.setScalar(scale)
  return { group, core, inner, spikeX, spikeY, spikeZ, shell, outerShell, ring, light }
}

function createKuribohWorld(renderer: THREE.WebGLRenderer) {
  const world = new THREE.Group()
  const root = new THREE.Group()
  root.position.y = 0.25
  const bodyGroup = new THREE.Group()
  const faceGroup = new THREE.Group()
  const hatGroup = new THREE.Group()
  const backTailGroup = new THREE.Group()
  const fxGroup = new THREE.Group()
  fxGroup.position.z = settings.fx.depth
  world.add(root, fxGroup)
  root.add(bodyGroup, faceGroup, hatGroup, backTailGroup)

  const hemisphere = new THREE.HemisphereLight(0xf5ffe8, 0x2a1118, settings.lights.hemi)
  const key = new THREE.DirectionalLight(0xffffff, settings.lights.key)
  key.position.set(-3, 4.8, 5)
  key.castShadow = false
  key.shadow.mapSize.set(1024, 1024)
  const fill = new THREE.DirectionalLight(0xffcf9e, settings.lights.fill)
  fill.position.set(4.3, 2.4, 4.5)
  const rim = new THREE.DirectionalLight(0xfff07d, settings.lights.rim)
  rim.position.set(-1.2, 3.5, -3.8)
  const lift = new THREE.PointLight(0xffd898, settings.lights.lift, 12, 2)
  lift.position.set(0, 1.5, 2.6)
  world.add(hemisphere, key, fill, rim, lift)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 64),
    new THREE.ShadowMaterial({ opacity: 0.18 }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -1.85
  shadow.receiveShadow = true
  shadow.visible = false
  world.add(shadow)
  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({
      map: makeSoftGlowTexture("255,215,110"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.172,
    }),
  )
  floorGlow.rotation.x = -Math.PI / 2
  floorGlow.position.y = -1.84
  floorGlow.visible = true
  world.add(floorGlow)

  const bodyMaterial = new THREE.MeshToonMaterial({ color: "#6b3f25" })
  const bodyState: any = { eyes: [], paws: [], feet: [], hatMeshes: [], hatOutlines: [] }
  const squareFitScale = 0.82
  const kuribohRotation = { x: 0, y: 0, z: 0 }
  const kuribohLookTarget = new THREE.Vector2()
  const kuribohLook = new THREE.Vector2()

  const bodyGeometry = buildBodyGeometry()
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.castShadow = true
  body.receiveShadow = true
  body.rotation.z = settings.body.tilt
  bodyGroup.add(body)
  const bodyOutline = new THREE.Mesh(
    bodyGeometry.clone(),
    new THREE.MeshBasicMaterial({ color: 0x2a180f, side: THREE.BackSide }),
  )
  bodyOutline.scale.setScalar(1.018)
  bodyOutline.rotation.z = settings.body.tilt
  bodyGroup.add(bodyOutline)

  const eyeL = createEye(-1)
  const eyeR = createEye(1)
  const pawL = createPaw(-1)
  const pawR = createPaw(1)
  const footL = createFoot(-1)
  const footR = createFoot(1)
  faceGroup.add(eyeL, eyeR, pawL, pawR, footL, footR)
  bodyState.eyes = [eyeL, eyeR]
  bodyState.paws = [pawL, pawR]
  bodyState.feet = [footL, footR]

  const hatTexture = makeStripeTexture()
  hatTexture.wrapS = hatTexture.wrapT = THREE.RepeatWrapping
  hatTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const hatMaterial = new THREE.MeshToonMaterial({ color: "#ffffff", map: hatTexture })
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x120b0b, side: THREE.BackSide })
  const capGeometry = new THREE.ConeGeometry(0.95, 1.45, 56, 1, false)
  const cap = new THREE.Mesh(capGeometry, hatMaterial)
  const capOutline = new THREE.Mesh(capGeometry.clone(), outlineMaterial)
  const brimGeometry = new THREE.TorusGeometry(0.78, 0.12, 18, 56)
  const brim = new THREE.Mesh(brimGeometry, new THREE.MeshToonMaterial({ color: "#1f9c7a" }))
  const brimOutline = new THREE.Mesh(brimGeometry.clone(), outlineMaterial)
  hatGroup.add(cap, capOutline, brim, brimOutline)

  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.62, 0.34, -1.02),
    new THREE.Vector3(1.15 * settings.hat.tailLength, 0.58 + 0.24 * settings.hat.tailCurl, -1.42),
    new THREE.Vector3(1.9 * settings.hat.tailLength, 0.26 + 0.12 * settings.hat.tailCurl, -1.14),
    new THREE.Vector3(2.36 * settings.hat.tailLength, -0.02 + 0.06 * settings.hat.tailCurl, -0.76),
  ])
  const tailGeometry = new THREE.TubeGeometry(tailCurve, 80, 0.15, 20, false)
  const tail = new THREE.Mesh(tailGeometry, hatMaterial)
  const tailOutline = new THREE.Mesh(tailGeometry.clone(), outlineMaterial)
  backTailGroup.add(tail, tailOutline)

  const stemCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.04, 1.9, 0.14),
    new THREE.Vector3(
      0.01 + 0.03 * settings.hat.globeReach + settings.hat.globeX * 0.15,
      2 + settings.hat.globeY * 0.1,
      0.16 + settings.hat.globeZ * 0.08,
    ),
    new THREE.Vector3(
      0.08 + 0.08 * settings.hat.globeReach + settings.hat.globeX * 0.4,
      2.08 + settings.hat.globeY * 0.32,
      0.18 + settings.hat.globeZ * 0.24,
    ),
  )
  const stemGeometry = new THREE.TubeGeometry(stemCurve, 36, 0.055, 14, false)
  const pomStem = new THREE.Mesh(stemGeometry, hatMaterial)
  const pomStemOutline = new THREE.Mesh(stemGeometry.clone(), outlineMaterial)
  const pom = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 28, 24),
    new THREE.MeshToonMaterial({ color: "#f1ca25" }),
  )
  const pomOutline = new THREE.Mesh(pom.geometry.clone(), outlineMaterial)
  hatGroup.add(pomStem, pomStemOutline, pom, pomOutline)

  const tipStar = starShapeMesh(0.26, 0.09, 0xffd42f)
  const tipStarOutline = new THREE.Mesh(tipStar.geometry.clone(), outlineMaterial)
  backTailGroup.add(tipStar, tipStarOutline)
  bodyState.hatMeshes = [cap, brim]
  bodyState.hatOutlines = [capOutline, brimOutline, pomOutline]
  bodyState.tail = tail
  bodyState.tailOutline = tailOutline
  bodyState.pomStem = pomStem
  bodyState.pomStemOutline = pomStemOutline
  bodyState.pom = pom
  bodyState.tipStar = tipStar
  bodyState.tipStarOutline = tipStarOutline
  bodyState.hatTexture = hatTexture
  bodyState.hatMaterial = hatMaterial

  function updateParts() {
    const eyeScale = settings.face.eyeSize
    const eyeSpread = 0.63 * settings.face.eyeSpread
    bodyState.eyes.forEach((eye: THREE.Group, index: number) => {
      const side = index === 0 ? -1 : 1
      eye.position.set(side * eyeSpread, settings.face.eyeY, 1.28)
      eye.scale.set(eyeScale, eyeScale, 1)
      eye.userData.front.scale.set(1, 1, 1)
    })
    const pawSpread = 1.02 * settings.paws.spread
    bodyState.paws.forEach((paw: THREE.Group, index: number) => {
      const side = index === 0 ? -1 : 1
      paw.position.set(side * pawSpread, settings.paws.y, 0.96)
      paw.rotation.z = side * -settings.paws.angle
      paw.rotation.y = side * 0.22
      paw.rotation.x = -0.1
      paw.scale.setScalar(settings.paws.size)
      const claws = [
        { x: side * 0.24, y: 0.15 * settings.paws.clawFan, z: 0.1, rz: side * -1.12, rx: -0.18 },
        { x: side * 0.31, y: 0, z: 0.14, rz: side * -1.32, rx: 0 },
        { x: side * 0.24, y: -0.15 * settings.paws.clawFan, z: 0.1, rz: side * -1.52, rx: 0.18 },
      ]
      paw.userData.claws.forEach((claw: THREE.Group, clawIndex: number) => {
        const data = claws[clawIndex]
        claw.position.set(data.x, data.y, data.z)
        claw.rotation.set(data.rx, 0, data.rz)
        claw.scale.set(0.95, settings.paws.clawLength, 0.95)
      })
    })
    bodyState.feet.forEach((foot: THREE.Group, index: number) => {
      const side = index === 0 ? -1 : 1
      foot.position.set(side * 0.62 * settings.feet.spread, -1.5 + settings.feet.y, 0.58)
      foot.rotation.z = side * -settings.feet.angle
      foot.rotation.x = 0.1
      foot.scale.setScalar(settings.feet.size)
      const claws = [
        {
          x: side * -0.14 * settings.feet.clawFan,
          y: 0.04,
          z: 0.08,
          direction: new THREE.Vector3(side * -0.34, -0.42, 1),
        },
        { x: 0, y: 0.06, z: 0.18, direction: new THREE.Vector3(0, -0.36, 1) },
        {
          x: side * 0.14 * settings.feet.clawFan,
          y: 0.04,
          z: 0.08,
          direction: new THREE.Vector3(side * 0.34, -0.42, 1),
        },
      ]
      const clawAxis = new THREE.Vector3(0, 1, 0)
      foot.userData.claws.forEach((claw: THREE.Group, clawIndex: number) => {
        const data = claws[clawIndex]
        claw.position.set(data.x, data.y, data.z)
        claw.quaternion.setFromUnitVectors(clawAxis, data.direction.normalize())
        claw.scale.set(0.74, settings.feet.clawLength * 0.9, 0.74)
      })
    })
    const size = settings.hat.size
    const tilt = settings.hat.tilt
    hatGroup.position.set(settings.hat.x, settings.hat.y, settings.hat.z)
    cap.position.set(-0.1, 1.22, 0.1)
    cap.rotation.set(-0.08, 0, tilt)
    cap.scale.setScalar(size)
    brim.position.set(-0.06, 0.66, 0.34)
    brim.rotation.set(Math.PI / 2.2, 0, tilt * 0.85)
    brim.scale.setScalar(size)
    const tailEnd = tailCurve.getPoint(1)
    const tailDirection = tailCurve.getTangent(1).normalize()
    tipStar.position.copy(tailEnd).addScaledVector(tailDirection, 0.2)
    tipStar.scale.setScalar(settings.hat.starSize)
    tipStar.rotation.set(0.18, -0.55, Math.PI)
    capOutline.position.copy(cap.position)
    capOutline.rotation.copy(cap.rotation)
    capOutline.scale.copy(cap.scale).multiplyScalar(1.045)
    brimOutline.position.copy(brim.position)
    brimOutline.rotation.copy(brim.rotation)
    brimOutline.scale.copy(brim.scale).multiplyScalar(1.055)
    tailOutline.scale.setScalar(1.055)
    pom.position.copy(stemCurve.getPoint(1))
    pom.scale.setScalar(size * settings.hat.globeSize)
    pomOutline.position.copy(pom.position)
    pomOutline.scale.copy(pom.scale).multiplyScalar(1.07)
    tipStarOutline.position.copy(tipStar.position)
    tipStarOutline.rotation.copy(tipStar.rotation)
    tipStarOutline.scale.copy(tipStar.scale).multiplyScalar(1.08)
  }
  updateParts()

  const atmosphere: any = { glows: [], stars: [], glitter: [], sparks: [] }
  const glowData = [
    [-3.6, 2.5, -1.1, 1.9, 0.16, 0xb8ff8e],
    [-2, 2.8, -0.6, 1.4, 0.12, 0xc5ff9f],
    [3.1, 2.1, -0.8, 2, 0.16, 0xb8ff8e],
    [-3, -1.8, 0.6, 1.8, 0.13, 0x8eff9f],
    [3.3, -1.5, 0.9, 1.8, 0.13, 0x8eff9f],
    [0, 2.9, -1, 1.5, 0.1, 0xd6ff98],
    [-0.8, 0.7, 1.1, 1, 0.08, 0xb0ff9f],
    [1.8, 0.2, 1, 1.1, 0.08, 0xe5ffb0],
    [-1.8, 0, 0.9, 1.1, 0.08, 0xe5ffb0],
  ]
  const glowItems = glowData.map(([x, y, z, scale, opacity, color]) => ({
    color,
    basePos: new THREE.Vector3(x, y, z),
    baseScale: scale,
    baseOpacity: opacity,
    seed: Math.random() * 100,
    pulse: 0.28 + Math.random() * 0.28,
    drift: 0.24 + Math.random() * 0.28,
  }))
  const glowBatches = new Map<number, any>()
  for (const color of new Set(glowItems.map((item) => item.color))) {
    const count = glowItems.filter((item) => item.color === color).length
    const source = createGlowOrb(1, 1, color)
    const batch = {
      core: createInstancedFxBatch(source.core, count),
      shell: createInstancedFxBatch(source.shell, count),
      outer: createInstancedFxBatch(source.outer, count),
      nextIndex: 0,
    }
    fxGroup.add(batch.core.mesh, batch.shell.mesh, batch.outer.mesh)
    glowBatches.set(color, batch)
  }
  glowItems.forEach((item) => {
    const batch = glowBatches.get(item.color)
    item.batch = batch
    item.index = batch.nextIndex
    batch.nextIndex += 1
    atmosphere.glows.push(item)
  })
  const starData = [
    [-3.6, 2.5, 0.2, 0.6],
    [-2.5, 2.9, -0.6, 0.44],
    [-1.1, 2.2, 0.8, 0.36],
    [3.3, 2.7, -0.4, 0.52],
    [2.1, 2.1, 0.9, 0.4],
    [-3.2, -1.6, 0.9, 0.46],
    [-2.2, -0.4, 1.1, 0.34],
    [3.5, -1.4, 0.9, 0.54],
    [1.8, -0.8, 1.2, 0.32],
    [0, 2.85, 0.4, 0.42],
    [0.4, -1.8, 0.7, 0.36],
  ]
  starData.forEach(([x, y, z, scale]) => {
    const fx = createDashedStar3D(scale)
    fx.group.position.set(x, y, z)
    fxGroup.add(fx.group)
    atmosphere.stars.push({
      fx,
      basePos: fx.group.position.clone(),
      baseScale: scale,
      seed: Math.random() * 100,
      pulse: 0.42 + Math.random() * 0.38,
      drift: 0.12 + Math.random() * 0.14,
      rot: Math.random() * Math.PI * 2,
    })
  })
  const glitterColors = [0xfff0a0, 0xffffff, 0xc6ff9a, 0xffd96a]
  const glitterCount = 70
  const glitterBatches = new Map<number, any>()
  const glitterIndices = new Map<number, number>()
  for (const color of glitterColors) {
    const count = Math.ceil(glitterCount / glitterColors.length)
    const coreMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.4,
      roughness: 0.2,
      transparent: true,
      opacity: 1,
    })
    const haloMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const coreMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.1), coreMaterial, count)
    const haloMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      haloMaterial,
      count,
    )
    const coreEmissive = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(2.4), 1)
    coreEmissive.setUsage(THREE.DynamicDrawUsage)
    coreMesh.geometry.setAttribute("instanceEmissive", coreEmissive)
    const coreOpacity = addInstanceOpacityAttribute(coreMesh.geometry, coreMaterial, count, true)
    const haloOpacity = addInstanceOpacityAttribute(haloMesh.geometry, haloMaterial, count)
    fxGroup.add(coreMesh, haloMesh)
    glitterBatches.set(color, { coreMesh, haloMesh, coreOpacity, coreEmissive, haloOpacity })
    glitterIndices.set(color, 0)
  }
  const glitterMatrix = new THREE.Matrix4()
  const glitterQuaternion = new THREE.Quaternion()
  const glitterEuler = new THREE.Euler()
  const glitterPosition = new THREE.Vector3()
  const glitterScale = new THREE.Vector3()
  for (let index = 0; index < glitterCount; index += 1) {
    const color = glitterColors[index % glitterColors.length]
    const batch = glitterBatches.get(color)
    const batchIndex = glitterIndices.get(color) ?? 0
    glitterIndices.set(color, batchIndex + 1)
    const baseScale = THREE.MathUtils.randFloat(0.18, 0.42)
    const basePos = new THREE.Vector3(
      THREE.MathUtils.randFloat(-3.8, 3.8),
      THREE.MathUtils.randFloat(-2.2, 3.2),
      THREE.MathUtils.randFloat(-1.4, 1.4),
    )
    glitterPosition.copy(basePos)
    glitterScale.set(0.65 * baseScale, 1.55 * baseScale, 0.65 * baseScale)
    glitterMatrix.compose(glitterPosition, glitterQuaternion, glitterScale)
    batch.coreMesh.setMatrixAt(batchIndex, glitterMatrix)
    glitterScale.set(baseScale, baseScale, baseScale)
    glitterMatrix.compose(glitterPosition, glitterQuaternion, glitterScale)
    batch.haloMesh.setMatrixAt(batchIndex, glitterMatrix)
    batch.coreOpacity.array[batchIndex] = 0.95
    batch.coreEmissive.array[batchIndex] = 2.4
    batch.haloOpacity.array[batchIndex] = 0.1
    atmosphere.glitter.push({
      batch,
      index: batchIndex,
      basePos,
      baseScale,
      seed: Math.random() * 100,
      pulse: 0.8 + Math.random() * 1.4,
      drift: 0.14 + Math.random() * 0.24,
      rot: Math.random() * Math.PI * 2,
    })
  }
  for (const batch of glitterBatches.values()) {
    batch.coreMesh.instanceMatrix.needsUpdate = true
    batch.haloMesh.instanceMatrix.needsUpdate = true
    batch.coreOpacity.needsUpdate = true
    batch.coreEmissive.needsUpdate = true
    batch.haloOpacity.needsUpdate = true
    batch.coreMesh.computeBoundingSphere()
    batch.haloMesh.computeBoundingSphere()
  }
  const sparkData = [
    [-3, 2.1, 0.3, 0.26],
    [-2.1, 1.1, -0.2, 0.28],
    [-1.2, 2.6, 1, 0.3],
    [0, 2, -0.6, 0.24],
    [1, 1.3, 1.2, 0.3],
    [2.2, 2.2, 0.2, 0.24],
    [3, 1, -0.5, 0.26],
    [-2.9, -0.8, 1, 0.24],
    [-1.2, -1.8, 0.8, 0.26],
    [-0.1, -1, 1.2, 0.2],
    [0.8, -1.5, -0.3, 0.24],
    [1.4, 0.4, 1.1, 0.22],
    [2, -1.2, 1, 0.26],
    [3.1, -0.5, -0.6, 0.24],
    [2.6, 1.4, 1.2, 0.22],
    [-2.4, 1.8, 1, 0.22],
  ]
  const sparkItems = sparkData.map(([x, y, z, opacity]) => ({
    variant: Math.floor(Math.random() * 3),
    basePos: new THREE.Vector3(x, y, z),
    baseScale: 0.52 + Math.random() * 0.32,
    baseOpacity: opacity,
    seed: Math.random() * 100,
    pulse: 0.9 + Math.random() * 0.9,
    drift: 0.18 + Math.random() * 0.22,
    rot: Math.random() * Math.PI * 2,
  }))
  const sparkBatches = new Map<number, any>()
  for (let variant = 0; variant < 3; variant += 1) {
    const count = sparkItems.filter((item) => item.variant === variant).length
    const source = createVolumetricSpark(1, 1, variant)
    source.group.updateMatrixWorld(true)
    const batches = {
      core: createInstancedFxBatch(source.core, count, true),
      inner: createInstancedFxBatch(source.inner, count),
      spikeX: createInstancedFxBatch(source.spikeX, count),
      spikeY: createInstancedFxBatch(source.spikeY, count),
      spikeZ: createInstancedFxBatch(source.spikeZ, count),
      shell: createInstancedFxBatch(source.shell, count),
      outerShell: createInstancedFxBatch(source.outerShell, count),
      ring: createInstancedFxBatch(source.ring, count),
      locals: {
        core: source.core.matrix.clone(),
        inner: source.inner.matrix.clone(),
        spikeX: source.spikeX.matrix.clone(),
        spikeY: source.spikeY.matrix.clone(),
        spikeZ: source.spikeZ.matrix.clone(),
        shell: source.shell.matrix.clone(),
        outerShell: source.outerShell.matrix.clone(),
      },
      nextIndex: 0,
    }
    fxGroup.add(
      batches.core.mesh,
      batches.inner.mesh,
      batches.spikeX.mesh,
      batches.spikeY.mesh,
      batches.spikeZ.mesh,
      batches.shell.mesh,
      batches.outerShell.mesh,
      batches.ring.mesh,
    )
    sparkBatches.set(variant, batches)
  }
  sparkItems.forEach((item) => {
    const batch = sparkBatches.get(item.variant)
    item.batch = batch
    item.index = batch.nextIndex
    batch.nextIndex += 1
    atmosphere.sparks.push(item)
  })

  const sparkGroupMatrix = new THREE.Matrix4()
  const sparkComponentMatrix = new THREE.Matrix4()
  const sparkPosition = new THREE.Vector3()
  const sparkScale = new THREE.Vector3()
  const sparkEuler = new THREE.Euler()
  const sparkQuaternion = new THREE.Quaternion()
  const sparkRingEuler = new THREE.Euler()
  const sparkRingQuaternion = new THREE.Quaternion()
  const sparkRingScale = new THREE.Vector3()
  const sparkRingMatrix = new THREE.Matrix4()
  const sparkOrigin = new THREE.Vector3()
  const glowMatrix = new THREE.Matrix4()
  const glowPosition = new THREE.Vector3()
  const glowQuaternion = new THREE.Quaternion()
  const glowScale = new THREE.Vector3()

  return {
    world,
    backgroundTexture: makeBackgroundTexture(),
    update(time: number, delta = 1 / 60, pointer?: THREE.Vector2) {
      root.position.y =
        0.25 + Math.sin(time * settings.motion.floatSpeed) * settings.motion.floatAmp
      const squash = 1 + Math.sin(time * settings.motion.squashSpeed) * settings.motion.squash
      root.scale.set(squareFitScale / squash, squareFitScale * squash, squareFitScale / squash)
      kuribohLookTarget.set(
        THREE.MathUtils.clamp(pointer?.x ?? 0, -1, 1),
        THREE.MathUtils.clamp(pointer?.y ?? 0, -1, 1),
      )
      kuribohLook.lerp(kuribohLookTarget, 1 - Math.exp(-delta * 5))
      root.rotation.set(
        kuribohRotation.x - kuribohLook.y * 0.4,
        kuribohRotation.y + kuribohLook.x * 0.57,
        kuribohRotation.z +
          settings.body.tilt +
          Math.sin(time * settings.motion.tiltSpeed) * settings.motion.tilt,
      )
      bodyState.eyes.forEach((eye: THREE.Group) => {
        const front = eye.userData.front
        const basePosition = eye.userData.irisBasePosition
        front.position.set(
          basePosition.x + kuribohLook.x * 0.08,
          basePosition.y + kuribohLook.y * 0.08,
          basePosition.z,
        )
      })
      hatGroup.rotation.z = Math.sin(time * 0.8) * 0.03
      tipStar.rotation.set(
        0.18 + Math.sin(time * 0.9) * 0.05,
        -0.55 + Math.sin(time * 1.2) * 0.15,
        Math.PI + time * 0.55,
      )
      tipStarOutline.position.copy(tipStar.position)
      tipStarOutline.rotation.copy(tipStar.rotation)
      tipStarOutline.scale.copy(tipStar.scale).multiplyScalar(1.08)
      atmosphere.glows.forEach((item: any) => {
        const phase = 0.5 + 0.5 * Math.sin(time * (item.pulse * settings.fx.sparkSpeed) + item.seed)
        const fade = phase * phase * (3 - 2 * phase)
        const batch = item.batch
        const index = item.index
        glowScale.setScalar(item.baseScale * (0.84 + 0.28 * fade) * settings.fx.sparkSize)
        glowPosition.set(
          item.basePos.x + Math.sin(time * item.drift + item.seed) * 0.18 * settings.fx.motion,
          item.basePos.y +
            Math.cos(time * item.drift * 1.3 + item.seed) * 0.16 * settings.fx.motion,
          item.basePos.z +
            Math.sin(time * item.drift * 0.9 + item.seed) * 0.12 * settings.fx.motion,
        )
        glowMatrix.compose(glowPosition, glowQuaternion, glowScale)
        batch.core.mesh.setMatrixAt(index, glowMatrix)
        batch.shell.mesh.setMatrixAt(index, glowMatrix)
        batch.outer.mesh.setMatrixAt(index, glowMatrix)
        batch.core.opacity.array[index] =
          item.baseOpacity * (0.25 + 0.95 * fade) * settings.fx.bokeh
        batch.shell.opacity.array[index] =
          item.baseOpacity * (0.06 + 0.38 * fade) * settings.fx.bokeh
        batch.outer.opacity.array[index] =
          item.baseOpacity * (0.015 + 0.16 * fade) * settings.fx.bokeh
      })
      for (const batch of glowBatches.values()) {
        batch.core.mesh.instanceMatrix.needsUpdate = true
        batch.shell.mesh.instanceMatrix.needsUpdate = true
        batch.outer.mesh.instanceMatrix.needsUpdate = true
        batch.core.opacity.needsUpdate = true
        batch.shell.opacity.needsUpdate = true
        batch.outer.opacity.needsUpdate = true
      }
      atmosphere.stars.forEach((item: any) => {
        const phase = 0.5 + 0.5 * Math.sin(time * item.pulse * settings.fx.sparkSpeed + item.seed)
        const flash = phase ** 2.8
        item.fx.group.scale.setScalar(
          item.baseScale * (0.78 + 0.85 * flash) * settings.fx.sparkSize,
        )
        item.fx.group.position.x =
          item.basePos.x + Math.sin(time * item.drift + item.seed) * 0.1 * settings.fx.motion
        item.fx.group.position.y =
          item.basePos.y + Math.cos(time * item.drift * 1.2 + item.seed) * 0.1 * settings.fx.motion
        item.fx.group.rotation.y = Math.sin(time * 0.32 + item.rot) * 0.35
        item.fx.group.rotation.z = item.rot + time * 0.16
        const dashOrder = item.fx.dashOrder
        dashOrder.sort(
          (left: number, right: number) =>
            -Math.sin(item.fx.group.rotation.y) * item.fx.dashData[left].center.x -
            -Math.sin(item.fx.group.rotation.y) * item.fx.dashData[right].center.x,
        )
        dashOrder.forEach((dashIndex: number, index: number) => {
          const dash = item.fx.dashData[dashIndex]
          item.fx.dashMatrix.compose(dash.center, dash.quaternion, dash.scale)
          item.fx.dashMesh.setMatrixAt(index, item.fx.dashMatrix)
          item.fx.dashOpacity.array[index] =
            (0.12 + 0.88 * flash * (0.86 + 0.14 * Math.sin(time * 2 + dashIndex))) *
            settings.fx.flares
        })
        item.fx.dashMesh.instanceMatrix.needsUpdate = true
        item.fx.dashOpacity.needsUpdate = true
        item.fx.dashMaterial.emissiveIntensity = (0.4 + 3 * flash) * settings.fx.sparkIntensity
        item.fx.glow.material.opacity = (0.01 + 0.12 * flash) * settings.fx.flares
        item.fx.light.intensity = (0.01 + 0.32 * flash) * settings.fx.sparkLight
      })
      atmosphere.glitter.forEach((item: any) => {
        const phase = 0.5 + 0.5 * Math.sin(time * item.pulse * settings.fx.sparkSpeed + item.seed)
        const flash = phase ** 4
        const scale = item.baseScale * (0.25 + 1.35 * flash) * settings.fx.sparkSize
        glitterPosition.set(
          item.basePos.x + Math.sin(time * item.drift + item.seed) * 0.05 * settings.fx.motion,
          item.basePos.y +
            Math.cos(time * item.drift * 1.4 + item.seed) * 0.06 * settings.fx.motion,
          item.basePos.z,
        )
        glitterEuler.set(time * 0.5 + item.rot, time * 0.7 + item.rot * 0.6, 0)
        glitterQuaternion.setFromEuler(glitterEuler)
        glitterScale.set(0.65 * scale, 1.55 * scale, 0.65 * scale)
        glitterMatrix.compose(glitterPosition, glitterQuaternion, glitterScale)
        item.batch.coreMesh.setMatrixAt(item.index, glitterMatrix)
        glitterScale.set(scale, scale, scale)
        glitterMatrix.compose(glitterPosition, glitterQuaternion, glitterScale)
        item.batch.haloMesh.setMatrixAt(item.index, glitterMatrix)
        item.batch.coreOpacity.array[item.index] = (0.03 + 0.97 * flash) * settings.fx.flares
        item.batch.coreEmissive.array[item.index] = (0.3 + 5 * flash) * settings.fx.sparkIntensity
        item.batch.haloOpacity.array[item.index] = (0.005 + 0.16 * flash) * settings.fx.flares
      })
      for (const batch of glitterBatches.values()) {
        batch.coreMesh.instanceMatrix.needsUpdate = true
        batch.haloMesh.instanceMatrix.needsUpdate = true
        batch.coreOpacity.needsUpdate = true
        batch.coreEmissive.needsUpdate = true
        batch.haloOpacity.needsUpdate = true
      }
      atmosphere.sparks.forEach((item: any) => {
        const phase = 0.5 + 0.5 * Math.sin(time * item.pulse * settings.fx.sparkSpeed + item.seed)
        const flash = phase ** 4.8
        const grow = (0.68 + 1.7 * flash) * settings.fx.sparkSize
        sparkPosition.set(
          item.basePos.x + Math.sin(time * item.drift + item.seed) * 0.1 * settings.fx.motion,
          item.basePos.y +
            Math.cos(time * item.drift * 1.5 + item.seed) * 0.12 * settings.fx.motion,
          item.basePos.z +
            Math.sin(time * item.drift * 1.1 + item.seed) * 0.08 * settings.fx.motion,
        )
        sparkEuler.set(
          Math.sin(time * 0.8 + item.rot) * 0.6,
          time + item.rot,
          Math.cos(time * 0.7 + item.rot) * 0.45,
        )
        sparkQuaternion.setFromEuler(sparkEuler)
        sparkScale.setScalar(item.baseScale * grow)
        sparkGroupMatrix.compose(sparkPosition, sparkQuaternion, sparkScale)

        const batch = item.batch
        const index = item.index
        const setComponentMatrix = (name: string, component: any) => {
          sparkComponentMatrix.copy(sparkGroupMatrix).multiply(batch.locals[name])
          component.mesh.setMatrixAt(index, sparkComponentMatrix)
        }
        setComponentMatrix("core", batch.core)
        setComponentMatrix("inner", batch.inner)
        setComponentMatrix("spikeX", batch.spikeX)
        setComponentMatrix("spikeY", batch.spikeY)
        setComponentMatrix("spikeZ", batch.spikeZ)
        setComponentMatrix("shell", batch.shell)
        setComponentMatrix("outerShell", batch.outerShell)

        sparkRingEuler.set(
          Math.PI * 0.5 + 0.55 * Math.sin(time * 0.9 + item.rot),
          time * 0.8 + item.rot * 0.5,
          item.rot + time * 0.45,
        )
        sparkRingQuaternion.setFromEuler(sparkRingEuler)
        sparkRingScale.setScalar(0.85 + 0.65 * flash)
        sparkRingMatrix.compose(sparkOrigin, sparkRingQuaternion, sparkRingScale)
        sparkComponentMatrix.copy(sparkGroupMatrix).multiply(sparkRingMatrix)
        batch.ring.mesh.setMatrixAt(index, sparkComponentMatrix)

        batch.core.opacity.array[index] = 1
        batch.core.emissive.array[index] = (0.7 + 5.8 * flash) * settings.fx.sparkIntensity
        batch.inner.opacity.array[index] = 0.08 + 0.92 * flash * settings.fx.sparkIntensity
        batch.spikeX.opacity.array[index] =
          item.baseOpacity * (0.06 + 1.15 * flash) * settings.fx.sparkIntensity
        batch.spikeY.opacity.array[index] =
          item.baseOpacity * (0.08 + 1.35 * flash) * settings.fx.sparkIntensity
        batch.spikeZ.opacity.array[index] =
          item.baseOpacity * (0.03 + 0.65 * flash) * settings.fx.sparkIntensity
        batch.shell.opacity.array[index] =
          item.baseOpacity * (0.04 + 1.25 * flash) * settings.fx.sparkIntensity
        batch.outerShell.opacity.array[index] =
          item.baseOpacity * (0.02 + 0.78 * flash) * settings.fx.sparkIntensity
        batch.ring.opacity.array[index] =
          item.baseOpacity * (0.01 + 0.7 * flash) * settings.fx.sparkIntensity
      })
      for (const batch of sparkBatches.values()) {
        batch.core.mesh.instanceMatrix.needsUpdate = true
        batch.inner.mesh.instanceMatrix.needsUpdate = true
        batch.spikeX.mesh.instanceMatrix.needsUpdate = true
        batch.spikeY.mesh.instanceMatrix.needsUpdate = true
        batch.spikeZ.mesh.instanceMatrix.needsUpdate = true
        batch.shell.mesh.instanceMatrix.needsUpdate = true
        batch.outerShell.mesh.instanceMatrix.needsUpdate = true
        batch.ring.mesh.instanceMatrix.needsUpdate = true
        batch.core.emissive.needsUpdate = true
        batch.inner.opacity.needsUpdate = true
        batch.spikeX.opacity.needsUpdate = true
        batch.spikeY.opacity.needsUpdate = true
        batch.spikeZ.opacity.needsUpdate = true
        batch.shell.opacity.needsUpdate = true
        batch.outerShell.opacity.needsUpdate = true
        batch.ring.opacity.needsUpdate = true
      }
    },
  }
}

function CameraBackground({ texture }: { texture: THREE.Texture }) {
  const { camera } = useThree()
  const mesh = useMemo(
    () =>
      new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: texture, depthWrite: false, depthTest: false }),
      ),
    [texture],
  )
  useEffect(() => {
    camera.add(mesh)
    return () => {
      camera.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  }, [camera, mesh])
  useFrame(() => {
    const distance = 20
    const height =
      2 * distance * Math.tan(THREE.MathUtils.degToRad(settings.scene.fov * 0.5)) * 1.05
    mesh.scale.set(height, height, 1)
    mesh.position.set(0, 0, -distance)
  })
  return null
}

function SceneParallax() {
  const { camera, gl } = useThree()
  const target = useRef(new THREE.Vector2())
  const current = useRef(new THREE.Vector2())
  const basePosition = useMemo(() => new THREE.Vector3(0, 0.85, 8.2), [])
  const lookAtTarget = useMemo(() => new THREE.Vector3(0, 0.4, 0), [])

  useEffect(() => {
    const element = gl.domElement

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return
      const rect = element.getBoundingClientRect()
      target.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      )
    }

    const resetPointer = () => target.current.set(0, 0)
    const unsubscribeTilt = subscribeDeviceTilt((tilt) => target.current.set(tilt.x, tilt.y))

    element.addEventListener("pointermove", handlePointerMove)
    element.addEventListener("pointerleave", resetPointer)

    return () => {
      element.removeEventListener("pointermove", handlePointerMove)
      element.removeEventListener("pointerleave", resetPointer)
      unsubscribeTilt()
    }
  }, [gl])

  useFrame((_, delta) => {
    current.current.lerp(target.current, 1 - Math.exp(-delta * 5))
    camera.position.x = basePosition.x + current.current.x * 2.4
    camera.position.y = basePosition.y + current.current.y * 1.2
    camera.position.z = basePosition.z
    camera.lookAt(lookAtTarget)
  })

  return null
}

function KuribohWorld() {
  const { gl } = useThree()
  const world = useMemo(() => createKuribohWorld(gl), [gl])
  useEffect(
    () => () => {
      world.world.traverse((object: any) => {
        object.geometry?.dispose()
        const material = object.material
        if (material) {
          const materials = Array.isArray(material) ? material : [material]
          materials.forEach((item: any) => {
            Object.values(item).forEach((value: any) => value?.isTexture && value.dispose())
            item.dispose()
          })
        }
      })
      world.backgroundTexture.dispose()
    },
    [world],
  )
  useFrame((state, delta) => world.update(state.clock.getElapsedTime(), delta, state.pointer))
  return (
    <>
      <primitive object={world.world} />
      <CameraBackground texture={world.backgroundTexture} />
      <SceneParallax />
    </>
  )
}

function SceneReady({ onReady }: { onReady?: () => void }) {
  const announced = useRef(false)
  useFrame(() => {
    if (announced.current) return
    announced.current = true
    requestAnimationFrame(() => onReady?.())
  })
  return null
}

export function KuribohCanvas({ onReady }: { onReady?: () => void }) {
  return (
    <Canvas
      camera={{ fov: settings.scene.fov, near: 0.1, far: 100, position: [0, 0.85, 8.2] }}
      dpr={[1, 1.5]}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: settings.scene.exposure,
      }}
      shadows="percentage"
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = settings.scene.exposure
        gl.shadowMap.type = THREE.PCFShadowMap
      }}
    >
      <color attach="background" args={["#2b3923"]} />
      <KuribohWorld />
      <SceneReady onReady={onReady} />
      <EffectComposer>
        <Bloom
          luminanceThreshold={1}
          intensity={settings.scene.bloom}
          radius={settings.scene.bloomRadius}
          levels={5}
          mipmapBlur
        />
      </EffectComposer>
    </Canvas>
  )
}

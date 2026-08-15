import type { PolynomialColorPreset } from "./contracts/index.js"

type GpuTextureSource = CanvasImageSource & {
  height: number
  naturalHeight?: number
  naturalWidth?: number
  width: number
}

interface SourceRectangle {
  height: number
  width: number
  x: number
  y: number
}

const vertexShaderSource = `#version 300 es
in vec2 aPosition;
uniform vec4 uSourceRect;
out vec2 vTextureCoordinate;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vec2 unit = aPosition * 0.5 + 0.5;
  vTextureCoordinate = vec2(
    uSourceRect.x + unit.x * uSourceRect.z,
    uSourceRect.y + (1.0 - unit.y) * uSourceRect.w
  );
}
`

const fragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform vec3 uCoefficients[20];
in vec2 vTextureCoordinate;
out vec4 outputColor;

void main() {
  vec4 source = texture(uTexture, vTextureCoordinate);
  float red = source.r;
  float green = source.g;
  float blue = source.b;
  float redSquared = red * red;
  float greenSquared = green * green;
  float blueSquared = blue * blue;
  float redGreen = red * green;
  float redBlue = red * blue;
  float greenBlue = green * blue;
  vec3 graded =
    uCoefficients[0] +
    red * uCoefficients[1] +
    green * uCoefficients[2] +
    blue * uCoefficients[3] +
    redSquared * uCoefficients[4] +
    redGreen * uCoefficients[5] +
    redBlue * uCoefficients[6] +
    greenSquared * uCoefficients[7] +
    greenBlue * uCoefficients[8] +
    blueSquared * uCoefficients[9] +
    redSquared * red * uCoefficients[10] +
    redSquared * green * uCoefficients[11] +
    redSquared * blue * uCoefficients[12] +
    red * greenSquared * uCoefficients[13] +
    redGreen * blue * uCoefficients[14] +
    red * blueSquared * uCoefficients[15] +
    greenSquared * green * uCoefficients[16] +
    greenSquared * blue * uCoefficients[17] +
    green * blueSquared * uCoefficients[18] +
    blueSquared * blue * uCoefficients[19];
  outputColor = vec4(clamp(graded, 0.0, 1.0), source.a);
}
`

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return undefined
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return undefined
  }
  const program = gl.createProgram()
  if (!program) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return undefined
  }
  return program
}

class GpuPolynomialGrader {
  readonly #canvas: OffscreenCanvas
  readonly #coefficientsLocation: WebGLUniformLocation
  readonly #gl: WebGL2RenderingContext
  readonly #positionLocation: number
  readonly #program: WebGLProgram
  readonly #sourceRectLocation: WebGLUniformLocation
  readonly #texture: WebGLTexture

  static create() {
    if (typeof OffscreenCanvas === "undefined") return undefined
    const canvas = new OffscreenCanvas(1, 1)
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
      stencil: false,
    })
    if (!gl) return undefined
    const program = createProgram(gl)
    const texture = gl.createTexture()
    const positionLocation = program ? gl.getAttribLocation(program, "aPosition") : -1
    const sourceRectLocation = program ? gl.getUniformLocation(program, "uSourceRect") : null
    const coefficientsLocation = program ? gl.getUniformLocation(program, "uCoefficients[0]") : null
    if (
      !program ||
      !texture ||
      positionLocation < 0 ||
      !sourceRectLocation ||
      !coefficientsLocation
    ) {
      if (program) gl.deleteProgram(program)
      if (texture) gl.deleteTexture(texture)
      return undefined
    }
    const buffer = gl.createBuffer()
    if (!buffer) {
      gl.deleteProgram(program)
      gl.deleteTexture(texture)
      return undefined
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.useProgram(program)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const textureLocation = gl.getUniformLocation(program, "uTexture")
    if (textureLocation) gl.uniform1i(textureLocation, 0)
    const grader = new GpuPolynomialGrader(
      canvas,
      gl,
      program,
      texture,
      positionLocation,
      sourceRectLocation,
      coefficientsLocation,
    )
    return grader
  }

  private constructor(
    canvas: OffscreenCanvas,
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    texture: WebGLTexture,
    positionLocation: number,
    sourceRectLocation: WebGLUniformLocation,
    coefficientsLocation: WebGLUniformLocation,
  ) {
    this.#canvas = canvas
    this.#gl = gl
    this.#program = program
    this.#texture = texture
    this.#positionLocation = positionLocation
    this.#sourceRectLocation = sourceRectLocation
    this.#coefficientsLocation = coefficientsLocation
  }

  render(source: GpuTextureSource, region: SourceRectangle, preset: PolynomialColorPreset) {
    if (this.#gl.isContextLost()) return undefined
    const sourceWidth = source.naturalWidth ?? source.width
    const sourceHeight = source.naturalHeight ?? source.height
    if (
      !sourceWidth ||
      !sourceHeight ||
      ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width < 1 ||
      region.height < 1 ||
      region.x + region.width > sourceWidth ||
      region.y + region.height > sourceHeight
    ) {
      return undefined
    }
    const coefficients = new Float32Array(60)
    preset.coefficients.forEach((term, termIndex) => {
      const offset = termIndex * 3
      coefficients[offset] = term[0] ?? 0
      coefficients[offset + 1] = term[1] ?? 0
      coefficients[offset + 2] = term[2] ?? 0
    })

    const gl = this.#gl
    try {
      this.#canvas.width = region.width
      this.#canvas.height = region.height
      gl.viewport(0, 0, region.width, region.height)
      gl.useProgram(this.#program)
      gl.bindTexture(gl.TEXTURE_2D, this.#texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
      gl.uniform4f(
        this.#sourceRectLocation,
        region.x / sourceWidth,
        region.y / sourceHeight,
        region.width / sourceWidth,
        region.height / sourceHeight,
      )
      gl.uniform3fv(this.#coefficientsLocation, coefficients)
      gl.enableVertexAttribArray(this.#positionLocation)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (gl.getError() !== gl.NO_ERROR) return undefined
      return this.#canvas.transferToImageBitmap()
    } catch {
      return undefined
    }
  }
}

const graders = new WeakMap<Document, GpuPolynomialGrader | false>()

/** Attempts GPU grading and returns undefined when WebGL2 is unavailable or rejects the source. */
export function tryGpuPolynomialGrading(
  source: GpuTextureSource,
  region: SourceRectangle,
  preset: PolynomialColorPreset,
) {
  let grader = graders.get(document)
  if (grader === undefined) {
    grader = GpuPolynomialGrader.create() ?? false
    graders.set(document, grader)
  }
  return grader ? grader.render(source, region, preset) : undefined
}

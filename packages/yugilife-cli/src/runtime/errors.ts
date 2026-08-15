export type CliErrorCode =
  | "ARGUMENT_ERROR"
  | "BROWSER_UNAVAILABLE"
  | "CLI_INTERRUPTED"
  | "CORE_UNAVAILABLE"
  | "HARNESS_UNAVAILABLE"
  | "INPUT_INVALID"
  | "INPUT_JSON_INVALID"
  | "INPUT_READ_FAILED"
  | "INTERNAL_ERROR"
  | "OUTPUT_INVALID"
  | "OUTPUT_WRITE_FAILED"
  | "RENDER_FAILED"
  | "RENDER_VALIDATION_FAILED"
  | "TEMPLATE_INVALID"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_NOT_INSTALLED"
  | "TEMPLATE_REGISTRY_UNAVAILABLE"

const defaultExitCodes: Readonly<Record<CliErrorCode, number>> = {
  ARGUMENT_ERROR: 2,
  BROWSER_UNAVAILABLE: 1,
  CLI_INTERRUPTED: 130,
  CORE_UNAVAILABLE: 1,
  HARNESS_UNAVAILABLE: 1,
  INPUT_INVALID: 1,
  INPUT_JSON_INVALID: 1,
  INPUT_READ_FAILED: 1,
  INTERNAL_ERROR: 1,
  OUTPUT_INVALID: 2,
  OUTPUT_WRITE_FAILED: 1,
  RENDER_FAILED: 1,
  RENDER_VALIDATION_FAILED: 1,
  TEMPLATE_INVALID: 1,
  TEMPLATE_NOT_FOUND: 1,
  TEMPLATE_NOT_INSTALLED: 1,
  TEMPLATE_REGISTRY_UNAVAILABLE: 1,
}

export class CliError extends Error {
  readonly code: CliErrorCode
  readonly exitCode: number

  constructor(code: CliErrorCode, message: string, options?: ErrorOptions & { exitCode?: number }) {
    super(message, options)
    this.name = "CliError"
    this.code = code
    this.exitCode = options?.exitCode ?? defaultExitCodes[code]
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError
}

export function asCliError(error: unknown): CliError {
  if (isCliError(error)) return error
  if (error instanceof Error) {
    return new CliError("INTERNAL_ERROR", error.message, { cause: error })
  }
  return new CliError("INTERNAL_ERROR", String(error))
}

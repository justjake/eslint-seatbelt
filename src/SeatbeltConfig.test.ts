import { test, describe } from "node:test"
import assert from "node:assert"
import {
  SeatbeltConfig,
  SeatbeltArgs,
  SEATBELT_QUIET,
  type SeatbeltEnv,
} from "./SeatbeltConfig"

describe("SeatbeltConfig", () => {
  test("fromEnvOverrides() parses SEATBELT_QUIET=1 as quiet: true", () => {
    const env: SeatbeltEnv = { [SEATBELT_QUIET]: "1" }
    const config = SeatbeltConfig.fromEnvOverrides(env)
    assert.strictEqual(config.quiet, true)
  })

  test("fromEnvOverrides() parses SEATBELT_QUIET=0 as quiet: false", () => {
    const env: SeatbeltEnv = { [SEATBELT_QUIET]: "0" }
    const config = SeatbeltConfig.fromEnvOverrides(env)
    assert.strictEqual(config.quiet, false)
  })

  test("fromEnvOverrides() leaves quiet undefined when SEATBELT_QUIET is omitted", () => {
    const env: SeatbeltEnv = {}
    const config = SeatbeltConfig.fromEnvOverrides(env)
    assert.strictEqual(config.quiet, undefined)
  })

  test("fromConfig() defaults quiet to false", () => {
    const args = SeatbeltArgs.fromConfig({})
    assert.strictEqual(args.quiet, false)
  })

  test("fromConfig() respects quiet: true", () => {
    const args = SeatbeltArgs.fromConfig({ quiet: true })
    assert.strictEqual(args.quiet, true)
  })
})

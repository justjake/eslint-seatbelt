import { test, describe } from "node:test"
import assert from "node:assert"
import {
  SeatbeltConfig,
  SeatbeltArgs,
  SEATBELT_QUIET,
  SEATBELT_READ_ONLY,
  SEATBELT_INCREASE,
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

  test("fromEnvOverrides() parses SEATBELT_READ_ONLY=1 as readOnly: true", () => {
    const env: SeatbeltEnv = { [SEATBELT_READ_ONLY]: "1" }
    const config = SeatbeltConfig.fromEnvOverrides(env)
    assert.strictEqual(config.readOnly, true)
  })

  test("fromEnvOverrides() parses SEATBELT_READ_ONLY=0 as readOnly: false", () => {
    const env: SeatbeltEnv = { [SEATBELT_READ_ONLY]: "0" }
    const config = SeatbeltConfig.fromEnvOverrides(env)
    assert.strictEqual(config.readOnly, false)
  })

  test("fromEnvOverrides() leaves readOnly undefined when SEATBELT_READ_ONLY omitted", () => {
    const config = SeatbeltConfig.fromEnvOverrides({})
    assert.strictEqual(config.readOnly, undefined)
  })

  test("fromEnvOverrides() SEATBELT_INCREASE overrides SEATBELT_READ_ONLY", () => {
    const env: SeatbeltEnv = {
      [SEATBELT_READ_ONLY]: "1",
      [SEATBELT_INCREASE]: "no-console",
    }
    const config = SeatbeltConfig.fromEnvOverrides(env)
    assert.strictEqual(config.readOnly, false)
  })

  test("fromConfig() defaults readOnly to false", () => {
    const args = SeatbeltArgs.fromConfig({})
    assert.strictEqual(args.readOnly, false)
  })

  test("fromConfig() respects readOnly: true", () => {
    const args = SeatbeltArgs.fromConfig({ readOnly: true })
    assert.strictEqual(args.readOnly, true)
  })
})

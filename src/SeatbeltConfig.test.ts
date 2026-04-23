import { test, describe } from "node:test"
import assert from "node:assert"
import * as path from "node:path"
import { Worker } from "node:worker_threads"
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

  test("fromFallbackEnv() leaves threadsafe undefined on the main thread", () => {
    const config = SeatbeltConfig.fromFallbackEnv({})
    assert.strictEqual(config.threadsafe, undefined)
  })

  test("fromFallbackEnv() defaults threadsafe to true inside a worker_thread", async () => {
    const threadsafe = await runInWorker<boolean | undefined>(`
      const { SeatbeltConfig } = require(${JSON.stringify(path.resolve(__dirname, "SeatbeltConfig"))});
      const config = SeatbeltConfig.fromFallbackEnv({});
      require("node:worker_threads").parentPort.postMessage(config.threadsafe);
    `)
    assert.strictEqual(threadsafe, true)
  })
})

function runInWorker<T>(script: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, {
      eval: true,
      execArgv: ["--require", "tsx/cjs"],
    })
    worker.once("message", (value: T) => {
      resolve(value)
      worker.terminate()
    })
    worker.once("error", reject)
  })
}

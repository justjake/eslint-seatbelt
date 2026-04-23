import { test, describe } from "node:test"
import assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Worker } from "node:worker_threads"
import { SeatbeltFile } from "./SeatbeltFile"

const WORKER_PATH = path.resolve(
  __dirname,
  "SeatbeltProcessor.concurrent.worker.ts",
)

const ITERATIONS = 20
const WORKER_COUNT = 8

describe("SeatbeltProcessor concurrency", () => {
  test(
    `threadsafe worker_threads writes never lose updates (N=${WORKER_COUNT}, ${ITERATIONS} iterations)`,
    async () => {
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const dir = fs.mkdtempSync(
          path.join(os.tmpdir(), `seatbelt-concurrent-${iter}-`),
        )
        const seatbeltFilename = path.join(dir, "eslint.seatbelt.tsv")
        fs.writeFileSync(seatbeltFilename, "")

        const sab = new SharedArrayBuffer(4)
        const barrier = new Int32Array(sab)

        const workers = Array.from(
          { length: WORKER_COUNT },
          (_, index) =>
            new Worker(WORKER_PATH, {
              workerData: { seatbeltFile: seatbeltFilename, index, sab },
              execArgv: ["--require", "tsx/cjs"],
            }),
        )

        // Give workers time to reach Atomics.wait; then release them all at once.
        await new Promise((resolve) => setTimeout(resolve, 75))
        Atomics.store(barrier, 0, 1)
        Atomics.notify(barrier, 0, WORKER_COUNT)

        await Promise.all(
          workers.map(
            (worker) =>
              new Promise<void>((resolve, reject) => {
                worker.once("error", reject)
                worker.once("exit", (code) =>
                  code === 0
                    ? resolve()
                    : reject(new Error(`worker exited with code ${code}`)),
                )
              }),
          ),
        )

        const file = SeatbeltFile.readSync(seatbeltFilename)
        const got = Array.from(file.filenames())
          .map((f) => path.basename(f))
          .sort()
        const want = Array.from(
          { length: WORKER_COUNT },
          (_, i) => `file${i}.ts`,
        ).sort()
        assert.deepStrictEqual(
          got,
          want,
          `iteration ${iter}: expected every worker's update to be present in the seatbelt file`,
        )
      }
    },
  )
})

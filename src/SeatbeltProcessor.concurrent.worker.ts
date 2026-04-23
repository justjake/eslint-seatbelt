// Worker entry point for SeatbeltProcessor.concurrent.test.ts.
// `new Worker(path, ...)` needs a script file - can't be inlined in the test.

import { workerData } from "node:worker_threads"
import { SeatbeltFile } from "./SeatbeltFile"
import type { SeatbeltArgs } from "./SeatbeltConfig"

interface ConcurrentWorkerData {
  seatbeltFile: string
  index: number
  sab: SharedArrayBuffer
}

const { seatbeltFile, index, sab } = workerData as ConcurrentWorkerData
const barrier = new Int32Array(sab)

// Sleep until the main thread stores a non-zero value at barrier[0] and
// Atomics.notify-s this waiter. Ensures every worker enters the critical
// section below simultaneously, not staggered by worker-startup latency.
Atomics.wait(barrier, 0, 0)

const args: SeatbeltArgs = {
  root: "/",
  seatbeltFile,
  keepRules: new Set(),
  allowIncreaseRules: "all",
  frozen: false,
  disable: false,
  quiet: false,
  threadsafe: true,
  verbose: false,
}

const file = SeatbeltFile.openSync(seatbeltFile)
file.updateFileMaxErrors(
  args,
  `file${index}.ts`,
  new Map([[`rule${index}`, 1]]),
)

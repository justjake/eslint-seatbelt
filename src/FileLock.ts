import { openSync, writeSync, closeSync, readFileSync, constants, rmSync } from "node:fs"
import { isErrno } from "./errorHanding"
const { O_CREAT, O_EXCL, O_RDWR } = constants

const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

const heldLocks = new Set<FileLock>()
let cleanupHooksInstalled = false

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const

function installCleanupHooks() {
  if (cleanupHooksInstalled) return
  cleanupHooksInstalled = true

  const release = () => {
    for (const lock of heldLocks) {
      try {
        lock.unlock()
      } catch {
        // On our way out; can't do much about it.
      }
    }
  }

  process.on("exit", release)
  for (const signal of Object.keys(SIGNAL_EXIT_CODES) as (keyof typeof SIGNAL_EXIT_CODES)[]) {
    process.on(signal, () => {
      release()
      process.exit(SIGNAL_EXIT_CODES[signal])
    })
  }
}

/** Uses posix open(2) O_EXCL to implement a multi-process mutual exclusion lock. */
export class FileLock {
  private fd: number | undefined
  constructor(public readonly filename: string) {}

  tryLock() {
    this.assertNotLocked()
    try {
      this.fd = openSync(this.filename, O_CREAT | O_EXCL | O_RDWR)
      writeSync(this.fd, `${process.pid}\n`)
      heldLocks.add(this)
      installCleanupHooks()
      return true
    } catch (e) {
      if (isErrno(e, "EEXIST")) {
        return false
      }
      throw e
    }
  }

  waitLock(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    let attemptedRecovery = false
    while (!this.tryLock()) {
      if (Date.now() > deadline) {
        if (!attemptedRecovery && this.reclaimIfStale()) {
          attemptedRecovery = true
          continue
        }
        throw new Error(`Timed out waiting for lock on ${this.filename}`)
      }
      Atomics.wait(waitBuffer, 0, 0, 1)
    }
  }

  isLocked() {
    return this.fd !== undefined
  }

  unlock() {
    if (this.fd !== undefined) {
      closeSync(this.fd)
      try {
        rmSync(this.filename)
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e
      }
      this.fd = undefined
      heldLocks.delete(this)
    }
  }

  assertNotLocked() {
    if (this.fd !== undefined) {
      throw new Error(
        `FileLock "${this.filename}" is already locked by this process [pid ${process.pid}]`,
      )
    }
  }

  private reclaimIfStale(): boolean {
    let contents: string
    try {
      contents = readFileSync(this.filename, "utf8")
    } catch (e) {
      if (isErrno(e, "ENOENT")) return true
      throw e
    }
    const pid = Number.parseInt(contents.trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return false
    } catch (e) {
      if (!isErrno(e, "ESRCH")) throw e
    }
    try {
      rmSync(this.filename)
    } catch (e) {
      if (!isErrno(e, "ENOENT")) throw e
    }
    return true
  }
}

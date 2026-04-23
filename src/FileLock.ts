import {
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  constants,
  rmSync,
} from "node:fs"
import { isErrno } from "./errorHanding"
const { O_CREAT, O_EXCL, O_RDWR } = constants

const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

const heldLocks = new Set<FileLock>()
let cleanupHooksInstalled = false

function installCleanupHooks() {
  if (cleanupHooksInstalled) return
  cleanupHooksInstalled = true

  const release = () => {
    for (const lock of heldLocks) {
      try {
        lock.unlock()
      } catch {
        // Best-effort; we're on our way out anyway.
      }
    }
  }

  process.on("exit", release)
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      release()
      process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1))
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
        throw new Error(
          `Timed out waiting for lock on ${this.filename} after ${timeoutMs}ms`,
        )
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

  /**
   * If the lock file exists but its recorded pid is no longer alive, remove it
   * so a subsequent tryLock can succeed. Returns true if a stale file was
   * removed.
   */
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

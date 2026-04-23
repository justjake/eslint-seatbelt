import { test, describe } from "node:test"
import assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { FileLock } from "./FileLock"

function tmpLockPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `seatbelt-filelock-${label}-`))
  return path.join(dir, "lock")
}

function findDeadPid(): number {
  for (const candidate of [2_147_483_646, 999_999_998, 999_999_997]) {
    try {
      process.kill(candidate, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") {
        return candidate
      }
    }
  }
  throw new Error("could not find a non-existent pid for test setup")
}

describe("FileLock", () => {
  test("tryLock returns true once and false on re-entry", () => {
    const lockPath = tmpLockPath("re-entry")
    const lock = new FileLock(lockPath)
    try {
      assert.strictEqual(lock.tryLock(), true)
      assert.throws(
        () => lock.tryLock(),
        /already locked by this process/,
      )
    } finally {
      lock.unlock()
    }
  })

  test("two FileLock instances on the same path: first wins, second fails tryLock", () => {
    const lockPath = tmpLockPath("contention")
    const a = new FileLock(lockPath)
    const b = new FileLock(lockPath)
    try {
      assert.strictEqual(a.tryLock(), true)
      assert.strictEqual(b.tryLock(), false)
    } finally {
      a.unlock()
    }
  })

  test("waitLock throws when lock is held by another instance past timeout", () => {
    const lockPath = tmpLockPath("timeout")
    const holder = new FileLock(lockPath)
    const waiter = new FileLock(lockPath)
    try {
      assert.strictEqual(holder.tryLock(), true)
      assert.throws(
        () => waiter.waitLock(50),
        /Timed out waiting for lock/,
      )
    } finally {
      holder.unlock()
    }
  })

  test("waitLock reclaims a stale lock whose pid is not alive", () => {
    const lockPath = tmpLockPath("stale-pid")
    const deadPid = findDeadPid()
    fs.writeFileSync(lockPath, `${deadPid}\n`)

    const lock = new FileLock(lockPath)
    try {
      lock.waitLock(200)
      assert.strictEqual(lock.isLocked(), true)
    } finally {
      lock.unlock()
    }
  })

  test("waitLock reclaims a lock left behind by a crashed child process", () => {
    const lockPath = tmpLockPath("crashed-child")

    // SIGKILL so our exit/signal cleanup hooks can't run; the child leaves the
    // lock file behind exactly like a real crash would.
    const script = `
      const { FileLock } = require(${JSON.stringify(path.resolve(__dirname, "FileLock"))});
      const lock = new FileLock(process.argv[1]);
      if (!lock.tryLock()) {
        console.error("child: failed to acquire lock");
        process.exit(2);
      }
      process.kill(process.pid, "SIGKILL");
    `

    try {
      execFileSync(
        process.execPath,
        ["--require", "tsx/cjs", "-e", script, "--", lockPath],
        { stdio: "pipe" },
      )
    } catch {
      // Expected: SIGKILL gives a non-zero exit status.
    }

    assert.strictEqual(
      fs.existsSync(lockPath),
      true,
      "precondition: child should have left the lock file behind",
    )

    const lock = new FileLock(lockPath)
    try {
      lock.waitLock(500)
      assert.strictEqual(lock.isLocked(), true)
    } finally {
      lock.unlock()
    }
  })
})

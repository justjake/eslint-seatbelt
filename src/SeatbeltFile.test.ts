import { test, describe } from "node:test"
import assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { SeatbeltFile } from "./SeatbeltFile"
import { SeatbeltArgs } from "./SeatbeltConfig"

describe("SeatbeltFile", () => {
  test("parse() handles empty file", () => {
    const file = SeatbeltFile.parse("/test/file.tsv", "")
    assert.strictEqual(file.filename, "/test/file.tsv")
    assert.strictEqual(file.getMaxErrors("any-file"), undefined)
  })

  test("parse() handles single line", () => {
    const file = SeatbeltFile.parse(
      "/test/file.tsv",
      `"src/file.ts"\t"@typescript-eslint/no-explicit-any"\t5\n`,
    )
    const maxErrors = file.getMaxErrors("src/file.ts")
    assert.ok(maxErrors)
    assert.strictEqual(maxErrors.get("@typescript-eslint/no-explicit-any"), 5)
  })

  test("parse() handles multiple lines for same file", () => {
    const file = SeatbeltFile.parse(
      "/test/file.tsv",
      [
        `"src/file.ts"\t"@typescript-eslint/no-explicit-any"\t5`,
        `"src/file.ts"\t"@typescript-eslint/no-unused-vars"\t3`,
      ].join("\n"),
    )
    const maxErrors = file.getMaxErrors("src/file.ts")
    assert.ok(maxErrors)
    assert.strictEqual(maxErrors.get("@typescript-eslint/no-explicit-any"), 5)
    assert.strictEqual(maxErrors.get("@typescript-eslint/no-unused-vars"), 3)
  })

  test("updateMaxErrors() updates error counts", () => {
    const file = SeatbeltFile.parse(
      "/test/file.tsv",
      [
        `"src/file.ts"\t"@typescript-eslint/no-explicit-any"\t5`,
        `"src/file.ts"\t"@typescript-eslint/no-unused-vars"\t3`,
        `"src/file.ts"\t"@typescript-eslint/keep"\t99`,
      ].join("\n"),
    )

    const args: SeatbeltArgs = {
      root: "/test",
      seatbeltFile: "/test/sourceCode.ts",
      keepRules: new Set(["@typescript-eslint/keep"]),
      allowIncreaseRules: new Set(),
      frozen: false,
      disable: false,
      quiet: false,
      threadsafe: false,
      verbose: false,
    }

    const newCounts = new Map(
      Object.entries({
        "@typescript-eslint/no-explicit-any": 3,
      }),
    )
    const changed = file.updateMaxErrors("/test/src/file.ts", args, newCounts)
    assert.strictEqual(changed.decreasedRulesCount, 1)
    assert.strictEqual(file.changed, true)

    const maxErrors = file.getMaxErrors("/test/src/file.ts")
    assert.ok(maxErrors)
    assert.strictEqual(maxErrors.get("@typescript-eslint/no-explicit-any"), 3)
    assert.strictEqual(
      maxErrors.get("@typescript-eslint/no-unused-vars"),
      undefined,
    )
    assert.strictEqual(maxErrors.get("@typescript-eslint/keep"), 99)
  })

  test("readSync() and writeSync() roundtrip", async () => {
    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "seatbelt-test-"),
    )
    const filename = path.join(tmpDir, "test.tsv")

    const originalContent = [
      `"src/fileA.ts"\t"@typescript-eslint/no-explicit-any"\t5\n`,
      `"src/fileB.ts"\t"@typescript-eslint/no-unused-vars"\t3\n`,
    ].join("")

    await fs.promises.writeFile(filename, originalContent)

    const file = SeatbeltFile.readSync(filename)
    file.writeSync()

    const writtenContent = await fs.promises.readFile(filename, "utf8")
    assert.strictEqual(writtenContent, originalContent)

    await fs.promises.rm(tmpDir, { recursive: true })
  })

  test("cleanUpRemovedFiles removes entries whose source file is gone", async () => {
    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "seatbelt-cleanup-"),
    )
    const seatbeltFilename = path.join(tmpDir, "eslint.seatbelt.tsv")
    const existingSrc = path.join(tmpDir, "existing.ts")
    const goneSrc = path.join(tmpDir, "gone.ts")
    fs.writeFileSync(existingSrc, "")
    fs.writeFileSync(
      seatbeltFilename,
      [
        `${JSON.stringify("existing.ts")}\t${JSON.stringify("rule1")}\t1\n`,
        `${JSON.stringify("gone.ts")}\t${JSON.stringify("rule1")}\t2\n`,
      ].join(""),
    )

    const args: SeatbeltArgs = {
      root: tmpDir,
      seatbeltFile: seatbeltFilename,
      keepRules: new Set(),
      allowIncreaseRules: new Set(),
      frozen: false,
      disable: false,
      quiet: false,
      threadsafe: false,
      verbose: false,
    }

    const file = SeatbeltFile.openSync(seatbeltFilename)
    const { removedFiles } = file.cleanUpRemovedFiles(args)

    assert.strictEqual(removedFiles, 1)
    const reread = SeatbeltFile.readSync(seatbeltFilename)
    assert.ok(reread.getMaxErrors(existingSrc))
    assert.strictEqual(reread.getMaxErrors(goneSrc), undefined)

    await fs.promises.rm(tmpDir, { recursive: true })
  })

  test("threadsafe cleanUpRemovedFiles does not clobber a concurrent update on stale in-memory state", async () => {
    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "seatbelt-cleanup-race-"),
    )
    const seatbeltFilename = path.join(tmpDir, "eslint.seatbelt.tsv")
    const existingSrc = path.join(tmpDir, "existing.ts")
    fs.writeFileSync(existingSrc, "")
    // Seed two entries: existing.ts (file present on disk) and gone.ts (file
    // missing). The staler's cleanup will want to drop gone.ts, forcing it
    // down the write path where a stale in-memory existing.ts count could
    // clobber the writer's update.
    fs.writeFileSync(
      seatbeltFilename,
      [
        `${JSON.stringify("existing.ts")}\t${JSON.stringify("rule1")}\t1\n`,
        `${JSON.stringify("gone.ts")}\t${JSON.stringify("rule1")}\t1\n`,
      ].join(""),
    )

    const args: SeatbeltArgs = {
      root: tmpDir,
      seatbeltFile: seatbeltFilename,
      keepRules: new Set(),
      allowIncreaseRules: "all",
      frozen: false,
      disable: false,
      quiet: false,
      threadsafe: true,
      verbose: false,
    }

    const staler = SeatbeltFile.openSync(seatbeltFilename)

    // Writer simulates a concurrent process landing an update to disk.
    const writer = SeatbeltFile.openSync(seatbeltFilename)
    writer.updateFileMaxErrors(args, existingSrc, new Map([["rule1", 5]]))

    // Now staler runs cleanup. It must drop gone.ts, but under threadsafe it
    // also has to re-read under the lock so existing.ts's fresh {rule1: 5}
    // round-trips through its write.
    const { removedFiles } = staler.cleanUpRemovedFiles(args)
    assert.strictEqual(removedFiles, 1)

    const final = SeatbeltFile.readSync(seatbeltFilename)
    assert.strictEqual(final.getMaxErrors(existingSrc)?.get("rule1"), 5)
    assert.strictEqual(final.getMaxErrors(path.join(tmpDir, "gone.ts")), undefined)

    await fs.promises.rm(tmpDir, { recursive: true })
  })

  test("toJSON() and fromJSON() roundtrip", () => {
    const file = SeatbeltFile.fromJSON({
      filename: "/test/eslint.seatbelt.tsv",
      data: {
        "src/fileA.ts": {
          "@typescript-eslint/no-explicit-any": 5,
          "@typescript-eslint/no-unused-vars": 3,
        },
        "src/fileB.ts": {
          "@typescript-eslint/strict-boolean-expressions": 2,
        },
      },
    })

    const json = file.toJSON()

    assert.deepStrictEqual(json, {
      filename: "/test/eslint.seatbelt.tsv",
      data: {
        "src/fileA.ts": {
          "@typescript-eslint/no-explicit-any": 5,
          "@typescript-eslint/no-unused-vars": 3,
        },
        "src/fileB.ts": {
          "@typescript-eslint/strict-boolean-expressions": 2,
        },
      },
    })

    const roundtrippedFile = SeatbeltFile.fromJSON(json)
    assert.deepStrictEqual(roundtrippedFile.toJSON(), json)
  })
})

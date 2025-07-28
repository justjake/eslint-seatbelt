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
      disableInEditor: false,
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

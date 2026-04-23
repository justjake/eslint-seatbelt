import { test, describe } from "node:test"
import assert from "node:assert"
import type { Linter } from "eslint"
import { SeatbeltFile } from "./SeatbeltFile"
import type { SeatbeltArgs } from "./SeatbeltConfig"
import { transformMessages, maybeWriteStateUpdate } from "./SeatbeltProcessor"

function makeArgs(overrides: Partial<SeatbeltArgs> = {}): SeatbeltArgs {
  return {
    root: "/test",
    seatbeltFile: "/test/eslint.seatbelt.tsv",
    keepRules: new Set(),
    allowIncreaseRules: new Set(),
    frozen: false,
    disable: false,
    quiet: false,
    readOnly: false,
    threadsafe: false,
    verbose: false,
    ...overrides,
  }
}

function makeMessage(
  ruleId: string,
  overrides: Partial<Linter.LintMessage> = {},
): Linter.LintMessage {
  return {
    ruleId,
    severity: 2,
    message: `Original: ${ruleId}`,
    line: 1,
    column: 1,
    nodeType: null as any,
    ...overrides,
  }
}

function makeSeatbeltFile(
  data: Record<string, Record<string, number>>,
): SeatbeltFile {
  return SeatbeltFile.fromJSON({
    filename: "/test/eslint.seatbelt.tsv",
    data,
  })
}

describe("transformMessages", () => {
  test("transformMessages() emits warning messages for errors at max count", () => {
    const seatbeltFile = makeSeatbeltFile({
      "src/file.ts": { "no-console": 2 },
    })
    const messages = [
      makeMessage("no-console"),
      makeMessage("no-console"),
    ]
    const ruleToErrorCount = new Map([["no-console", 2]])

    const result = transformMessages(
      makeArgs(),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].severity, 1)
    assert.ok(result[0].message.includes("tend the garden"))
  })

  test("transformMessages() quiet suppresses at-max-count warnings", () => {
    const seatbeltFile = makeSeatbeltFile({
      "src/file.ts": { "no-console": 2 },
    })
    const messages = [
      makeMessage("no-console"),
      makeMessage("no-console"),
    ]
    const ruleToErrorCount = new Map([["no-console", 2]])

    const result = transformMessages(
      makeArgs({ quiet: true }),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 0)
  })

  test("transformMessages() quiet suppresses under-max-count warnings", () => {
    const seatbeltFile = makeSeatbeltFile({
      "src/file.ts": { "no-console": 5 },
    })
    const messages = [
      makeMessage("no-console"),
      makeMessage("no-console"),
    ]
    const ruleToErrorCount = new Map([["no-console", 2]])

    const result = transformMessages(
      makeArgs({ quiet: true }),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 0)
  })

  test("transformMessages() quiet preserves over-max error messages", () => {
    const seatbeltFile = makeSeatbeltFile({
      "src/file.ts": { "no-console": 1 },
    })
    const messages = [
      makeMessage("no-console"),
      makeMessage("no-console"),
      makeMessage("no-console"),
    ]
    const ruleToErrorCount = new Map([["no-console", 3]])

    const result = transformMessages(
      makeArgs({ quiet: true }),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].severity, 2)
    assert.ok(result[0].message.includes("Remove"))
  })

  test("transformMessages() quiet preserves frozen-mode warnings", () => {
    const seatbeltFile = makeSeatbeltFile({
      "src/file.ts": { "no-console": 5 },
    })
    const messages = [
      makeMessage("no-console"),
      makeMessage("no-console"),
    ]
    const ruleToErrorCount = new Map([["no-console", 2]])

    const result = transformMessages(
      makeArgs({ quiet: true, frozen: true }),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].severity, 1)
    assert.ok(result[0].message.includes("SEATBELT_FROZEN"))
  })

  test("transformMessages() quiet suppresses SEATBELT_INCREASE warnings", () => {
    const seatbeltFile = makeSeatbeltFile({})
    const messages = [
      makeMessage("no-console"),
      makeMessage("no-console"),
    ]
    const ruleToErrorCount = new Map([["no-console", 2]])

    const result = transformMessages(
      makeArgs({ quiet: true, allowIncreaseRules: new Set(["no-console"]) }),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 0)
  })

  test("transformMessages() quiet passes through non-seatbelt messages unchanged", () => {
    const seatbeltFile = makeSeatbeltFile({})
    const messages = [makeMessage("some-other-rule")]
    const ruleToErrorCount = new Map([["some-other-rule", 1]])

    const result = transformMessages(
      makeArgs({ quiet: true }),
      seatbeltFile,
      "src/file.ts",
      messages,
      ruleToErrorCount,
      () => false,
    )

    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].severity, 2)
    assert.strictEqual(result[0].message, "Original: some-other-rule")
  })
})

describe("maybeWriteStateUpdate", () => {
  function makeFileWithSpy(data: Record<string, Record<string, number>>) {
    const file = makeSeatbeltFile(data)
    let flushed = 0
    const originalFlush = file.flushChanges.bind(file)
    file.flushChanges = () => {
      flushed++
      // Skip disk I/O; mirror flushChanges() return shape.
      const wasChanged = file.changed
      file.changed = false
      return { updated: wasChanged }
    }
    return { file, getFlushCount: () => flushed, originalFlush }
  }

  test("writes when counts decrease and readOnly is false", () => {
    const { file, getFlushCount } = makeFileWithSpy({
      "src/file.ts": { "no-console": 5 },
    })
    maybeWriteStateUpdate(
      makeArgs(),
      file,
      "src/file.ts",
      new Map([["no-console", 2]]),
    )
    assert.strictEqual(getFlushCount(), 1)
  })

  test("skips flushChanges when readOnly is true (counts decrease)", () => {
    const { file, getFlushCount } = makeFileWithSpy({
      "src/file.ts": { "no-console": 5 },
    })
    const extra = maybeWriteStateUpdate(
      makeArgs({ readOnly: true }),
      file,
      "src/file.ts",
      new Map([["no-console", 2]]),
    )
    assert.strictEqual(getFlushCount(), 0)
    assert.strictEqual(extra, undefined)
  })

  test("skips flushChanges when readOnly is true (counts equal)", () => {
    const { file, getFlushCount } = makeFileWithSpy({
      "src/file.ts": { "no-console": 2 },
    })
    maybeWriteStateUpdate(
      makeArgs({ readOnly: true }),
      file,
      "src/file.ts",
      new Map([["no-console", 2]]),
    )
    assert.strictEqual(getFlushCount(), 0)
  })

  test("frozen + readOnly: skips flushChanges (frozen takes precedence)", () => {
    const { file, getFlushCount } = makeFileWithSpy({
      "src/file.ts": { "no-console": 5 },
    })
    const extra = maybeWriteStateUpdate(
      makeArgs({ readOnly: true, frozen: true, keepRules: "all" }),
      file,
      "src/file.ts",
      new Map([["no-console", 2]]),
    )
    assert.strictEqual(getFlushCount(), 0)
    assert.strictEqual(extra, undefined)
  })

  test("disable short-circuits readOnly", () => {
    const { file, getFlushCount } = makeFileWithSpy({
      "src/file.ts": { "no-console": 5 },
    })
    const extra = maybeWriteStateUpdate(
      makeArgs({ disable: true, readOnly: true }),
      file,
      "src/file.ts",
      new Map([["no-console", 2]]),
    )
    assert.strictEqual(getFlushCount(), 0)
    assert.strictEqual(extra, undefined)
  })
})

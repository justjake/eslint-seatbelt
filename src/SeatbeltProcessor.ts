import type { Linter } from "eslint"
import packageJson from "../package.json"
import { RuleId, SeatbeltFile } from "./SeatbeltFile"
import {
  formatFilename,
  formatRuleId,
  SEATBELT_FROZEN,
  SEATBELT_INCREASE,
  SeatbeltArgs,
} from "./SeatbeltConfig"
import * as pluginGlobals from "./pluginGlobals"
import { appendErrorContext } from "./errorHanding"

const { name, version } = packageJson

/**
 * seatbelt works by observing the list messages and filtering out
 * messages that are allowed by the seatbelt file. Note that ESLint is a
 * completely synchronous codebase, so we also need to be synchronous.
 *
 * https://eslint.org/docs/latest/extend/custom-processors
 */
export const SeatbeltProcessor: Linter.Processor = {
  supportsAutofix: true,
  meta: {
    name,
    version,
  },
  // takes text of the file and filename
  preprocess(text, filename) {
    pluginGlobals.onPreprocess(filename)
    // We don't need to do anything here, pass through the data unchanged.
    return [text]
  },

  /** Where the action happens. */
  postprocess(messagesPerSection, filename) {
    pluginGlobals.onPostprocess(filename)
    // takes a Message[][] and filename
    // `messages` argument contains two-dimensional array of Message objects
    // where each top-level array item contains array of lint messages related
    // to the text that was returned in array from preprocess() method
    if (messagesPerSection.length !== 1) {
      throw new Error(
        `${name} bug: expected preprocess to return 1 section, got ${messagesPerSection.length}`,
      )
    }
    const messages = messagesPerSection[0]

    const args = pluginGlobals.popFileArgs(filename)
    if (args.disable) {
      return messages
    }

    const seatbeltFile = pluginGlobals.getSeatbeltFile(args.seatbeltFile)
    if (args.threadsafe || !pluginGlobals.isEslintCli()) {
      seatbeltFile.readSync()
    }
    const ruleToErrorCount = countRuleIds(messages)
    const verboseOnce = args.verbose ? createOnce<RuleId>() : () => false
    try {
      const transformed = transformMessages(
        args,
        seatbeltFile,
        filename,
        messages,
        ruleToErrorCount,
        verboseOnce,
      )

      try {
        // Ideally we could find a way to batch writes until all linting is finished, but I haven't found a
        // good way to schedule our code to run after all files but before
        // ESLint returns to its caller or exits.
        const additionalMessages = maybeWriteStateUpdate(
          args,
          seatbeltFile,
          filename,
          ruleToErrorCount,
        )

        if (additionalMessages) {
          return transformed.concat(additionalMessages)
        } else {
          return transformed
        }
      } catch (e) {
        return [...transformed, handleProcessingError(filename, e)]
      }
    } catch (e) {
      return [...messages, handleProcessingError(filename, e)]
    }
  },
}

function createOnce<T>(): (value: T) => boolean {
  const seen = new Set<T>()
  return (value: T) => {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  }
}

function transformMessages(
  args: SeatbeltArgs,
  seatbeltFile: SeatbeltFile,
  filename: string,
  messages: Linter.LintMessage[],
  ruleToErrorCount: Map<RuleId, number>,
  verboseOnce: (ruleId: RuleId) => boolean,
) {
  if (args.disable) {
    return messages
  }

  const ruleToMaxErrorCount = seatbeltFile.getMaxErrors(filename)
  const allowIncrease =
    args.allowIncreaseRules === "all" || args.allowIncreaseRules.size > 0
  if (!ruleToMaxErrorCount && !allowIncrease) {
    // We have no state related to this file, so no need to consider it.
    return messages
  }

  return messages.map((message) => {
    if (message.ruleId === null) {
      SeatbeltArgs.verboseLog(
        args,
        () =>
          `${formatFilename(filename)}:${message.line}:${message.column}: cannot transform message with null ruleId`,
      )
      return message
    }

    if (!isCountableLintError(message)) {
      return message
    }

    const errorCount = ruleToErrorCount.get(message.ruleId)
    if (errorCount === undefined) {
      throw new Error(
        `${name} bug: errorCount not found for rule ${message.ruleId}`,
      )
    }

    const maxErrorCount = ruleToMaxErrorCount?.get(message.ruleId) ?? 0
    const allowIncrease = SeatbeltArgs.ruleSetHas(
      args.allowIncreaseRules,
      message.ruleId,
    )
    if (maxErrorCount === 0 && !allowIncrease) {
      // Rule not controlled by seatbelt, just pass it through unchanged.
      return message
    } else if (errorCount > maxErrorCount) {
      if (allowIncrease) {
        // Rule is allowed to increase from 0 -> any, so it should become a warning.
        return messageOverMaxErrorCountButIncreaseAllowed(
          message,
          errorCount,
          maxErrorCount,
        )
      }

      // Rule controlled by seatbelt, but too many errorCount:
      // keep the message as an error, but add a notice about seatbelt
      // violation count
      if (verboseOnce(message.ruleId)) {
        SeatbeltArgs.verboseLog(
          args,
          () =>
            `${formatFilename(filename)}: ${formatRuleId(message.ruleId)}: error: ${errorCount} ${pluralErrors(errorCount)} found > max ${maxErrorCount}`,
        )
      }
      return messageOverMaxErrorCount(message, errorCount, maxErrorCount)
    } else if (errorCount === maxErrorCount) {
      // For rules under the limit, turn errors into warnings.
      // Add an appropriate notice about seatbelt violation status.
      if (verboseOnce(message.ruleId)) {
        SeatbeltArgs.verboseLog(
          args,
          () =>
            `${formatFilename(filename)}: ${formatRuleId(message.ruleId)}: ok: ${errorCount} ${pluralErrors(errorCount)} found == max ${maxErrorCount}`,
        )
      }

      return messageAtMaxErrorCount(message, errorCount)
    } else {
      if (args.frozen) {
        // We're frozen, so it's actually an error to decrease the error count.
        return messageFrozenUnderMaxErrorCount(
          message,
          filename,
          errorCount,
          maxErrorCount,
        )
      }
      // Can tighten the seatbelt.
      return messageUnderMaxErrorCount(message, errorCount, maxErrorCount)
    }
  })
}

function isCountableLintError(
  message: Linter.LintMessage | Linter.SuppressedLintMessage,
): message is Linter.LintMessage & { ruleId: string } {
  if (!message.severity || message.severity < 2) {
    return false
  }

  if (
    ("suppressions" satisfies keyof Linter.SuppressedLintMessage) in message &&
    message.suppressions.length > 0
  ) {
    return false
  }

  if (!message.ruleId) {
    return false
  }

  return true
}

function countRuleIds(messages: Linter.LintMessage[]): Map<RuleId, number> {
  const ruleToErrorCount = new Map<RuleId, number>()
  messages.forEach((message) => {
    if (!isCountableLintError(message)) {
      return
    }
    ruleToErrorCount.set(
      message.ruleId,
      (ruleToErrorCount.get(message.ruleId) ?? 0) + 1,
    )
  })
  return ruleToErrorCount
}

function maybeWriteStateUpdate(
  args: SeatbeltArgs,
  stateFile: SeatbeltFile,
  filename: string,
  ruleToErrorCount: Map<RuleId, number>,
): Linter.LintMessage[] | undefined {
  if (args.disable) {
    return
  }
  // Used to disable updates but still run checks (the general `disable` turns off everything)
  if (args.disableInEditor) {
    return
  }
  if (args.threadsafe) {
    // TODO: Implement locking
    // For now just refresh the file.
    stateFile.readSync()
  }

  const ruleToMaxErrorCount = stateFile.getMaxErrors(filename)
  const { removedRules } = stateFile.updateMaxErrors(
    filename,
    args,
    ruleToErrorCount,
  )
  if (!args.frozen) {
    stateFile.flushChanges()
  } else if (removedRules && removedRules.size > 0) {
    // We didn't actually update the state file in this case.
    // We need to add an original error message about the inconsistent state.
    return Array.from(removedRules).map((ruleId) => {
      const maxErrorCount = ruleToMaxErrorCount?.get(ruleId)
      if (maxErrorCount === undefined) {
        throw new Error(
          `${name} bug: maxErrorCount not found for removed frozen rule ${ruleId}`,
        )
      }
      const message: Linter.LintMessage = {
        ruleId,
        column: 0,
        line: 1,
        severity: 2,
        message: messageFrozenUnderMaxErrorCountText(
          filename,
          0,
          maxErrorCount,
        ),
      }
      return message
    })
  }
}

function messageOverMaxErrorCount(
  message: Linter.LintMessage,
  errorCount: number,
  maxErrorCount: number,
): Linter.LintMessage {
  return {
    ...message,
    message: `${message.message}
[${name}]: There are ${errorCount} ${pluralErrors(errorCount)} of this type, but only ${maxErrorCount} are allowed.
Remove ${errorCount - maxErrorCount} to turn these errors into warnings.
    `.trim(),
  }
}

function messageOverMaxErrorCountButIncreaseAllowed(
  message: Linter.LintMessage,
  errorCount: number,
  maxErrorCount: number,
): Linter.LintMessage {
  const increaseCount = errorCount - maxErrorCount

  return {
    ...message,
    severity: 1,
    message: `${message.message}
[${name}]: ${SEATBELT_INCREASE}: Temporarily allowing ${increaseCount} new ${pluralErrors(increaseCount)} of this type.
    `.trim(),
  }
}

function messageAtMaxErrorCount(
  message: Linter.LintMessage,
  errorCount: number,
): Linter.LintMessage {
  return {
    ...message,
    severity: 1,
    message: `${message.message}
[${name}]: This file is temporarily allowed to have ${errorCount} ${pluralErrors(errorCount)} of this type.
Please tend the garden by fixing if you have the time.
    `.trim(),
  }
}

function messageUnderMaxErrorCount(
  message: Linter.LintMessage,
  errorCount: number,
  maxErrorCount: number,
): Linter.LintMessage {
  const fixed = errorCount - maxErrorCount
  const fixedMessage = fixed === 1 ? "one" : `${fixed} errors`
  return {
    ...message,
    severity: 1,
    message: `${message.message}
[${name}]: This file is temporarily allowed to have ${maxErrorCount} ${pluralErrors(maxErrorCount)} of this type.
Thank you for fixing ${fixedMessage}, it really helps.
    `.trim(),
  }
}

function messageFrozenUnderMaxErrorCountText(
  seatbeltFilename: string,
  errorCount: number,
  maxErrorCount: number,
) {
  const fixed = errorCount - maxErrorCount
  const fixedMessage = fixed === 1 ? "error" : "errors"
  return `
[${name}]: ${SEATBELT_FROZEN}: Expected ${maxErrorCount} ${pluralErrors(maxErrorCount)}, found ${errorCount}.
If you fixed ${fixed} ${fixedMessage}, thank you, but you'll need to update the seatbelt file to match.
Try running eslint, then committing ${seatbeltFilename}.
`.trim()
}

function messageFrozenUnderMaxErrorCount(
  message: Linter.LintMessage,
  seatbeltFilename: string,
  errorCount: number,
  maxErrorCount: number,
): Linter.LintMessage {
  return {
    ...message,
    severity: 1,
    message: `${message.message}\n${messageFrozenUnderMaxErrorCountText(seatbeltFilename, errorCount, maxErrorCount)}`,
  }
}

const alreadyModifiedError = new WeakSet<Error>()

function handleProcessingError(
  filename: string,
  e: unknown,
): Linter.LintMessage {
  if (e instanceof Error && !alreadyModifiedError.has(e)) {
    alreadyModifiedError.add(e)
    appendErrorContext(e, `while processing \`${filename}\``)
    appendErrorContext(
      e,
      `this may be a bug in ${name}@${version} or a problem with your setup`,
    )
  }
  throw e
}

function pluralErrors(count: number) {
  return count === 1 ? "error" : "errors"
}

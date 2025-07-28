#!/usr/bin/env -S pnpm exec tsx

import {
  FallbackEnv,
  logStderr,
  SeatbeltConfig,
  SeatbeltEnv,
} from "./SeatbeltConfig"
import { parse } from "ts-command-line-args"
import { SeatbeltConfigSchema } from "./jsonSchema/SeatbeltConfigSchema"
import { name, version } from "../package.json"

export interface SeatbeltCliConfig extends SeatbeltConfig {
  /** Paths are relative to this directory. Default: `process.cwd()` */
  pwd?: string
  /** Print the version and exit */
  version?: boolean
  /** Command to execute. Default: `eslint` */
  exec?: string
  /** Show help and exit */
  help?: boolean
}

const ZERO_WIDTH_SPACE = "\u200B"

function parseArgs() {
  const fallback = SeatbeltConfig.fromFallbackEnv(process.env as unknown as FallbackEnv)
  const overrides = SeatbeltConfig.fromEnvOverrides(process.env as unknown as SeatbeltEnv)
  const env = { ...fallback, ...overrides }
  const escapeForChalk = (s: string) =>
    s
      .replaceAll("{", "\\{")
      .replaceAll("}", "\\}")
      .replaceAll(/^(\s)/gm, (match) => `${ZERO_WIDTH_SPACE}${match}`)
  return parse<SeatbeltCliConfig>(
    {
      pwd: {
        type: String,
        defaultValue: env.pwd ?? process.cwd(),
        description: `Paths are relative to this directory`,
        optional: true,
      },
      seatbeltFile: {
        type: String,
        alias: "f",
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.seatbeltFile.description,
        ),
        defaultValue: env.seatbeltFile,
        optional: true,
      },
      keepRules: {
        type: String,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.keepRules.description,
        ),
        defaultValue: env.keepRules,
        multiple: true,
        optional: true,
      },
      allowIncreaseRules: {
        alias: "r",
        type: String,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.allowIncreaseRules.description,
        ),
        defaultValue: env.allowIncreaseRules,
        multiple: true,
        optional: true,
      },
      frozen: {
        type: Boolean,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.frozen.description,
        ),
        defaultValue: env.frozen,
        optional: true,
      },
      disable: {
        type: Boolean,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.disable.description,
        ),
        defaultValue: env.disable,
        optional: true,
      },
      disableInEditor: {
        type: Boolean,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.disableInEditor.description,
        ),
        defaultValue: env.disableInEditor,
        optional: true,
      },
      threadsafe: {
        type: Boolean,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.threadsafe.description,
        ),
        defaultValue: env.threadsafe,
        optional: true,
      },
      verbose: {
        type: Boolean,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.verbose.description,
        ),
        defaultValue: env.verbose,
        optional: true,
      },
      root: {
        type: String,
        description: escapeForChalk(
          SeatbeltConfigSchema.properties.root.description,
        ),
        defaultValue: env.root,
        optional: true,
      },
      version: {
        type: Boolean,
        description: "Print the version and exit",
        optional: true,
        alias: "v",
      },
      exec: {
        type: String,
        description: "Command to execute",
        optional: true,
        defaultValue: "eslint",
      },
      help: {
        type: Boolean,
        description: "Show help and exit",
        optional: true,
        alias: "h",
      },
    },
    {
      processExitCode: 2,
      showHelpWhenArgsMissing: true,
      helpArg: "help",
      headerContentSections: [
        {
          header: name,
          content: `Turns command-line arguments into ${name} environment variables, then call 'eslint' or another command with them.`,
        },
      ],
    },
  )
}

// eslint-disable-next-line no-console
const stdout = (...args: unknown[]) => console.log(...args)
// eslint-disable-next-line no-console
const stderr = (...args: unknown[]) => console.error(...args)

function main() {
  const argsConfig = parseArgs()

  if (argsConfig.version) {
    stdout(`v${version}`)
    return
  }

  if (argsConfig.verbose) {
    stderr("Parsed config:", argsConfig)
  }
  // const args = SeatbeltArgs.fromConfig(argsConfig)
  logStderr("command not implemented")
  process.exit(1)
}

if (require.main === module) {
  main()
}

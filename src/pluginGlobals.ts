/**
 * Facilitates caching and passing of state between different parts of the plugin.
 */

import {
  FallbackEnv,
  logStderr,
  padVarName,
  SEATBELT_VERBOSE,
  SeatbeltArgs,
  SeatbeltConfig,
  SeatbeltConfigWithPwd,
  SeatbeltEnv,
} from "./SeatbeltConfig"
import { SeatbeltFile } from "./SeatbeltFile"
import { name, version } from "../package.json"
import fs from "node:fs"

let ANY_CONFIG_DISABLED = false
let LAST_VERBOSE_ARGS: SeatbeltArgs | undefined
const VERBOSE_SEATBELT_FILES = new Set<string>()
const CLI_ARGS = new Set<SeatbeltArgs>()

const EMPTY_CONFIG: SeatbeltConfig = {}
const argsCache = new WeakMap<SeatbeltConfig, SeatbeltArgs>()
const seatbeltFileCache = new Map<string, SeatbeltFile>()
const mergedConfigCache = new WeakMap<
  /* settings.seatbelt */ SeatbeltConfig,
  WeakMap</* from rule settings override*/ SeatbeltConfig, SeatbeltConfig>
>()

let envFallbackConfig: SeatbeltConfig | undefined
let envOverrideConfig: SeatbeltConfigWithPwd | undefined
let hasAnyEnvVars = false
let lastLintedFile: { filename: string; args: SeatbeltArgs } | undefined
const temporaryFileArgs = new Map<string, SeatbeltArgs>()

function getProcessEnvFallbackConfig(): SeatbeltConfig {
  if (!envFallbackConfig) {
    envFallbackConfig = SeatbeltConfig.fromFallbackEnv(
      process.env as FallbackEnv,
    )
    hasAnyEnvVars = Object.keys(envFallbackConfig).length > 0
  }
  return envFallbackConfig
}

function getProcessEnvOverrideConfig(): SeatbeltConfigWithPwd {
  if (!envOverrideConfig) {
    envOverrideConfig = SeatbeltConfig.fromEnvOverrides(
      process.env as SeatbeltEnv,
    )
    ANY_CONFIG_DISABLED ||= envOverrideConfig.disable ?? false
    hasAnyEnvVars = Object.keys(envOverrideConfig).length > 0
  }
  return envOverrideConfig
}

export function ruleOverrideConfigToArgs(
  settingsConfig: SeatbeltConfig | undefined,
  ruleOverrideConfig: SeatbeltConfig | undefined,
): SeatbeltArgs {
  if (settingsConfig && ruleOverrideConfig) {
    let settingsConfigMergeMap = mergedConfigCache.get(settingsConfig)
    if (!settingsConfigMergeMap) {
      settingsConfigMergeMap = new WeakMap()
      mergedConfigCache.set(settingsConfig, settingsConfigMergeMap)
    }
    let mergedConfig = settingsConfigMergeMap.get(ruleOverrideConfig)
    if (!mergedConfig) {
      mergedConfig = { ...settingsConfig, ...ruleOverrideConfig }
      settingsConfigMergeMap.set(ruleOverrideConfig, mergedConfig)
    }
    return configToArgs(mergedConfig)
  }
  return configToArgs(ruleOverrideConfig ?? settingsConfig ?? EMPTY_CONFIG)
}

function configToArgs(config: SeatbeltConfig): SeatbeltArgs {
  let args = argsCache.get(config)
  if (!args) {
    const compiledConfig = {
      ...getProcessEnvFallbackConfig(),
      ...config,
      ...getProcessEnvOverrideConfig(),
    }
    args = SeatbeltArgs.fromConfig(compiledConfig)
    ANY_CONFIG_DISABLED ||= args.disable
    if (args.verbose) {
      LAST_VERBOSE_ARGS = args
      VERBOSE_SEATBELT_FILES.add(args.seatbeltFile)
      if (!args.disable) {
        logConfig(args, config)
      }
    }
    argsCache.set(config, args)
  }
  return args
}

const configureRuleName = `${name}/configure`

function logRuleSetupHint() {
  logStderr(
    `
Make sure you have rule ${configureRuleName} enabled in your ESLint config for all files:

  rules: {
    // ...
    "${configureRuleName}": "error",
  }

Docs: https://github.com/justjake/${name}#setup`,
  )
}

function logConfig(args: SeatbeltArgs, baseConfig: SeatbeltConfig) {
  const log = SeatbeltArgs.getLogger(args)
  SeatbeltConfig.fromFallbackEnv(process.env as FallbackEnv, log)
  for (const [key, value] of Object.entries(baseConfig)) {
    log(`${padVarName("ESLint settings")} config.${key} =`, value)
  }
  SeatbeltConfig.fromEnvOverrides(process.env as SeatbeltEnv, log)
}

export function pushFileArgs(filename: string, args: SeatbeltArgs) {
  lastLintedFile = { filename, args }
  temporaryFileArgs.set(filename, args)
  if (isEslintCli()) {
    CLI_ARGS.add(args)
  }
}

export function popFileArgs(filename: string): SeatbeltArgs {
  const args = temporaryFileArgs.get(filename)
  temporaryFileArgs.delete(filename)
  if (args) {
    return args
  }

  if (lastLintedFile?.filename === filename) {
    // When there is a fatal TS error, eslint doesn't call configure.create() but still
    // runs the postprocessor, i.e. `temporaryFileArgs` is empty when trying to get the
    // args for the processed file. As a fallback, we try to use the once from the previous
    // run.
    return lastLintedFile.args
  }

  if (!hasAnyEnvVars) {
    if (lastLintedFile) {
      logStderr(
        `WARNING: last configured by file \`${lastLintedFile.filename}\` but linting file \`${filename}\`.
You may have rule ${configureRuleName} enabled for some files, but not this one.
`.trim(),
      )
    } else {
      logStderr(
        `WARNING: rule ${configureRuleName} not enabled in ESLint config and no SEATBELT environment variables set`,
      )
    }
    logRuleSetupHint()
  }
  return configToArgs(EMPTY_CONFIG)
}

export function getSeatbeltFile(filename: string): SeatbeltFile {
  let seatbeltFile = seatbeltFileCache.get(filename)
  if (!seatbeltFile) {
    seatbeltFile = SeatbeltFile.openSync(filename)
    seatbeltFileCache.set(filename, seatbeltFile)
  }
  return seatbeltFile
}

let didRegisterProcessExitHandler = false

type RunContext = {
  runner: "eslint-cli" | "editor" | "unknown"
  inEditorTerminal?: boolean
  vscodeLike?: boolean
  ci?: boolean
  npmLifecycleScript?: string
}

function detectRunContext(): RunContext {
  const isVscodeExtension = Boolean(process.env.VSCODE_IPC_HOOK)
  const isVscodeShell = process.env.TERM_PROGRAM === "vscode"
  const isEslintCli = process.argv.some(
    (arg) =>
      arg.endsWith("bin/eslint.js") || arg.includes("node_modules/eslint/"),
  )

  return {
    runner: isVscodeExtension
      ? "editor"
      : isEslintCli
        ? "eslint-cli"
        : "unknown",
    inEditorTerminal: isVscodeShell,
    npmLifecycleScript: process.env.npm_lifecycle_script,
    ci: Boolean(process.env.CI),
  }
}

let runContext: RunContext | undefined
function getRunContext(): RunContext {
  if (!runContext) {
    runContext = detectRunContext()
  }
  return runContext
}

const pluginStats = {
  processorRuns: 0,
  ruleRuns: 0,
  removedFiles: 0,
}

export function incrementStat(key: keyof typeof pluginStats, value = 1) {
  pluginStats[key] += value
}

export function onPreprocess(_filename: string) {
  incrementStat("processorRuns")
}

export function onPostprocess(_filename: string) {}

export function onConfigureRule(_filename: string) {
  incrementStat("ruleRuns")
}

export function registerEslintCliExitHandler() {
  if (ANY_CONFIG_DISABLED) {
    return
  }
  if (didRegisterProcessExitHandler) {
    return
  }
  didRegisterProcessExitHandler = true
  const runContext = detectRunContext()
  if (isEslintCli()) {
    process.once("exit", () => handleEslintCliExit(runContext))
  }
}

// Detect configuration errors
function handleEslintCliExit(_runContext: RunContext) {
  if (ANY_CONFIG_DISABLED) {
    return
  }

  cleanUpRemovedFiles()

  if (LAST_VERBOSE_ARGS) {
    logEslintRunSummary()
  }
}

function cleanUpRemovedFiles() {
  for (const args of CLI_ARGS) {
    const seatbeltFile = getSeatbeltFile(args.seatbeltFile)
    // TODO: args.threadsafe
    seatbeltFile.readSync()
    for (const filename of seatbeltFile.filenames()) {
      if (!fs.existsSync(filename)) {
        seatbeltFile.removeFile(filename, args)
        incrementStat("removedFiles")
      }
    }
    seatbeltFile.writeSync()
  }
}

function logEslintRunSummary() {
  const log = LAST_VERBOSE_ARGS
    ? SeatbeltArgs.getLogger(LAST_VERBOSE_ARGS)
    : logStderr

  const seatbeltFiles = Array.from(VERBOSE_SEATBELT_FILES).map(getSeatbeltFile)
  const ruleInfo = new Map<string, { allowed: number; inFiles: number }>()
  const totalInfo = { allowed: 0, inFiles: 0 }
  for (const seatbeltFile of seatbeltFiles) {
    for (const filename of seatbeltFile.filenames()) {
      const maxErrors = seatbeltFile.getMaxErrors(filename)
      if (maxErrors) {
        for (const [ruleId, errorCount] of maxErrors.entries()) {
          const info = getDefault(ruleInfo, ruleId, () => ({
            allowed: 0,
            inFiles: 0,
          }))
          info.allowed += errorCount
          info.inFiles++
          totalInfo.allowed += errorCount
          totalInfo.inFiles++
        }
      }
    }
  }

  const ruleStatsMessages: string[] = []
  ruleStatsMessages.push(
    `${SEATBELT_VERBOSE}: ${name}@${version} checked ${pluginStats.processorRuns} source files\n`,
  )

  const seatbeltFileCount =
    seatbeltFiles.length === 1
      ? "seatbelt file"
      : `${seatbeltFiles.length} seatbelt files`

  if (pluginStats.removedFiles > 0) {
    ruleStatsMessages.push(
      `Removed ${pluginStats.removedFiles} non-existent source files from ${seatbeltFileCount}\n`,
    )
  }
  ruleStatsMessages.push(`Allowed errors in ${seatbeltFileCount}:\n`)
  for (const ruleId of Array.from(ruleInfo.keys()).sort()) {
    const info = ruleInfo.get(ruleId)!
    const sourceFilesCount =
      info.inFiles === 1 ? "1 source file" : `${info.inFiles} source files`
    ruleStatsMessages.push(
      `  ${ruleId}: ${info.allowed} allowed in ${sourceFilesCount}\n`,
    )
  }
  log(ruleStatsMessages.join(""))
}

export function hasProcessorRun() {
  return pluginStats.processorRuns > 0
}

export function anyDisabled() {
  return ANY_CONFIG_DISABLED
}

function getDefault<K, V>(map: Map<K, V>, key: K, defaultValue: () => V) {
  if (!map.has(key)) {
    const value = defaultValue()
    map.set(key, value)
    return value
  }
  return map.get(key)!
}

export function isEslintCli() {
  return getRunContext().runner === "eslint-cli"
}

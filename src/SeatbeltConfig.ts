import type { RuleId } from "./SeatbeltFile"
import { name } from "../package.json"
import path from "node:path"
import { findRepoRoot } from "./repoIntegration"

export const SEATBELT_FILE_NAME = "eslint.seatbelt.tsv"

export const SEATBELT_FROZEN = "SEATBELT_FROZEN"
export const SEATBELT_INCREASE = "SEATBELT_INCREASE"
export const SEATBELT_KEEP = "SEATBELT_KEEP"
export const SEATBELT_FILE = "SEATBELT_FILE"
export const SEATBELT_PWD = "SEATBELT_PWD"
export const SEATBELT_DISABLE = "SEATBELT_DISABLE"
export const SEATBELT_DISABLE_IN_EDITOR = "SEATBELT_DISABLE_IN_EDITOR"
export const SEATBELT_THREADSAFE = "SEATBELT_THREADSAFE"
export const SEATBELT_VERBOSE = "SEATBELT_VERBOSE"
export const SEATBELT_ROOT = "SEATBELT_ROOT"

const ENV_VARS = {
  SEATBELT_FROZEN,
  SEATBELT_INCREASE,
  SEATBELT_KEEP,
  SEATBELT_FILE,
  SEATBELT_PWD,
  SEATBELT_DISABLE,
  SEATBELT_DISABLE_IN_EDITOR,
  SEATBELT_THREADSAFE,
  SEATBELT_VERBOSE,
  SEATBELT_ROOT,
  CI: "CI",
  JEST_WORKER_ID: "JEST_WORKER_ID",
}

/**
 * Configuration for seatbelt can be provided in a few ways:
 *
 * 1. Defined in the shared `settings` object in your ESLint config. This
 *    requires also configuring the `eslint-seatbelt/configure` rule.
 *
 *     ```js
 *     // in eslint.config.js
 *     const config = [
 *       {
 *         settings: {
 *           seatbelt: {
 *             // ...
 *           }
 *         },
 *         rules: {
 *           "eslint-seatbelt/configure": "error",
 *         }
 *       }
 *     ]
 *     ```
 *
 * 2. Using the `eslint-seatbelt/configure` rule in your ESLint config.
 *    This can be used to override settings for specific files in legacy ESLint configs.
 *    Any configuration provided here will override the shared `settings` object.
 *
 *     ```js
 *     // in .eslintrc.js
 *     module.exports = {
 *       rules: {
 *         "eslint-seatbelt/configure": "error",
 *       },
 *       overrides: [
 *         {
 *           files: ["some/path/*"],
 *           rules: {
 *             "eslint-seatbelt/configure": ["error", { seatbeltFile: "some/path/eslint.seatbelt.tsv" }]
 *           },
 *         },
 *       ],
 *     }
 *     ```
 * 3. The settings in config files can be overridden with environment variables when running `eslint` or other tools.
 *
 *    ```bash
 *    SEATBELT_FILE=some/path/eslint.seatbelt.tsv SEATBELT_FROZEN=1 eslint
 *    ```
 */
export interface SeatbeltConfig {
  /**
   * The seatbelt file stores the max error counts allowed for each file. Should
   * be an absolute path.
   *
   * If not provided, $SEATBELT_PWD/eslint.seatbelt.tsv or $PWD/eslint.seatbelt.tsv will be used.
   *
   * ```js
   * // in eslint.config.js
   * const config = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         // commonjs
   *         seatbeltFile: `${__dirname}/eslint.seatbelt.tsv`
   *         // esm
   *         seatbeltFile: new URL('./eslint.seatbelt.tsv', import.meta.url).pathname
   *       }
   *     }
   *   }
   * ]
   * ```
   *
   * You can also set this with environment variable `SEATBELT_FILE`:
   *
   * ```bash
   * SEATBELT_FILE=.config/custom-seatbelt-file eslint
   * ```
   */
  seatbeltFile?: string
  /**
   * By default whenever a file is linted and a rule has no errors, that rule's
   * max errors for the file is set to zero.
   *
   * However with typescript-eslint, it can be helpful to have two ESLint configs:
   *
   * - A default ESLint config with only syntactic rules enabled that don't
   *   require typechecking, that runs on developer machines and in their editor.
   * - A CI-only ESLint config with only type-aware rules enabled that requires
   *   typechecking. Since these rules require typechecking, they can be too
   *   slow to run in interactive contexts.
   *
   * To avoid this, set `keepRules` to the names of *disabled but known rules*
   * while linting.
   *
   * Example:
   *
   * ```js
   * // Default ESLint config
   * module.exports = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         keepRules: require('./eslint-typed.config.js').flatMap(config => Object.keys(config.rules ?? {})),
   *       }
   *     },
   *     rules: {
   *       "no-unused-vars": "error",
   *     },
   *   }
   * ]
   *
   * // Typechecking-required ESLint config for CI
   * module.exports = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         keepRules: require('./eslint.config.js').flatMap(config => Object.keys(config.rules ?? {})),
   *       }
   *     },
   *     rules: {
   *       // Requires typechecking (slow)
   *       "@typescript-eslint/no-floating-promises": "error",
   *     },
   *   }
   * ]
   * ```
   *
   * You can also set this with environment variable `SEATBELT_KEEP`:
   *
   * ```bash
   * SEATBELT_KEEP="@typescript-eslint/no-floating-promises @typescript-eslint/prefer-reduce-type-parameter" \
   *   eslint
   * ```
   *
   * You can set this to `"ALL"` to enable this setting for ALL rules:
   *
   * ```bash
   * SEATBELT_KEEP=ALL eslint
   * ```
   */
  keepRules?: RuleId[] | "all"
  /**
   * When you enable a rule for the first time, lint with it in this set to set
   * the initial max error counts.
   *
   * Typically this should be enabled for one lint run only via an environment
   * variable, but it can also be configured via ESLint settings.
   *
   * ```bash
   * SEATBELT_INCREASE="@typescript-eslint/no-floating-promises" eslint
   * ```
   *
   * You can set this to `"ALL"` to enable this setting for ALL rules:
   *
   * ```bash
   * SEATBELT_INCREASE=ALL eslint
   * ```
   *
   * ```js
   * // in eslint.config.js
   * // maybe you have a use-case for this
   * const config = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         allowIncreaseRules: ["@typescript-eslint/no-floating-promises"],
   *       }
   *     }
   *   }
   * ]
   * ```
   */
  allowIncreaseRules?: RuleId[] | "all"
  /**
   * Error if there is any change in the number of errors in the seatbelt file.
   * This is useful in CI to ensures that developers keep the seatbelt file up-to-date as they fix errors.
   *
   * It is enabled by default when environment variable `CI` is set.
   *
   * ```bash
   * CI=1 eslint
   * ```
   *
   * This can be set with the `SEATBELT_FROZEN` environment variable.
   *
   * ```bash
   * SEATBELT_FROZEN=1 eslint
   * ```
   *
   * Or in ESLint config:
   *
   * ```js
   * // in eslint.config.js
   * const config = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         frozen: true,
   *       }
   *     }
   *   }
   * ]
   * ```
   */
  frozen?: boolean
  /**
   * Completely disable seatbelt error processing for a lint run while leaving it otherwise configured.
   *
   * This can be set with the `SEATBELT_DISABLE` environment variable.
   *
   * ```bash
   * SEATBELT_DISABLE=1 eslint
   * ```
   *
   * Or in ESLint config:
   *
   * ```js
   * // in eslint.config.js
   * const config = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         disable: true,
   *       }
   *     }
   *   }
   * ]
   * ```
   */
  disable?: boolean
  /**
   * Use this in your IDE config to block seatbelt from automatically updating
   * the exceptions file when eslint is running during the `onType` event.
   */
  disableInEditor?: boolean
  /**
   * By default seatbelt assumes that only one ESLint process will read and
   * write to the seatbelt file at a time.
   *
   * This should be set to `true` if you use a parallel ESLint runner similar to
   * jest-runner-eslint to avoid losing updates during parallel writes to the
   * seatbelt file.
   *
   * When enabled, seatbelt creates temporary lock files to serialize updates to
   * the seatbelt file. This comes at a small performance cost.
   *
   * This is enabled by default when run with Jest (environment variable `JEST_WORKER_ID` is set).
   *
   * It can also be set with environment variable `SEATBELT_THREADSAFE`:
   *
   * ```bash
   * SEATBELT_THREADSAFE=1 eslint-parallel
   * ```
   *
   * Or in ESLint config:
   *
   * ```js
   * // in eslint.config.js
   * const config = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         threadsafe: true,
   *       }
   *     }
   *   }
   * ]
   * ```
   */
  threadsafe?: boolean

  /**
   * Enable verbose logging.
   *
   * This can be set with the `SEATBELT_VERBOSE` environment variable.
   *
   * ```bash
   * SEATBELT_VERBOSE=1 eslint
   * ```
   *
   * Or in ESLint config:
   *
   * ```js
   * // in eslint.config.js
   * const config = [
   *   {
   *     settings: {
   *       seatbelt: {
   *         verbose: true,
   *       }
   *     }
   *   }
   * ]
   * ```
   *
   * If set to a function (like `console.error`), that function will be called with the log messages.
   * The default logger when set to `true` is `console.error`.
   */
  verbose?: boolean | "stdout" | "stderr" | ((...message: unknown[]) => void)

  /**
   * Repository or project root.
   * By default this is inferred from `seatbeltFile` by checking ancestor directories for `.git`.
   * Used for editor integration to disable seatbelt during git actions like rebase or merge.
   *
   * This can be set with the `SEATBELT_ROOT` environment variable.
   */
  root?: string
}

export interface SeatbeltConfigWithPwd extends SeatbeltConfig {
  pwd: string
}

export const SeatbeltConfig = {
  withEnvOverrides(
    config: SeatbeltConfig,
    env: SeatbeltEnv & FallbackEnv,
  ): SeatbeltConfig {
    return {
      ...SeatbeltConfig.fromFallbackEnv(env),
      ...config,
      ...SeatbeltConfig.fromEnvOverrides(env),
    }
  },

  fromFallbackEnv(
    env: FallbackEnv,
    log?: (...message: unknown[]) => void,
  ): SeatbeltConfig {
    const config: SeatbeltConfig = {}
    const isCI = SeatbeltEnv.readBooleanEnvVar(env.CI)
    if (isCI) {
      config.frozen = true
      log?.(`${padVarName("CI")} config.frozen defaults to`, true)
    }
    if (env.JEST_WORKER_ID) {
      config.threadsafe = true
      log?.(
        `${padVarName("JEST_WORKER_ID")} config.threadsafe defaults to`,
        true,
      )
    }
    return config
  },

  fromEnvOverrides(
    env: SeatbeltEnv,
    log?: (...message: unknown[]) => void,
  ): SeatbeltConfigWithPwd {
    const config: SeatbeltConfigWithPwd = {
      pwd: env[SEATBELT_PWD] || process.cwd(),
    }

    const verbose = SeatbeltEnv.readBooleanEnvVar(env[SEATBELT_VERBOSE])
    if (verbose !== undefined) {
      config.verbose = verbose
      log?.(`${padVarName(SEATBELT_VERBOSE)} config.verbose =`, verbose)
    }
    const seatbeltFile = env[SEATBELT_FILE]
    if (seatbeltFile) {
      const rootRelative = path.isAbsolute(seatbeltFile) ? seatbeltFile : path.join(config.pwd, seatbeltFile)
      config.seatbeltFile = rootRelative
      log?.(`${padVarName(SEATBELT_FILE)} config.seatbeltFile =`, rootRelative)
    }
    const disable = SeatbeltEnv.readBooleanEnvVar(env[SEATBELT_DISABLE])
    if (disable !== undefined) {
      config.disable = disable
      log?.(`${padVarName(SEATBELT_DISABLE)} config.disable =`, disable)
    }
    const disableInEditor = SeatbeltEnv.readBooleanEnvVar(env[SEATBELT_DISABLE_IN_EDITOR])
    if (disableInEditor !== undefined) {
      config.disableInEditor = disableInEditor
      log?.(`${padVarName(SEATBELT_DISABLE_IN_EDITOR)} config.disableInEditor =`, disableInEditor)
    }
    const frozen = SeatbeltEnv.readBooleanEnvVar(env[SEATBELT_FROZEN])
    if (frozen !== undefined) {
      config.frozen = frozen
      log?.(`${padVarName(SEATBELT_FROZEN)} config.frozen =`, frozen)
    }
    const increase = SeatbeltEnv.parseRuleSetEnvVar(env[SEATBELT_INCREASE])
    if (increase !== undefined) {
      config.allowIncreaseRules = increase
      log?.(
        `${padVarName(SEATBELT_INCREASE)} config.allowIncreaseRules =`,
        increase,
      )
    }
    const keep = SeatbeltEnv.parseRuleSetEnvVar(env[SEATBELT_KEEP])
    if (keep !== undefined) {
      config.keepRules = keep
      log?.(`${padVarName(SEATBELT_KEEP)} config.keepRules =`, keep)
    }
    const threadsafe = SeatbeltEnv.readBooleanEnvVar(env[SEATBELT_THREADSAFE])
    if (threadsafe !== undefined) {
      config.threadsafe = threadsafe
      log?.(
        `${padVarName(SEATBELT_THREADSAFE)} config.threadsafe =`,
        threadsafe,
      )
    }
    const root = env[SEATBELT_ROOT]
    if (root) {
      config.root = root
      log?.(`${padVarName(SEATBELT_ROOT)} config.root =`, root)
    }

    return config
  },
} as const

/** A parsed {@link SeatbeltConfig} with all properties converted to runtime types. */
export type SeatbeltArgs = {
  [K in keyof SeatbeltConfig]-?: "all" | RuleId[] extends SeatbeltConfig[K]
    ? "all" | Set<RuleId>
    : SeatbeltConfig[K]
}

/** Catalogues the names of environment variables */
export interface SeatbeltEnv {
  [SEATBELT_INCREASE]?: string
  [SEATBELT_KEEP]?: string
  [SEATBELT_FILE]?: string
  [SEATBELT_PWD]?: string
  [SEATBELT_THREADSAFE]?: string
  [SEATBELT_DISABLE]?: string
  [SEATBELT_DISABLE_IN_EDITOR]?: string
  [SEATBELT_FROZEN]?: string
  [SEATBELT_VERBOSE]?: string
  [SEATBELT_ROOT]?: string
}

export const SeatbeltEnv = {
  parseRuleSetEnvVar(value: string | undefined): RuleId[] | "all" | undefined {
    if (value === undefined) {
      return undefined
    }

    if (!value) {
      return []
    }

    const lower = value.toLowerCase()
    if (lower === "all" || lower === "1" || lower === "true") {
      return "all"
    }

    return value.split(/[\s,]+/g).filter(Boolean)
  },

  readBooleanEnvVar(value: string | undefined): boolean | undefined {
    if (value === undefined || value === "") {
      return undefined
    }

    const lower = value.toLowerCase()
    if (lower === "false" || lower === "0" || lower === "no") {
      return false
    }
    return Boolean(value)
  },
} as const

/** Environment variables we may consider that don't override explicitly set config values. */
export interface FallbackEnv {
  CI?: string
  JEST_WORKER_ID?: string
}

export const logStdout = (...message: unknown[]) =>
  // eslint-disable-next-line no-console
  console.log(`[${name}]:`, ...message)
export const logStderr = (...message: unknown[]) =>
  // eslint-disable-next-line no-console
  console.error(`[${name}]:`, ...message)

export const SeatbeltArgs = {
  fromConfig(config: SeatbeltConfig & { pwd?: string }): SeatbeltArgs {
    const cwd = config.pwd ?? process.cwd()
    const seatbeltFile =
      config.seatbeltFile ?? SeatbeltArgs.findSeatbeltFile(cwd)
    const root =
      config.root ?? findRepoRoot(seatbeltFile) ?? path.dirname(seatbeltFile)
    return {
      seatbeltFile,
      root,
      keepRules:
        typeof config.keepRules === "string"
          ? config.keepRules
          : new Set(config.keepRules ?? []),
      allowIncreaseRules:
        typeof config.allowIncreaseRules === "string"
          ? config.allowIncreaseRules
          : new Set(config.allowIncreaseRules ?? []),
      frozen: config.frozen ?? false,
      disable: config.disable ?? false,
      disableInEditor: config.disableInEditor ?? false,
      threadsafe: config.threadsafe ?? false,
      verbose: config.verbose ?? false,
    }
  },
  getLogger(args: SeatbeltArgs): (...message: unknown[]) => void {
    if (typeof args.verbose === "function") {
      return args.verbose
    }
    if (args.verbose === "stdout") {
      return logStdout
    }
    return logStderr
  },
  ruleSetHas(ruleSet: "all" | Set<RuleId>, ruleId: RuleId): boolean {
    return ruleSet === "all" || ruleSet.has(ruleId)
  },
  verboseLog(args: SeatbeltArgs, makeMessage: () => string | unknown[]) {
    if (args.verbose) {
      const message = makeMessage()
      const log = SeatbeltArgs.getLogger(args)
      if (typeof message === "string") {
        log(message)
      } else {
        log(...message)
      }
    }
  },
  findSeatbeltFile(cwd: string): string {
    // TODO: go up to parent dir w/ .git?
    return `${cwd}/${SEATBELT_FILE_NAME}`
  },
}

let envVarMaxLength = 0

export function padVarName(name: string) {
  envVarMaxLength ||= Math.max(
    ...Object.values(ENV_VARS).map((name) => name.length),
  )
  return `${name}:`.padEnd(envVarMaxLength + 1)
}

export function formatFilename(filename: string) {
  const relative = path.relative(
    process.env[SEATBELT_PWD] ?? process.cwd(),
    filename,
  )
  return relative ? relative : filename
}

export function formatRuleId(ruleId: RuleId | null) {
  if (ruleId === null) {
    return `unknown rule`
  }
  return `rule ${ruleId}`
}

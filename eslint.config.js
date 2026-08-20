import reactHooks from "eslint-plugin-react-hooks"
import { parser as typescriptParser } from "typescript-eslint"

/**
 * ESLint is here for one rule set and no other: `eslint-plugin-react-hooks`
 * carries the React Compiler's diagnostics, and Biome does not implement them.
 * Biome keeps formatting and the general lint pass, and stays a separate
 * command because it rewrites files while this one only reports.
 *
 * The configuration sits at the repository root so that it reaches the UI
 * package as well as the web app, and extends no preset beyond the plugin's
 * own. Only the parser comes from `typescript-eslint`; none of its rules run.
 * A warning fails the command as an error does: a check whose findings are
 * printed and survived teaches the reader to scroll past it.
 *
 * Biome does have a rule of its own now — `useReactCompiler`, from 2.5.8 — and
 * it is not a replacement yet. It is in the nursery group, it caught three of
 * the seven breaches this plugin found the day both were run over the same
 * code, and it is skipped entirely unless the nearest `package.json` names a
 * React version it can parse — which `"react": "catalog:"` is not. A check that
 * turns itself off in silence is worse than no check. Worth trying again once
 * the rule is stable.
 */
export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/src-tauri/**", "**/routeTree.gen.ts"]
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    ...reactHooks.configs.flat.recommended
  }
]

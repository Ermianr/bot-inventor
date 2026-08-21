import reactHooks from "eslint-plugin-react-hooks"
import { parser as typescriptParser } from "typescript-eslint"

/**
 * ESLint is here for one rule set and no other: `eslint-plugin-react-hooks`
 * carries the React Compiler's diagnostics, and oxlint does not implement them.
 * oxfmt keeps formatting and oxlint the general lint pass; they stay a separate
 * command because that one rewrites files while this one only reports.
 *
 * The configuration sits at the repository root so that it reaches the UI
 * package as well as the web app, and extends no preset beyond the plugin's
 * own. Only the parser comes from `typescript-eslint`; none of its rules run.
 * A warning fails the command as an error does: a check whose findings are
 * printed and survived teaches the reader to scroll past it.
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

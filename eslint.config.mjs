import eslint from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import prettierRecommended from "eslint-plugin-prettier/recommended"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import globals from "globals"
import tseslint from "typescript-eslint"

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    ".features-gen/**",
    ".tmp/**",
  ]),

  eslint.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": [
        "error",
        {
          groups: [
            // Side effect imports.
            ["^\\u0000"],

            // Node.js builtins.
            ["^node:"],

            // React and related imports.
            ["^react$", "^react/"],

            // External packages.
            ["^@?\\w"],

            // Internal alias imports.
            ["^@/"],

            // Parent directory imports.
            ["^\\.\\.(?!/?$)", "^\\.\\./?$"],

            // Same-folder relative imports.
            ["^\\./(?=.*/)(?!/?$)", "^\\.(?!/?$)", "^\\./?$"],

            // Type-only imports.
            ["^.+\\u0000$"],

            // Style imports.
            ["^.+\\.s?css$"],
          ],
        },
      ],
      "simple-import-sort/exports": "error",
    },
  },

  {
    name: "yugilife/typescript",
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportSpecifier[importKind='type']",
          message: "Use a separate import type declaration.",
        },
      ],
    },
  },

  {
    name: "yugilife/react-app",
    files: ["apps/yugilife/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },

  // Keep Prettier last so it disables conflicting rules.
  prettierRecommended,
])

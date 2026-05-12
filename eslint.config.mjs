import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname
});

export default [
  js.configs.recommended,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "coverage/**",
      "**/*.d.ts",
      "AGENTS.md",
      "GEMINI.md"
    ]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      "no-console": [
        "warn",
        {
          "allow": ["warn", "error"]
        }
      ],
      "@next/next/no-html-link-for-pages": "off"
    }
  }
];

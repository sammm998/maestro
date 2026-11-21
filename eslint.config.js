import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.output/**", "**/.wxt/**", "**/drizzle/**", "**/next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // LLM SDKs may only be imported from packages/llm (plan §11).
      "no-restricted-imports": ["error", { paths: [
        { name: "@anthropic-ai/sdk", message: "Use @maestro/llm instead." },
        { name: "@mistralai/mistralai", message: "Use @maestro/llm instead." },
        { name: "openai", message: "Use @maestro/llm instead." }
      ] }]
    }
  },
  { files: ["packages/llm/**"], rules: { "no-restricted-imports": "off" } },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: globals.node } }
);

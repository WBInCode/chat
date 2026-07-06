// Shared ESLint flat config for chatv2 monorepo.
// Usage in a package: `import base from "@chatv2/config/eslint.config.js"; export default [...base, ...]`
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "warn"
    }
  },
  {
    ignores: ["dist/**", "node_modules/**", ".turbo/**", "generated/**"]
  }
);

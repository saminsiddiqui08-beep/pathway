import js from "@eslint/js";
import globals from "globals";

export default [
  // Skipping the Android copy of www, which would otherwise be checked twice
  { ignores: ["android/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["www/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    files: ["www/app/boot.js"],
    languageOptions: { sourceType: "script" },
  },
  // Running the checking scripts in Node on the computer, never on the phone
  {
    files: ["eslint.config.js", "tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
    },
  },
];

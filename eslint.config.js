import tseslint from "typescript-eslint";
import noSeparateExport from "./eslint-rules/no-separate-export.js";

export default [
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: {
      custom: {
        rules: {
          "no-separate-export": noSeparateExport,
        },
      },
    },
    rules: {
      "custom/no-separate-export": "error",
    },
  },
];

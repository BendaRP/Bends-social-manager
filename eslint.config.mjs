import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    rules: {
      // Media is served from a user-configured S3 bucket, so next/image's
      // build-time domain allowlist cannot cover it; plain <img> is correct here.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;

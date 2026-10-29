// https://docs.expo.dev/guides/using-eslint/
// Own config on purpose: the website's eslint.config.mjs one folder up ignores mobile/** (different rules, different runtime).
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*"],
  },
]);

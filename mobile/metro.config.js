// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// The website's pure lib modules (prices, money formatting, card numbers,
// games, typed search) run inside the app unchanged: tsconfig.json maps
// "@/lib/*" to ../src/lib, and Metro must watch that folder to serve it.
// Nothing under ../src/lib may import React, Next or server-only code.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../src/lib")];

module.exports = config;

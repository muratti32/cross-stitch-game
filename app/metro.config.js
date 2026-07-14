const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

if (config.resolver && config.resolver.assetExts) {
  config.resolver.assetExts.push('bin');
}

module.exports = config;


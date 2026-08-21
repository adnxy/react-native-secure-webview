module.exports = {
  preset: '@react-native/jest-preset',
  modulePathIgnorePatterns: ['<rootDir>/example/node_modules', '<rootDir>/lib'],
  // The root babel.config.js uses react-native-builder-bob's babel preset,
  // which is ESM-only and cannot be loaded by Jest's synchronous Babel
  // pipeline. Use an explicit inline config for tests instead.
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': [
      'babel-jest',
      {
        configFile: false,
        presets: ['module:@react-native/babel-preset'],
      },
    ],
  },
};

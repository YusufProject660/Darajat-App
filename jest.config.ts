import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^uuid$': '<rootDir>/src/test/mocks/uuid.ts',
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 20000,
  detectOpenHandles: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 20,
      lines: 20,
      statements: 20,
    },
  },

  // 🚫 Ignore helper and mock files so Jest doesn’t treat them as test suites
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/src/test/',
  ],

  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  verbose: true,
};

export default config;

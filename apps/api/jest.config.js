// apps/api/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: { '^@surfshark/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};

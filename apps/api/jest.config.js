// apps/api/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src'],
  moduleNameMapper: { '^@surfshark/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};

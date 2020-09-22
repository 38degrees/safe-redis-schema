module.exports = {
  roots: [
    "src"
  ],
  transform: {
    "^.+\\.ts$": "ts-jest"
  },
  collectCoverageFrom: [
    'src/**/*.{ts}',
  ],
  verbose: true
}

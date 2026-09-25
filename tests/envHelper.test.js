const test = require('node:test');
const assert = require('node:assert/strict');
const dotenv = require('dotenv');
const {
  serializeEnvValue,
  updateEnvFile,
} = require('../server/config/envHelper');

test('serializeEnvValue leaves safe values readable', () => {
  assert.equal(serializeEnvValue('simple-value_123'), 'simple-value_123');
});

test('serializeEnvValue round-trips dotenv-significant values', () => {
  const values = [
    'value with spaces',
    'value#with-hash',
    'value$with${expansion}',
    "value'with\"quotes",
    'line one\nline two',
    'back\\slash',
  ];

  for (const value of values) {
    const parsed = dotenv.parse(`TEST_SECRET=${serializeEnvValue(value)}\n`);
    assert.equal(parsed.TEST_SECRET, value);
  }
});

test('updateEnvFile rejects invalid environment names without mutating process', () => {
  const key = 'INVALID\nENV_NAME';
  assert.equal(updateEnvFile({ [key]: 'unsafe' }), false);
  assert.equal(process.env[key], undefined);
});

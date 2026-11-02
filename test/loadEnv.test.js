'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const loadEnvPath = path.join(__dirname, '..', 'config', 'loadEnv.js');

function writeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelterlink-load-env-'));
  fs.writeFileSync(path.join(dir, '.env'), 'SENTINEL_FROM_DOTENV=from-dotenv\n');
  const envFile = path.join(dir, 'local.env');
  fs.writeFileSync(envFile, 'SENTINEL_FROM_ENV_FILE=from-env-file\n');
  const script = path.join(dir, 'run.js');
  fs.writeFileSync(
    script,
    `'use strict';
require(${JSON.stringify(loadEnvPath)}).loadEnv();
process.stdout.write(JSON.stringify({
  fromFile: process.env.SENTINEL_FROM_ENV_FILE || '',
  fromDotenv: process.env.SENTINEL_FROM_DOTENV || '',
}));
`
  );
  return { dir, envFile, script };
}

function run(script, cwd, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('ENV_FILE is loaded and .env is not', () => {
  const { dir, envFile, script } = writeTempProject();
  try {
    const seen = run(script, dir, {
      PATH: process.env.PATH,
      ENV_FILE: envFile,
    });
    assert.equal(seen.fromFile, 'from-env-file');
    assert.equal(seen.fromDotenv, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with ENV_FILE unset, .env in the working directory is loaded', () => {
  const { dir, script } = writeTempProject();
  try {
    const seen = run(script, dir, { PATH: process.env.PATH });
    assert.equal(seen.fromDotenv, 'from-dotenv');
    assert.equal(seen.fromFile, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

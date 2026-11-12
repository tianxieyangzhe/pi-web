#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { packageRelease } = require('./package-release.cjs');

const exists = target => {
  try { fs.lstatSync(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
function checkDestination(destination, replace) {
  if (!exists(destination)) return;
  if (!replace) throw Error('Release destination already exists; choose a new directory.');
  if (fs.lstatSync(destination).isSymbolicLink() || !fs.lstatSync(destination).isDirectory()) {
    throw Error('Default release destination must be a regular directory.');
  }
  const names = fs.readdirSync(destination);
  if (names.some(name => ['.data', 'agents', 'models.json', 'settings.json', 'auth.json'].includes(name) || name.startsWith('.env'))) {
    throw Error('release/ contains runtime data or configuration; use a new explicit destination.');
  }
  for (const name of ['release.json', 'server.js']) {
    const file = path.join(destination, name);
    if (!exists(file) || fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile()) {
      throw Error('Existing release/ is not a recognized build package; use a new explicit destination.');
    }
  }
  if (!JSON.parse(fs.readFileSync(path.join(destination, 'release.json'), 'utf8')).buildId) {
    throw Error('Existing release/ has no Build ID; use a new explicit destination.');
  }
}
function release(args = process.argv.slice(2)) {
  const withoutNodeModules = args.includes('--without-node-modules');
  const destinations = args.filter(arg => arg !== '--without-node-modules');
  if (destinations.length > 1 || destinations.some(arg => arg.startsWith('--'))) {
    throw Error('Usage: npm run release -- [new-destination] [--without-node-modules]');
  }
  const root = path.resolve(__dirname, '..');
  const destination = path.resolve(root, destinations[0] || 'release');
  const replace = destinations.length === 0;
  const build = path.join(root, '.next-release');
  if (destination === root || root.startsWith(destination + path.sep) || destination === build || destination.startsWith(build + path.sep)) {
    throw Error('Release destination must be outside the build and must not contain the application root.');
  }
  checkDestination(destination, replace);
  const lock = path.join(root, '.release.lock');
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('Another release may be in progress (.release.lock exists). Verify it has stopped before removing the lock.');
    throw error;
  }
  let temporary;
  let backup;
  try {
    // Always start with a clean production build, including its cache.
    if (exists(build)) {
      const stat = fs.lstatSync(build);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw Error('Production build path must be a regular directory: ' + build);
      }
      if (fs.readdirSync(build).some(name => ['.data', 'agents', 'models.json', 'settings.json', 'auth.json'].includes(name) || name.startsWith('.env'))) {
        throw Error('Production build directory contains runtime data or configuration; refusing to clean it.');
      }
      fs.rmSync(build, { recursive: true });
      console.log('Removed old production build: ' + build);
    }
    // Both compilation and packaging use the same isolated production directory.
    const env = { ...process.env, AI_WORKSPACE_BUILD_DIR: '.next-release' };
    console.log('Building production release in ' + build);
    const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', '--webpack'], {
      cwd: root, env, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error('Production build failed; release/ was not changed.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.release-stage-'));
    const staged = path.join(temporary, 'package');
    const previousBuildDir = process.env.AI_WORKSPACE_BUILD_DIR;
    process.env.AI_WORKSPACE_BUILD_DIR = env.AI_WORKSPACE_BUILD_DIR;
    try { packageRelease(root, staged, { withoutNodeModules }); }
    finally {
      if (previousBuildDir === undefined) delete process.env.AI_WORKSPACE_BUILD_DIR;
      else process.env.AI_WORKSPACE_BUILD_DIR = previousBuildDir;
    }
    const metadata = JSON.parse(fs.readFileSync(path.join(staged, 'release.json'), 'utf8'));
    if (metadata.buildId !== fs.readFileSync(path.join(build, 'BUILD_ID'), 'utf8').trim()) {
      throw Error('Release Build ID does not match production build.');
    }
    checkDestination(destination, replace);
    if (exists(destination)) {
      backup = path.join(root, 'release-previous-' + randomUUID());
      fs.renameSync(destination, backup);
    }
    try { fs.renameSync(staged, destination); }
    catch (error) {
      if (backup) { fs.renameSync(backup, destination); backup = undefined; }
      throw error;
    }
    if (backup) {
      try {
        fs.rmSync(backup, { recursive: true });
        console.log('Removed previous release: ' + backup);
      } catch (error) {
        console.warn('New release is ready, but previous release cleanup failed: ' + backup + ' (' + error.message + ')');
      }
    }
    console.log('Release ready: ' + destination);
    console.log('Build ID: ' + metadata.buildId);
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmdirSync(lock);
  }
}
if (require.main === module) {
  try { release(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { release };

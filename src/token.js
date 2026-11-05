// src/token.js — Access token resolution, persistence, and interactive prompting.
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';

/**
 * Returns the default persistent file path for stored credentials.
 * @returns {string}
 */
export function getTokenPath() {
  return join(homedir(), '.config', 'figmacode', 'token');
}

/**
 * Reads any previously saved token from disk.
 * @param {string} [customPath]
 * @returns {string|null}
 */
export function readSavedToken(customPath = null) {
  try {
    const p = customPath || getTokenPath();
    const token = readFileSync(p, 'utf8').trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Saves access token to disk for future CLI/MCP runs.
 * @param {string} token
 * @param {string} [customPath]
 * @returns {boolean}
 */
export function saveToken(token, customPath = null) {
  try {
    if (!token || !String(token).trim()) return false;
    const p = customPath || getTokenPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, String(token).trim() + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes any previously saved token from disk.
 * @param {string} [customPath]
 * @returns {boolean}
 */
export function deleteSavedToken(customPath = null) {
  try {
    const p = customPath || getTokenPath();
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves access token from:
 * 1. Explicit token argument
 * 2. Environment variables (ACCESS_TOKEN / ORIGIN_TOKEN)
 * 3. Saved token file (~/.config/figmacode/token)
 * 4. Interactive stdin prompt (if interactive && stdin is a TTY)
 *
 * @param {object} [opts]
 * @param {string} [opts.token]
 * @param {boolean} [opts.interactive]
 * @param {string} [opts.customPath]
 * @returns {Promise<string>}
 */
export async function resolveToken(opts = {}) {
  const { token, interactive = true, customPath = null } = opts;

  if (token && String(token).trim()) {
    return String(token).trim();
  }

  const envToken = process.env.ACCESS_TOKEN || process.env.ORIGIN_TOKEN;
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  const saved = readSavedToken(customPath);
  if (saved) {
    return saved;
  }

  if (interactive && process.stdin && process.stdin.isTTY) {
    const rl = createInterface({ input, output });
    try {
      console.error('\nCodeConvert Access Token required (get from plugin avatar menu > Access Token).');
      const answer = await rl.question('Enter Access Token (cct_...): ');
      const trimmed = answer.trim();
      if (trimmed) {
        saveToken(trimmed, customPath);
        console.error(`Token saved to ${customPath || getTokenPath()}\n`);
        return trimmed;
      }
    } finally {
      rl.close();
    }
  }

  return '';
}


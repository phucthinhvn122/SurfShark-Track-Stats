// apps/api/src/key-redeem/device/device.service.ts
//
// Fetches the 6-character device code from a running Surfshark app.
//
// The "right" source depends on the platform the user is on:
//   - desktop app that writes its code to a JSON file → SURFSHARK_DEVICE_CODE_FILE
//   - app exposes an HTTP endpoint                      → SURFSHARK_DEVICE_CODE_URL
//   - a CLI shim ships the code                        → SURFSHARK_DEVICE_CODE_CLI
//   - static / CI environment                          → SURFSHARK_DEVICE_CODE env (handled in env.config.ts)
//
// Strategies are tried in order. The first one that returns a value wins.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ENV } from '../../config/config.module';
import type { AppEnv } from '../../config/env.config';
import { AppException } from '../../common/app-exception';
import { ErrorCode } from '@surfshark/shared';

const execFileAsync = promisify(execFile);
const DEVICE_CODE_REGEX = /^[A-Z0-9]{6}$/;
const HTTP_TIMEOUT_MS = 5_000;
const CLI_TIMEOUT_MS = 10_000;

export interface DeviceCodeSource {
  name: string;
  read(): Promise<string | null>;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger('DeviceService');
  private readonly sources: DeviceCodeSource[];

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    this.sources = this.buildSources(env);
  }

  /**
   * Returns the current 6-character device code or throws an AppException with
   * a clear message that the caller can return to the end user.
   */
  async getDeviceCode(): Promise<string> {
    const errors: string[] = [];
    for (const source of this.sources) {
      try {
        const value = await source.read();
        const normalized = this.normalize(value);
        if (normalized) {
          this.logger.log(`Device code resolved from source "${source.name}"`);
          return normalized;
        }
      } catch (e) {
        errors.push(`${source.name}: ${(e as Error).message}`);
      }
    }
    this.logger.error(`No device code source returned a value (${errors.join(' | ')})`);
    throw new AppException(
      ErrorCode.DEVICE_CODE_UNAVAILABLE,
      'Could not read device code from Surfshark app',
      502,
    );
  }

  private buildSources(env: AppEnv): DeviceCodeSource[] {
    const sources: DeviceCodeSource[] = [];

    if (env.SURFSHARK_DEVICE_CODE_FILE) {
      sources.push({
        name: 'file',
        read: async () => readDeviceCodeFromFile(env.SURFSHARK_DEVICE_CODE_FILE!),
      });
    }
    if (env.SURFSHARK_DEVICE_CODE_URL) {
      sources.push({
        name: 'http',
        read: async () => readDeviceCodeFromHttp(env.SURFSHARK_DEVICE_CODE_URL!),
      });
    }
    if (env.SURFSHARK_DEVICE_CODE_CLI) {
      sources.push({
        name: 'cli',
        read: async () => readDeviceCodeFromCli(env.SURFSHARK_DEVICE_CODE_CLI!),
      });
    }
    return sources;
  }

  private normalize(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim().toUpperCase();
    return DEVICE_CODE_REGEX.test(trimmed) ? trimmed : null;
  }
}

async function readDeviceCodeFromFile(path: string): Promise<string | null> {
  const raw = await fs.readFile(path, 'utf8');
  // Support either a raw 6-char string, or a JSON object with `deviceCode`.
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed.deviceCode === 'string') return parsed.deviceCode;
  } catch {
    // not JSON — treat as raw string
  }
  return raw;
}

async function readDeviceCodeFromHttp(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json, text/plain' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as { deviceCode?: unknown };
      return typeof json.deviceCode === 'string' ? json.deviceCode : null;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readDeviceCodeFromCli(command: string): Promise<string | null> {
  const { stdout } = await execFileAsync(command, { timeout: CLI_TIMEOUT_MS, shell: true });
  return stdout;
}

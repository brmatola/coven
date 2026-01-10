import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

/**
 * Supported platforms for the daemon binary.
 */
export type Platform = 'darwin-arm64' | 'darwin-amd64' | 'linux-amd64' | 'linux-arm64';

/**
 * Options for BinaryManager initialization.
 */
export interface BinaryManagerOptions {
  /** Extension root path (where bundled binaries are stored) */
  extensionPath: string;
  /** Version of the bundled binary */
  bundledVersion: string;
  /** Override the coven directory (defaults to ~/.coven). Used for testing. */
  covenDir?: string;
  /** Override path to the covend binary (for development). Bypasses bundled binary extraction. */
  overridePath?: string;
}

/**
 * Manages the daemon binary lifecycle - extraction and version management.
 *
 * Binary Paths:
 * - Bundled: {extensionPath}/bin/{platform}/covend
 * - Extracted: ~/.coven/bin/covend
 *
 * Version Management:
 * - Stores version in ~/.coven/bin/.version
 * - Auto-updates if bundled version is newer
 */
export class BinaryManager {
  private readonly extensionPath: string;
  private readonly bundledVersion: string;
  private readonly covenDir: string;
  private readonly binDir: string;
  private readonly versionFile: string;
  private readonly overridePath: string | undefined;

  constructor(options: BinaryManagerOptions) {
    this.extensionPath = options.extensionPath;
    this.bundledVersion = options.bundledVersion;
    this.overridePath = options.overridePath;

    // ~/.coven/bin (or custom covenDir for testing)
    this.covenDir = options.covenDir ?? path.join(os.homedir(), '.coven');
    this.binDir = path.join(this.covenDir, 'bin');
    this.versionFile = path.join(this.binDir, '.version');
  }

  /**
   * Get the path to the daemon binary, extracting if needed.
   *
   * @returns Path to the extracted binary
   * @throws Error if platform is unsupported or extraction fails
   */
  async ensureBinary(): Promise<string> {
    // Check override path first (for development)
    if (this.overridePath) {
      const exists = await this.binaryExists(this.overridePath);
      if (exists) {
        return this.overridePath;
      }
      // Override path doesn't exist - fall through to bundled binary
      // This allows development setups to gracefully degrade
    }

    const binaryPath = this.getExtractedBinaryPath();

    // Check if binary exists and is up to date
    const exists = await this.binaryExists(binaryPath);
    const needsUpdate = exists ? await this.needsUpdate() : true;

    if (!exists || needsUpdate) {
      await this.extractBinary();
    }

    return binaryPath;
  }

  /**
   * Check if the bundled binary is newer than the extracted one.
   */
  async needsUpdate(): Promise<boolean> {
    try {
      const installedVersion = await this.getInstalledVersion();
      if (!installedVersion) {
        return true;
      }
      return this.isNewerVersion(this.bundledVersion, installedVersion);
    } catch {
      // Any error means we should update
      return true;
    }
  }

  /**
   * Get the currently installed version.
   */
  async getInstalledVersion(): Promise<string | null> {
    try {
      const version = await fs.readFile(this.versionFile, 'utf-8');
      return version.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get the path where the binary will be extracted.
   */
  getExtractedBinaryPath(): string {
    return path.join(this.binDir, 'covend');
  }

  /**
   * Get the current platform identifier.
   *
   * @throws Error if platform is unsupported
   */
  static getPlatform(): Platform {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'darwin' && arch === 'arm64') {
      return 'darwin-arm64';
    }
    if (platform === 'darwin' && (arch === 'x64' || arch === 'ia32')) {
      return 'darwin-amd64';
    }
    if (platform === 'linux' && arch === 'x64') {
      return 'linux-amd64';
    }
    if (platform === 'linux' && arch === 'arm64') {
      return 'linux-arm64';
    }

    throw new Error(
      `Unsupported platform: ${platform}-${arch}. ` +
      `Supported: darwin-arm64, darwin-amd64, linux-amd64, linux-arm64`
    );
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Extract the bundled binary to ~/.coven/bin.
   */
  private async extractBinary(): Promise<void> {
    const platform = BinaryManager.getPlatform();
    const bundledPath = this.getBundledBinaryPath(platform);

    // Verify bundled binary exists
    const bundledExists = await this.binaryExists(bundledPath);
    if (!bundledExists) {
      throw new Error(
        `Bundled binary not found at ${bundledPath}. ` +
        `The extension package may be incomplete.`
      );
    }

    // Create bin directory
    await fs.mkdir(this.binDir, { recursive: true });

    // Copy binary
    const extractedPath = this.getExtractedBinaryPath();
    await fs.copyFile(bundledPath, extractedPath);

    // Make executable (chmod +x)
    await fs.chmod(extractedPath, 0o755);

    // Write version file
    await fs.writeFile(this.versionFile, this.bundledVersion, 'utf-8');
  }

  /**
   * Get the path to the bundled binary for a specific platform.
   */
  private getBundledBinaryPath(platform: Platform): string {
    return path.join(this.extensionPath, 'bin', platform, 'covend');
  }

  /**
   * Check if a binary file exists.
   */
  private async binaryExists(binaryPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(binaryPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Compare two semver versions.
   *
   * @returns true if newVersion is newer than oldVersion
   */
  private isNewerVersion(newVersion: string, oldVersion: string): boolean {
    const parseVersion = (v: string): number[] => {
      // Strip 'v' prefix if present
      const clean = v.replace(/^v/, '');
      return clean.split('.').map((n) => parseInt(n, 10) || 0);
    };

    const newParts = parseVersion(newVersion);
    const oldParts = parseVersion(oldVersion);

    for (let i = 0; i < 3; i++) {
      const n = newParts[i] ?? 0;
      const o = oldParts[i] ?? 0;
      if (n > o) return true;
      if (n < o) return false;
    }

    return false;
  }
}

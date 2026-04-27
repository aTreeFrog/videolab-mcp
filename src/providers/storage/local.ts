import { resolve, isAbsolute, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { StorageProvider } from "../types.js";
import { logger } from "../../logger.js";

export class LocalStorageProvider implements StorageProvider {
  readonly kind = "local";
  constructor(private readonly root: string, private readonly cwd: string) {}

  private absoluteRoot(): string {
    return isAbsolute(this.root) ? this.root : resolve(this.cwd, this.root);
  }

  private cacheDir(): string {
    return resolve(this.absoluteRoot(), "cache");
  }

  async resolveUri(pathOrUri: string): Promise<string> {
    if (/^(file|https?):\/\//i.test(pathOrUri)) return pathOrUri;
    const abs = this.toAbsolute(pathOrUri);
    return pathToFileURL(abs).toString();
  }

  async resolveLocalPath(pathOrUri: string): Promise<string> {
    if (pathOrUri.startsWith("file://")) {
      const u = new URL(pathOrUri);
      return decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    }
    if (/^https?:\/\//i.test(pathOrUri)) {
      return this.downloadToCache(pathOrUri);
    }
    const abs = this.toAbsolute(pathOrUri);
    if (!existsSync(abs)) {
      throw new Error(`File not found: ${abs}`);
    }
    return abs;
  }

  private async downloadToCache(url: string): Promise<string> {
    const cacheDir = this.cacheDir();
    mkdirSync(cacheDir, { recursive: true });
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
    const ext = (url.split("?")[0].split(".").pop() || "bin").toLowerCase().slice(0, 5);
    const cachePath = resolve(cacheDir, `${hash}.${ext}`);
    if (existsSync(cachePath)) return cachePath;
    logger.info(`storage: downloading ${url} -> cache/${hash}.${ext}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download ${url}: ${res.status} ${await res.text().catch(() => "")}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
    return cachePath;
  }

  async writeBlob(relativePath: string, data: Buffer): Promise<{ url: string; localPath: string }> {
    const localPath = this.toAbsolute(relativePath);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, data);
    return { url: relativePath, localPath };
  }

  async localPathFor(relativePath: string): Promise<string> {
    const localPath = this.toAbsolute(relativePath);
    mkdirSync(dirname(localPath), { recursive: true });
    return localPath;
  }

  private toAbsolute(p: string): string {
    return isAbsolute(p) ? p : resolve(this.absoluteRoot(), p);
  }
}

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { SceneAsset, SceneRef } from "../../types.js";
import type { SceneAssetProvider } from "../types.js";

type Manifest = {
  scenes: Record<string, string[]>;
  assets: Record<string, SceneAsset>;
};

export class JsonManifestSceneAssetProvider implements SceneAssetProvider {
  readonly kind = "json-manifest";
  private readonly path: string;
  private manifest: Manifest;

  constructor(path: string, cwd: string) {
    this.path = isAbsolute(path) ? path : resolve(cwd, path);
    this.manifest = this.load();
  }

  describeRefShape(): string {
    return 'json-manifest provider expects { "key": "<scene-key>" } as the sceneRef. ' +
      'Available keys: ' + Object.keys(this.manifest.scenes).join(", ") || "(none yet)";
  }

  private load(): Manifest {
    if (!existsSync(this.path)) return { scenes: {}, assets: {} };
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      return { scenes: raw.scenes ?? {}, assets: raw.assets ?? {} };
    } catch (e) {
      throw new Error(`Failed to parse scene manifest at ${this.path}: ${(e as Error).message}`);
    }
  }

  async listAssets(ref: SceneRef): Promise<SceneAsset[]> {
    const key = (ref as { key?: unknown })?.key;
    if (typeof key !== "string") {
      throw new Error('json-manifest provider requires sceneRef.key (string). Got: ' + JSON.stringify(ref));
    }
    const ids = this.manifest.scenes[key];
    if (!ids) return [];
    return ids.map(id => this.manifest.assets[id]).filter(Boolean);
  }

  async getAsset(id: string): Promise<SceneAsset | null> {
    return this.manifest.assets[id] ?? null;
  }
}

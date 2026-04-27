import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import type { MusicTrack, BRollClip, Voiceover, ScriptDoc, RenderManifest, GeneratedImage } from "../../types.js";
import type { MusicLibrary, BRollLibrary, VoiceoverStore, ScriptStore, RenderStore, ImageStore } from "../library-types.js";
import type { MusicFilter, BRollFilter } from "../types.js";

type Shape = {
  music: Record<string, MusicTrack>;
  broll: Record<string, BRollClip>;
  voiceovers: Record<string, Voiceover>;
  scripts: Record<string, ScriptDoc>;
  renders: Record<string, RenderManifest>;
  images: Record<string, GeneratedImage>;
};

const EMPTY: Shape = { music: {}, broll: {}, voiceovers: {}, scripts: {}, renders: {}, images: {} };

export class JsonStore {
  readonly path: string;
  constructor(path: string, cwd: string) {
    this.path = isAbsolute(path) ? path : resolve(cwd, path);
  }
  load(): Shape {
    if (!existsSync(this.path)) return structuredClone(EMPTY);
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      return {
        music: raw.music ?? {},
        broll: raw.broll ?? {},
        voiceovers: raw.voiceovers ?? {},
        scripts: raw.scripts ?? {},
        renders: raw.renders ?? {},
        images: raw.images ?? {},
      };
    } catch (e) {
      throw new Error(`Failed to parse index at ${this.path}: ${(e as Error).message}`);
    }
  }
  save(shape: Shape): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(shape, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
}

export class LocalJsonMusicLibrary implements MusicLibrary {
  readonly kind = "local";
  constructor(private store: JsonStore) {}
  async list(f?: MusicFilter): Promise<MusicTrack[]> {
    return applyMusicFilter(Object.values(this.store.load().music), f);
  }
  async get(id: string): Promise<MusicTrack | null> {
    return this.store.load().music[id] ?? null;
  }
  async add(track: MusicTrack): Promise<void> {
    const shape = this.store.load();
    shape.music[track.id] = track;
    this.store.save(shape);
  }
  async remove(id: string): Promise<boolean> {
    const shape = this.store.load();
    if (!(id in shape.music)) return false;
    delete shape.music[id];
    this.store.save(shape);
    return true;
  }
}

export class LocalJsonBRollLibrary implements BRollLibrary {
  readonly kind = "local";
  constructor(private store: JsonStore) {}
  async list(f?: BRollFilter): Promise<BRollClip[]> {
    return applyBRollFilter(Object.values(this.store.load().broll), f);
  }
  async get(id: string): Promise<BRollClip | null> {
    return this.store.load().broll[id] ?? null;
  }
  async add(clip: BRollClip): Promise<void> {
    const shape = this.store.load();
    shape.broll[clip.id] = clip;
    this.store.save(shape);
  }
  async remove(id: string): Promise<boolean> {
    const shape = this.store.load();
    if (!(id in shape.broll)) return false;
    delete shape.broll[id];
    this.store.save(shape);
    return true;
  }
}

export class LocalJsonVoiceoverStore implements VoiceoverStore {
  readonly kind = "local";
  constructor(private store: JsonStore) {}
  async list(): Promise<Voiceover[]> {
    return Object.values(this.store.load().voiceovers).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<Voiceover | null> {
    return this.store.load().voiceovers[id] ?? null;
  }
  async add(vo: Voiceover): Promise<void> {
    const shape = this.store.load();
    shape.voiceovers[vo.id] = vo;
    this.store.save(shape);
  }
  async remove(id: string): Promise<boolean> {
    const shape = this.store.load();
    if (!(id in shape.voiceovers)) return false;
    delete shape.voiceovers[id];
    this.store.save(shape);
    return true;
  }
}

export class LocalJsonScriptStore implements ScriptStore {
  readonly kind = "local";
  constructor(private store: JsonStore) {}
  async list(): Promise<ScriptDoc[]> {
    return Object.values(this.store.load().scripts).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<ScriptDoc | null> {
    return this.store.load().scripts[id] ?? null;
  }
  async add(script: ScriptDoc): Promise<void> {
    const shape = this.store.load();
    shape.scripts[script.id] = script;
    this.store.save(shape);
  }
  async remove(id: string): Promise<boolean> {
    const shape = this.store.load();
    if (!(id in shape.scripts)) return false;
    delete shape.scripts[id];
    this.store.save(shape);
    return true;
  }
}

export class LocalJsonRenderStore implements RenderStore {
  readonly kind = "local";
  constructor(private store: JsonStore) {}
  async list(): Promise<RenderManifest[]> {
    return Object.values(this.store.load().renders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<RenderManifest | null> {
    return this.store.load().renders[id] ?? null;
  }
  async add(render: RenderManifest): Promise<void> {
    const shape = this.store.load();
    shape.renders[render.renderId] = render;
    this.store.save(shape);
  }
  async remove(id: string): Promise<boolean> {
    const shape = this.store.load();
    if (!(id in shape.renders)) return false;
    delete shape.renders[id];
    this.store.save(shape);
    return true;
  }
}

export class LocalJsonImageStore implements ImageStore {
  readonly kind = "local";
  constructor(private store: JsonStore) {}
  async list(): Promise<GeneratedImage[]> {
    return Object.values(this.store.load().images).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<GeneratedImage | null> {
    return this.store.load().images[id] ?? null;
  }
  async add(image: GeneratedImage): Promise<void> {
    const shape = this.store.load();
    shape.images[image.id] = image;
    this.store.save(shape);
  }
  async remove(id: string): Promise<boolean> {
    const shape = this.store.load();
    if (!(id in shape.images)) return false;
    delete shape.images[id];
    this.store.save(shape);
    return true;
  }
}

function applyMusicFilter(tracks: MusicTrack[], f?: MusicFilter): MusicTrack[] {
  if (!f) return tracks;
  return tracks.filter(t => {
    if (f.mood && t.mood !== f.mood) return false;
    if (f.genre && t.genre !== f.genre) return false;
    if (f.intensity && t.intensity !== f.intensity) return false;
    if (f.source && t.source !== f.source) return false;
    if (f.tags?.length) {
      const tags = t.tags ?? [];
      if (!f.tags.every(req => tags.includes(req))) return false;
    }
    return true;
  });
}

function applyBRollFilter(clips: BRollClip[], f?: BRollFilter): BRollClip[] {
  if (!f) return clips;
  return clips.filter(c => {
    if (f.platform && c.platform !== f.platform) return false;
    if (f.minDurationSec != null && c.durationSec < f.minDurationSec) return false;
    if (f.maxDurationSec != null && c.durationSec > f.maxDurationSec) return false;
    if (f.tags?.length) {
      const tags = c.tags ?? [];
      if (!f.tags.every(req => tags.includes(req))) return false;
    }
    return true;
  });
}

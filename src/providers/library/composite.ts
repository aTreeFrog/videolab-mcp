import type { MusicTrack, BRollClip, Voiceover, ScriptDoc, RenderManifest, GeneratedImage } from "../../types.js";
import type { IndexProvider, MusicFilter, BRollFilter } from "../types.js";
import type { MusicLibrary, BRollLibrary, VoiceoverStore, ScriptStore, RenderStore, ImageStore } from "../library-types.js";

export class CompositeIndexProvider implements IndexProvider {
  readonly kind = "composite";
  constructor(
    private musicLib: MusicLibrary,
    private brollLib: BRollLibrary,
    private voStore: VoiceoverStore,
    private scriptStore: ScriptStore,
    private renderStore: RenderStore,
    private imageStore: ImageStore,
  ) {}

  listMusic(f?: MusicFilter) { return this.musicLib.list(f); }
  getMusic(id: string) { return this.musicLib.get(id); }
  putMusic(t: MusicTrack) { return this.musicLib.add(t); }
  deleteMusic(id: string) { return this.musicLib.remove(id); }

  listBRoll(f?: BRollFilter) { return this.brollLib.list(f); }
  getBRoll(id: string) { return this.brollLib.get(id); }
  putBRoll(c: BRollClip) { return this.brollLib.add(c); }
  deleteBRoll(id: string) { return this.brollLib.remove(id); }

  listVoiceovers() { return this.voStore.list(); }
  getVoiceover(id: string) { return this.voStore.get(id); }
  putVoiceover(v: Voiceover) { return this.voStore.add(v); }
  deleteVoiceover(id: string) { return this.voStore.remove(id); }

  listScripts() { return this.scriptStore.list(); }
  getScript(id: string) { return this.scriptStore.get(id); }
  putScript(s: ScriptDoc) { return this.scriptStore.add(s); }
  deleteScript(id: string) { return this.scriptStore.remove(id); }

  listRenders() { return this.renderStore.list(); }
  getRender(id: string) { return this.renderStore.get(id); }
  putRender(r: RenderManifest) { return this.renderStore.add(r); }
  deleteRender(id: string) { return this.renderStore.remove(id); }

  listImages() { return this.imageStore.list(); }
  getImage(id: string) { return this.imageStore.get(id); }
  putImage(i: GeneratedImage) { return this.imageStore.add(i); }
  deleteImage(id: string) { return this.imageStore.remove(id); }
}

export class HybridMusicLibrary implements MusicLibrary {
  readonly kind = "hybrid";
  constructor(private remote: MusicLibrary, private local: MusicLibrary) {}
  async list(f?: MusicFilter): Promise<MusicTrack[]> {
    const [r, l] = await Promise.all([
      this.remote.list(f).catch(() => [] as MusicTrack[]),
      this.local.list(f),
    ]);
    return dedupeById([...r, ...l]);
  }
  async get(id: string): Promise<MusicTrack | null> {
    const r = await this.remote.get(id).catch(() => null);
    if (r) return r;
    return this.local.get(id);
  }
  async add(track: MusicTrack): Promise<void> {
    return this.local.add(track);
  }
  async remove(id: string): Promise<boolean> {
    return this.local.remove(id);
  }
}

export class HybridBRollLibrary implements BRollLibrary {
  readonly kind = "hybrid";
  constructor(private remote: BRollLibrary, private local: BRollLibrary) {}
  async list(f?: BRollFilter): Promise<BRollClip[]> {
    const [r, l] = await Promise.all([
      this.remote.list(f).catch(() => [] as BRollClip[]),
      this.local.list(f),
    ]);
    return dedupeById([...r, ...l]);
  }
  async get(id: string): Promise<BRollClip | null> {
    const r = await this.remote.get(id).catch(() => null);
    if (r) return r;
    return this.local.get(id);
  }
  async add(clip: BRollClip): Promise<void> {
    return this.local.add(clip);
  }
  async remove(id: string): Promise<boolean> {
    return this.local.remove(id);
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

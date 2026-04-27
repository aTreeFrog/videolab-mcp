import type { MusicTrack, BRollClip, Voiceover, ScriptDoc, RenderManifest, GeneratedImage } from "../types.js";
import type { MusicFilter, BRollFilter } from "./types.js";

export interface MusicLibrary {
  readonly kind: string;
  list(filter?: MusicFilter): Promise<MusicTrack[]>;
  get(id: string): Promise<MusicTrack | null>;
  add(track: MusicTrack): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface BRollLibrary {
  readonly kind: string;
  list(filter?: BRollFilter): Promise<BRollClip[]>;
  get(id: string): Promise<BRollClip | null>;
  add(clip: BRollClip): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface VoiceoverStore {
  readonly kind: string;
  list(): Promise<Voiceover[]>;
  get(id: string): Promise<Voiceover | null>;
  add(vo: Voiceover): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface ScriptStore {
  readonly kind: string;
  list(): Promise<ScriptDoc[]>;
  get(id: string): Promise<ScriptDoc | null>;
  add(script: ScriptDoc): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface RenderStore {
  readonly kind: string;
  list(): Promise<RenderManifest[]>;
  get(id: string): Promise<RenderManifest | null>;
  add(render: RenderManifest): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export interface ImageStore {
  readonly kind: string;
  list(): Promise<GeneratedImage[]>;
  get(id: string): Promise<GeneratedImage | null>;
  add(image: GeneratedImage): Promise<void>;
  remove(id: string): Promise<boolean>;
}

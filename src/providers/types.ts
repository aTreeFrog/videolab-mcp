import type {
  MusicTrack, BRollClip, SceneAsset, SceneRef,
  Voiceover, ScriptDoc, Voice, Platform, RenderManifest, GeneratedImage,
} from "../types.js";

export interface StorageProvider {
  readonly kind: string;
  resolveUri(pathOrUri: string): Promise<string>;
  resolveLocalPath(pathOrUri: string): Promise<string>;
  writeBlob(relativePath: string, data: Buffer): Promise<{ url: string; localPath: string }>;
  localPathFor(relativePath: string): Promise<string>;
}

export interface IndexProvider {
  readonly kind: string;
  listMusic(filter?: MusicFilter): Promise<MusicTrack[]>;
  getMusic(id: string): Promise<MusicTrack | null>;
  putMusic(track: MusicTrack): Promise<void>;
  deleteMusic(id: string): Promise<boolean>;

  listBRoll(filter?: BRollFilter): Promise<BRollClip[]>;
  getBRoll(id: string): Promise<BRollClip | null>;
  putBRoll(clip: BRollClip): Promise<void>;
  deleteBRoll(id: string): Promise<boolean>;

  listVoiceovers(): Promise<Voiceover[]>;
  getVoiceover(id: string): Promise<Voiceover | null>;
  putVoiceover(vo: Voiceover): Promise<void>;
  deleteVoiceover(id: string): Promise<boolean>;

  listScripts(): Promise<ScriptDoc[]>;
  getScript(id: string): Promise<ScriptDoc | null>;
  putScript(script: ScriptDoc): Promise<void>;
  deleteScript(id: string): Promise<boolean>;

  listRenders(): Promise<RenderManifest[]>;
  getRender(id: string): Promise<RenderManifest | null>;
  putRender(render: RenderManifest): Promise<void>;
  deleteRender(id: string): Promise<boolean>;

  listImages(): Promise<GeneratedImage[]>;
  getImage(id: string): Promise<GeneratedImage | null>;
  putImage(image: GeneratedImage): Promise<void>;
  deleteImage(id: string): Promise<boolean>;
}

export interface TtsProvider {
  readonly kind: string;
  listVoices(): Promise<Voice[]>;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}

export type TtsRequest = {
  text: string;
  voiceId: string;
  model?: string;
  withTimestamps?: boolean;
};

export type TtsResult = {
  audio: Buffer;
  mimeType: string;
  alignment?: import("../types.js").VoiceoverAlignment;
};

export interface MusicGenProvider {
  readonly kind: string;
  compose(req: MusicGenRequest): Promise<MusicGenResult>;
}

export type MusicGenRequest = {
  prompt: string;
  durationMs?: number;
  instrumental?: boolean;
  model?: string;
};

export type MusicGenResult = {
  audio: Buffer;
  mimeType: string;
  durationMs?: number;
};

export interface LlmProvider {
  readonly kind: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

export interface AnimateProvider {
  readonly kind: string;
  imageToVideo(req: AnimateRequest): Promise<AnimateResult>;
  extendVideo?(req: ExtendVideoRequest): Promise<AnimateResult>;
}

export type AnimateRequest = {
  imageBytes: Buffer;
  imageMimeType: string;
  prompt?: string;
  durationSeconds?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
};

export type ExtendVideoRequest = {
  previousVideoRef: unknown;
  prompt?: string;
};

export type AnimateResult = {
  videoBytes: Buffer;
  mimeType: string;
  durationSeconds?: number;
  videoRef?: unknown;
  model?: string;
};

export interface TalkingHeadProvider {
  readonly kind: string;
  generate(req: TalkingHeadRequest): Promise<TalkingHeadResult>;
}

export type TalkingHeadRequest = {
  imageBytes: Buffer;
  imageMimeType: string;
  audioBytes: Buffer;
  audioMimeType: string;
};

export type TalkingHeadResult = {
  videoBytes: Buffer;
  mimeType: string;
  durationSeconds?: number;
};

export interface BlobUploader {
  readonly kind: string;
  uploadBuffer(blobPath: string, data: Buffer, contentType: string): Promise<string>;
}

export interface ImageGenProvider {
  readonly kind: string;
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

export type ImageGenRequest = {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  model?: string;
};

export type ImageGenResult = {
  image: Buffer;
  mimeType: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  model?: string;
};

export type LlmRequest = {
  system?: string;
  user: string;
  maxTokens?: number;
  jsonOnly?: boolean;
};

export type LlmResult = {
  text: string;
};

export interface SceneAssetProvider {
  readonly kind: string;
  describeRefShape(): string;
  listAssets(ref: SceneRef): Promise<SceneAsset[]>;
  getAsset(id: string): Promise<SceneAsset | null>;
}

export type MusicFilter = {
  mood?: string;
  genre?: string;
  intensity?: "calm" | "moderate" | "intense";
  tags?: string[];
  source?: "stock" | "generated";
};

export type BRollFilter = {
  tags?: string[];
  platform?: "mobile" | "desktop";
  minDurationSec?: number;
  maxDurationSec?: number;
};

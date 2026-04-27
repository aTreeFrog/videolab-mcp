export type Platform = "mobile" | "desktop";

export type SlotSource =
  | { kind: "broll"; id: string }
  | { kind: "scene"; id: string }
  | { kind: "url"; url: string };

export type Slot = {
  source: SlotSource;
  durationMs: number;
};

export type Timeline = {
  platform: Platform;
  slots: Slot[];
};

export const PLATFORM_DIMENSIONS: Record<Platform, { width: number; height: number }> = {
  mobile: { width: 1080, height: 1920 },
  desktop: { width: 1920, height: 1080 },
};

export type MusicTrack = {
  id: string;
  displayName: string;
  url: string;
  durationMs?: number;
  mood?: string;
  genre?: string;
  intensity?: "calm" | "moderate" | "intense";
  themes?: string[];
  tags?: string[];
  source: "stock" | "generated";
};

export type BRollClip = {
  id: string;
  url: string;
  filename: string;
  platform: Platform;
  durationSec: number;
  description: string;
  source?: string;
  tags: string[];
  firstFrameUrl?: string;
  veoRef?: unknown;
  veoModel?: string;
  veoPrompt?: string;
  parentBrollId?: string;
  extensionCount?: number;
};

export type SceneAsset = {
  id: string;
  type: "image" | "video" | "portrait" | "poi";
  label: string;
  url: string;
  thumbnailUrl?: string;
};

export type SceneRef = Record<string, unknown>;

export type RenderManifest = {
  renderId: string;
  parentId?: string;
  createdAt: string;
  platform: Platform;
  timeline: Timeline;
  voiceoverId?: string;
  musicId?: string;
  outputPath: string;
  visualsPath?: string;
};

export type Voiceover = {
  id: string;
  text: string;
  voiceId: string;
  model: string;
  url: string;
  durationMs?: number;
  alignment?: VoiceoverAlignment;
  createdAt: string;
};

export type VoiceoverAlignment = {
  characters: string[];
  startMs: number[];
  endMs: number[];
};

export type ScriptDoc = {
  id: string;
  text: string;
  slots?: ScriptSlot[];
  context?: string;
  platform?: Platform;
  durationSeconds?: number;
  tone?: string;
  parentId?: string;
  createdAt: string;
};

export type ScriptSlot = {
  name: string;
  text: string;
  estimatedSeconds?: number;
};

export type Voice = {
  voiceId: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  previewUrl?: string;
};

export type DocChapter = {
  number: number;
  title: string;
  text: string;
  wordCount: number;
  startCharOffset?: number;
  endCharOffset?: number;
};

export type AttentionPurpose =
  | "Hook"
  | "CoreIdea"
  | "Example"
  | "PatternInterrupt"
  | "MicroRecap"
  | "Transition"
  | "WhyItMatters"
  | "Cliffhanger";

export type DocScene = {
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  subtitle: string;
  visualText: string;
  attentionPurpose: AttentionPurpose;
  visualPrompt?: string;
};

export type AttentionValidation = {
  ok: boolean;
  issues: string[];
  warnings: string[];
  stats: {
    sceneCount: number;
    totalSeconds: number;
    avgSceneSeconds: number;
    avgSubtitleWords: number;
    avgVisualTextWords: number;
    purposeCounts: Record<string, number>;
  };
};

export type GeneratedImage = {
  id: string;
  prompt: string;
  url: string;
  mimeType: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  model?: string;
  tags?: string[];
  description?: string;
  createdAt: string;
};

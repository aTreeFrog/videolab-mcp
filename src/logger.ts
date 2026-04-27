type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const envLevel = (process.env.VIDEOLAB_LOG_LEVEL ?? process.env.PROMO_VIDEO_LOG_LEVEL ?? "info") as Level;
const minLevel = LEVELS[envLevel] ?? LEVELS.info;

function emit(level: Level, msg: string, extra?: unknown) {
  if (LEVELS[level] < minLevel) return;
  const line = `[videolab-mcp] ${level.toUpperCase()} ${msg}`;
  process.stderr.write(line + "\n");
  if (extra !== undefined) {
    process.stderr.write(JSON.stringify(extra, null, 2) + "\n");
  }
}

export const logger = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};

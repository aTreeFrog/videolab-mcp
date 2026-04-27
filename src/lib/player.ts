import { spawn } from "node:child_process";
import { platform } from "node:os";
import { logger } from "../logger.js";

export function openInDefaultPlayer(absolutePath: string): { spawned: boolean; command: string } {
  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", absolutePath];
  } else if (os === "darwin") {
    cmd = "open";
    args = [absolutePath];
  } else {
    cmd = "xdg-open";
    args = [absolutePath];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { spawned: true, command: `${cmd} ${args.join(" ")}` };
  } catch (e) {
    logger.warn(`failed to open player for ${absolutePath}`, { error: (e as Error).message });
    return { spawned: false, command: `${cmd} ${args.join(" ")}` };
  }
}

/**
 * Copies everything the bot prints into logs/bot.log as well, so problems can be checked
 * later even when the bot runs in its own window. The file is trimmed when it gets big.
 */
import fs from "fs";
import path from "path";
import { format } from "util";

const MAX_BYTES = 5 * 1024 * 1024;

export function mirrorConsoleToFile(file = path.join(process.cwd(), "logs", "bot.log")): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
  } catch {
    return; // logging to a file is a convenience; never stop the bot over it
  }

  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const stamp = new Date().toISOString();
      fs.appendFile(file, `${stamp} ${level.toUpperCase()} ${format(...args)}\n`, () => {});
    };
  }
}

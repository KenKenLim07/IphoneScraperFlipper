import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { envBool } from "./utils.mjs";

export function makeLogger(runId) {
  let log = (line) => console.log(line);
  let error = (line) => console.error(line);
  let filePath = null;

  if (envBool("SCRAPE_LOG_FILE", false)) {
    const logsDir = path.resolve("logs");
    fs.mkdirSync(logsDir, { recursive: true });
    filePath = path.join(logsDir, `sniffer-${runId}.log`);
    fs.appendFileSync(filePath, "", "utf8");
    log = (line) => {
      console.log(line);
      fs.appendFileSync(filePath, `${line}${os.EOL}`, "utf8");
    };
    error = (line) => {
      console.error(line);
      fs.appendFileSync(filePath, `${line}${os.EOL}`, "utf8");
    };
    log(`[INFO] local_log=${filePath}`);
  }

  return { log, error, filePath };
}

export function logProgress(enabled, log, message) {
  if (enabled) log(message);
}


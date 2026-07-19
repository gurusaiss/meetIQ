/**
 * Structured JSON logging — one line per event, machine-parseable for any
 * log aggregator (the prod observability target). No dependency.
 *
 * The formatter is a pure function so it is unit-tested directly; the Logger
 * just decides level + destination. Bind request/tenant context with child().
 */
export type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function formatLog(
  level: Level,
  msg: string,
  fields: Record<string, unknown>,
  ts: string,
): string {
  return JSON.stringify({ ts, level, msg, ...fields });
}

export class Logger {
  private fields: Record<string, unknown>;
  private minLevel: Level;

  constructor(fields: Record<string, unknown> = {}, minLevel: Level = "info") {
    this.fields = fields;
    this.minLevel = minLevel;
  }

  child(fields: Record<string, unknown>): Logger {
    return new Logger({ ...this.fields, ...fields }, this.minLevel);
  }

  private emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const line = formatLog(level, msg, { ...this.fields, ...extra }, new Date().toISOString());
    if (level === "error" || level === "warn") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.emit("debug", msg, extra);
  }
  info(msg: string, extra?: Record<string, unknown>): void {
    this.emit("info", msg, extra);
  }
  warn(msg: string, extra?: Record<string, unknown>): void {
    this.emit("warn", msg, extra);
  }
  error(msg: string, extra?: Record<string, unknown>): void {
    this.emit("error", msg, extra);
  }
}

function envLevel(): Level {
  const v = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return v === "debug" || v === "warn" || v === "error" ? v : "info";
}

export const logger = new Logger({}, envLevel());

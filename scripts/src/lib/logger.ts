/**
 * Minimal structured logger for standalone scripts/src/*.ts tools — mirrors the
 * app's `logger.child({ channel })` shape (see api-server's logger.ts) without
 * pulling in the full pino/request-context/exception-tracker stack a one-off
 * script doesn't run inside.
 */
type Fields = Record<string, unknown>;

function write(level: string, channel: string, fields: Fields, msg: string): void {
  console.log(JSON.stringify({ level, channel, time: new Date().toISOString(), ...fields, msg }));
}

export const logger = {
  child({ channel }: { channel: string }) {
    return {
      info: (fields: Fields, msg: string) => write("info", channel, fields, msg),
      warn: (fields: Fields, msg: string) => write("warn", channel, fields, msg),
      error: (fields: Fields, msg: string) => write("error", channel, fields, msg),
    };
  },
};

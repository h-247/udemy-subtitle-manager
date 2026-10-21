import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../.dev.vars", import.meta.url));
let contents = existsSync(file) ? readFileSync(file, "utf8") : "";
const secret = contents.match(/^SECRET_KEY=(.*)$/m)?.[1]?.trim();

if (secret && secret.length < 32) {
  throw new Error("SECRET_KEY in .dev.vars must contain at least 32 characters.");
}

if (!secret) {
  const separator = contents && !contents.endsWith("\n") ? "\n" : "";
  contents += `${separator}SECRET_KEY=${randomBytes(48).toString("base64url")}\n`;
  writeFileSync(file, contents, { mode: 0o600 });
}

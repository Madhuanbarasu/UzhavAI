// Minimal .env loader (no dependency). Real environment variables always win,
// so on a hosting platform the dashboard-configured values are used and a
// stray .env file can never override them.
const fs = require("fs");
const path = require("path");

function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

function loadDotEnv(file = path.join(__dirname, "..", ".env"), env = process.env) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return false; } // no .env is normal
  for (const [k, v] of Object.entries(parseEnv(text))) if (env[k] === undefined) env[k] = v;
  return true;
}

module.exports = { parseEnv, loadDotEnv };

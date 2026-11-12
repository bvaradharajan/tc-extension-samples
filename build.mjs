import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "dist");
const excluded = new Set(["dist", "build.mjs", "README.md", "node_modules", ".git", ".github", ".gitignore", "package.json"]);

const baseUrlArg = process.argv[2] ?? process.env.BASE_URL;
if (!baseUrlArg) {
  console.error("Usage: node build.mjs <BASE_URL>   e.g. node build.mjs https://<user>.github.io/tc-extension-samples");
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(baseUrlArg);
} catch {
  console.error(`Invalid BASE_URL: ${baseUrlArg}`);
  process.exit(1);
}
const isLocalhost = ["localhost", "127.0.0.1"].includes(baseUrl.hostname);
if (baseUrl.protocol !== "https:" && !isLocalhost) {
  console.error("BASE_URL must use https:// (Trimble Connect only embeds https extensions).");
  process.exit(1);
}
const base = baseUrl.href.replace(/\/+$/, "");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const entry of readdirSync(root)) {
  if (!excluded.has(entry)) {
    cpSync(join(root, entry), join(outDir, entry), { recursive: true });
  }
}

function findTemplates(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return findTemplates(path);
    }
    return entry === "manifest.template.json" ? [path] : [];
  });
}

const manifests = [];
for (const templatePath of findTemplates(outDir)) {
  const manifestPath = join(dirname(templatePath), "manifest.json");
  const content = readFileSync(templatePath, "utf8").replaceAll("{{BASE_URL}}", base);
  JSON.parse(content);
  writeFileSync(manifestPath, content);
  rmSync(templatePath);
  manifests.push(`${base}/${relative(outDir, manifestPath).split(sep).join("/")}`);
}

if (!existsSync(join(outDir, ".nojekyll"))) {
  writeFileSync(join(outDir, ".nojekyll"), "");
}

console.log(`Built ${manifests.length} manifests into ${relative(root, outDir)}/ for ${base}:`);
manifests.sort().forEach((url) => console.log(`  ${url}`));

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [sdkArg, sourceArg] = process.argv.slice(2);
if (!sdkArg || !sourceArg) throw new Error("usage: node scripts/generate-models.mjs LUTAML_TS OMML_SOURCE");
const sdk = resolve(sdkArg), source = resolve(sourceArg);
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "model/provenance.json")));
const head = (repo) => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head(sdk) !== manifest.source.lutaml_ts) throw new Error("LutaML source revision mismatch");
execFileSync("git", ["-C", source, "cat-file", "-e", manifest.source.omml + "^{commit}"]);
const sdkStatus = execFileSync("git", ["-C", sdk, "status", "--porcelain", "--", "src"], { encoding: "utf8" });
if (sdkStatus !== "") throw new Error("LutaML TypeScript generator sources have local changes");
execFileSync(process.execPath, [join(sdk, "node_modules/typescript/bin/tsc"), "-p", join(sdk, "tsconfig.build.json")], {
  cwd: sdk, stdio: "inherit",
});
const fromSdk = (path) => pathToFileURL(join(sdk, "dist", path)).href;
const { loadBundle, generateModelsWith, bundleChecksum } = await import(fromSdk("index.js"));
const { createXmlEmitter } = await import(fromSdk("xml/index.js"));
const bytes = readFileSync(join(root, "model", manifest.graph + ".json"));
if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw new Error("graph bytes differ");
const bundle = loadBundle(bytes, "json");
if (bundleChecksum(bundle) !== manifest.lml_checksum) throw new Error("LML checksum mismatch");
const types = Object.fromEntries(Object.entries(bundle.value_types)
  .filter(([, spec]) => spec.facets.source_binding_v1 === true)
  .map(([id, spec]) => [id, {
    module: "./" + (spec.base === "decimal" ? "coordinate" : spec.base === "integer" ? "integer" : "token") + ".js",
    export: id.split("::").at(-1).split("@")[0],
    xmlLexical: true,
  }]));
const output = join(root, "src/generated");
const options = { contractsModule: "./contracts-shim.js" };
for (const [name, contents] of generateModelsWith(bundle, { types }, [createXmlEmitter(options)], options)) {
  const path = join(output, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
copyFileSync(join(sdk, "src/contracts.ts"), join(output, "contracts-shim.ts"));
for (const file of ["coordinate.ts", "integer.ts", "token.ts"]) {
  const path = manifest.source.omml + ":model/portable/bindings/" + file;
  writeFileSync(join(output, file), execFileSync("git", ["-C", source, "show", path]));
}
execFileSync(process.execPath, [join(root, "scripts/check-artifacts.mjs")], { stdio: "inherit" });

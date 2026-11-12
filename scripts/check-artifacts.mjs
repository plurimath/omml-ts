import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root));
const manifest = JSON.parse(read("model/provenance.json"));
function check(file, expected) {
  const actual = createHash("sha256").update(read(file)).digest("hex");
  if (actual !== expected) throw new Error("artifact checksum mismatch for " + file);
}
check("model/" + manifest.graph + ".json", manifest.sha256);
for (const [name, digest] of Object.entries(manifest.generated)) check("src/generated/" + name, digest);
check(manifest.corpus.file, manifest.corpus.sha256);
console.log("OMML artifact and " + Object.keys(manifest.generated).length + " source files verified");

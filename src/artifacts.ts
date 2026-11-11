import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

interface Manifest {
  readonly graph: string;
  readonly sha256: string;
  readonly lml_checksum: string;
}

export function declarationManifest(): Manifest {
  return JSON.parse(readFileSync(new URL("../model/provenance.json", import.meta.url), "utf8")) as Manifest;
}

export function readModelDeclarations(): unknown {
  const manifest = declarationManifest();
  const bytes = readFileSync(new URL("../model/runtime-graph-v1.json", import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
    throw new Error("OMML model declaration checksum mismatch");
  }
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

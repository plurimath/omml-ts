import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse as parseXml } from "moxml-ts";
import { OMath, OMathPara, parseOmml, stringifyOmml } from "@plurimath/omml-ts";
import { declarationManifest, readModelDeclarations } from "@plurimath/omml-ts/artifacts";

const corpus = JSON.parse(readFileSync(new URL("./formula-source.json", import.meta.url), "utf8"));
const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";

function tree(node) {
  const attrs = (node.attributes() ?? [])
    .filter((attr) => attr.localName !== "xmlns" && !(attr.qualifiedName ?? "").startsWith("xmlns:"))
    .map((attr) => [attr.namespaceUri, attr.localName, attr.value])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const children = node.children();
  const structural = children.some((child) => child.kind() === 1);
  const content = [];
  for (const child of children) {
    if (child.kind() === 1) {
      content.push(tree(child));
    } else if (child.kind() === 2 || child.kind() === 4) {
      const text = child.text() ?? "";
      if (!structural || text.trim() !== "") {
        if (typeof content.at(-1) === "string") content[content.length - 1] += text;
        else content.push(text);
      }
    }
  }
  return [node.namespaceUri(), node.localName(), attrs, content];
}

async function xmlTree(xml) {
  const doc = await parseXml(xml);
  try {
    return tree(doc.root());
  } finally {
    doc.dispose();
  }
}

for (const row of corpus) {
  test(row.id, async () => {
    const value = await parseOmml(row.input);
    assert.ok(value instanceof (row.model.endsWith("Para") ? OMathPara : OMath));
    const actual = await stringifyOmml(value);
    assert.deepEqual(await xmlTree(actual), await xmlTree(row.expected));
  });
}

test("public root and parser limits", async () => {
  await assert.rejects(() => parseOmml("<oMath/>"), /expected an OMML/);
  await assert.rejects(() => parseOmml("<!DOCTYPE oMath><oMath/>"), /DOCTYPE/);
  await assert.rejects(() => parseOmml(
    `<m:oMath xmlns:m="${mathNamespace}"><m:r><m:t>x</m:t></m:r></m:oMath>`,
    { limits: { maxElements: 1 } },
  ), (error) => error.info?.rule === "max_elements");
});

test("declarations are available with the verified package checksum", () => {
  const graph = readModelDeclarations();
  assert.ok(graph.roots.includes("Omml::Models::OMath@omml"));
  assert.ok(graph.roots.includes("Omml::Models::OMathPara@omml"));
  assert.equal(Object.keys(graph.models).length, 186);
  assert.equal(declarationManifest().graph, "runtime-graph-v1");
});

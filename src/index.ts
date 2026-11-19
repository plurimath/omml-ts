import { OmmlModelsOMath_omml, OmmlModelsOMathPara_omml } from "./generated/models.js";
import { codecOmmlModelsOMath_omml, codecOmmlModelsOMathPara_omml } from "./generated/xml/codecs.js";
import { parseText, XmlError, type ReadOptions } from "./generated/xml/runtime.js";
import type { NamespaceBinding, Node } from "moxml-ts";

export { OmmlModelsOMath_omml as OMath, OmmlModelsOMathPara_omml as OMathPara, XmlError };
export { initEngine, initModel } from "moxml-ts";
export type { ReadOptions };
export type OmmlDocument = OmmlModelsOMath_omml | OmmlModelsOMathPara_omml;

const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/**
 * What a parsed document remembers of its input, so that writing it back gives
 * the bytes the Ruby gem writes: the root's namespace declarations, and the
 * attributes each element carried (an attribute the input left out and the
 * model filled from its default is not written, as Ruby does not render
 * defaults).
 */
interface Source {
  readonly rootNamespaces: readonly NamespaceBinding[];
  readonly attributes: ReadonlyMap<string, ReadonlySet<string>>;
}

const sources = new WeakMap<OmmlDocument, Source>();

const KIND_ELEMENT = 1;
const KIND_TEXT = 2;
const KIND_CDATA = 4;

const expanded = (uri: string | undefined, local: string | undefined) => "{" + (uri ?? "") + "}" + (local ?? "");
const rootKey = (root: Node) => "/" + expanded(root.namespaceUri(), root.localName()) + "[0]";

/** A child element's key: its expanded name plus its position among same-named siblings. */
function childKey(child: Node, path: string, seen: Map<string, number>): string {
  const name = expanded(child.namespaceUri(), child.localName());
  const index = seen.get(name) ?? 0;
  seen.set(name, index + 1);
  return path + "/" + name + "[" + index + "]";
}

function recordAttributes(node: Node, path: string, out: Map<string, Set<string>>) {
  out.set(path, new Set((node.attributes() ?? []).map((a) => expanded(a.namespaceUri, a.localName))));
  const seen = new Map<string, number>();
  for (const child of node.children()) if (child.kind() === KIND_ELEMENT) recordAttributes(child, childKey(child, path, seen), out);
}

/** The root's start tag in the (well-formed) input: the text up to the first '>' outside quotes. */
function rootStartTag(input: string, qname: string): string {
  let start = -1;
  for (let at = input.indexOf("<" + qname); at >= 0; at = input.indexOf("<" + qname, at + 1)) {
    if (/[\s/>]/.test(input.charAt(at + qname.length + 1))) {
      start = at;
      break;
    }
  }
  if (start < 0) return "";
  let quote: string | null = null;
  for (let i = start; i < input.length; i++) {
    const c = input[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return input.slice(start, i + 1);
  }
  return "";
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The root's declarations in input order (moxml-ts does not report them in document order). */
function inputRootNamespaces(input: string, root: Node): NamespaceBinding[] {
  const tag = rootStartTag(input, root.qualifiedName() ?? "");
  const at = (d: NamespaceBinding) => new RegExp("\\sxmlns" + (d.prefix === "" ? "" : ":" + escapeRegExp(d.prefix)) + "\\s*=").exec(tag)?.index ?? -1;
  return [...(root.declaredNamespaces() ?? [])].sort((a, b) => at(a) - at(b));
}

function remember(model: OmmlDocument, root: Node, input: string): OmmlDocument {
  const attributes = new Map<string, Set<string>>();
  recordAttributes(root, rootKey(root), attributes);
  sources.set(model, { rootNamespaces: inputRootNamespaces(input, root), attributes });
  return model;
}

function escapeText(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
}

function escapeAttribute(text: string) {
  return escapeText(text).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
}

interface Written {
  readonly name: string;
  namespaces: NamespaceBinding[];
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  readonly content: ReadonlyArray<Written | { readonly text: string; readonly cdata: boolean }>;
  /** A child of m:r: run content, written in the root's scope. */
  readonly inRun: boolean;
}

/**
 * Reads the writer's output back into a plain tree: declarations already in
 * scope with the same URI are dropped, and so are attributes the input element
 * did not carry.
 */
function collect(node: Node, path: string, scope: ReadonlyMap<string, string>, source: Source | undefined, inRun = false): Written {
  const inner = new Map(scope);
  const namespaces: NamespaceBinding[] = [];
  for (const decl of node.declaredNamespaces() ?? []) {
    if (inner.get(decl.prefix) === decl.uri) continue;
    inner.set(decl.prefix, decl.uri);
    namespaces.push(decl);
  }
  const isRun = node.namespaceUri() === mathNamespace && node.localName() === "r";
  const given = source?.attributes.get(path);
  const attributes = (node.attributes() ?? [])
    .filter((a) => given === undefined || given.has(expanded(a.namespaceUri, a.localName)))
    .map((a) => [a.name, a.value] as const);
  const seen = new Map<string, number>();
  const content: Array<Written | { text: string; cdata: boolean }> = [];
  for (const child of node.children()) {
    const kind = child.kind();
    if (kind === KIND_ELEMENT) content.push(collect(child, childKey(child, path, seen), inner, source, isRun));
    else if (kind === KIND_TEXT || kind === KIND_CDATA) {
      const text = child.text() ?? "";
      if (text !== "") content.push({ text, cdata: kind === KIND_CDATA });
    }
  }
  return { name: node.qualifiedName() ?? "", namespaces, attributes, content, inRun };
}

const sameDecl = (a: NamespaceBinding, b: NamespaceBinding) => a.prefix === b.prefix && a.uri === b.uri;

/** Declarations the writer places below the root, outside run content. */
function declaredBelow(element: Written, out: NamespaceBinding[]) {
  for (const child of element.content) {
    if ("name" in child) {
      if (!child.inRun) out.push(...child.namespaces);
      declaredBelow(child, out);
    }
  }
  return out;
}

/** Drops run content's local copies of declarations the root keeps. */
function foldRunContent(element: Written, kept: readonly NamespaceBinding[]) {
  for (const child of element.content) {
    if ("name" in child) {
      if (child.inRun) child.namespaces = child.namespaces.filter((d) => !kept.some((k) => sameDecl(k, d)));
      foldRunContent(child, kept);
    }
  }
}

/**
 * The input root's declarations in input order, minus any the writer declares
 * below the root, then the writer's own root declarations the input lacked.
 * Run content (w:br, w:tab, w:rPr directly under m:r) is written in the root's
 * scope: where the root keeps a declaration, the gem writes no local copy, and
 * a local copy there does not take the declaration off the root.
 */
function rootNamespaces(root: Written, input: readonly NamespaceBinding[]): NamespaceBinding[] {
  const below = declaredBelow(root, []);
  const merged = input.filter((d) => !below.some((b) => sameDecl(b, d))).map((d) => ({ ...d }));
  for (const decl of root.namespaces) {
    const at = merged.findIndex((d) => d.prefix === decl.prefix);
    if (at >= 0) (merged[at] as NamespaceBinding).uri = decl.uri;
    else merged.push({ ...decl });
  }
  foldRunContent(root, merged);
  return merged;
}

/** Ruby's layout: element-only content indented by two spaces, anything holding text written inline. */
function serialize(element: Written, indent: string | null, out: string[]) {
  let tag = "<" + element.name;
  for (const { prefix, uri } of element.namespaces) tag += (prefix === "" ? " xmlns" : " xmlns:" + prefix) + '="' + escapeAttribute(uri) + '"';
  for (const [name, value] of element.attributes) tag += " " + name + '="' + escapeAttribute(value) + '"';
  if (element.content.length === 0) {
    out.push(tag + "/>");
    return;
  }
  const elementOnly = element.content.every((c) => "name" in c);
  out.push(tag + ">");
  for (const child of element.content) {
    if ("name" in child) {
      if (indent !== null && elementOnly) out.push("\n" + indent + "  ");
      serialize(child, indent !== null && elementOnly ? indent + "  " : null, out);
    } else out.push(child.cdata ? "<![CDATA[" + child.text.replace(/]]>/g, "]]]]><![CDATA[>") + "]]>" : escapeText(child.text));
  }
  if (indent !== null && elementOnly) out.push("\n" + indent);
  out.push("</" + element.name + ">");
}

export async function parseOmml(input: string, options?: ReadOptions): Promise<OmmlDocument> {
  const document = await parseText(input);
  try {
    const root = document.root();
    if (root?.namespaceUri() === mathNamespace) {
      if (root.localName() === "oMath") return remember(codecOmmlModelsOMath_omml.decode(document, options), root, input);
      if (root.localName() === "oMathPara") return remember(codecOmmlModelsOMathPara_omml.decode(document, options), root, input);
    }
    throw new XmlError("invalid_document", "expected an OMML oMath or oMathPara root");
  } finally {
    document.dispose();
  }
}

export async function stringifyOmml(model: OmmlDocument): Promise<string> {
  const document = model instanceof OmmlModelsOMath_omml
    ? await codecOmmlModelsOMath_omml.encode(model)
    : model instanceof OmmlModelsOMathPara_omml
      ? await codecOmmlModelsOMathPara_omml.encode(model)
      : null;
  if (document === null) throw new TypeError("expected an OMath or OMathPara model");
  let compact: string;
  try {
    compact = document.toXml();
  } finally {
    document.dispose();
  }
  // Read the compact output back: the parsed tree resolves every name's
  // namespace and reports the declarations the writer emitted.
  const written = await parseText(compact);
  try {
    const root = written.root();
    if (root === undefined) return compact;
    const source = sources.get(model);
    const tree = collect(root, rootKey(root), new Map(), source);
    if (source !== undefined) tree.namespaces = rootNamespaces(tree, source.rootNamespaces);
    const out: string[] = [];
    serialize(tree, "", out);
    return out.join("");
  } finally {
    written.dispose();
  }
}

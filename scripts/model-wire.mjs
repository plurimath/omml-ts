// Writes a parsed model in the tagged wire form that plurimath-testsuite
// scripts/generate-xml-stage-cases.rb records for the omml gem:
// {node: <Ruby class>, fields: [[name, value], ...]} with the declared
// attributes that are set, in declaration order, plus "@element_order" where
// the model keeps the order of its XML children.
//
// Class names, attribute order and XML element names come from
// model/runtime-graph-v1.json, the graph the models are generated from.
//
// Three Ruby-side details are not state this package keeps, so the expected
// wire is normalized before the comparison (see normalizeExpected):
// - Lutaml records element_order on every model read from XML, but writes it
//   back only for ordered or mixed models. On other models it never reaches
//   to_xml, and the port does not keep it.
// - On ordered models that are not mixed, element_order also lists the
//   whitespace-only text between elements. to_xml does not write it, and the
//   port drops it on read.
// - An attribute explicitly set to its declared default (m:val="on" on an
//   on/off property) is not using_default? in Ruby, but its mapping never
//   renders the default, so to_xml writes the same bytes as when it is absent.
//   The port's constructor fills the default in, so both sides drop a field
//   that holds its unrendered default.
// - element_order also lists a child element no attribute read (an
//   m:lastRenderedPageBreak where the model maps w:lastRenderedPageBreak).
//   to_xml skips it and the port keeps no token for it, so an Element entry
//   beyond the number of values its attribute holds is dropped.
// - An empty string can carry the US-ASCII encoding in Ruby; that is the
//   same value as "".
import { readFileSync } from "node:fs";

const ORDERED_MEMBER = "__lml_content";
const graph = JSON.parse(readFileSync(new URL("../model/runtime-graph-v1.json", import.meta.url), "utf8"));

const infoCache = new Map();
function info(id) {
  let found = infoCache.get(id);
  if (found) return found;
  const model = graph.models[id];
  if (model === undefined) throw new Error(`model ${id} is not in the graph`);
  const xml = model.mappings?.xml ?? {};
  const names = new Map();
  let content = null;
  const visit = (rule) => {
    if (rule.kind === "element" && rule.to !== undefined && !names.has(rule.to)) names.set(rule.to, rule.name?.[0]);
    if (rule.kind === "content") content = rule.to;
    for (const member of rule.members ?? []) visit(member);
  };
  for (const rule of xml.rules ?? []) visit(rule);
  for (const rule of xml.sequence ?? []) visit(rule);
  found = {
    name: model.model,
    attributes: model.attributes.map((a) => a.name),
    names,
    defaults: new Map(
      model.attributes
        .filter((a) => a.default?.present === true && !renderedDefault(xml, a.name))
        .map((a) => [a.name, a.default.value]),
    ),
    content,
    keepsOrder: xml.ordered === true || xml.mixed === true,
    mixed: xml.mixed === true,
  };
  infoCache.set(id, found);
  return found;
}

function renderedDefault(xml, name) {
  return (xml.rules ?? []).some((rule) => rule.to === name && rule.render?.default === true);
}

const isModel = (value) => value !== null && typeof value === "object" && typeof value.constructor?.modelId === "string";

function tag(value) {
  if (value === null || value === undefined) return { nil: true };
  if (typeof value === "boolean") return { bool: value };
  if (typeof value === "bigint") return { int: value.toString() };
  if (typeof value === "number") return Number.isInteger(value) ? { int: String(value) } : { float: String(value) };
  if (typeof value === "string") return { str: value };
  if (Array.isArray(value)) return { array: value.map(tag) };
  if (isModel(value)) return wire(value);
  throw new Error(`no tagged form for ${Object.prototype.toString.call(value)}`);
}

const orderEntry = (pairs) => ({ hash: pairs.map(([k, v]) => [{ str: k }, { str: v }]) });

/** The Ruby wire of one parsed model. */
export function wire(model) {
  const meta = info(model.constructor.modelId);
  const fields = [];
  for (const name of meta.attributes) {
    if (!Object.hasOwn(model, name)) throw new Error(`${meta.name}: no member ${name}`);
    const value = model[name];
    // rt.ABSENT is the port's "not set", Ruby's using_default?. The reader
    // fills a collection with no element in the input with [] (absentList),
    // which is the attribute's default in Ruby too.
    if (typeof value === "symbol") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (meta.defaults.has(name) && meta.defaults.get(name) === value) continue;
    fields.push([name, tag(value)]);
  }
  const tokens = model[ORDERED_MEMBER];
  if (meta.keepsOrder && Array.isArray(tokens) && tokens.length > 0) {
    const order = [];
    for (const token of tokens) {
      if (token.kind === "element") {
        const name = meta.names.get(token.attribute);
        if (name === undefined) throw new Error(`${meta.name}: no element name for ${token.attribute}`);
        order.push(orderEntry([["type", "Element"], ["name", name]]));
      } else if (token.kind === "text") {
        const text = "literal" in token ? token.literal : [model[token.attribute]].flat()[token.index];
        order.push(orderEntry([["type", "Text"], ["name", "text"], ["text", text]]));
      } else if (token.kind !== "attribute") {
        throw new Error(`${meta.name}: no wire form for a ${token.kind} token`);
      }
    }
    if (order.length > 0) fields.push(["@element_order", { array: order }]);
  }
  return { node: meta.name, fields };
}

const byName = new Map(Object.entries(graph.models).map(([id, m]) => [m.model, id]));
const profiles = { unread_element_order_entry: 0, unrendered_default_value: 0, unwritten_element_order: 0, ordered_whitespace_text: 0, ascii_empty_string: 0 };

function normalizeValue(value, used) {
  if (value.bytes !== undefined && value.encoding === "US-ASCII" && value.bytes === "") {
    used.add("ascii_empty_string");
    return { str: "" };
  }
  if (value.array !== undefined) return { array: value.array.map((v) => normalizeValue(v, used)) };
  if (value.node !== undefined) return normalizeModel(value, used);
  return value;
}

function normalizeModel(value, used) {
  const id = byName.get(value.node);
  if (id === undefined) throw new Error(`expected model ${value.node} is not in the graph`);
  const meta = info(id);
  const fields = [];
  for (const [name, field] of value.fields) {
    if (name !== "@element_order") {
      if (meta.defaults.has(name) && field.str !== undefined && field.str === meta.defaults.get(name)) {
        used.add("unrendered_default_value");
        continue;
      }
      fields.push([name, normalizeValue(field, used)]);
      continue;
    }
    if (!meta.keepsOrder) {
      used.add("unwritten_element_order");
      continue;
    }
    const held = new Map();
    for (const [attribute, element] of meta.names) {
      const field = value.fields.find(([n]) => n === attribute)?.[1];
      const count = field === undefined ? 0 : field.array !== undefined ? field.array.length : 1;
      held.set(element, (held.get(element) ?? 0) + count);
    }
    const seen = new Map();
    const kept = field.array.filter((entry) => {
      const pairs = Object.fromEntries(entry.hash.map(([k, v]) => [k.str, v.str]));
      if (pairs.type === "Element") {
        const index = seen.get(pairs.name) ?? 0;
        seen.set(pairs.name, index + 1);
        if (index >= (held.get(pairs.name) ?? 0)) {
          used.add("unread_element_order_entry");
          return false;
        }
        return true;
      }
      const drop = !meta.mixed && pairs.type === "Text" && pairs.text.trim() === "";
      if (drop) used.add("ordered_whitespace_text");
      return !drop;
    });
    if (kept.length > 0) fields.push([name, { array: kept }]);
  }
  return { node: value.node, fields };
}

/** The expected wire with the Ruby-only state above removed; `used` collects the profile names applied. */
export function normalizeExpected(value) {
  const used = new Set();
  const normalized = normalizeValue(value, used);
  for (const name of used) profiles[name]++;
  return { normalized, used: [...used] };
}

/** Rows each normalization applied to. */
export const profileCounts = () => ({ ...profiles });

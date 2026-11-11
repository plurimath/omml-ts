import { OmmlModelsOMath_omml, OmmlModelsOMathPara_omml } from "./generated/models.js";
import { codecOmmlModelsOMath_omml, codecOmmlModelsOMathPara_omml } from "./generated/xml/codecs.js";
import { parseText, XmlError, type ReadOptions } from "./generated/xml/runtime.js";

export { OmmlModelsOMath_omml as OMath, OmmlModelsOMathPara_omml as OMathPara, XmlError };
export { initEngine, initModel } from "moxml-ts";
export type { ReadOptions };
export type OmmlDocument = OmmlModelsOMath_omml | OmmlModelsOMathPara_omml;

const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";

export async function parseOmml(input: string, options?: ReadOptions): Promise<OmmlDocument> {
  const document = await parseText(input);
  try {
    const root = document.root();
    if (root?.namespaceUri() === mathNamespace) {
      if (root.localName() === "oMath") return codecOmmlModelsOMath_omml.decode(document, options);
      if (root.localName() === "oMathPara") return codecOmmlModelsOMathPara_omml.decode(document, options);
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
  try {
    return document.toXml();
  } finally {
    document.dispose();
  }
}

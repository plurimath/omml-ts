# OMML TypeScript

Parse and write Office Math oMath and oMathPara documents using generated
typed models and the Moxml XML runtime.

    import { parseOmml, stringifyOmml } from "@plurimath/omml-ts";

    const document = await parseOmml(source);
    const xml = await stringifyOmml(document);

The ./models export provides generated classes and codecs. Choice
validation is explicit. Call the generated model's static validate method
to check its choice groups.

The ./artifacts export provides a checksummed declaration graph through the
Node.js filesystem. Exact source revisions and file hashes are in
model/provenance.json.

The candidate has been checked against native OMML formula trees.
WordprocessingML payloads, lexical date coercion, and XML attribute tabs
and line feeds have separate compatibility limits.

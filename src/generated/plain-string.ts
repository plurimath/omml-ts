export type HexBinary = string;

export function isHexBinary(value: unknown): value is HexBinary {
  return typeof value === "string";
}

export function parseHexBinary(value: string): HexBinary {
  return value;
}

export const formatHexBinary = parseHexBinary;
export const parseHexBinaryXml = parseHexBinary;
export const formatHexBinaryXml = parseHexBinary;

export type STLang = string;

export function isSTLang(value: unknown): value is STLang {
  return typeof value === "string";
}

export function parseSTLang(value: string): STLang {
  return value;
}

export const formatSTLang = parseSTLang;
export const parseSTLangXml = parseSTLang;
export const formatSTLangXml = parseSTLang;

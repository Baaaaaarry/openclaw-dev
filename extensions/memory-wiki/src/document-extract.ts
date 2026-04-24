import JSZip from "jszip";

type PdfTextItem = {
  str: string;
};

type PdfTextContent = {
  items: Array<PdfTextItem | object>;
};

type PdfPage = {
  getTextContent(): Promise<PdfTextContent>;
};

type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
};

type PdfJsModule = {
  getDocument(params: { data: Uint8Array; disableWorker?: boolean }): {
    promise: Promise<PdfDocument>;
  };
};

const PDFJS_MODULE = "pdfjs-dist/legacy/build/pdf.mjs";
const MIN_LEGACY_PPT_TEXT_BYTES = 4;
const XML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

export type ExtractedWikiSourceContent = {
  text: string;
  format: "text" | "pdf" | "pptx" | "ppt";
  extractedBy: "utf8" | "pdfjs" | "pptx-xml" | "ppt-strings";
};

function normalizeExtractedText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }
    return XML_ENTITY_MAP[lower] ?? "";
  });
}

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (import(PDFJS_MODULE) as Promise<PdfJsModule>).catch((err) => {
      pdfJsModulePromise = null;
      throw new Error(
        `Optional dependency pdfjs-dist is required for PDF extraction: ${String(err)}`,
      );
    });
  }
  return pdfJsModulePromise;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfJsModule = await loadPdfJsModule();
  const pdf = await pdfJsModule.getDocument({ data: new Uint8Array(buffer), disableWorker: true })
    .promise;
  const textParts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    if (pageText.trim()) {
      textParts.push(`## Page ${pageNumber}\n${pageText.trim()}`);
    }
  }
  return normalizeExtractedText(textParts.join("\n\n"));
}

function extractPrintableAsciiRuns(buffer: Buffer): string[] {
  const runs: string[] = [];
  let current = "";
  for (const byte of buffer) {
    if ((byte >= 32 && byte <= 126) || byte === 9) {
      current += String.fromCharCode(byte);
      continue;
    }
    if (current.length >= MIN_LEGACY_PPT_TEXT_BYTES) {
      runs.push(current.trim());
    }
    current = "";
  }
  if (current.length >= MIN_LEGACY_PPT_TEXT_BYTES) {
    runs.push(current.trim());
  }
  return runs.filter(Boolean);
}

function extractPrintableUtf16LeRuns(buffer: Buffer): string[] {
  const runs: string[] = [];
  for (const offset of [0, 1] as const) {
    let current = "";
    for (let index = offset; index + 1 < buffer.length; index += 2) {
      const codeUnit = buffer.readUInt16LE(index);
      if ((codeUnit >= 32 && codeUnit <= 126) || codeUnit === 9) {
        current += String.fromCharCode(codeUnit);
        continue;
      }
      if (current.length >= MIN_LEGACY_PPT_TEXT_BYTES) {
        runs.push(current.trim());
      }
      current = "";
    }
    if (current.length >= MIN_LEGACY_PPT_TEXT_BYTES) {
      runs.push(current.trim());
    }
  }
  return runs.filter(Boolean);
}

function dedupeOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function extractLegacyPptText(buffer: Buffer): string {
  const strings = dedupeOrdered([
    ...extractPrintableAsciiRuns(buffer),
    ...extractPrintableUtf16LeRuns(buffer),
  ]);
  return normalizeExtractedText(strings.join("\n"));
}

function parseSlideNumber(fileName: string): number {
  const match = fileName.match(/slide(\d+)\.xml$/i);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .toSorted((left, right) => parseSlideNumber(left) - parseSlideNumber(right));
  const parts: string[] = [];
  for (const [index, fileName] of slideFiles.entries()) {
    const xml = await zip.file(fileName)?.async("string");
    if (!xml) {
      continue;
    }
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g), (match) =>
      decodeXmlEntities(match[1] ?? "").trim(),
    ).filter(Boolean);
    if (texts.length === 0) {
      continue;
    }
    parts.push(`## Slide ${index + 1}\n${texts.join("\n")}`);
  }
  return normalizeExtractedText(parts.join("\n\n"));
}

function assertUtf8Text(buffer: Buffer, sourcePath: string): string {
  const preview = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (preview.includes(0)) {
    throw new Error(`Cannot ingest binary file as markdown source: ${sourcePath}`);
  }
  return normalizeExtractedText(buffer.toString("utf8"));
}

export async function extractWikiSourceContent(params: {
  buffer: Buffer;
  sourcePath: string;
}): Promise<ExtractedWikiSourceContent> {
  const normalizedPath = params.sourcePath.toLowerCase();
  if (normalizedPath.endsWith(".pdf")) {
    const text = await extractPdfText(params.buffer);
    if (!text) {
      throw new Error(`No extractable text found in PDF: ${params.sourcePath}`);
    }
    return { text, format: "pdf", extractedBy: "pdfjs" };
  }
  if (normalizedPath.endsWith(".pptx")) {
    const text = await extractPptxText(params.buffer);
    if (!text) {
      throw new Error(`No extractable text found in PPTX: ${params.sourcePath}`);
    }
    return { text, format: "pptx", extractedBy: "pptx-xml" };
  }
  if (normalizedPath.endsWith(".ppt")) {
    const text = extractLegacyPptText(params.buffer);
    if (!text) {
      throw new Error(
        `No extractable text found in legacy PPT: ${params.sourcePath}. Convert to .pptx for richer import.`,
      );
    }
    return { text, format: "ppt", extractedBy: "ppt-strings" };
  }
  return {
    text: assertUtf8Text(params.buffer, params.sourcePath),
    format: "text",
    extractedBy: "utf8",
  };
}

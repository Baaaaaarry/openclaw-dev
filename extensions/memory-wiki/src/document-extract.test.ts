import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractWikiSourceContent } from "./document-extract.js";

describe("extractWikiSourceContent", () => {
  it("reads utf8 text files directly", async () => {
    const result = await extractWikiSourceContent({
      buffer: Buffer.from("alpha\nbeta\n", "utf8"),
      sourcePath: "/tmp/demo.txt",
    });

    expect(result).toEqual({
      text: "alpha\nbeta",
      format: "text",
      extractedBy: "utf8",
    });
  });

  it("extracts slide text from pptx files", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Alpha</a:t><a:t>Roadmap</a:t></p:sld>',
    );
    zip.file(
      "ppt/slides/slide2.xml",
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Beta &amp; Gamma</a:t></p:sld>',
    );
    const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));

    const result = await extractWikiSourceContent({
      buffer,
      sourcePath: "/tmp/demo.pptx",
    });

    expect(result.format).toBe("pptx");
    expect(result.extractedBy).toBe("pptx-xml");
    expect(result.text).toContain("## Slide 1");
    expect(result.text).toContain("Alpha");
    expect(result.text).toContain("Roadmap");
    expect(result.text).toContain("## Slide 2");
    expect(result.text).toContain("Beta & Gamma");
  });

  it("extracts best-effort text from legacy ppt files", async () => {
    const ascii = Buffer.from("Quarterly Review\x00Strategy Update\x00", "latin1");
    const utf16 = Buffer.from("Action Items", "utf16le");
    const buffer = Buffer.concat([ascii, utf16]);

    const result = await extractWikiSourceContent({
      buffer,
      sourcePath: "/tmp/demo.ppt",
    });

    expect(result.format).toBe("ppt");
    expect(result.extractedBy).toBe("ppt-strings");
    expect(result.text).toContain("Quarterly Review");
    expect(result.text).toContain("Strategy Update");
    expect(result.text).toContain("Action Items");
  });
});

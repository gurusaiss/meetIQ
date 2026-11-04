import PptxGenJS from "pptxgenjs";
import type { SlideData } from "./slides.ts";

const BRAND = "5B4DF5";

export async function buildPptx(title: string, slides: SlideData[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = title;

  const cover = pptx.addSlide();
  cover.background = { color: "0A0D16" };
  cover.addShape("rect", { x: 0.6, y: 3.2, w: 1.2, h: 0.08, fill: { color: BRAND } });
  cover.addText(title, { x: 0.6, y: 1.6, w: 12, h: 1.4, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  cover.addText("Every point cited to the source and confidence-scored", {
    x: 0.6, y: 3.5, w: 12, h: 0.6, fontSize: 18, color: "A7B0C5", fontFace: "Calibri",
  });
  cover.addText("MeetIQ", { x: 0.6, y: 6.6, w: 4, h: 0.4, fontSize: 14, bold: true, color: BRAND, fontFace: "Calibri" });

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape("rect", { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: BRAND } });
    slide.addText(s.title, { x: 0.7, y: 0.4, w: 12, h: 1, fontSize: 30, bold: true, color: "141827", fontFace: "Calibri" });
    slide.addText(
      s.bullets.map((b) => ({
        text: (b.flagged ? "⚠ " : "") + b.text,
        options: { bullet: true, breakLine: true, color: b.flagged ? "A15C00" : "2B3246" },
      })),
      { x: 0.7, y: 1.6, w: 12, h: 5, fontSize: 20, valign: "top", fontFace: "Calibri", paraSpaceAfter: 10 },
    );
    slide.addNotes(s.notes);
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

import { describe, expect, it } from "vitest";
import { parseMediaLink } from "@/lib/media-link";

describe("parseMediaLink", () => {
  it("reconhece links de arquivo do Google Drive e monta o player", () => {
    for (const u of [
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
      "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp",
      "https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOp&export=download",
    ]) {
      const r = parseMediaLink(u);
      expect(r?.kind).toBe("drive");
      expect(r && "embed" in r && r.embed).toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview");
    }
  });
  it("diferencia pasta do Drive de arquivo", () => {
    expect(parseMediaLink("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp")?.kind).toBe("drive-folder");
  });
  it("reconhece YouTube (watch, youtu.be, shorts) e Vimeo", () => {
    expect(parseMediaLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.kind).toBe("youtube");
    expect(parseMediaLink("https://youtu.be/dQw4w9WgXcQ")?.kind).toBe("youtube");
    expect(parseMediaLink("https://youtube.com/shorts/dQw4w9WgXcQ")?.kind).toBe("youtube");
    expect(parseMediaLink("https://vimeo.com/123456789")?.kind).toBe("vimeo");
  });
  it("recusa http e texto inválido; outros sites viram link simples", () => {
    expect(parseMediaLink("http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view")).toBeNull();
    expect(parseMediaLink("javascript:alert(1)")).toBeNull();
    expect(parseMediaLink("não é link")).toBeNull();
    expect(parseMediaLink("https://exemplo.com/video.mp4")?.kind).toBe("other");
  });
});

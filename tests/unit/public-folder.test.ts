import { describe, expect, it } from "vitest";
import { looksLikeVideo, parseFolderHtml } from "@/lib/drive/public-folder";

const entry = (id: string, href: string, icon: string, title: string) =>
  `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="${href}" target="_blank">` +
  `<div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/${icon}" alt=""></div>` +
  `<div class="flip-entry-title">${title}</div></a></div><div class="flip-entry-last-modified"><div>20 de nov.</div></div></div>`;

describe("public Drive folder parser", () => {
  const html = `<html><body><div class="flip-entries">` +
    entry("1VideoAAAAAAAAAAAAAAA", "https://drive.google.com/file/d/1VideoAAAAAAAAAAAAAAA/view?usp=drive_web", "video/mp4", "Reels 01 &amp; capa.mp4") +
    entry("1PhotoBBBBBBBBBBBBBBB", "https://drive.google.com/file/d/1PhotoBBBBBBBBBBBBBBB/view?usp=drive_web", "image/jpeg", "foto.jpg") +
    entry("1FolderCCCCCCCCCCCCCC", "https://drive.google.com/drive/folders/1FolderCCCCCCCCCCCCCC", "application/vnd.google-apps.folder", "Brutos") +
    `</div></body></html>`;

  it("reads files, names and types", () => {
    const out = parseFolderHtml(html, "1ParentDDDDDDDDDDDDDD");
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ id: "1VideoAAAAAAAAAAAAAAA", name: "Reels 01 & capa.mp4", mime: "video/mp4", folder: false });
    expect(out[2].folder).toBe(true);
    expect(out.filter((e) => !e.folder && looksLikeVideo(e.name, e.mime)).map((e) => e.id)).toEqual(["1VideoAAAAAAAAAAAAAAA"]);
  });

  it("falls back to bare file links when the layout changes", () => {
    const out = parseFolderHtml(`<a href="/file/d/1OnlyLinkEEEEEEEEEEEE/view">x</a>`, "1ParentDDDDDDDDDDDDDD");
    expect(out).toEqual([{ id: "1OnlyLinkEEEEEEEEEEEE", name: "", mime: null, folder: false }]);
  });

  it("detects videos by extension when the type is unknown", () => {
    expect(looksLikeVideo("clip.MOV", null)).toBe(true);
    expect(looksLikeVideo("roteiro.pdf", null)).toBe(false);
  });
});

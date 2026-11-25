import { describe, expect, it } from "vitest";
import { crc32, makeZip } from "@/lib/zip";

describe("zip", () => {
  it("crc32 bate com o valor de referência", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("gera um zip com assinaturas e diretório central corretos", async () => {
    const blob = makeZip([{ name: "01 - Título/legenda.txt", data: new TextEncoder().encode("olá") }, { name: "b.bin", data: new Uint8Array([1, 2, 3]) }]);
    const buf = new DataView(await blob.arrayBuffer());
    expect(buf.getUint32(0, true)).toBe(0x04034b50);
    const eocd = buf.byteLength - 22;
    expect(buf.getUint32(eocd, true)).toBe(0x06054b50);
    expect(buf.getUint16(eocd + 10, true)).toBe(2);
    const cdOffset = buf.getUint32(eocd + 16, true);
    expect(buf.getUint32(cdOffset, true)).toBe(0x02014b50);
  });
});

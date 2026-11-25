import { describe, expect, it, beforeAll } from "vitest";
import { editorialStatus, isTaskOverdue, stageDropAction } from "@/lib/domain";
import { fromLocalInput, pct, toLocalInput } from "@/lib/format";
import { csvCell, isUuid, slugify, storagePath, toCsv } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";

describe("Pipeline: arrastar no Kanban respeita a máquina de estados", () => {
  it("só permite movimentos de publicação", () => {
    expect(stageDropAction("ready", "scheduled").kind).toBe("schedule");
    expect(stageDropAction("scheduled", "published").kind).toBe("confirm");
    expect(stageDropAction("ready", "published").kind).toBe("confirm");
    for (const to of ["editing", "cover", "caption", "internal_review", "client_approval", "ready", "adjustments"] as const) {
      expect(stageDropAction("planning", to).kind).toBe("invalid");
    }
    expect(stageDropAction("editing", "scheduled").kind).toBe("invalid");
  });
});

describe("Status editorial", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  it("data vencida sem confirmação vira atrasada, nunca publicada", () => {
    expect(editorialStatus({ publication_status: "planned", planned_publish_at: "2026-11-20T12:00:00Z", scheduled_at: null }, now))
      .toMatchObject({ label: "Publicação atrasada", late: true });
    expect(editorialStatus({ publication_status: "scheduled", planned_publish_at: null, scheduled_at: "2026-11-23T12:00:00Z" }, now))
      .toMatchObject({ label: "Aguardando confirmação", late: true });
    expect(editorialStatus({ publication_status: "published", planned_publish_at: "2026-11-20T12:00:00Z", scheduled_at: null }, now).late).toBe(false);
  });
  it("atraso de tarefa é calculado sem alterar o status", () => {
    expect(isTaskOverdue({ status: "in_progress", due_at: "2026-11-23T00:00:00Z" }, now)).toBe(true);
    expect(isTaskOverdue({ status: "done", due_at: "2026-11-23T00:00:00Z" }, now)).toBe(false);
    expect(isTaskOverdue({ status: "blocked", due_at: "2026-11-23T00:00:00Z" }, now)).toBe(false);
  });
});

describe("Fuso horário (America/Fortaleza, UTC−3)", () => {
  it("converte ida e volta sem deslocar o horário", () => {
    const iso = fromLocalInput("2026-11-30T15:00");
    expect(iso).toBe("2026-11-30T18:00:00.000Z");
    expect(toLocalInput(iso)).toBe("2026-11-30T15:00");
    expect(fromLocalInput("lixo")).toBeNull();
  });
  it("percentual nunca passa de 100 nem divide por zero", () => {
    expect(pct(12, 10)).toBe(100);
    expect(pct(3, 0)).toBe(0);
  });
});

describe("Utilitários", () => {
  it("CSV neutraliza injeção de fórmula e escapa separadores", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("a;b")).toBe("\"a;b\"");
    expect(toCsv([{ a: 1 }], [{ key: "a", label: "A" }]).startsWith("﻿A\r\n1")).toBe(true);
  });
  it("caminho de storage segue a convenção usada pela RLS", () => {
    const p = storagePath("ws", "cl", "id", "Vídeo final (v2).MP4");
    expect(p).toBe("ws/cl/id/Video-final-v2-.MP4");
    expect(p.split("/")).toHaveLength(4);
    expect(storagePath("ws", null, "id", "../../etc/passwd")).toBe("ws/_shared/id/etc-passwd");
    expect(storagePath("ws", null, "id", "..")).toBe("ws/_shared/id/arquivo");
  });
  it("slug e uuid", () => {
    expect(slugify("Agência Delta!")).toBe("agencia-delta");
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("1 or 1=1")).toBe(false);
  });
  it("erros do banco viram mensagens claras sem vazar SQL", () => {
    expect(friendlyError({ message: "stale_version" })).toMatch(/substituída/);
    expect(friendlyError({ message: "new row violates row-level security policy for table \"clients\"" })).toMatch(/permissão/);
    expect(friendlyError({ message: "syntax error at or near" })).toBe("Não foi possível concluir a ação. Tente novamente.");
  });
});

describe("Criptografia dos tokens do Google Drive", () => {
  beforeAll(() => { process.env.DRIVE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); });
  it("AES-256-GCM: cifra, decifra e detecta adulteração", async () => {
    const { encrypt, decrypt } = await import("@/lib/drive/crypto");
    const c = encrypt("1//refresh-token");
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("refresh-token");
    expect(decrypt(c)).toBe("1//refresh-token");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

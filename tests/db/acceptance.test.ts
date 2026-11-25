/**
 * Acceptance criteria (briefing §31) executed against a real PostgreSQL with
 * every migration applied and RLS enforced. Each scenario runs as the actual
 * role involved (collaborator JWT or anonymous portal visitor).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin, as, asAnon, contentState, createReels, deliverableOf, expectDbError, key, openPortal,
  pool, portalGet, produceAll, rpc, setupAgency, taskByStep, uploadAsset, type Agency,
} from "./helpers";

let a: Agency;

beforeAll(async () => {
  a = await setupAgency("Delta");
});
afterAll(async () => {
  await pool.end();
});

async function sendBatch(contents: string[], opts: { pin?: string; expires?: string } = {}) {
  return as(a.manager, (q) =>
    rpc<{ token: string; batch_id: string; link_id: string }>(q, "create_approval_batch", [
      a.ws, a.clientA, "Lote semanal", contents, null, opts.expires ?? null, opts.pin ?? null,
    ]),
  );
}

describe("Cenário 1 — Produção: captação concluída libera a edição e notifica o editor", () => {
  it("bloqueia dependências, exige entregável e libera a próxima etapa", async () => {
    const content = await createReels(a, "Reels Fotona #01");

    expect((await taskByStep(content, "script")).status).toBe("pending");
    expect((await taskByStep(content, "capture")).status).toBe("blocked");
    expect((await taskByStep(content, "edit")).status).toBe("blocked");

    // Filmmaker cannot start a blocked task.
    const capture = await taskByStep(content, "capture");
    await expectDbError(as(a.filmmaker, (q) => rpc(q, "start_task", [capture.id])), "dependencies_pending");

    // Copywriter cannot complete the script without the deliverable.
    const script = await taskByStep(content, "script");
    await expectDbError(as(a.copywriter, (q) => rpc(q, "complete_task", [script.id])), "deliverable_missing");
    await as(a.copywriter, async (q) => {
      await rpc(q, "add_deliverable_version", [script.deliverable_id, "Roteiro aprovado internamente", [], null, null]);
      await rpc(q, "complete_task", [script.id]);
    });
    expect((await taskByStep(content, "capture")).status).toBe("pending");
    expect((await taskByStep(content, "cover")).status).toBe("pending");
    expect((await taskByStep(content, "caption")).status).toBe("pending");
    expect((await taskByStep(content, "edit")).status).toBe("blocked");

    // Filmmaker links raw footage and finishes.
    const raw = await uploadAsset(a.filmmaker, a.ws, a.clientA, "bruto-fotona.mov", "video/quicktime", "raw");
    await as(a.filmmaker, async (q) => {
      await rpc(q, "start_task", [capture.id]);
      await rpc(q, "add_deliverable_version", [capture.deliverable_id, null, [raw], null, null]);
      await rpc(q, "complete_task", [capture.id]);
    });

    const edit = await taskByStep(content, "edit");
    expect(edit.status).toBe("pending");
    const notes = await as(a.editor, (q) =>
      q<{ type: string; entity_id: string }>("select type, entity_id from notifications where type = 'task_released'"),
    );
    expect(notes.some((n) => n.entity_id === edit.id)).toBe(true);
    expect((await contentState(content)).stage).toBe("editing");
  });

  it("concluir duas vezes não duplica efeitos", async () => {
    const content = await createReels(a, "Reels idempotente");
    const script = await taskByStep(content, "script");
    await as(a.copywriter, async (q) => {
      await rpc(q, "add_deliverable_version", [script.deliverable_id, "texto", [], null, null]);
      await rpc(q, "complete_task", [script.id]);
      await rpc(q, "complete_task", [script.id]);
    });
    const count = await admin((q) =>
      q<{ n: string }>("select count(*) n from notifications where type = 'task_released' and entity_id in (select id from tasks where content_id = $1)", [content]),
    );
    expect(Number(count[0].n)).toBe(3); // capture, cover, caption — once each
  });
});

describe("Cenário 2 — Google Drive: vincula arquivo existente sem duplicar", () => {
  it("a mesma referência do Drive só é importada uma vez e é vinculada ao conteúdo correto", async () => {
    const content = await createReels(a, "Reels com arquivo do Drive");
    const insertDrive = (q: Parameters<Parameters<typeof as>[1]>[0]) =>
      q<{ id: string }>(
        `insert into file_assets (workspace_id, client_id, provider, drive_file_id, name, mime_type, category, created_by)
         values ($1, $2, 'drive', 'drive-file-abc123', 'Fotona 03 editado.mp4', 'video/mp4', 'edited_video', $3)
         on conflict (workspace_id, drive_file_id) where drive_file_id is not null do nothing returning id`,
        [a.ws, a.clientA, a.manager],
      );
    const first = await as(a.manager, insertDrive);
    const second = await as(a.manager, insertDrive);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    const video = await deliverableOf(content, "video");
    await as(a.manager, (q) => rpc(q, "add_deliverable_version", [video.id, null, [first[0].id], null, null]));
    const linked = await admin((q) =>
      q<{ n: string }>(
        `select count(*) n from deliverable_version_assets dva join deliverable_versions v on v.id = dva.version_id
          join deliverables d on d.id = v.deliverable_id where d.content_id = $1 and dva.asset_id = $2`,
        [content, first[0].id],
      ),
    );
    expect(Number(linked[0].n)).toBe(1);
    const total = await admin((q) => q<{ n: string }>("select count(*) n from file_assets where drive_file_id = 'drive-file-abc123'"));
    expect(Number(total[0].n)).toBe(1);

    const suggestions = await as(a.manager, (q) => q("select * from suggest_asset_links($1)", [first[0].id]));
    expect(Array.isArray(suggestions)).toBe(true);
  });
});

describe("Cenários 3 a 5 e 10 a 12 — Portal de aprovação", () => {
  let contents: string[] = [];
  let token = "";
  let session = "";

  beforeAll(async () => {
    contents = [];
    for (let i = 1; i <= 8; i++) {
      const c = await createReels(a, `Reels lote #${i}`);
      await produceAll(a, c);
      contents.push(c);
    }
    const batch = await sendBatch(contents);
    token = batch.token;
  });

  it("Cenário 3: cliente abre o lote de 8 conteúdos sem cadastro", async () => {
    const opened = await openPortal(token);
    expect(opened.ok).toBe(true);
    session = opened.session!;
    const data = await portalGet(token, session);
    expect(data.items).toHaveLength(8);
    const kinds = data.items[0].deliverables.map((d) => d.kind).sort();
    expect(kinds).toEqual(["caption", "cover", "video"]);
    // Internal deliverables (script, raw footage) never reach the client.
    expect(JSON.stringify(data)).not.toMatch(/raw_footage|Roteiro:/);
    for (const c of contents) expect((await contentState(c)).approval_status).toBe("awaiting");
  });

  it("anon não lê tabelas diretamente", async () => {
    await expectDbError(asAnon((q) => q("select * from clients")), /permission denied/);
    await expectDbError(asAnon((q) => q("select * from approval_links")), /permission denied/);
  });

  it("Cenário 4: aprova vídeo e capa, reprova legenda; só o copywriter recebe ajuste", async () => {
    const data = await portalGet(token, session);
    const item = data.items[0];
    const by = (k: string) => item.deliverables.find((d) => d.kind === k)!;

    await asAnon((q) => rpc(q, "portal_respond", [token, session, by("video").version!.id, "approved", null, "Dra. Ana", key(), false]));
    await asAnon((q) => rpc(q, "portal_respond", [token, session, by("cover").version!.id, "approved", "Perfeita", "Dra. Ana", key(), false]));
    await expectDbError(
      asAnon((q) => rpc(q, "portal_respond", [token, session, by("caption").version!.id, "rejected", "  ", "Dra. Ana", key(), false])),
      "comment_required",
    );
    await asAnon((q) =>
      rpc(q, "portal_respond", [token, session, by("caption").version!.id, "rejected", "Trocar o CTA para WhatsApp", "Dra. Ana", key(), false]),
    );

    const content = item.content_id;
    expect((await deliverableOf(content, "video")).approval_status).toBe("approved");
    expect((await deliverableOf(content, "cover")).approval_status).toBe("approved");
    expect((await deliverableOf(content, "caption")).approval_status).toBe("rejected");
    const st = await contentState(content);
    expect(st.production_status).toBe("adjustments");
    expect(st.approval_status).toBe("rejected");

    const adj = await admin((q) =>
      q<{ assignee_id: string; status: string; description: string }>(
        "select assignee_id, status, description from tasks where content_id = $1 and kind = 'adjustment'", [content]),
    );
    expect(adj).toHaveLength(1);
    expect(adj[0].assignee_id).toBe(a.copywriter);
    expect(adj[0].description).toContain("CTA");
    // Video/cover production tasks were NOT reopened.
    expect((await taskByStep(content, "edit")).status).toBe("done");
    expect((await taskByStep(content, "cover")).status).toBe("done");
  });

  it("Cenário 10: o mesmo evento de reprovação processado duas vezes não duplica tarefa", async () => {
    const data = await portalGet(token, session);
    const item = data.items[1];
    const caption = item.deliverables.find((d) => d.kind === "caption")!;
    const k = key();
    const args = [token, session, caption.version!.id, "rejected", "Texto longo demais", "Cliente", k, false];
    const r1 = await asAnon((q) => rpc<{ status: string }>(q, "portal_respond", args));
    const r2 = await asAnon((q) => rpc<{ status: string }>(q, "portal_respond", args));
    const r3 = await asAnon((q) =>
      rpc<{ status: string }>(q, "portal_respond", [token, session, caption.version!.id, "rejected", "De novo", "Cliente", key(), false]),
    );
    expect(r1.status).toBe("applied");
    expect(r2.status).toBe("duplicate");
    expect(r3.status).toBe("unchanged");
    const tasks = await admin((q) => q("select id from tasks where content_id = $1 and kind = 'adjustment'", [item.content_id]));
    expect(tasks).toHaveLength(1);
    const responses = await admin((q) => q("select id from approval_responses where version_id = $1", [caption.version!.id]));
    expect(responses).toHaveLength(1);
  });

  it("Cenário 5 e 12: nova legenda V2 no mesmo link, V1 preservada; versão antiga é rejeitada", async () => {
    const before = await portalGet(token, session);
    const item = before.items[0];
    const staleCaption = item.deliverables.find((d) => d.kind === "caption")!.version!;
    const content = item.content_id;
    const caption = await deliverableOf(content, "caption");
    const adj = (await admin((q) => q<{ id: string }>("select id from tasks where content_id = $1 and kind = 'adjustment'", [content])))[0];

    // Completing without a NEW version is refused.
    await expectDbError(as(a.copywriter, (q) => rpc(q, "complete_task", [adj.id])), "deliverable_missing");
    await as(a.copywriter, async (q) => {
      await rpc(q, "add_deliverable_version", [caption.id, "Legenda V2: chame no WhatsApp e agende.", [], null, "Ajuste do CTA"]);
      await rpc(q, "complete_task", [adj.id]);
    });

    // Not reviewed yet: the client still sees V1 and cannot decide on it.
    const mid = await portalGet(token, session);
    const midCaption = mid.items[0].deliverables.find((d) => d.kind === "caption")!;
    expect(midCaption.version!.number).toBe(1);
    expect(midCaption.version!.decidable).toBe(false);

    // Scenario 12: an old page tries to act on V1.
    await expectDbError(
      asAnon((q) => rpc(q, "portal_respond", [token, session, staleCaption.id, "approved", null, "Cliente", key(), true])),
      "stale_version",
    );

    const review = await taskByStep(content, "review");
    expect(review.status).toBe("reopened");
    await as(a.manager, (q) => rpc(q, "complete_task", [review.id]));

    const after = await portalGet(token, session);
    const v2 = after.items[0].deliverables.find((d) => d.kind === "caption")!;
    expect(v2.version!.number).toBe(2);
    expect(v2.version!.decidable).toBe(true);
    expect(v2.history).toEqual([expect.objectContaining({ version: 1, decision: "rejected", comment: "Trocar o CTA para WhatsApp" })]);

    const v1 = await admin((q) =>
      q<{ status: string; text_content: string }>("select status, text_content from deliverable_versions where id = $1", [staleCaption.id]),
    );
    expect(v1[0].status).toBe("rejected");
    expect(v1[0].text_content).toContain("Legenda V1");

    await asAnon((q) => rpc(q, "portal_respond", [token, session, v2.version!.id, "approved", null, "Cliente", key(), false]));
    const st = await contentState(content);
    expect(st.approval_status).toBe("approved");
    expect(st.publication_status).toBe("ready");
  });

  it("aprovação em massa não sobrescreve reprovados sem confirmação específica", async () => {
    const res = await asAnon((q) =>
      rpc<{ approved: number; skipped_rejected: number }>(q, "portal_bulk_approve", [token, session, null, "Cliente", key(), false]),
    );
    expect(res.skipped_rejected).toBe(1); // item #2 caption stays rejected
    expect(res.approved).toBeGreaterThan(0);
    const st = await contentState(contents[1]);
    expect(st.approval_status).toBe("rejected");

    const summary = await asAnon((q) =>
      rpc<{ approved_contents: number; adjustment_contents: number }>(q, "portal_finalize", [token, session, "Cliente"]),
    );
    expect(summary.adjustment_contents).toBe(1);
    expect(summary.approved_contents).toBe(7);
  });

  it("Cenário 11: link revogado ou expirado não dá acesso", async () => {
    const extra = await createReels(a, "Reels para link expirado");
    await produceAll(a, extra);
    const b = await sendBatch([extra]);
    const s = await openPortal(b.token);
    expect(s.ok).toBe(true);

    await admin((q) => q("update approval_links set expires_at = now() - interval '1 minute' where id = $1", [b.link_id]));
    await expectDbError(openPortal(b.token), "link_unavailable");
    await expectDbError(portalGet(b.token, s.session!), "link_unavailable");

    const c = await sendBatch([extra]);
    await as(a.manager, (q) => rpc(q, "revoke_approval_link", [c.link_id]));
    await expectDbError(openPortal(c.token), "link_unavailable");
    await expectDbError(openPortal("f".repeat(64)), "link_unavailable");
  });
});

describe("PIN e materiais sensíveis", () => {
  it("cliente sensível exige PIN; tentativas abusivas bloqueiam o link", async () => {
    await as(a.owner, (q) => q("update clients set is_sensitive = true where id = $1", [a.clientA]));
    const c = await createReels(a, "Reels sensível");
    await produceAll(a, c);
    await expectDbError(sendBatch([c]), "pin_required");
    const b = await sendBatch([c], { pin: "4821" });

    expect((await openPortal(b.token)).error).toBe("pin_required");
    for (let i = 0; i < 4; i++) expect((await openPortal(b.token, "0000")).error).toBe("pin_invalid");
    expect((await openPortal(b.token, "0000")).error).toBe("locked");
    expect((await openPortal(b.token, "4821")).error).toBe("locked"); // even the right PIN while locked

    await admin((q) => q("update approval_links set locked_until = now() - interval '1 second' where id = $1", [b.link_id]));
    expect((await openPortal(b.token, "4821")).ok).toBe(true);
    await as(a.owner, (q) => q("update clients set is_sensitive = false where id = $1", [a.clientA]));
  });
});

describe("Cenário 6 — Publicação", () => {
  it("social media agenda conteúdo aprovado e confirma a publicação", async () => {
    const c = await createReels(a, "Reels para publicar");
    await produceAll(a, c);
    const b = await sendBatch([c]);
    const s = (await openPortal(b.token)).session!;
    await asAnon((q) => rpc(q, "portal_bulk_approve", [b.token, s, null, "Cliente", key(), false]));
    expect((await contentState(c)).publication_status).toBe("ready");

    const when = new Date(Date.now() + 864e5).toISOString();
    await as(a.social, (q) => rpc(q, "schedule_publication", [c, when, "instagram", null]));
    expect((await contentState(c)).publication_status).toBe("scheduled");

    await expectDbError(
      as(a.social, (q) => rpc(q, "confirm_publication", [c, new Date(Date.now() + 864e5 * 2).toISOString(), null])),
      "validation: published_at",
    );
    await as(a.social, (q) => rpc(q, "confirm_publication", [c, new Date().toISOString(), "https://instagram.com/p/abc"]));
    const st = await contentState(c);
    expect(st.publication_status).toBe("published");
    expect(st.stage).toBe("published");

    const month = new Date();
    const from = new Date(month.getFullYear(), month.getMonth() - 1, 1).toISOString();
    const to = new Date(month.getFullYear(), month.getMonth() + 2, 1).toISOString();
    const dash = await as(a.manager, (q) => rpc<{ published: number }>(q, "dashboard_summary", [a.ws, from, to, null, null, null, null]));
    expect(dash.published).toBeGreaterThanOrEqual(1);
  });

  it("não agenda sem aprovação; exceção exige permissão e motivo, e é auditada", async () => {
    const c = await createReels(a, "Reels sem aprovação");
    const when = new Date(Date.now() + 864e5).toISOString();
    await expectDbError(as(a.social, (q) => rpc(q, "schedule_publication", [c, when, null, null])), "approval_required");
    await expectDbError(as(a.social, (q) => rpc(q, "schedule_publication", [c, when, null, "Cliente pediu urgência"])), "permission_denied");
    await as(a.owner, (q) => rpc(q, "schedule_publication", [c, when, null, "Cliente pediu urgência por telefone"]));
    const audit = await admin((q) => q("select id from audit_logs where action = 'publication.override' and entity_id = $1", [c]));
    expect(audit).toHaveLength(1);
  });

  it("não marca como publicado só porque a data passou", async () => {
    const c = await createReels(a, "Reels data passada");
    await admin((q) => q("update content_items set planned_publish_at = now() - interval '2 days' where id = $1", [c]));
    await admin((q) => q("select public.run_deadline_scan()"));
    expect((await contentState(c)).publication_status).not.toBe("published");
    const att = await as(a.manager, (q) => rpc<{ late_publications: Array<{ id: string }> }>(q, "dashboard_attention", [a.ws]));
    expect(att.late_publications.some((x) => x.id === c)).toBe(true);
  });
});

describe("Cenário 7 — Colaborador sem acesso ao cliente", () => {
  it("URL direta, consulta e RPC são bloqueadas", async () => {
    const c = await createReels(a, "Reels restrito");
    const script = await taskByStep(c, "script");

    const visible = await as(a.outsider, (q) => q("select id from content_items where id = $1", [c]));
    expect(visible).toHaveLength(0);
    expect(await as(a.outsider, (q) => q("select id from clients where id = $1", [a.clientA]))).toHaveLength(0);
    expect(await as(a.outsider, (q) => q("select id from tasks where content_id = $1", [c]))).toHaveLength(0);
    expect(await as(a.outsider, (q) => q("select id from deliverable_versions"))).toHaveLength(0);

    await expectDbError(as(a.outsider, (q) => rpc(q, "complete_task", [script.id])), /not_found|permission_denied/);
    await expectDbError(
      as(a.outsider, (q) => rpc(q, "create_content", [a.ws, a.clientA, a.formatReels, "x", {}, {}])),
      "permission_denied",
    );
    const upd = await as(a.outsider, (q) => q("update clients set name = 'hack' where id = $1 returning id", [a.clientA]));
    expect(upd).toHaveLength(0);

    // Storage: cannot write bytes into another client's folder.
    await expectDbError(
      as(a.outsider, (q) => q("insert into storage.objects (bucket_id, name) values ('workspace-files', $1)", [`${a.ws}/${a.clientA}/x/f.mp4`])),
      /row-level security/,
    );
    await as(a.filmmaker, (q) =>
      q("insert into storage.objects (bucket_id, name) values ('workspace-files', $1)", [`${a.ws}/${a.clientA}/y/f.mp4`]),
    );
  });

  it("permissão não é só visual: status não muda por UPDATE direto", async () => {
    const c = await createReels(a, "Reels guardado");
    await expectDbError(
      as(a.manager, (q) => q("update content_items set approval_status = 'approved' where id = $1", [c])),
      /permission denied|invalid_transition/,
    );
    const script = await taskByStep(c, "script");
    await expectDbError(
      as(a.copywriter, (q) => q("update tasks set status = 'done', completed_at = now() where id = $1", [script.id])),
      "invalid_transition",
    );
    await expectDbError(
      as(a.copywriter, (q) => q("update tasks set assignee_id = $2 where id = $1", [script.id, a.designer])),
      "permission_denied",
    );
    await expectDbError(
      as(a.copywriter, (q) => q("insert into approval_responses (workspace_id) values ($1)", [a.ws])),
      /permission denied|row-level security|violates/,
    );
  });
});

describe("Cenário 8 — Isolamento entre agências", () => {
  it("usuário da agência B não acessa nem referencia dados da agência A", async () => {
    const b = await setupAgency("Beta");
    const c = await createReels(a, "Reels da Delta");

    for (const table of ["clients", "content_items", "tasks", "deliverables", "deliverable_versions", "file_assets",
                         "approval_batches", "activity_logs", "workspace_members", "roles"]) {
      const rows = await as(b.owner, (q) => q(`select workspace_id from ${table} where workspace_id = $1`, [a.ws]));
      expect(rows, table).toHaveLength(0);
    }
    expect(await as(b.owner, (q) => q("select id from workspaces where id = $1", [a.ws]))).toHaveLength(0);

    await expectDbError(
      as(b.owner, (q) => q("insert into clients (workspace_id, name) values ($1, 'intruso')", [a.ws])),
      /row-level security/,
    );
    await expectDbError(as(b.owner, (q) => rpc(q, "create_content", [a.ws, a.clientA, a.formatReels, "x", {}, {}])), "permission_denied");
    await expectDbError(as(b.owner, (q) => rpc(q, "dashboard_attention", [a.ws])).then((r) => {
      const att = r as Record<string, unknown[]>;
      if (Object.values(att).some((v) => Array.isArray(v) && v.length > 0)) throw new Error("leak");
      throw new Error("empty-ok");
    }), "empty-ok");

    // Composite FKs: even with a valid own workspace, a foreign client id is rejected.
    await expectDbError(
      as(b.owner, (q) =>
        q("insert into tasks (workspace_id, client_id, title) values ($1, $2, 'cross')", [b.ws, a.clientA])),
      /foreign key|row-level security/,
    );
    await expectDbError(
      admin((q) => q("insert into tasks (workspace_id, client_id, content_id, title) values ($1, $2, $3, 'cross')", [b.ws, b.clientA, c])),
      /foreign key|invalid_reference/,
    );
    const search = await as(b.owner, (q) => q("select * from search_global($1, 'Reels')", [a.ws]));
    expect(search).toHaveLength(0);
  });
});

describe("Invalidação explícita e contagem por conteúdo", () => {
  it("gestor invalida aprovação de capa com motivo; relatório conta conteúdos, não entregáveis", async () => {
    const c = await createReels(a, "Reels invalidação");
    await produceAll(a, c);
    const b = await sendBatch([c]);
    const s = (await openPortal(b.token)).session!;
    await asAnon((q) => rpc(q, "portal_bulk_approve", [b.token, s, null, "Cliente", key(), false]));
    const cover = await deliverableOf(c, "cover");

    await expectDbError(as(a.designer, (q) => rpc(q, "invalidate_approval", [cover.id, "vídeo mudou"])), "permission_denied");
    await as(a.manager, (q) => rpc(q, "invalidate_approval", [cover.id, "Vídeo foi recortado, capa ficou desatualizada"]));
    expect((await contentState(c)).production_status).toBe("adjustments");
    expect((await deliverableOf(c, "video")).approval_status).toBe("approved");

    const month = new Date();
    const rows = await as(a.manager, (q) =>
      q<{ service_name: string; planned: string; videos_ready: string; covers_ready: string }>(
        "select * from client_progress($1, $2, $3)", [a.ws, new Date(month.getFullYear(), month.getMonth(), 1).toISOString().slice(0, 10), a.clientA]),
    );
    const fotona = rows.find((r) => r.service_name === "Fotona")!;
    // planned counts contents; videos_ready <= planned even though each content has 3+ deliverables.
    expect(Number(fotona.videos_ready)).toBeLessThanOrEqual(Number(fotona.planned));
  });
});

describe("Integridade estrutural entre workspaces", () => {
  it("FK composta impede vincular linha de um workspace a pai de outro, mesmo como dono do banco", async () => {
    const b = await setupAgency("Gama");
    const c = await createReels(a, "Reels FK");
    await expectDbError(
      admin((q) => q("insert into content_assignees (workspace_id, content_id, user_id) values ($1, $2, $3)", [b.ws, c, b.owner])),
      /foreign key/,
    );
    await expectDbError(
      admin((q) => q("insert into client_services (workspace_id, client_id, name) values ($1, $2, 'x')", [b.ws, a.clientA])),
      /foreign key/,
    );
  });
});

describe("Reverter reprovação exige confirmação específica", () => {
  it("aprovar item reprovado sem confirmação retorna override_required; com confirmação cancela o ajuste", async () => {
    const c = await createReels(a, "Reels override");
    await produceAll(a, c);
    const b = await sendBatch([c]);
    const s = (await openPortal(b.token)).session!;
    const data = await portalGet(b.token, s);
    const cap = data.items[0].deliverables.find((d) => d.kind === "caption")!;
    await asAnon((q) => rpc(q, "portal_respond", [b.token, s, cap.version!.id, "rejected", "Revisar emoji", "Cliente", key(), false]));
    const r1 = await asAnon((q) => rpc<{ status: string }>(q, "portal_respond", [b.token, s, cap.version!.id, "approved", null, "Cliente", key(), false]));
    expect(r1.status).toBe("override_required");
    const r2 = await asAnon((q) => rpc<{ status: string }>(q, "portal_respond", [b.token, s, cap.version!.id, "approved", null, "Cliente", key(), true]));
    expect(r2.status).toBe("applied");
    const adj = await admin((q) => q<{ status: string }>("select status from tasks where content_id = $1 and kind = 'adjustment'", [c]));
    expect(adj[0].status).toBe("cancelled");
    const hist = await admin((q) => q("select decision from approval_responses where version_id = $1 order by created_at", [cap.version!.id]));
    expect(hist.map((h) => (h as { decision: string }).decision)).toEqual(["rejected", "approved"]);
  });

  it("colaborador não conclui tarefa de outro colaborador", async () => {
    const c = await createReels(a, "Reels alheio");
    const script = await taskByStep(c, "script");
    await expectDbError(as(a.filmmaker, (q) => rpc(q, "complete_task", [script.id])), "permission_denied");
  });
});

describe("Configurações e funções personalizadas", () => {
  it("admin não altera plano/limites; funções customizadas não concedem mais do que o autor tem", async () => {
    await expectDbError(as(a.owner, (q) => q("update workspaces set plan = 'enterprise' where id = $1", [a.ws])), /permission denied/);
    await as(a.owner, (q) => q("update workspaces set brand_color = '#C6FF34' where id = $1", [a.ws]));
    await as(a.owner, (q) => rpc(q, "save_role", [a.ws, "revisor", "Revisor", "Revisa legendas", ["tasks.view_all"], ["caption"]]));
    await expectDbError(as(a.manager, (q) => rpc(q, "save_role", [a.ws, "x_role", "X", null, ["audit.view"], []])), "permission_denied");
    await expectDbError(as(a.owner, (q) => rpc(q, "delete_role", [a.ws, "manager"])), "invalid_transition");
    await as(a.owner, (q) => rpc(q, "delete_role", [a.ws, "revisor"]));
  });
});

describe("Fila de jobs (worker)", () => {
  it("um job só é reivindicado uma vez; falha aplica backoff; idempotency_key impede duplicata", async () => {
    const asService = async <T,>(fn: (q: Parameters<Parameters<typeof admin>[0]>[0]) => Promise<T>) => {
      const client = await pool.connect();
      try { await client.query("begin"); await client.query("set local role service_role");
        const out = await fn(async (t, p) => (await client.query(t, p)).rows as never); await client.query("commit"); return out; }
      finally { client.release(); }
    };
    const key = `test:${Date.now()}`;
    await admin((q) => q("insert into background_jobs (workspace_id, type, payload, idempotency_key) values ($1, 'send_email', '{}', $2)", [a.ws, key]));
    await expectDbError(admin((q) => q("insert into background_jobs (workspace_id, type, payload, idempotency_key) values ($1, 'send_email', '{}', $2)", [a.ws, key])), /duplicate key/);
    const first = await asService((q) => q<{ id: string; idempotency_key: string }>("select * from claim_background_jobs(array['send_email'], 50)"));
    const mine = first.find((j) => j.idempotency_key === key)!;
    expect(mine).toBeTruthy();
    const second = await asService((q) => q<{ idempotency_key: string }>("select * from claim_background_jobs(array['send_email'], 50)"));
    expect(second.some((j) => j.idempotency_key === key)).toBe(false);
    await asService((q) => q("select finish_background_job($1, false, 'smtp down')", [mine.id]));
    const [row] = await admin((q) => q<{ status: string; run_after: string }>("select status, run_after from background_jobs where id = $1", [mine.id]));
    expect(row.status).toBe("failed");
    expect(new Date(row.run_after).getTime()).toBeGreaterThan(Date.now());
    await expectDbError(as(a.owner, (q) => q("select * from claim_background_jobs(array['send_email'], 1)")), /permission denied/);
  });
});

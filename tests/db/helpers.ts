import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

const url =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/deltaflow_test";

export const pool = new Pool({ connectionString: url, max: 4 });

export type Q = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

function bind(client: PoolClient): Q {
  return async (text, params) => (await client.query(text, params)).rows;
}

/** Runs as the database owner (migrations / fixtures only). */
export async function admin<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(bind(client));
  } finally {
    client.release();
  }
}

async function scoped<T>(role: "authenticated" | "anon", uid: string | null, fn: (q: Q) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    const out = await fn(bind(client));
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Runs inside one transaction as an authenticated user, with RLS enforced. */
export const as = <T>(uid: string, fn: (q: Q) => Promise<T>) => scoped("authenticated", uid, fn);
/** Runs as the anonymous role (public approval portal). */
export const asAnon = <T>(fn: (q: Q) => Promise<T>) => scoped("anon", null, fn);

/** Calls an RPC and returns its scalar result. */
export async function rpc<T = unknown>(q: Q, fn: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await q<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args);
  return rows[0]?.r as T;
}

export async function createUser(name: string): Promise<string> {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${randomUUID().slice(0, 6)}@delta.test`;
  return admin(async (q) => {
    const [u] = await q<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
      [email, { full_name: name }],
    );
    return u.id;
  });
}

export async function emailOf(uid: string) {
  return admin(async (q) => (await q<{ email: string }>("select email from auth.users where id = $1", [uid]))[0].email);
}

export async function invite(owner: string, ws: string, uid: string, roles: string[]) {
  const email = await emailOf(uid);
  await as(owner, (q) => rpc(q, "invite_member", [ws, email, roles]));
  await as(uid, (q) => rpc(q, "accept_pending_invites"));
}

export function expectDbError(p: Promise<unknown>, code: string | RegExp) {
  return p.then(
    () => {
      throw new Error(`expected DB error ${String(code)}`);
    },
    (e: Error) => {
      const re = typeof code === "string" ? new RegExp(code) : code;
      if (!re.test(e.message)) throw new Error(`expected ${String(code)}, got: ${e.message}`);
      return e;
    },
  );
}

export interface Agency {
  ws: string;
  owner: string;
  manager: string;
  filmmaker: string;
  editor: string;
  designer: string;
  copywriter: string;
  social: string;
  outsider: string; // member allocated only to client B
  clientA: string;
  clientB: string;
  serviceFotona: string;
  formatReels: string;
  templateReels: string;
}

let slugSeq = 0;

export async function setupAgency(label = "Delta"): Promise<Agency> {
  const owner = await createUser(`${label} Owner`);
  const slug = `${label.toLowerCase()}-${Date.now().toString(36)}-${slugSeq++}`;
  const ws = await as(owner, (q) => rpc<string>(q, "create_workspace", [`Agência ${label}`, slug]));

  const [manager, filmmaker, editor, designer, copywriter, social, outsider] = await Promise.all(
    ["Gestora", "Filmmaker", "Editor", "Designer", "Copy", "Social", "Outsider"].map((n) => createUser(`${label} ${n}`)),
  );
  await invite(owner, ws, manager, ["manager"]);
  await invite(owner, ws, filmmaker, ["filmmaker"]);
  await invite(owner, ws, editor, ["editor"]);
  await invite(owner, ws, designer, ["designer"]);
  await invite(owner, ws, copywriter, ["copywriter"]);
  await invite(owner, ws, social, ["social_media"]);
  await invite(owner, ws, outsider, ["designer"]);

  const { clientA, clientB, serviceFotona } = await as(owner, async (q) => {
    const [a] = await q<{ id: string }>(
      "insert into clients (workspace_id, name, monthly_target, created_by) values ($1, 'Império Clinic', 12, $2) returning id",
      [ws, owner],
    );
    const [b] = await q<{ id: string }>(
      "insert into clients (workspace_id, name, monthly_target, created_by) values ($1, 'Outra Marca', 4, $2) returning id",
      [ws, owner],
    );
    const [s] = await q<{ id: string }>(
      "insert into client_services (workspace_id, client_id, name, color, monthly_target) values ($1, $2, 'Fotona', '#C6FF34', 5) returning id",
      [ws, a.id],
    );
    for (const u of [filmmaker, editor, designer, copywriter, social]) {
      await q("insert into client_members (workspace_id, client_id, user_id) values ($1, $2, $3)", [ws, a.id, u]);
    }
    await q("insert into client_members (workspace_id, client_id, user_id) values ($1, $2, $3)", [ws, b.id, outsider]);
    return { clientA: a.id, clientB: b.id, serviceFotona: s.id };
  });

  const { formatReels, templateReels } = await as(owner, async (q) => {
    const [f] = await q<{ id: string }>("select id from content_formats where workspace_id = $1 and key = 'reels'", [ws]);
    const [t] = await q<{ id: string }>("select id from content_templates where workspace_id = $1 and name = 'Reels padrão'", [ws]);
    return { formatReels: f.id, templateReels: t.id };
  });

  return {
    ws, owner, manager, filmmaker, editor, designer, copywriter, social, outsider,
    clientA, clientB, serviceFotona, formatReels, templateReels,
  };
}

export async function createReels(a: Agency, title = "Reels Fotona") {
  return as(a.manager, (q) =>
    rpc<string>(q, "create_content", [
      a.ws, a.clientA, a.formatReels, title,
      { template_id: a.templateReels, service_id: a.serviceFotona, planned_publish_at: new Date(Date.now() + 7 * 864e5).toISOString() },
      { script: a.copywriter, capture: a.filmmaker, edit: a.editor, cover: a.designer, caption: a.copywriter, review: a.manager },
    ]),
  );
}

export async function taskByStep(content: string, step: string) {
  return admin(async (q) =>
    (await q<{ id: string; status: string; assignee_id: string; deliverable_id: string | null }>(
      "select id, status, assignee_id, deliverable_id from tasks where content_id = $1 and step_key = $2 and kind <> 'adjustment'",
      [content, step],
    ))[0],
  );
}

export async function deliverableOf(content: string, kind: string) {
  return admin(async (q) =>
    (await q<{ id: string; current_version_id: string | null; approval_status: string }>(
      "select id, current_version_id, approval_status from deliverables where content_id = $1 and kind = $2",
      [content, kind],
    ))[0],
  );
}

/** Registers an uploaded object as a file asset owned by `uid`. */
export async function uploadAsset(uid: string, ws: string, client: string, name: string, mime: string, category = "edited_video") {
  return as(uid, async (q) => {
    const [r] = await q<{ id: string }>(
      `insert into file_assets (workspace_id, client_id, provider, storage_bucket, storage_path, name, mime_type, size_bytes, category, created_by)
       values ($1, $2, 'supabase', 'workspace-files', $3, $4, $5, 1048576, $6, $7) returning id`,
      [ws, client, `${ws}/${client}/${randomUUID()}/${name}`, name, mime, category, uid],
    );
    return r.id;
  });
}

/** Produces every deliverable and completes every production + review task. */
export async function produceAll(a: Agency, content: string) {
  const script = await taskByStep(content, "script");
  await as(a.copywriter, async (q) => {
    await rpc(q, "add_deliverable_version", [script.deliverable_id, "Roteiro: gancho + prova + CTA", [], null, null]);
    await rpc(q, "complete_task", [script.id]);
  });
  const capture = await taskByStep(content, "capture");
  const raw = await uploadAsset(a.filmmaker, a.ws, a.clientA, "bruto.mov", "video/quicktime", "raw");
  await as(a.filmmaker, async (q) => {
    await rpc(q, "add_deliverable_version", [capture.deliverable_id, null, [raw], null, null]);
    await rpc(q, "complete_task", [capture.id]);
  });
  const edit = await taskByStep(content, "edit");
  const video = await uploadAsset(a.editor, a.ws, a.clientA, "final.mp4", "video/mp4");
  await as(a.editor, async (q) => {
    await rpc(q, "add_deliverable_version", [edit.deliverable_id, null, [video], null, null]);
    await rpc(q, "complete_task", [edit.id]);
  });
  const cover = await taskByStep(content, "cover");
  const img = await uploadAsset(a.designer, a.ws, a.clientA, "capa.png", "image/png", "cover");
  await as(a.designer, async (q) => {
    await rpc(q, "add_deliverable_version", [cover.deliverable_id, null, [img], null, null]);
    await rpc(q, "complete_task", [cover.id]);
  });
  const caption = await taskByStep(content, "caption");
  await as(a.copywriter, async (q) => {
    await rpc(q, "add_deliverable_version", [caption.deliverable_id, "Legenda V1 com CTA para agendar avaliação.", [], null, null]);
    await rpc(q, "complete_task", [caption.id]);
  });
  const review = await taskByStep(content, "review");
  await as(a.manager, (q) => rpc(q, "complete_task", [review.id]));
}

export async function contentState(content: string) {
  return admin(async (q) =>
    (await q<{
      production_status: string; approval_status: string; publication_status: string; stage: string;
    }>("select production_status, approval_status, publication_status, stage from content_items where id = $1", [content]))[0],
  );
}

export async function openPortal(token: string, pin?: string) {
  const res = await asAnon((q) => rpc<{ ok: boolean; session?: string; error?: string }>(q, "portal_open", [token, pin ?? null]));
  return res;
}

export async function portalGet(token: string, session: string) {
  return asAnon((q) => rpc<PortalPayload>(q, "portal_get", [token, session]));
}

export interface PortalPayload {
  batch: { id: string; name: string };
  items: Array<{
    content_id: string;
    title: string;
    deliverables: Array<{
      deliverable_id: string;
      kind: string;
      version: { id: string; number: number; text: string | null; decidable: boolean; assets: unknown[] } | null;
      decision: { decision: string; comment: string | null } | null;
      history: Array<{ version: number; decision: string; comment: string | null }>;
    }>;
  }>;
}

export const key = () => `k-${randomUUID()}`;

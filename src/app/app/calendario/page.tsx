import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { contentFilters, contentSelect, listClientsLite, listFormats, listMembers, listServicesLite, parseFilters, thumbnails, type ContentRow } from "@/lib/data";
import { PageHeader } from "@/components/ui/primitives";
import { FilterBar } from "@/components/content/filter-bar";
import { CalendarMonth } from "@/components/calendar/calendar-month";

export const metadata: Metadata = { title: "Calendário editorial" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getContext();
  const raw = await searchParams;
  const f = parseFilters(contentFilters, raw);
  const ws = ctx.workspace.id;
  const sb = await createClient();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString();

  let q = sb.from("content_items").select(contentSelect).eq("workspace_id", ws).is("archived_at", null)
    .or(`planned_publish_at.is.null,and(planned_publish_at.gte.${from},planned_publish_at.lt.${to})`).limit(1000);
  if (f.cliente) q = q.eq("client_id", f.cliente);
  if (f.servico) q = q.eq("service_id", f.servico);
  if (f.formato) q = q.eq("format_id", f.formato);
  if (f.aprovacao) q = q.eq("approval_status", f.aprovacao);
  if (f.publicacao && f.publicacao !== "late") q = q.eq("publication_status", f.publicacao);
  const canal = typeof raw.canal === "string" && /^[a-z_]+$/.test(raw.canal) ? raw.canal : null;
  if (canal) q = q.eq("channel", canal);

  const [{ data }, clients, services, formats, members] = await Promise.all([q, listClientsLite(ws), listServicesLite(ws), listFormats(ws), listMembers(ws)]);
  const rows = (data ?? []) as unknown as ContentRow[];
  const thumb = await thumbnails(rows);

  // Captions (current version) for one-click copy.
  const ids = rows.map((r) => r.id);
  const { data: caps } = ids.length
    ? await sb.from("deliverables").select("content_id, deliverable_versions!deliverables_current_version_fk(text_content)").in("content_id", ids).eq("kind", "caption")
    : { data: [] };
  const caption = new Map((caps ?? []).map((c) => [c.content_id as string, ((c.deliverable_versions as unknown as { text_content: string | null } | null)?.text_content) ?? null]));

  return (
    <>
      <PageHeader title="Calendário editorial"
        description="Planejado é intenção; agendado exige registro do social media; publicado exige confirmação. Datas vencidas sem confirmação aparecem como atrasadas." />
      <FilterBar clients={clients} services={services} formats={formats}
        members={members.filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id, name: m.full_name }))}
        show={["cliente", "servico", "formato", "aprovacao", "publicacao"]} />
      <CalendarMonth canEdit={ctx.can("publications.manage") || ctx.can("contents.manage")}
        items={rows.filter((r) => !f.publicacao || f.publicacao !== "late" || (r.planned_publish_at && new Date(r.planned_publish_at) < now && !["published", "cancelled"].includes(r.publication_status)))
          .map((r) => ({
            id: r.id, code: r.code, title: r.title, client: r.clients?.name ?? "", at: r.scheduled_at ?? r.planned_publish_at,
            publication_status: r.publication_status, approval_status: r.approval_status, planned_publish_at: r.planned_publish_at,
            scheduled_at: r.scheduled_at, color: r.client_services?.color ?? null, thumb: thumb(r), channel: r.channel,
            format: r.content_formats?.name ?? "", caption: caption.get(r.id) ?? null,
          }))} />
    </>
  );
}

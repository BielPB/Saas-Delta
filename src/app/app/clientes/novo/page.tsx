import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "Novo cliente" };

export default async function NewClientPage() {
  await requirePermission("clients.manage");
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow={<Link href="/app/clientes" className="hover:text-fg">Clientes</Link>} title="Cadastrar cliente"
        description="Depois do cadastro você define serviços, metas e a equipe responsável." />
      <Panel><ClientForm /></Panel>
    </div>
  );
}

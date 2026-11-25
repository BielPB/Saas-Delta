import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { isConfigured } from "@/lib/env";
import { SetupRequired } from "@/components/setup-required";

export default async function Home() {
  if (!isConfigured()) return <SetupRequired />;
  const user = await getUser();
  redirect(user ? "/app" : "/entrar");
}

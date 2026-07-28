import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (!profile) redirect("/login");

  return (
    <main className="wrap">
      <h1>大厅</h1>
      <p className="hint">
        已登录：<span className="dot" /> {profile.username}
      </p>
    </main>
  );
}

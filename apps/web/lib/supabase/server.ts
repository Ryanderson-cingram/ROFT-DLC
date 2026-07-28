import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side client. Cookie writes only land from proxy.ts / route handlers. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          // Server Components cannot set cookies; proxy.ts refreshes instead.
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {}
        },
      },
    },
  );
}

import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { setSetting } from "@/lib/db";
import { audit } from "@/lib/assessment";

const Body = z.object({ access_code: z.string().max(100) });

/** Optional shared code candidates must enter on the public start page (empty = open link). */
export const POST = route(async (req, { actor }) => {
  const admin = requireAdminActor(actor);
  const { access_code } = Body.parse(await readJson(req));
  setSetting("access_code", access_code.trim());
  audit(admin, "set_access_code", "settings", null, { enabled: access_code.trim() !== "" });
  return json({ ok: true });
});

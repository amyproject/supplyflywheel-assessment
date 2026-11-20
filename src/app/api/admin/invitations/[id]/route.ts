import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { reissueInvitation, revokeInvitation } from "@/lib/assessment";

const Body = z.object({ action: z.enum(["reissue", "revoke"]) });

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const admin = requireAdminActor(actor);
  const b = Body.parse(await readJson(req));
  if (b.action === "revoke") {
    revokeInvitation(admin, params.id);
    return json({ ok: true });
  }
  const { url } = reissueInvitation(admin, params.id);
  return json({ ok: true, url });
});

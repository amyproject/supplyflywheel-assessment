import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { attemptDetail } from "@/lib/admin";
import { extendAttempt, reopenAttempt, resolveAccommodation, setArchived, setPasteAccommodation } from "@/lib/assessment";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => json(attemptDetail(requireAdminActor(actor), params.id)));

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reopen"), reason: z.string().min(1).max(500), extend_minutes: z.number().min(0).max(600).optional() }),
  z.object({ action: z.literal("extend"), reason: z.string().min(1).max(500), minutes: z.number().min(1).max(600) }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("unarchive") }),
  z.object({ action: z.literal("paste"), allowed: z.boolean(), request_id: z.string().max(80).optional() }),
  z.object({ action: z.literal("resolve_accommodation"), request_id: z.string().max(80), status: z.enum(["granted", "declined"]) }),
]);

export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const admin = requireAdminActor(actor);
  const b = Action.parse(await readJson(req));
  switch (b.action) {
    case "reopen":
      reopenAttempt(admin, params.id, b.reason, b.extend_minutes ?? 0);
      break;
    case "extend":
      extendAttempt(admin, params.id, b.minutes, b.reason);
      break;
    case "archive":
    case "unarchive":
      setArchived(admin, params.id, b.action === "archive");
      break;
    case "paste":
      setPasteAccommodation(admin, params.id, b.allowed, b.request_id);
      break;
    case "resolve_accommodation":
      resolveAccommodation(admin, params.id, b.request_id, b.status);
      break;
  }
  return json({ ok: true });
});

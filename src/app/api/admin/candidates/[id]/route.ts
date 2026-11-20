import { route, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { deleteCandidate } from "@/lib/admin";

export const DELETE = route<{ id: string }>(async (_req, { actor, params }) => json({ ok: true, ...deleteCandidate(requireAdminActor(actor), params.id) }));

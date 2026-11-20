import { route, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { candidateView } from "@/lib/assessment";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => json(candidateView(requireActor(actor), params.id)));

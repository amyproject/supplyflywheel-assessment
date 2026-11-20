import { route, json } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { submitAttempt } from "@/lib/assessment";

export const POST = route<{ id: string }>(async (_req, { actor, params }) => json(submitAttempt(requireActor(actor), params.id)));

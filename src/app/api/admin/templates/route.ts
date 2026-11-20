import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { publishTemplateSettings } from "@/lib/assessment";

const Body = z.object({
  recommended_minutes: z.number().min(10).max(600),
  overall_limit_minutes: z.number().min(10).max(720).nullable(),
  auto_submit_on_expiry: z.boolean(),
  copy_restriction_enabled: z.boolean(),
  paste_restriction_enabled: z.boolean(),
  allow_navigation: z.boolean(),
  soft_limit_minutes: z.number().min(1).max(60),
});

export const POST = route(async (req, { actor }) => {
  const admin = requireAdminActor(actor);
  const t = publishTemplateSettings(admin, Body.parse(await readJson(req)));
  return json({ id: t.id, version: t.version }, 201);
});

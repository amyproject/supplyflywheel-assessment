import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { createUser, findUserByEmail, requireSuperAdminActor } from "@/lib/auth";
import { audit } from "@/lib/assessment";
import { HttpError } from "@/lib/http";

const Body = z.object({ email: z.string().email().max(200), full_name: z.string().min(1).max(100), password: z.string().min(12).max(200), role: z.enum(["admin", "super_admin"]) });

export const POST = route(async (req, { actor }) => {
  const sa = requireSuperAdminActor(actor);
  const b = Body.parse(await readJson(req));
  if (findUserByEmail(b.email)) throw new HttpError(409, "conflict", "该邮箱已存在 / Email already exists");
  const u = createUser({ email: b.email, full_name: b.full_name, password: b.password, role: b.role });
  audit(sa, "create_admin", "user", u.id, { role: b.role, email: u.email });
  return json({ id: u.id }, 201);
});

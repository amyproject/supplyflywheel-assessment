import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { requireAdminActor } from "@/lib/auth";
import { createInvitation } from "@/lib/assessment";
import { sendEmail, escapeHtml } from "@/lib/mail";

const Body = z.object({ email: z.string().email().max(200), full_name: z.string().min(1).max(100), send_email: z.boolean().optional() });

export const POST = route(async (req, { actor }) => {
  const admin = requireAdminActor(actor);
  const b = Body.parse(await readJson(req));
  const { invitation, url } = createInvitation(admin, b);
  let emailed = false;
  if (b.send_email) {
    emailed = await sendEmail(
      invitation.email,
      "SupplyFlywheel 机器人供应链负责人测评邀请",
      `<p>${escapeHtml(invitation.full_name)}，您好：</p><p>SupplyFlywheel 邀请您参加「机器人供应链负责人」结构化案例测评（约90分钟）。</p><p><a href="${url}">${url}</a></p><p>链接14天内有效。</p>`,
    );
  }
  return json({ id: invitation.id, url, emailed }, 201);
});

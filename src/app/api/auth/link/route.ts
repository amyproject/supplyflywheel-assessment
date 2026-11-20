import { z } from "zod";
import { route, readJson, json } from "@/lib/api";
import { createLoginLink, findUserByEmail } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/mail";
import { HttpError } from "@/lib/http";

const Body = z.object({ email: z.string().email().max(200) });

/** Magic sign-in link. Always answers the same way so it can't be used to discover accounts. */
export const POST = route(async (req) => {
  const { email } = Body.parse(await readJson(req));
  if (!rateLimit(`link:${email.toLowerCase()}`, 3, 900)) throw new HttpError(429, "rate_limited", "请求过于频繁 / Too many requests");
  const u = findUserByEmail(email);
  let delivered = false;
  if (u && !u.disabled_at) {
    const token = createLoginLink(u.id);
    const url = `${config.appBaseUrl}/api/auth/link/${token}`;
    delivered = await sendEmail(u.email, "SupplyFlywheel 测评登录链接 / Sign-in link", `<p>点击登录（15分钟内有效）/ Sign in (valid 15 minutes):</p><p><a href="${url}">${url}</a></p>`);
    if (!delivered && process.env.NODE_ENV !== "production") console.info(`[dev] sign-in link for ${u.email}: ${url}`);
  }
  return json({ ok: true, email_configured: Boolean(config.resendKey && config.emailFrom) });
});

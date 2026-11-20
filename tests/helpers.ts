import { resetDbForTests } from "@/lib/db";
import { createUser, type Actor } from "@/lib/auth";
import { acceptInvitation, createInvitation, startAttempt } from "@/lib/assessment";

export function freshDb() {
  resetDbForTests();
}

export function makeAdmin(email = "admin@test.dev", role: "admin" | "super_admin" = "super_admin"): Actor {
  return createUser({ email, full_name: "Admin", password: "admin-password-123", role });
}

/** Invite → accept → start; returns the candidate and their attempt. */
export function makeCandidateWithAttempt(admin: Actor, email: string, consentRecording = true) {
  const { token, invitation } = createInvitation(admin, { email, full_name: email.split("@")[0] });
  const candidate = acceptInvitation(token, { actor: null, password: "candidate-password-1" });
  const attempt = startAttempt(candidate, { invitation_id: invitation.id, consent_terms: true, consent_recording: consentRecording });
  return { candidate, attempt, invitation };
}

export const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 1)]);

"use client";
export function SignOutButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="btn btn-quiet btn-sm"
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST" });
        window.location.href = "/auth/sign-in";
      }}
    >
      {label}
    </button>
  );
}

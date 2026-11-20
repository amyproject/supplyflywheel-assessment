import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[520px] px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">未找到页面</h1>
      <p className="mt-2 text-ink-2">Page not found, or you don&apos;t have access to it.</p>
      <Link href="/" className="btn btn-quiet mt-6">返回首页 / Home</Link>
    </main>
  );
}

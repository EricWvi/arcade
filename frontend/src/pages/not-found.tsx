import { Link } from "wouter";

export function NotFound({ message = "页面不存在" }: { message?: string }) {
  return (
    <main className="grid flex-1 place-items-center p-4 text-center">
      <div className="space-y-4">
        <p className="text-lg font-semibold">{message}</p>
        <Link href="/" className="inline-block rounded-full bg-pill px-5 py-1.5 text-sm font-bold text-accent">
          返回首页
        </Link>
      </div>
    </main>
  );
}

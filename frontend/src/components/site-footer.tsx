const columns = [
  { title: "关于", links: ["我们的故事", "隐私政策", "服务条款"] },
  { title: "帮助", links: ["常见问题", "使用指南", "联系支持"] },
  { title: "反馈", links: ["提交反馈", "游戏问题", "功能建议"] },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-surface text-xs text-muted">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-3 gap-6">
          {columns.map((c) => (
            <div key={c.title}>
              <h3 className="mb-3 font-semibold text-foreground">{c.title}</h3>
              <ul className="space-y-2">
                {c.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="hover:underline">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-8 border-t pt-4">© Arcade 经典 Flash 游戏</p>
      </div>
    </footer>
  );
}

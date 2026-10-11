import { RecentlyPlayed } from "@/components/recently-played";
import { Shelf } from "@/components/shelf";
import { SiteFooter } from "@/components/site-footer";
import { allShelves } from "@/data/home";
import { useCatalog } from "@/hooks/use-catalog";
import { useRecentPlays } from "@/hooks/use-recent-plays";

export function HomePage() {
  const catalog = useCatalog();
  const recent = useRecentPlays();
  return (
    <>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-10 px-4 pt-6 sm:px-6 lg:px-8">
        <RecentlyPlayed games={recent.data?.games} loading={recent.isPending} />
        {catalog.error && <p className="text-sm text-danger">{catalog.error.message}</p>}
        {/* Mock shelves wait for the catalogue so the configured ones never jump in above them. */}
        {!catalog.isPending && allShelves(catalog.data).map((s) => <Shelf key={s.id} shelf={s} />)}
      </main>
      <SiteFooter />
    </>
  );
}

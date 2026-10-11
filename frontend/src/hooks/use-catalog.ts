import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

/** games.yaml as served by the API; every page shares one cached copy. */
export const useCatalog = () => useQuery({ queryKey: ["catalog"], queryFn: api.catalog });

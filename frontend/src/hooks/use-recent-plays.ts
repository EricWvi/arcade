import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

/** The user's recently played games, refetched whenever the home page shows. */
export const useRecentPlays = () => useQuery({ queryKey: ["plays", "recent"], queryFn: api.recentPlays });

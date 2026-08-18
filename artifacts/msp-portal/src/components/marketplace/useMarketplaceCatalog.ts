import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import type { Product } from './types';

interface MarketplaceCatalogResponse {
  role: string | null;
  services: Product[];
}

/** Real, role-scoped catalog from GET /api/portal/marketplace/catalog (portal-marketplace.ts). */
export function useMarketplaceCatalog() {
  const { fetchWithAuth } = useAuth();

  return useQuery<Product[]>({
    queryKey: ['portal-marketplace-catalog'],
    queryFn: async () => {
      const res = await fetchWithAuth('/api/portal/marketplace/catalog');
      if (!res.ok) throw new Error('Failed to fetch marketplace catalog');
      const data: MarketplaceCatalogResponse = await res.json();
      return data.services;
    },
  });
}

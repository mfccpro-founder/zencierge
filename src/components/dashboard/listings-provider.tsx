"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { properties as seedProperties, type Property, type Reservation } from "@/lib/dashboard-data";
import {
  fetchListings,
  upsertReservation,
} from "@/lib/supabase-listings";

type ListingsContextValue = {
  properties: Property[];
  reservations: Reservation[];
  loading: boolean;
  error: string | null;
  saveProperty: (property: Property) => Promise<void>;
  applyHandbook: (propertyId: string, aiHandbook: string) => void;
  saveReservation: (reservation: Reservation) => Promise<void>;
};

const ListingsContext = createContext<ListingsContextValue | null>(null);

export function ListingsProvider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await fetchListings();
    setProperties(result.properties);
    setReservations(result.reservations);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        await refresh();
        if (!cancelled) setError(null);
      } catch (cause) {
        if (!cancelled) {
          const loft = seedProperties.find((property) => property.id === "prop-1") ?? seedProperties[0];
          setProperties([loft]);
          setReservations([]);
          setError(cause instanceof Error ? cause.message : "Could not reach Supabase");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const saveProperty = useCallback(async (property: Property) => {
    const response = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(property),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Could not save property");
    }
    await refresh();
    setError(null);
  }, [refresh]);

  const applyHandbook = useCallback((propertyId: string, aiHandbook: string) => {
    setProperties((current) =>
      current.map((property) =>
        property.id === propertyId ? { ...property, handbook: aiHandbook } : property,
      ),
    );
  }, []);

  const saveReservation = useCallback(async (reservation: Reservation) => {
    await upsertReservation(reservation);
    await refresh();
    setError(null);
  }, [refresh]);

  const value = useMemo(
    () => ({
      properties,
      reservations,
      loading,
      error,
      saveProperty,
      applyHandbook,
      saveReservation,
    }),
    [properties, reservations, loading, error, saveProperty, applyHandbook, saveReservation],
  );

  return <ListingsContext.Provider value={value}>{children}</ListingsContext.Provider>;
}

export function useListings() {
  const context = useContext(ListingsContext);
  if (!context) {
    throw new Error("useListings must be used inside ListingsProvider");
  }
  return context;
}

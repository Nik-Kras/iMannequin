// Live reads for the outfits, wear log, trips and settings screens.
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { Item, Outfit, Trip, WearEntry } from '../domain/types';

export function useOutfits(): Outfit[] | undefined {
  return useLiveQuery(() => db.outfits.orderBy('createdAt').reverse().toArray(), []);
}

export function useWear(): WearEntry[] | undefined {
  return useLiveQuery(() => db.wear.toArray(), []);
}

export function useTrips(): Trip[] | undefined {
  return useLiveQuery(() => db.trips.toArray(), []);
}

export function useTrip(id?: string): Trip | null | undefined {
  return useLiveQuery(async () => (id ? (await db.trips.get(id)) ?? null : null), [id]);
}

/** Every item that isn't waiting in To review, by id (outfits and logs can still point at archived pieces). */
export function useItemsById(): Map<string, Item> | undefined {
  const items = useLiveQuery(() => db.items.where('status').notEqual('review').toArray(), []);
  return useMemo(() => (items ? new Map(items.map((i) => [i.id, i])) : undefined), [items]);
}

export function useById<T extends { id: string }>(list: T[] | undefined): Map<string, T> {
  return useMemo(() => new Map((list ?? []).map((x) => [x.id, x])), [list]);
}

export function useActiveCount(): number | undefined {
  return useLiveQuery(() => db.items.where('status').equals('active').count(), []);
}

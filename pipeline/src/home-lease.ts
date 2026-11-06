// Only one home agent relays BBC and refreshes the snapshots at a time (issue #102). Every agent claims jobs (the store
// hands each out once), but the relay and the snapshots belong to whoever holds the lease. It's a lock in the store,
// renewed every check-in and good for LEASE_MS, so if the holder goes quiet another agent takes over within that.
// A preferred agent (the always-on Mac, --preferred) holds its own lock, which the others defer to while it is held:
// so the Mac takes the work back from the PC the moment it is up, and gives it to the PC only once it has gone quiet.

import { dropLock, type Store, takeLock } from './store.ts';

export const LEASE_MS = 120_000;
const PREFERRED = 'home-relay:preferred';
const ANY = 'home-relay';

/** True if this agent holds the relay and snapshots right now (renewing the lease), false if another does. */
export async function takeHomeLease(store: Store, holder: string, preferred: boolean, now: Date): Promise<boolean> {
  if (preferred) return takeLock(store, PREFERRED, holder, LEASE_MS, now);
  const [rows] = await store.batch([{ sql: 'SELECT holder FROM locks WHERE name = ? AND until > ?', params: [PREFERRED, now.toISOString()] }]);
  if (rows.length) return false;
  return takeLock(store, ANY, holder, LEASE_MS, now);
}

/** Going off: let go of the lease so another agent takes over at its next check-in, not after LEASE_MS. */
export async function dropHomeLease(store: Store, holder: string): Promise<void> {
  await dropLock(store, PREFERRED, holder);
  await dropLock(store, ANY, holder);
}

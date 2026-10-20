/**
 * Putting the tenancy and its back-office records together.
 *
 * Everything that renders a document, runs a check or talks to the assistant
 * should look at the *effective* details — the tenancy's own values merged over
 * what it inherits — rather than the sparse fields stored on the pack. This is
 * the one place that does the joining.
 */

import type { Pack, Store } from '../db.ts';
import type { BackOffice } from './entities.ts';
import { resolveFields, type ResolvedFields } from './inheritance.ts';

/** A tenancy plus the records it points at, and the merged result. */
export type TenancyContext = {
  pack: Pack;
  resolved: ResolvedFields;
};

export function contextFor(pack: Pack, backOffice: BackOffice): TenancyContext {
  const agency = backOffice.getSettings();
  const landlord = pack.landlordId === null ? null : backOffice.getLandlord(pack.landlordId);
  const property = pack.propertyId === null ? null : backOffice.getProperty(pack.propertyId);
  const room = pack.roomId === null ? null : backOffice.getRoom(pack.roomId);
  const tenant = pack.tenantId === null ? null : backOffice.getTenant(pack.tenantId);

  return {
    pack,
    resolved: resolveFields({
      tenancy: pack.fields,
      agency,
      landlord,
      property,
      room,
      tenant,
    }),
  };
}

/** The merged details for a pack — what documents are actually built from. */
export function effectiveFields(pack: Pack, backOffice: BackOffice): Record<string, unknown> {
  return contextFor(pack, backOffice).resolved.values;
}

/** Same, by pack id, for callers that only hold an id. */
export function effectiveFieldsById(store: Store, backOffice: BackOffice, packId: string): Record<string, unknown> {
  return effectiveFields(store.getPack(packId), backOffice);
}

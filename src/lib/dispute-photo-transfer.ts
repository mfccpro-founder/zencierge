export const DISPUTE_PHOTO_QUEUE_KEY = "zencierge.dispute.housekeepingPhotos";

export type HousekeepingDisputePhoto = {
  inspectionId: string;
  property: string;
  unit: string;
  propertyId: string;
  photoId: string;
  caption: string;
  takenAt: string;
  url: string;
};

export function queueHousekeepingPhotoForDispute(photo: HousekeepingDisputePhoto) {
  const existing = readHousekeepingPhotoQueue();
  const next = existing.filter((item) => item.photoId !== photo.photoId);
  next.push(photo);
  window.sessionStorage.setItem(DISPUTE_PHOTO_QUEUE_KEY, JSON.stringify(next));
}

export function consumeHousekeepingPhotoQueue(): HousekeepingDisputePhoto[] {
  const items = readHousekeepingPhotoQueue();
  window.sessionStorage.removeItem(DISPUTE_PHOTO_QUEUE_KEY);
  return items;
}

function readHousekeepingPhotoQueue(): HousekeepingDisputePhoto[] {
  try {
    const raw = window.sessionStorage.getItem(DISPUTE_PHOTO_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HousekeepingDisputePhoto[]) : [];
  } catch {
    return [];
  }
}

export function formatPhotoEvidenceLine(photo: HousekeepingDisputePhoto) {
  return `Housekeeping pre-clean (${photo.property} · unit ${photo.unit}) — ${photo.caption} · ${photo.takenAt} · ${photo.url}`;
}

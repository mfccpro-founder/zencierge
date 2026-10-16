# Saturday demo: fresh fictitious stay for every rehearsal

This procedure is for the isolated sandbox `ygipnetialejzuazfjcn`. It does not
delete or overwrite a prior rehearsal. Keep `STRIPE_SANDBOX_ACCESS_ENABLED=false`.

## Why a new stay is required

`guest_service_requests_one_towel_request_per_stay_uidx` permits one
`extra_towels` request per `reservation_id`. A replacement guest token for the
same reservation remains the same stay and therefore returns the existing
request. Each rehearsal needs a new reservation, stay token, proof task, photo,
and service-request ID.

## Preflight — stop on any failure

1. Confirm the running application points to `ygipnetialejzuazfjcn` and the
   authenticated account owns the chosen fictitious property.
2. Confirm the chosen property contains only fictitious demo content. Do not
   create another property for each run; the property may be reused.
3. Confirm the previous rehearsal remains visible as historical data. Do not
   delete, rename, or edit it for reuse.
4. Generate a new UUID locally for the reservation. Prefix its external ID with
   `sat-demo-`, for example `sat-demo-<UUID>`. Never reuse an ID, even after an
   interrupted rehearsal.

## Prepare one rehearsal through existing authenticated server routes

1. While signed in as the dedicated demo host, create a reservation using the
   existing `POST /api/reservations` flow. Use:
   - `id`: the new `sat-demo-<UUID>` value;
   - `propertyId`: the owned fictitious demo property;
   - `guest`: an explicitly fictitious label such as `Saturday Demo Guest`;
   - `platform`: `Direct`;
   - `status`: `staying`;
   - `checkIn`: today in the property's timezone;
   - `checkOut`: tomorrow (or later) in that timezone;
   - no real phone number, access code, or personal notes.
   The Calendar currently edits existing reservations but does not expose a
   create-reservation button. Until that UI exists, the operator can make the
   same authenticated request from the browser console on `localhost` (replace
   only the bracketed fictitious values):

   ```js
   const reservationId = `sat-demo-${crypto.randomUUID()}`;
   const response = await fetch("/api/reservations", {
     method: "POST",
     credentials: "same-origin",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       id: reservationId,
       propertyId: "[OWNED-FICTIONAL-PROPERTY-ID]",
       guest: "Saturday Demo Guest",
       phone: "",
       platform: "Direct",
       checkIn: "[TODAY-IN-PROPERTY-TIMEZONE]",
       checkOut: "[TOMORROW-IN-PROPERTY-TIMEZONE]",
       checkInTime: "00:00",
       checkOutTime: "23:59",
       accessCode: "",
       aiNotes: "Fictitious Saturday rehearsal",
       nights: 1,
       status: "staying",
     }),
   });
   console.log(response.status, await response.json());
   ```

   This uses the normal host session and the protected reservation RPC. It does
   not use the service-role key in the browser.
2. Require HTTP 200 and confirm the returned ID exactly matches the generated
   reservation ID. If creation or the subsequent listings refresh fails, stop.
3. In Properties → Secure guest QR, select that exact stay and generate its
   authorized guest link. A new reservation creates a new token scope. Do not
   regenerate a link for an older stay.
4. Open **Saturday demo**. Its start time prevents it from adopting an older
   towel request. On the phone, use only the newly generated link and request
   two towels.
5. At **Verify the towel request**, require the server confirmation before
   continuing. Record the displayed reservation label separately in the demo
   checklist; never copy the bearer token into notes.
6. Assign and start the request. Issue a new housekeeping proof task for the
   same reservation. Upload a new fictitious photo with a unique storage object;
   never select or relink a prior task or photo.
7. Submit the proof, verify it on the server, approve its photo, and approve the
   task. The request may complete only after those server transitions succeed.
8. Leave the reservation, token, request, task, and photo intact as an audit
   trail. Start the next rehearsal at step 4 of Preflight with another UUID.

## Abort rules

- An unexpected existing request for the new reservation means the ID was
  reused: stop and create another new reservation; do not delete the row.
- If the guest link is pending, expired, invalid, or points to another stay,
  stop. Do not weaken token checks.
- If the proof task or photo belongs to another reservation, stop. The database
  must reject the cross-stay link; do not broaden grants or constraints.
- A failed server read is not zero records and is not a successful demo step.

## Rehearsal ledger (non-secret)

For each run, record only: UTC start time, fictitious reservation ID, fictitious
property label, request ID, proof-task ID, final status, and PASS/FAIL. Do not
record guest-link tokens, credentials, access codes, or photo URLs.

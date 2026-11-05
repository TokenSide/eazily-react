# Eazily secure chat and messaging

This repository now contains one shared customer-to-partner messaging system for Service Partners, Influencers, and Consultants. It extends the existing `seller_messages` records and the existing `realtime_events` transport. It does not create a parallel demo chat, start bookings, alter prices, or trigger payments.

## Migration and dependencies

Use [migration-manifest.json](supabase/migration-manifest.json) for the authoritative sequence, including the final step 23 security repair, and [the staging runbook](docs/staging/RUNBOOK.md) before remote work.

`supabase/chat_messaging.sql` is database step 21. Apply it once after `supabase/realtime_events.sql` and before `supabase/background_automation.sql`. It depends on the existing Auth-linked profiles, partner applications/posts/orders, service requests/vendors, staff permissions, seller messages/order events, private Storage schema, and realtime event functions.

For a new database, keep the documented order in `REALTIME.md` and add:

21. `chat_messaging.sql`
22. `background_automation.sql`

On an existing database, inspect migration history and back up first. Apply only this missing additive migration after `realtime_events.sql`; do not rerun the older non-repeatable seller migrations. Nothing in this work has been deployed.

## Access rules

- A customer can start a profile conversation only from an approved partner application's published post. Repeating the action returns the existing context conversation.
- Either participant can open an existing order conversation. Every new `partner_order` receives one conversation automatically. Existing orders and old `seller_messages` are backfilled into one conversation per order.
- An assigned legacy service request can create one conversation between its customer and assigned vendor.
- Partners cannot discover customers or initiate a profile chat. They can reply only when their authenticated profile is the conversation's partner or when a valid assigned order already connects the accounts.
- Role-filtered partner inboxes expose only the authenticated account's Service Partner, Influencer, or Consultant conversations.
- Opening Consultant chat creates no order, does not start or reset an introduction, and does not start a paid session. Chat never changes payment state.
- An ordinary Admin role cannot read reports or messages. Staff need the explicit `chat.review` permission, an open report, a reason of at least ten characters, and a two-hour access grant. Grant and transcript view are audited. Support access remains read-only because send RPC membership still requires a participant.

The browser never supplies a sender ID. `send_chat_message` derives it from `auth.uid()`, checks participant membership, conversation/block state, message type, length, reply context, attachment ownership, and the configured 20-message-per-minute limit. Stable client operation UUIDs make retries idempotent.

## Data and row security

The migration adds:

- `chat_conversations`
- `chat_participant_state`
- `chat_attachments`
- `chat_reports`
- `chat_staff_access`
- `chat_staff_audit`
- `chat_configuration`

It extends `seller_messages` with conversation, message type, reply, attachment, server acceptance, and moderation fields. Participant reads use row-level security. Direct browser inserts are not granted; trusted RPCs perform all mutations. Unread counts compare server message timestamps with each participant's server read timestamp. Only an actually returned message ID can advance a participant's own read marker.

Editing and participant removal are unavailable because no approved edit/removal window or evidence policy exists. Server moderation can retain a row and display its `removed` state later without hard-deleting evidence.

## Private attachments

The migration creates the private `chat-attachments` bucket with a 10 MB limit. Accepted MIME types are JPG, PNG, WebP, and PDF. Paths must be:

`<conversation UUID>/<authenticated account UUID>/<operation UUID>.<approved extension>`

The client validates type and size, uploads once with a stable operation UUID, and calls `register_chat_attachment`. The server verifies MIME, extension, size, participant access, path ownership, and the confirmed Storage object before it can be sent. Message records store the object path, never a signed URL. The UI requests a new 300-second signed URL when rendering an attachment.

`mark_abandoned_chat_attachments()` can be run only by `service_role` (or a future scoped `chat.manage` worker) to mark unfinished uploads after the configured 24-hour grace period. A trusted scheduled backend must then delete the marked Storage objects through the Storage API. Malware scanning is not configured and `malware_scanning_enabled` remains false; production must add a scanning/quarantine service before claiming scanned files.

## Real-time behavior

A saved message emits one payload-free `messages` invalidation event for each participant. The envelope carries the conversation ID as `entity_id`; it contains no body, attachment, phone, booking detail, bank field, KYC field, or private price. The existing account channel receives it, batches and deduplicates event IDs, then the active inbox/thread reloads through the RLS-protected RPC. Block/report status changes notify both participants. Read/archive/mute changes notify only the account whose participant state changed.

The UI uses authoritative rows after every send. It shows Sending while the request is pending, Sent after server acceptance, Read only from the other participant's server read timestamp, and Failed with a same-operation retry. Drafts use account-and-conversation-scoped `sessionStorage`; message contents are never written to the realtime stream. The shared realtime provider removes its channels when account/workspace state is removed.

## Product integration

- Customer Messages uses `ChatWorkspace`; placeholder conversations were removed.
- Published provider sheets for all three partner types contain **Message Provider** and retain their existing booking actions.
- Customer booking details can open the linked secure conversation.
- All three partner Messages tabs use the same component with a server-enforced role filter.
- Bottom navigation unread badges come from `get_chat_unread_total`.
- Admin Support retains support tickets and adds a separate, restricted reported-chat review panel.

The conversation list supports permitted search, authoritative sorting, loading/error/empty states, 30-row pagination, unread counts, archive/mute, and context references. Threads support 40-message history pages, date separators, account-scoped drafts, retry, read state, private image/PDF previews, block/report controls, connection state, and the Eazily payment-safety reminder.

## Retention and missing production services

Final message/attachment retention, account-deletion export/anonymisation, legal-hold release, and user-data export rules have not been approved. `retention_days` is deliberately `NULL`, so this migration does not silently delete messages or dispute evidence. Existing foreign keys also prevent accidental participant deletion from silently erasing conversation evidence. A legal/operations policy and trusted backend jobs are required before retention or deletion is enabled.

External push, SMS, and email delivery are outside this task. Only in-app realtime invalidations and unread counts are implemented. No message text is sent to an external notification provider.

## Verification

- `npm run test:chat` applies the real migration sequence to PGlite and tests all three roles, profile and order contexts, idempotent start/send, no implicit booking, unread/read, archive recovery, block/unblock, report isolation, attachment RLS, unrelated-account rejection, normal-Admin rejection, audited support review, system messages, and payload-free realtime envelopes.
- `npm run lint` checks the React integration.
- `npm run build` creates the production bundle.

PGlite cannot prove hosted Supabase signed-URL expiry, Storage malware scanning, Postgres publication delivery latency, or two physical browser sessions. Those require an authorised local Supabase stack or sandbox with separate authenticated fixture accounts. This repository has no configured Supabase URL/key, so no remote writes, websocket journey, Storage download, or deployment was performed.

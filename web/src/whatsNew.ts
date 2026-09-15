// Pre-filled "what's new" text for the version-announcement e-mail (Settings screen).
//
// This is MAINTAINED BY CLAUDE: it always lists the user-facing changes made since the
// last GitHub push, in Dutch (the announcement e-mails are Dutch). Steven reviews/edits
// it in the textarea before pressing "Announce new version"; after a release the list is
// reset to the next batch of changes.
//
// One change per line, numbered. Leading numbers or bullets are optional — the mailer
// strips them and re-numbers the list so it always runs 1, 2, 3… in the e-mail.
export const WHATS_NEW_DEFAULT = `1. Deals zonder eigenaar of zonder bedrag worden nu rood gemarkeerd en tellen mee als aandachtspunt in het maandoverzicht.
2. Nieuw filter "(No owner)" in het maandoverzicht, zodat deals zonder accountmanager niet meer uit beeld vallen.
3. De links in "Raw HubSpot data" openen nu net als in het maandoverzicht: het HubSpot-icoon opent HubSpot, de dealnaam opent TerraFlow.
4. Nieuw: vanuit Instellingen kan een "nieuwe versie"-melding per e-mail naar het team worden gestuurd.`;

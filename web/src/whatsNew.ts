// Pre-filled "what's new" text for the version-announcement e-mail (Settings screen).
//
// This is MAINTAINED BY CLAUDE: it always lists the user-facing changes made since the
// last GitHub push, in Dutch (the announcement e-mails are Dutch). Steven reviews/edits
// it in the textarea before pressing "Announce new version"; after a release the list is
// reset to the next batch of changes.
//
// One change per line, numbered. Leading numbers or bullets are optional — the mailer
// strips them and re-numbers the list so it always runs 1, 2, 3… in the e-mail.
//
// RESET after each announcement: cleared to empty so the field starts blank (showing the
// placeholder). Claude adds the next batch of changes here as they are made.
export const WHATS_NEW_DEFAULT = ``;

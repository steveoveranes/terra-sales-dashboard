# Productie-database vullen met de ontwikkelgegevens

Deze map bevat een klein scriptje waarmee de **productie**-database dezelfde
door-de-gebruiker-ingestelde gegevens krijgt als ontwikkel: het **budget**, de
**locatieregels** (`country.rules.user`), de **TDJP-upside** en de overige
**instellingen**.

Bedoeld voor de **eerste deploy**, zodat productie meteen dezelfde cijfers toont
en zich hetzelfde gedraagt.

## Wat wordt er wél en niet meegenomen

**Wel** (staat in `seed-data.json`):

- Budget per maand (tabel `budgets`)
- Instellingen / regels / TDJP-upside (tabel `settings`)

**Niet** (komt vanzelf uit de HubSpot-sync, wordt met rust gelaten):

- Deals, pipelines, stages, owners

> Het script **verwijdert nooit iets** en raakt de deals niet aan. Het voegt de
> budget- en instellingsrijen toe of werkt ze bij (upsert). Meerdere keren
> draaien mag: het zet dan gewoon dezelfde waarden opnieuw.

## Stappen voor Niek (op de productieserver)

1. Deploy de nieuwe versie zoals altijd. `server/scripts/` (met dit script en
   `seed-data.json`) komt mee met de code.

2. Ga naar de `server`-map (waar `node_modules` met `pg` staat) en draai eerst
   een **proefdraai** (schrijft niets):

   ```bash
   cd server
   node scripts/seed-prod.cjs --dry-run
   ```

   Je ziet dan welke 12 budgetmaanden en welke instellingen ingeladen zouden
   worden. Klopt dat? Ga dan door.

3. Echt inladen:

   ```bash
   node scripts/seed-prod.cjs
   ```

4. Herlaad het dashboard (Ctrl+F5). Budget, regels en instellingen staan er nu.

## Database-verbinding

Het script gebruikt dezelfde `DATABASE_URL` als de app. Het zoekt die in deze
volgorde:

1. `--database-url "postgres://..."` als argument
2. omgevingsvariabele `DATABASE_URL`
3. een `DATABASE_URL=`-regel in de `.env` naast de server

Draai je het buiten de servermap, of wil je expliciet zijn:

```bash
node scripts/seed-prod.cjs --database-url "postgres://gebruiker:wachtwoord@host:5432/database"
```

## Snapshot opnieuw maken (optioneel, later)

`seed-data.json` is een momentopname uit ontwikkel. Wil je later een verse
snapshot maken (bijv. na budgetwijzigingen), draai dan op de **ontwikkelmachine**:

```bash
cd server
node scripts/export-dev.cjs
```

Dat leest de lokale `data.json` en schrijft een nieuwe `seed-data.json`. Daarna
weer committen/deployen en op productie `seed-prod.cjs` draaien.

-- What the club's player page says about each person (pipeline/src/playerdetails.ts), read once when they join the squad
-- list and editable from the admin squad list. JSON: { number, position, nationality, born, signed, debut, debutOn, apps,
-- goals, url, raw }. Dates are YYYY-MM-DD when the page gave a whole date; `raw` keeps the page's own words (it has typos).
ALTER TABLE entities ADD COLUMN details TEXT;

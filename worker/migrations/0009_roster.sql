-- The squad list is edited from the admin view (worker/src/admin.ts, /admin?roster). The club's own pages are the only
-- automatic source (pipeline/src/collectors/clubsite.ts); a row an admin has touched is `locked`, and the pipeline applies
-- it over the club page (pipeline/src/entities.ts): their spelling, aliases and active flag win. `added` marks a person
-- the admin put in who is not on the club's pages (a signing not yet listed), so the build never retires them for that.
ALTER TABLE entities ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entities ADD COLUMN added INTEGER NOT NULL DEFAULT 0;

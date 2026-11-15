// The apps a block holds records of (M-238 review): appKinds classifies each app from its newest records whatever days a
// request reads, so it finds an app's newest blocks by this list (the table's day order, read backwards) without opening
// every block's records. Kept by a trigger on every write of recs (a save, a merge restore, a deletion, a restore), so no
// path can leave it out of date; filled here for the blocks already saved.
export default /* sql */ `
ALTER TABLE health_records ADD COLUMN apps text[] NOT NULL DEFAULT '{}'::text[];
CREATE FUNCTION motus_health_records_apps() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.apps := ARRAY(SELECT DISTINCT x.r->>'o' FROM jsonb_each(NEW.recs) x(id, r) WHERE x.r->>'o' IS NOT NULL ORDER BY 1);
  RETURN NEW;
END $$;
CREATE TRIGGER health_records_apps BEFORE INSERT OR UPDATE OF recs ON health_records
  FOR EACH ROW EXECUTE FUNCTION motus_health_records_apps();
UPDATE health_records SET recs = recs;
`;

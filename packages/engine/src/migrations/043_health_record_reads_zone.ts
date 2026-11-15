// A type's read times are kept per zone (M-238 review): a read merges only with the reads of its own zone that it
// touches or overlaps, so a day is read whole in the zone it was read in (readDay), and a read in another zone (travel,
// a clock change) neither moves where an earlier read's days begin nor joins a window it doesn't touch. Two reads of
// different zones may now begin at the same second, hence the key.
export default /* sql */ `
ALTER TABLE health_record_reads DROP CONSTRAINT health_record_reads_pkey;
ALTER TABLE health_record_reads ADD PRIMARY KEY (user_id, type, zone, from_s);
`;

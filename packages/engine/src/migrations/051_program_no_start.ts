// A program may have no start date (M-288): it then starts with the first workout done from it after it was made.
export default /* sql */ `
ALTER TABLE programs ALTER COLUMN start_date DROP NOT NULL;
`;

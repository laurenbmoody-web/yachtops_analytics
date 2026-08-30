-- Which shelves a job's stock actually came off.
--
-- Consuming takes from the fullest location first, so two cartridges can come
-- off the engine room shelf while the bosun's store keeps its one. Reopening
-- the job has to undo exactly that. Without a record of where the stock came
-- from, the restore can only guess — it put everything back on the first
-- location in the list, quietly moving stock between shelves every time a job
-- was reopened, and the count per location drifted from what is really there.
--
-- Shape: [{ "locationName": "Engine room > Spares", "qty": 2 }]. Null on links
-- that have never been consumed, and on items that track no locations at all,
-- where the item's own total is the only number there is.

alter table public.job_links
  add column if not exists consumed_from jsonb;

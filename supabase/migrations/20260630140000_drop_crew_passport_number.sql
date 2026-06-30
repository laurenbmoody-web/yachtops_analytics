-- Revert: the passport / ID number is already captured on the uploaded passport
-- document (personal_documents.document_number) and surfaced read-only on the
-- profile. A separate crew_personal_details.passport_number duplicated it, so
-- drop the column — official-form exports read the document number instead.
alter table public.crew_personal_details drop column if exists passport_number;

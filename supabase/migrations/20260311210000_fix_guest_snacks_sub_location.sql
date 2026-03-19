-- Fix sub_location path mismatch: replace 'Guest Snacks' with 'Guest' in all inventory_items rows
-- This corrects items like Tig and Tignanello whose sub_location was saved as
-- 'Guest Snacks > Alcohol > Wine' but the folder is now navigated as 'Guest > Alcohol > Wine'

UPDATE public.inventory_items
SET sub_location = REPLACE(sub_location, 'Guest Snacks', 'Guest')
WHERE sub_location LIKE '%Guest Snacks%';

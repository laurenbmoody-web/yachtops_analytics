-- Delete Tig and Tignanello from inventory_items
DELETE FROM public.inventory_items
WHERE LOWER(name) IN ('tig', 'tignanello');

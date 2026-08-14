-- Chart of accounts — top up every existing tenant chart with the detail lines.
--
-- The standard chart grew from the 48 MYBA summary lines to 149: the summary lines
-- are unchanged (money is already filed against them) and the detail sits beneath
-- them, plus two sections the report never had — Charter Costs and Tenders & Toys.
--
-- A vessel that seeded its chart before today holds only the old 48 and would never
-- see the additions, so this backfills them. It is deliberately conservative:
--
--   * only tenants that ALREADY have a chart are touched — this does not seed a
--     chart onto a vessel that chose not to have one;
--   * a template line is skipped if the tenant already holds that CODE or that
--     bucket+label, so a line they renamed, re-coded or switched off is left alone
--     (and neither unique index can be violated);
--   * nothing is updated or deleted — insert only;
--   * sort_order is 1000 + template index, so the additions sort after whatever the
--     vessel already had. Their existing rows were numbered against the shorter
--     template, so a raw template index would scatter new lines through the old
--     ones; appending keeps each bucket's original head order with the detail
--     beneath it, which is exactly what a freshly seeded chart looks like.
--
-- Re-runnable: the NOT EXISTS guards make a second run a no-op.

with tpl (idx, bucket, code, category, kind) as (
  values
    (0, 'Revenue', 'NCR', 'Net Charter Revenue', 'revenue'),
    (1, 'Revenue', 'CRI', 'Charter Reimbursements', 'revenue'),
    (2, 'Revenue', 'OIN', 'Other Income', 'revenue'),
    (3, 'Revenue', 'APA', 'APA Received', 'revenue'),
    (4, 'Revenue', 'OWC', 'Owner Contributions', 'revenue'),
    (5, 'Revenue', 'IIN', 'Interest & Investment Income', 'revenue'),
    (6, 'Revenue', 'ICP', 'Insurance Claim Proceeds', 'revenue'),
    (7, 'Crew Cost', 'OCW', 'Officer & Crew Wages', 'expense'),
    (8, 'Crew Cost', 'CCW', 'Casual Crew Wages', 'expense'),
    (9, 'Crew Cost', 'CTE', 'Crew Travelling', 'expense'),
    (10, 'Crew Cost', 'CFC', 'Crew Food & Consumables', 'expense'),
    (11, 'Crew Cost', 'CUF', 'Crew Uniforms', 'expense'),
    (12, 'Crew Cost', 'MCC', 'Miscellaneous Crew Cost', 'expense'),
    (13, 'Crew Cost', 'CSC', 'Crew Social Charges & Payroll Taxes', 'expense'),
    (14, 'Crew Cost', 'CPS', 'Crew Payroll Service Fees', 'expense'),
    (15, 'Crew Cost', 'CRE', 'Crew Recruitment & Placement Fees', 'expense'),
    (16, 'Crew Cost', 'CTR', 'Crew Training & Certification', 'expense'),
    (17, 'Crew Cost', 'CMD', 'Crew Medical & Dental', 'expense'),
    (18, 'Crew Cost', 'CMI', 'Crew Medical & Travel Insurance', 'expense'),
    (19, 'Crew Cost', 'CRP', 'Crew Repatriation', 'expense'),
    (20, 'Crew Cost', 'CVI', 'Crew Visas & Seafarer Documentation', 'expense'),
    (21, 'Crew Cost', 'CAH', 'Crew Accommodation Ashore', 'expense'),
    (22, 'Crew Cost', 'CWF', 'Crew Welfare & Morale', 'expense'),
    (23, 'Crew Cost', 'CBO', 'Crew Bonuses & Gratuities', 'expense'),
    (24, 'Deck', 'DCN', 'Deck Consumables', 'expense'),
    (25, 'Deck', 'DSR', 'Deck Spares & Renewals', 'expense'),
    (26, 'Deck', 'DRM', 'Deck Repair & Maintenance', 'expense'),
    (27, 'Deck', 'DPT', 'Deck Paint & Varnish', 'expense'),
    (28, 'Deck', 'DTK', 'Teak Care & Renewal', 'expense'),
    (29, 'Deck', 'DRO', 'Ropes, Lines & Fenders', 'expense'),
    (30, 'Deck', 'DAN', 'Anchors, Chain & Mooring Gear', 'expense'),
    (31, 'Deck', 'DRG', 'Rigging, Davits & Cranes', 'expense'),
    (32, 'Deck', 'DCV', 'Covers, Canvas & Exterior Upholstery', 'expense'),
    (33, 'Deck', 'DTL', 'Deck Tools & Equipment', 'expense'),
    (34, 'Engineer', 'ECN', 'Engineer Consumables', 'expense'),
    (35, 'Engineer', 'ESR', 'Engineer Spares & Renewals', 'expense'),
    (36, 'Engineer', 'ERM', 'Engineer Repair & Maintenance', 'expense'),
    (37, 'Engineer', 'EME', 'Main Engines', 'expense'),
    (38, 'Engineer', 'EGE', 'Generators', 'expense'),
    (39, 'Engineer', 'EPR', 'Propulsion, Shafts & Propellers', 'expense'),
    (40, 'Engineer', 'EHY', 'Hydraulics & Stabilisers', 'expense'),
    (41, 'Engineer', 'EEL', 'Electrical Systems & Batteries', 'expense'),
    (42, 'Engineer', 'EHV', 'HVAC & Refrigeration', 'expense'),
    (43, 'Engineer', 'EWM', 'Watermakers', 'expense'),
    (44, 'Engineer', 'EPL', 'Plumbing & Sanitary Systems', 'expense'),
    (45, 'Engineer', 'ESW', 'Sewage & Waste Treatment Plant', 'expense'),
    (46, 'Engineer', 'EFL', 'Filters, Oils & Greases', 'expense'),
    (47, 'Engineer', 'ETL', 'Engineer Tools & Workshop', 'expense'),
    (48, 'Engineer', 'ECT', 'Engineering Contractors & Technicians', 'expense'),
    (49, 'Interior', 'ICN', 'Interior Consumables', 'expense'),
    (50, 'Interior', 'ISR', 'Interior Spares & Renewals', 'expense'),
    (51, 'Interior', 'IRM', 'Interior Repair & Maintenance', 'expense'),
    (52, 'Interior', 'ILN', 'Linen & Towels', 'expense'),
    (53, 'Interior', 'ILA', 'Laundry & Dry Cleaning', 'expense'),
    (54, 'Interior', 'ICH', 'Cleaning Chemicals & Materials', 'expense'),
    (55, 'Interior', 'IGL', 'Glassware, China & Cutlery', 'expense'),
    (56, 'Interior', 'IGE', 'Galley Equipment & Small Wares', 'expense'),
    (57, 'Interior', 'IUP', 'Soft Furnishings & Upholstery', 'expense'),
    (58, 'Interior', 'IDC', 'Interior Decor & Accessories', 'expense'),
    (59, 'Interior', 'IAM', 'Amenities & Toiletries', 'expense'),
    (60, 'Fuel', 'FLE', 'Fuel & Lube Oil', 'expense'),
    (61, 'Fuel', 'FLT', 'Tender Fuel', 'expense'),
    (62, 'Fuel', 'FBK', 'Bunkering Fees & Barge Charges', 'expense'),
    (63, 'Fuel', 'FAD', 'Fuel Additives & Treatment', 'expense'),
    (64, 'Fuel', 'FGS', 'LPG & Galley Gas', 'expense'),
    (65, 'Fuel', 'FVE', 'Vehicle & Shore Fuel', 'expense'),
    (66, 'Financial', 'MGE', 'Management Expenses', 'expense'),
    (67, 'Financial', 'PJT', 'Project Manager Fees', 'expense'),
    (68, 'Financial', 'INS', 'Insurance Premiums', 'expense'),
    (69, 'Financial', 'ADM', 'Administration', 'expense'),
    (70, 'Financial', 'IHM', 'Hull & Machinery Insurance', 'expense'),
    (71, 'Financial', 'IPI', 'P&I / Third Party Liability', 'expense'),
    (72, 'Financial', 'IWR', 'War Risk & Territorial Extensions', 'expense'),
    (73, 'Financial', 'ILB', 'Employer Liability & Crew Cover', 'expense'),
    (74, 'Financial', 'BNK', 'Bank Charges & Card Fees', 'expense'),
    (75, 'Financial', 'FXL', 'Foreign Exchange Differences', 'expense'),
    (76, 'Financial', 'ACC', 'Accountancy & Bookkeeping', 'expense'),
    (77, 'Financial', 'AUF', 'Audit Fees', 'expense'),
    (78, 'Financial', 'LEG', 'Legal & Professional Fees', 'expense'),
    (79, 'Financial', 'REG', 'Registry & Flag State Fees', 'expense'),
    (80, 'Financial', 'OSF', 'Corporate & Ownership Structure Fees', 'expense'),
    (81, 'Financial', 'ITF', 'Interest & Finance Charges', 'expense'),
    (82, 'Financial', 'DUT', 'Duties & Import Taxes', 'expense'),
    (83, 'Guest Costs', 'GFE', 'Guest Food Stock', 'expense'),
    (84, 'Guest Costs', 'GWS', 'Guest Wine Stock', 'expense'),
    (85, 'Guest Costs', 'GCT', 'Guest Travel / Car Hire', 'expense'),
    (86, 'Guest Costs', 'FLO', 'Guest Flowers', 'expense'),
    (87, 'Guest Costs', 'GME', 'Guest Miscellaneous', 'expense'),
    (88, 'Guest Costs', 'GBV', 'Guest Soft Drinks & Mixers', 'expense'),
    (89, 'Guest Costs', 'GTB', 'Guest Tobacco & Cigars', 'expense'),
    (90, 'Guest Costs', 'GLA', 'Guest Laundry & Dry Cleaning', 'expense'),
    (91, 'Guest Costs', 'GEX', 'Guest Excursions & Activities', 'expense'),
    (92, 'Guest Costs', 'GSP', 'Guest Spa, Salon & Wellness', 'expense'),
    (93, 'Guest Costs', 'GGF', 'Guest Gifts & Hospitality', 'expense'),
    (94, 'Guest Costs', 'GXS', 'Guest Extra Staff & Chef Hire', 'expense'),
    (95, 'Shipyard', 'SHY', 'Shipyard Annual Maintenance', 'expense'),
    (96, 'Shipyard', 'RFT', 'Refit (major shipyard / improvements)', 'expense'),
    (97, 'Shipyard', 'MCA', 'Marine Coastguard Agency', 'expense'),
    (98, 'Shipyard', 'DDK', 'Dry Dock & Haul Out', 'expense'),
    (99, 'Shipyard', 'AFL', 'Antifoul & Hull Coatings', 'expense'),
    (100, 'Shipyard', 'HUL', 'Hull Repair & Fairing', 'expense'),
    (101, 'Shipyard', 'SVY', 'Survey & Inspection', 'expense'),
    (102, 'Shipyard', 'SYS', 'Shipyard Subcontractors', 'expense'),
    (103, 'Shipyard', 'SYB', 'Yard Berthing & Services', 'expense'),
    (104, 'Shipyard', 'WIN', 'Winter Layup & Storage', 'expense'),
    (105, 'Shipyard', 'GRD', 'Guardianage', 'expense'),
    (106, 'General', 'LSF', 'Life Saving & Fire Fighting', 'expense'),
    (107, 'General', 'NAV', 'Navigation & Communication', 'expense'),
    (108, 'General', 'AUD', 'Audiovisual & Entertainment', 'expense'),
    (109, 'General', 'CAR', 'Transport', 'expense'),
    (110, 'General', 'HAR', 'Harbour Dues & Taxes', 'expense'),
    (111, 'General', 'SPW', 'Shore Power & Water', 'expense'),
    (112, 'General', 'COM', 'Communication Expenses', 'expense'),
    (113, 'General', 'CRT', 'Class & Certificates', 'expense'),
    (114, 'General', 'AGT', 'Agent Fees', 'expense'),
    (115, 'General', 'MSC', 'Miscellaneous Ship Cost', 'expense'),
    (116, 'General', 'CAP', 'Capital Purchases', 'expense'),
    (117, 'General', 'SET', 'Set Up Costs', 'expense'),
    (118, 'General', 'MKT', 'Marketing', 'expense'),
    (119, 'General', 'DOC', 'Dock Express', 'expense'),
    (120, 'General', 'FRG', 'Freight', 'expense'),
    (121, 'General', 'TAX', 'Charter VAT', 'expense'),
    (122, 'General', 'BRT', 'Berthing & Marina Contracts', 'expense'),
    (123, 'General', 'PIL', 'Pilotage & Towage', 'expense'),
    (124, 'General', 'CNL', 'Canal & Waterway Transit', 'expense'),
    (125, 'General', 'CUS', 'Customs, Clearance & Immigration', 'expense'),
    (126, 'General', 'WST', 'Waste, Sewage & Garbage Disposal', 'expense'),
    (127, 'General', 'ENV', 'Environmental Compliance & Fees', 'expense'),
    (128, 'General', 'SEC', 'Security & Anti-Piracy', 'expense'),
    (129, 'General', 'MED', 'Ship Medical Stores', 'expense'),
    (130, 'General', 'SFS', 'Safety Equipment Servicing', 'expense'),
    (131, 'General', 'CHP', 'Charts & Nautical Publications', 'expense'),
    (132, 'General', 'SAT', 'Satellite Airtime & Internet', 'expense'),
    (133, 'General', 'ITS', 'IT, Software & Subscriptions', 'expense'),
    (134, 'General', 'ISM', 'ISM / ISPS Compliance & Audits', 'expense'),
    (135, 'Charter Costs', 'CBC', 'Charter Broker Commission', 'expense'),
    (136, 'Charter Costs', 'CCC', 'Central Agency Commission', 'expense'),
    (137, 'Charter Costs', 'CDL', 'Charter Delivery & Redelivery', 'expense'),
    (138, 'Charter Costs', 'CPR', 'Charter Preparation Costs', 'expense'),
    (139, 'Charter Costs', 'CGT', 'Charter Gratuities', 'expense'),
    (140, 'Charter Costs', 'CLS', 'Charter Listing & Advertising', 'expense'),
    (141, 'Charter Costs', 'CIN', 'Charter Insurance Extension', 'expense'),
    (142, 'Tenders & Toys', 'TDC', 'Tender & Toy Consumables', 'expense'),
    (143, 'Tenders & Toys', 'TSR', 'Tender Spares & Renewals', 'expense'),
    (144, 'Tenders & Toys', 'TRM', 'Tender Repair & Maintenance', 'expense'),
    (145, 'Tenders & Toys', 'TOY', 'Water Toys & Inflatables', 'expense'),
    (146, 'Tenders & Toys', 'TDV', 'Diving Equipment & Compressor', 'expense'),
    (147, 'Tenders & Toys', 'TJS', 'Jet Ski & Seabob Servicing', 'expense'),
    (148, 'Tenders & Toys', 'TRI', 'Tender Registration & Insurance', 'expense')
),
charted as (select distinct tenant_id from public.chart_of_accounts)
insert into public.chart_of_accounts (tenant_id, bucket, code, category, kind, sort_order)
select c.tenant_id, t.bucket, t.code, t.category, t.kind, 1000 + t.idx
from charted c
cross join tpl t
where not exists (
        select 1 from public.chart_of_accounts x
        where x.tenant_id = c.tenant_id and x.code = t.code)
  and not exists (
        select 1 from public.chart_of_accounts x
        where x.tenant_id = c.tenant_id
          and x.bucket = t.bucket
          and lower(x.category) = lower(t.category));

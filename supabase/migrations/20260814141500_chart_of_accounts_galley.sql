-- Chart of accounts — give the galley its own section.
--
-- Galley is a department everywhere else in Cargo (authStorage.DEPARTMENTS, the
-- department scope picker, lineDetail's code → department map) but it was the one
-- department with no section in the chart: Deck, Engineer and Interior each had
-- one, and the chef's running cost was scattered across Interior.
--
-- This adds Galley, and moves the one line that plainly belonged there —
-- "Galley Equipment & Small Wares", added earlier today as Interior/IGE — onto the
-- Galley code GLE. That move is only safe because nothing is filed against it, and
-- the statement re-checks that rather than trusting it: if anything has been coded
-- to IGE since, the move is skipped and GLE is simply added alongside it. No line
-- with money against it moves, ever.
--
-- Provisions stay exactly where they are. Guest Food Stock (GFE), Guest Wine Stock
-- (GWS) and Crew Food & Consumables (CFC) carry live transactions and remain on
-- their MYBA lines; lineDetail already books them to the Galley department, which
-- is the right split — the galley SPENDS the food budget, it does not own it.
--
-- Ordering: the previous top-up appended new lines at 1000+, which cannot place a
-- whole new SECTION. A vessel's Interior lines were numbered 15-17 and its Fuel
-- lines 18-19, so there is no integer between them for Galley to occupy and it
-- would strand at the bottom of the picker below Tenders & Toys. So every line that
-- matches the template is renumbered to the template's own index. sort_order is
-- presentation only — no money hangs off it — and lines the vessel added itself
-- match no template line and keep their own order.
--
-- Three separate statements, not one with CTEs: a CTE reads the table as it was at
-- statement start, so the insert would not see the rename and would try to add a
-- second GLE.
--
-- Re-runnable: the insert is guarded on both unique keys and the renumber is a
-- no-op once applied.

create temporary table _chart_tpl (
  idx int, bucket text, code text, category text, kind text
);

insert into _chart_tpl (idx, bucket, code, category, kind) values
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
    (56, 'Interior', 'IUP', 'Soft Furnishings & Upholstery', 'expense'),
    (57, 'Interior', 'IDC', 'Interior Decor & Accessories', 'expense'),
    (58, 'Interior', 'IAM', 'Amenities & Toiletries', 'expense'),
    (59, 'Galley', 'GLC', 'Galley Consumables', 'expense'),
    (60, 'Galley', 'GLE', 'Galley Equipment & Small Wares', 'expense'),
    (61, 'Galley', 'GLS', 'Galley Spares & Renewals', 'expense'),
    (62, 'Galley', 'GLR', 'Galley Repair & Maintenance', 'expense'),
    (63, 'Galley', 'GLB', 'Coffee & Beverage Equipment', 'expense'),
    (64, 'Galley', 'GLH', 'Food Safety & HACCP', 'expense'),
    (65, 'Galley', 'GLP', 'Galley Hygiene & Pest Control', 'expense'),
    (66, 'Fuel', 'FLE', 'Fuel & Lube Oil', 'expense'),
    (67, 'Fuel', 'FLT', 'Tender Fuel', 'expense'),
    (68, 'Fuel', 'FBK', 'Bunkering Fees & Barge Charges', 'expense'),
    (69, 'Fuel', 'FAD', 'Fuel Additives & Treatment', 'expense'),
    (70, 'Fuel', 'FGS', 'LPG & Galley Gas', 'expense'),
    (71, 'Fuel', 'FVE', 'Vehicle & Shore Fuel', 'expense'),
    (72, 'Financial', 'MGE', 'Management Expenses', 'expense'),
    (73, 'Financial', 'PJT', 'Project Manager Fees', 'expense'),
    (74, 'Financial', 'INS', 'Insurance Premiums', 'expense'),
    (75, 'Financial', 'ADM', 'Administration', 'expense'),
    (76, 'Financial', 'IHM', 'Hull & Machinery Insurance', 'expense'),
    (77, 'Financial', 'IPI', 'P&I / Third Party Liability', 'expense'),
    (78, 'Financial', 'IWR', 'War Risk & Territorial Extensions', 'expense'),
    (79, 'Financial', 'ILB', 'Employer Liability & Crew Cover', 'expense'),
    (80, 'Financial', 'BNK', 'Bank Charges & Card Fees', 'expense'),
    (81, 'Financial', 'FXL', 'Foreign Exchange Differences', 'expense'),
    (82, 'Financial', 'ACC', 'Accountancy & Bookkeeping', 'expense'),
    (83, 'Financial', 'AUF', 'Audit Fees', 'expense'),
    (84, 'Financial', 'LEG', 'Legal & Professional Fees', 'expense'),
    (85, 'Financial', 'REG', 'Registry & Flag State Fees', 'expense'),
    (86, 'Financial', 'OSF', 'Corporate & Ownership Structure Fees', 'expense'),
    (87, 'Financial', 'ITF', 'Interest & Finance Charges', 'expense'),
    (88, 'Financial', 'DUT', 'Duties & Import Taxes', 'expense'),
    (89, 'Guest Costs', 'GFE', 'Guest Food Stock', 'expense'),
    (90, 'Guest Costs', 'GWS', 'Guest Wine Stock', 'expense'),
    (91, 'Guest Costs', 'GCT', 'Guest Travel / Car Hire', 'expense'),
    (92, 'Guest Costs', 'FLO', 'Guest Flowers', 'expense'),
    (93, 'Guest Costs', 'GME', 'Guest Miscellaneous', 'expense'),
    (94, 'Guest Costs', 'GBV', 'Guest Soft Drinks & Mixers', 'expense'),
    (95, 'Guest Costs', 'GTB', 'Guest Tobacco & Cigars', 'expense'),
    (96, 'Guest Costs', 'GLA', 'Guest Laundry & Dry Cleaning', 'expense'),
    (97, 'Guest Costs', 'GEX', 'Guest Excursions & Activities', 'expense'),
    (98, 'Guest Costs', 'GSP', 'Guest Spa, Salon & Wellness', 'expense'),
    (99, 'Guest Costs', 'GGF', 'Guest Gifts & Hospitality', 'expense'),
    (100, 'Guest Costs', 'GXS', 'Guest Extra Staff & Chef Hire', 'expense'),
    (101, 'Shipyard', 'SHY', 'Shipyard Annual Maintenance', 'expense'),
    (102, 'Shipyard', 'RFT', 'Refit (major shipyard / improvements)', 'expense'),
    (103, 'Shipyard', 'MCA', 'Marine Coastguard Agency', 'expense'),
    (104, 'Shipyard', 'DDK', 'Dry Dock & Haul Out', 'expense'),
    (105, 'Shipyard', 'AFL', 'Antifoul & Hull Coatings', 'expense'),
    (106, 'Shipyard', 'HUL', 'Hull Repair & Fairing', 'expense'),
    (107, 'Shipyard', 'SVY', 'Survey & Inspection', 'expense'),
    (108, 'Shipyard', 'SYS', 'Shipyard Subcontractors', 'expense'),
    (109, 'Shipyard', 'SYB', 'Yard Berthing & Services', 'expense'),
    (110, 'Shipyard', 'WIN', 'Winter Layup & Storage', 'expense'),
    (111, 'Shipyard', 'GRD', 'Guardianage', 'expense'),
    (112, 'General', 'LSF', 'Life Saving & Fire Fighting', 'expense'),
    (113, 'General', 'NAV', 'Navigation & Communication', 'expense'),
    (114, 'General', 'AUD', 'Audiovisual & Entertainment', 'expense'),
    (115, 'General', 'CAR', 'Transport', 'expense'),
    (116, 'General', 'HAR', 'Harbour Dues & Taxes', 'expense'),
    (117, 'General', 'SPW', 'Shore Power & Water', 'expense'),
    (118, 'General', 'COM', 'Communication Expenses', 'expense'),
    (119, 'General', 'CRT', 'Class & Certificates', 'expense'),
    (120, 'General', 'AGT', 'Agent Fees', 'expense'),
    (121, 'General', 'MSC', 'Miscellaneous Ship Cost', 'expense'),
    (122, 'General', 'CAP', 'Capital Purchases', 'expense'),
    (123, 'General', 'SET', 'Set Up Costs', 'expense'),
    (124, 'General', 'MKT', 'Marketing', 'expense'),
    (125, 'General', 'DOC', 'Dock Express', 'expense'),
    (126, 'General', 'FRG', 'Freight', 'expense'),
    (127, 'General', 'TAX', 'Charter VAT', 'expense'),
    (128, 'General', 'BRT', 'Berthing & Marina Contracts', 'expense'),
    (129, 'General', 'PIL', 'Pilotage & Towage', 'expense'),
    (130, 'General', 'CNL', 'Canal & Waterway Transit', 'expense'),
    (131, 'General', 'CUS', 'Customs, Clearance & Immigration', 'expense'),
    (132, 'General', 'WST', 'Waste, Sewage & Garbage Disposal', 'expense'),
    (133, 'General', 'ENV', 'Environmental Compliance & Fees', 'expense'),
    (134, 'General', 'SEC', 'Security & Anti-Piracy', 'expense'),
    (135, 'General', 'MED', 'Ship Medical Stores', 'expense'),
    (136, 'General', 'SFS', 'Safety Equipment Servicing', 'expense'),
    (137, 'General', 'CHP', 'Charts & Nautical Publications', 'expense'),
    (138, 'General', 'SAT', 'Satellite Airtime & Internet', 'expense'),
    (139, 'General', 'ITS', 'IT, Software & Subscriptions', 'expense'),
    (140, 'General', 'ISM', 'ISM / ISPS Compliance & Audits', 'expense'),
    (141, 'Charter Costs', 'CBC', 'Charter Broker Commission', 'expense'),
    (142, 'Charter Costs', 'CCC', 'Central Agency Commission', 'expense'),
    (143, 'Charter Costs', 'CDL', 'Charter Delivery & Redelivery', 'expense'),
    (144, 'Charter Costs', 'CPR', 'Charter Preparation Costs', 'expense'),
    (145, 'Charter Costs', 'CGT', 'Charter Gratuities', 'expense'),
    (146, 'Charter Costs', 'CLS', 'Charter Listing & Advertising', 'expense'),
    (147, 'Charter Costs', 'CIN', 'Charter Insurance Extension', 'expense'),
    (148, 'Tenders & Toys', 'TDC', 'Tender & Toy Consumables', 'expense'),
    (149, 'Tenders & Toys', 'TSR', 'Tender Spares & Renewals', 'expense'),
    (150, 'Tenders & Toys', 'TRM', 'Tender Repair & Maintenance', 'expense'),
    (151, 'Tenders & Toys', 'TOY', 'Water Toys & Inflatables', 'expense'),
    (152, 'Tenders & Toys', 'TDV', 'Diving Equipment & Compressor', 'expense'),
    (153, 'Tenders & Toys', 'TJS', 'Jet Ski & Seabob Servicing', 'expense'),
    (154, 'Tenders & Toys', 'TRI', 'Tender Registration & Insurance', 'expense');

-- 1 · retire the misplaced Interior/IGE line onto its Galley code, while unused.
update public.chart_of_accounts c
   set bucket = 'Galley', code = 'GLE'
 where c.code = 'IGE'
   and c.bucket = 'Interior'
   and c.category = 'Galley Equipment & Small Wares'
   and not exists (select 1 from public.ledger_transactions t
                    where t.tenant_id = c.tenant_id and t.category_code = 'IGE')
   and not exists (select 1 from public.budget_lines b where b.code = 'IGE')
   and not exists (select 1 from public.chart_of_accounts x
                    where x.tenant_id = c.tenant_id and x.code = 'GLE');

-- 2 · add whatever each charted tenant is missing, judged on BOTH unique keys.
insert into public.chart_of_accounts (tenant_id, bucket, code, category, kind, sort_order)
select c.tenant_id, t.bucket, t.code, t.category, t.kind, t.idx
from (select distinct tenant_id from public.chart_of_accounts) c
cross join _chart_tpl t
where not exists (
        select 1 from public.chart_of_accounts x
        where x.tenant_id = c.tenant_id and x.code = t.code)
  and not exists (
        select 1 from public.chart_of_accounts x
        where x.tenant_id = c.tenant_id
          and x.bucket = t.bucket
          and lower(x.category) = lower(t.category));

-- 3 · put every template line where the template says it goes.
update public.chart_of_accounts c
   set sort_order = t.idx
  from _chart_tpl t
 where (c.code = t.code
        or (c.bucket = t.bucket and lower(c.category) = lower(t.category)))
   and c.sort_order is distinct from t.idx;

drop table _chart_tpl;

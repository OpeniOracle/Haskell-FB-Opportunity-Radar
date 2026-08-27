-- Seed: reference vocabulary.
--
-- ADR 0008 puts the ontology in rows rather than CHECK constraints, so this is
-- data, not a migration. Adding a capability later is an INSERT and a review,
-- not a schema change and a deploy.
--
-- The nine signal families are the ones the v0.1 baseline hard-coded. They are
-- reproduced here as rows so `signals.signal_family` has a foreign key to point
-- at; the constraint was dropped in migration 0013.

insert into signal_families (code, label, description) values
    ('facility_capacity',        'Facility and capacity',        'New plants, expansions, lines, closures'),
    ('process_systems',          'Process systems',              'Processing, thermal, aseptic, CIP'),
    ('packaging_systems',        'Packaging systems',            'Filling, labelling, case packing, palletising'),
    ('automation_controls',      'Automation and controls',      'Controls, robotics, MES, warehouse automation'),
    ('food_safety_compliance',   'Food safety and compliance',   'Recalls, enforcement, audits, certification'),
    ('utilities_sustainability', 'Utilities and sustainability', 'Energy, water, refrigeration, emissions'),
    ('distribution_supply_chain','Distribution and supply chain','Cold chain, distribution centres, logistics'),
    ('corporate_capital',        'Corporate and capital',        'Capex, M&A, financing, restructuring'),
    ('market_demand',            'Market and demand',            'Category demand shifts and market structure')
on conflict (code) do update set
    label = excluded.label, description = excluded.description;

-- Event types. `signals.event_type` was free text with no vocabulary at all in
-- the baseline; 0013 gave it a foreign key.
insert into signal_event_types (code, label, signal_family_id, provisional)
select v.code, v.label, f.id, v.provisional
from (values
    ('new_facility_announced',      'New facility announced',          'facility_capacity',        false),
    ('facility_expansion',          'Facility expansion',              'facility_capacity',        false),
    ('production_line_added',       'Production line added',           'facility_capacity',        false),
    ('facility_closure',            'Facility closure',                'facility_capacity',        false),
    ('capacity_guidance',           'Capacity guidance',               'facility_capacity',        true),
    ('process_upgrade',             'Process system upgrade',          'process_systems',          false),
    ('aseptic_capability',          'Aseptic capability',              'process_systems',          false),
    ('packaging_line_investment',   'Packaging line investment',       'packaging_systems',        false),
    ('automation_investment',       'Automation investment',           'automation_controls',      false),
    ('warehouse_automation',        'Warehouse automation',            'automation_controls',      false),
    ('recall_issued',               'Recall issued',                   'food_safety_compliance',   false),
    ('regulatory_enforcement',      'Regulatory enforcement',          'food_safety_compliance',   false),
    ('establishment_registered',    'Establishment registered',        'food_safety_compliance',   false),
    ('energy_project',              'Energy project',                  'utilities_sustainability', false),
    ('water_project',               'Water project',                   'utilities_sustainability', false),
    ('refrigeration_project',       'Refrigeration project',           'utilities_sustainability', false),
    ('utility_load_study',          'Utility load study',              'utilities_sustainability', true),
    ('distribution_centre_project', 'Distribution centre project',     'distribution_supply_chain',false),
    ('cold_chain_investment',       'Cold chain investment',           'distribution_supply_chain',false),
    ('capital_expenditure_plan',    'Capital expenditure plan',        'corporate_capital',        false),
    ('acquisition_completed',       'Acquisition completed',           'corporate_capital',        false),
    ('divestiture_completed',       'Divestiture completed',           'corporate_capital',        false),
    ('restructuring_announced',     'Restructuring announced',         'corporate_capital',        false),
    ('special_purpose_entity_formation', 'Special purpose entity formation', 'corporate_capital',  true),
    ('plant_specific_hiring',       'Plant-specific hiring',           'facility_capacity',        true),
    ('supplier_equipment_announcement', 'Supplier equipment announcement', 'process_systems',      true),
    ('category_demand_shift',       'Category demand shift',           'market_demand',            false)
) as v(code, label, family, provisional)
join signal_families f on f.code = v.family
on conflict (code) do update set
    label = excluded.label, provisional = excluded.provisional;

insert into sectors (code, label, sort_order) values
    ('beverage', 'Beverage', 10),
    ('bottled_water', 'Bottled water', 11),
    ('dairy', 'Dairy', 20),
    ('protein', 'Protein', 30),
    ('snacks', 'Snacks', 40),
    ('confectionery', 'Confectionery', 50),
    ('food', 'Food, general', 60),
    ('retail', 'Grocery retail', 70),
    ('consumer_products', 'Consumer products', 80),
    ('pet_care', 'Pet care', 85),
    ('sanitation', 'Sanitation and hygiene', 90),
    ('water_treatment', 'Water treatment', 95),
    ('coatings', 'Coatings', 99)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into capabilities (code, label, sort_order) values
    ('process_systems', 'Process systems', 10),
    ('packaging_systems', 'Packaging systems', 20),
    ('automation_controls', 'Automation and controls', 30),
    ('facility_design_build', 'Facility design and build', 40),
    ('utilities_energy', 'Utilities and energy', 50),
    ('refrigeration_cold_chain', 'Refrigeration and cold chain', 60),
    ('water_wastewater', 'Water and wastewater', 70),
    ('material_handling', 'Material handling', 80)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

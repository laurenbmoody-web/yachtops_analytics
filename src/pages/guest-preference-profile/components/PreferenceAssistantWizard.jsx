import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { createPreference, getPreferencesByGuest, PreferenceCategory } from '../../../utils/preferencesStorage';
import { showToast } from '../../../utils/toast';

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 10;

// Key questions that count toward completion % (not optional notes)
const KEY_QUESTION_FIELDS = [
  'roleInGroup', 'charterStatus', 'crewFamiliarity', 'personalityProfile',
  'crewInteractionStyle', 'communicationStyle',
  'crewPresence', 'diningBreakfast', 'diningLunch', 'diningDinner', 'diningPace',
  'morningRoutine', 'breakfastTime', 'lateNightBehaviour',
  'coffeeMilkPref', 'coffeeFrequency',
  'favouriteMeals', 'foodPresentation', 'portionSize', 'spiceTolerance',
  'cabinTidiness', 'laundryExpectations', 'musicVolume',
  'energyLevel',
  'thingsToPrep',
  'overallGuestType', 'topThingOne'
];

const STEP_LABELS = [
  'Guest Identity',
  'Personality & Behaviour',
  'Service Style',
  'Daily Routine',
  'Beverage Behaviour',
  'Food Behaviour',
  'Cabin & Comfort',
  'Activities',
  'Repeat Visit Strategy',
  'Chief Stew Summary'
];

// ─── Time of Day Mapping ─────────────────────────────────────────────────────
const TIME_OF_DAY_MAP = {
  // Morning
  'Wake Up Time': 'morning',
  'Morning Routine': 'morning',
  'Breakfast Time': 'morning',
  'Coffee': 'morning',
  'Tea': 'morning',

  // Midday
  'Lunch Time': 'midday',
  'Favourite Meals': 'midday',
  'Favourite Cuisines': 'midday',
  'Favourite Snacks': 'midday',

  // Afternoon
  'Water Toys Used': 'afternoon',
  'Water Toys Avoided': 'afternoon',
  'Favourite Excursions': 'afternoon',
  'Repeated Activities': 'afternoon',
  'Activities to Pre-Plan': 'afternoon',
  'Energy Level': 'afternoon',
  'Favourite Spaces': 'afternoon',

  // Evening
  'Dinner Time': 'evening',
  'Dining Service Style': 'evening',
  'Dining Style': 'evening',
  'Dining Pace': 'evening',
  'Table Preferences': 'evening',
  'Wine': 'evening',
  'Wines to Stock': 'evening',
  'Cocktail': 'evening',
  'Spirits': 'evening',
  'Evening Drink': 'evening',
  'Food Presentation': 'evening',
  'Portion Size': 'evening',
  'Dessert Preferences': 'evening',

  // Night
  'Bed Time': 'night',
  'Late Night Behaviour': 'night',
  'Nap Habits': 'night',
  'Turn-Down Preferences': 'night',
  'Late Night Snacks': 'night',
  'Ambience': 'night',
  'Music': 'night',
  'Music Volume': 'night',
};

// ─── Dining Service Style Options ────────────────────────────────────────────
const DINING_SERVICE_STYLE_OPTIONS = [
  {
    value: 'american_plated',
    label: 'American (Plated)',
    tooltip: 'Food plated in the galley and served directly to guests.'
  },
  {
    value: 'english_silver_service',
    label: 'English / Silver Service',
    tooltip: 'Crew serves food from platters onto guest plates using service utensils.'
  },
  {
    value: 'russian_service',
    label: 'Russian Service',
    tooltip: 'Large platters presented tableside and portioned onto plates by crew.'
  },
  {
    value: 'butler_service',
    label: 'Butler Service',
    tooltip: 'Platters presented individually for guests to serve themselves.'
  },
  {
    value: 'family_style',
    label: 'Family Style',
    tooltip: 'Serving platters placed in the centre of the table for guests to share.'
  },
  {
    value: 'buffet',
    label: 'Buffet',
    tooltip: 'Food arranged on a buffet station for guests to serve themselves.'
  },
  {
    value: 'gueridon',
    label: 'Gueridon',
    tooltip: 'Food prepared, carved or finished tableside using a service cart.'
  },
  {
    value: 'french_service',
    label: 'French Service',
    tooltip: 'Multiple platters presented simultaneously for guests to serve themselves.'
  },
];

// ─── Meal rows for per-meal dining service style ──────────────────────────────
const MEAL_ROWS = [
  { key: 'diningBreakfast', label: 'Breakfast', optional: false },
  { key: 'diningLunch',     label: 'Lunch',     optional: false },
  { key: 'diningDinner',    label: 'Dinner',    optional: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getActiveTenantId = () =>
  localStorage.getItem('cargo_active_tenant_id') ||
  localStorage.getItem('cargo.currentTenantId') ||
  null;

const getCurrentUser = async () => {
  try {
    const { data: { session } } = await supabase?.auth?.getSession();
    return session?.user || null;
  } catch { return null; }
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const FieldLabel = ({ children, required = false }) => (
  <label className="block text-sm font-medium text-foreground mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

const SelectField = ({ label, value, onChange, options, required }) => (
  <div className="mb-4">
    <FieldLabel required={required}>{label}</FieldLabel>
    <div className="relative">
      <select
        value={value || ''}
        onChange={e => onChange(e?.target?.value)}
        className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
      >
        <option value="">Select an option...</option>
        {options?.map(opt => (
          <option key={opt?.value} value={opt?.value}>{opt?.label}</option>
        ))}
      </select>
      <Icon name="ChevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
    </div>
  </div>
);

const MultiSelectField = ({ label, value = [], onChange, options }) => (
  <div className="mb-4">
    <FieldLabel>{label}</FieldLabel>
    <div className="flex flex-wrap gap-2">
      {options?.map(opt => {
        const selected = value?.includes(opt?.value);
        return (
          <button
            key={opt?.value}
            type="button"
            onClick={() => {
              if (selected) {
                onChange(value?.filter(v => v !== opt?.value));
              } else {
                onChange([...(value || []), opt?.value]);
              }
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-foreground border-border hover:border-primary/50'
            }`}
          >
            {opt?.label}
          </button>
        );
      })}
    </div>
  </div>
);

const TextField = ({ label, value, onChange, placeholder, multiline = false }) => (
  <div className="mb-4">
    <FieldLabel>{label}</FieldLabel>
    {multiline ? (
      <textarea
        value={value || ''}
        onChange={e => onChange(e?.target?.value)}
        placeholder={placeholder || ''}
        rows={3}
        className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground resize-none"
      />
    ) : (
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e?.target?.value)}
        placeholder={placeholder || ''}
        className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground"
      />
    )}
  </div>
);

const TimeField = ({ label, value, onChange }) => (
  <div className="mb-4">
    <FieldLabel>{label}</FieldLabel>
    <input
      type="time"
      value={value || ''}
      onChange={e => onChange(e?.target?.value)}
      className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
    />
  </div>
);

// ─── Dining Service Style Field (per-meal) ────────────────────────────────────
const DiningServiceStyleField = ({ answers, setField }) => {
  const [openMeal, setOpenMeal] = useState(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef?.current && !dropdownRef?.current?.contains(e?.target)) {
        setOpenMeal(null);
        setActiveTooltip(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="mb-4" ref={dropdownRef}>
      <div className="space-y-3">
        {MEAL_ROWS?.map(meal => {
          const rawValue = answers?.[meal?.key];
          const selectedValue = rawValue || null;
          const selectedOpt = selectedValue
            ? DINING_SERVICE_STYLE_OPTIONS?.find(o => o?.value === selectedValue)
            : null;
          const isOpen = openMeal === meal?.key;

          return (
            <div key={meal?.key} className="flex items-center gap-3">
              {/* Meal label */}
              <div className="w-24 flex-shrink-0">
                <span className={`text-sm font-medium ${
                  meal?.optional ? 'text-muted-foreground' : 'text-foreground'
                }`}>
                  {meal?.label}
                  {meal?.optional && (
                    <span className="ml-1 text-xs text-muted-foreground/60">(optional)</span>
                  )}
                </span>
              </div>
              {/* Custom dropdown */}
              <div className="flex-1 relative">
                {/* Trigger button */}
                <button
                  type="button"
                  onClick={() => {
                    setOpenMeal(isOpen ? null : meal?.key);
                    setActiveTooltip(null);
                  }}
                  className="w-full flex items-center justify-between pl-3 pr-2.5 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-left text-foreground"
                >
                  <span style={{ color: selectedOpt ? 'var(--color-foreground)' : undefined }} className={selectedOpt ? 'text-foreground font-medium' : 'text-muted-foreground'}>
                    {selectedOpt ? selectedOpt?.label : 'Select service style...'}
                  </span>
                  <Icon name="ChevronDown" size={14} className={`text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown options */}
                {isOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                    {/* Clear option */}
                    <button
                      type="button"
                      onClick={() => {
                        setField(meal?.key, null);
                        setOpenMeal(null);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                      — None —
                    </button>
                    {DINING_SERVICE_STYLE_OPTIONS?.map(opt => {
                      const isSelected = selectedValue === opt?.value;
                      const tooltipKey = `${meal?.key}-${opt?.value}`;
                      const showTooltip = activeTooltip === tooltipKey;

                      return (
                        <div
                          key={opt?.value}
                          className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'
                          }`}
                          onClick={() => {
                            setField(meal?.key, opt?.value);
                            setOpenMeal(null);
                            setActiveTooltip(null);
                          }}
                        >
                          {/* Option label — clicking selects */}
                          <span className="text-sm flex-1 pr-2">{opt?.label}</span>

                          {/* Help icon — clicking does NOT select */}
                          <div className="relative flex-shrink-0">
                            <button
                              type="button"
                              onClick={e => {
                                e?.stopPropagation();
                                setActiveTooltip(showTooltip ? null : tooltipKey);
                              }}
                              onMouseEnter={() => setActiveTooltip(tooltipKey)}
                              onMouseLeave={() => setActiveTooltip(null)}
                              className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-primary/20 border-primary/40 text-primary hover:bg-primary/30' :'bg-muted border-border text-muted-foreground hover:text-foreground hover:bg-muted/80'
                              }`}
                              aria-label={`Help: ${opt?.label}`}
                            >
                              <span className="text-xs font-bold leading-none">?</span>
                            </button>

                            {/* Tooltip */}
                            {showTooltip && (
                              <div className="absolute top-full right-0 mb-2 z-[60] w-56 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 pointer-events-none">
                                <p className="text-xs text-gray-900 leading-relaxed">{opt?.tooltip}</p>
                                <div className="absolute top-full right-2 w-2 h-2 bg-white border-r border-b border-gray-200 rotate-45 -mt-1" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Preview pills - removed */}
    </div>
  );
};

// ─── Step Renderers ───────────────────────────────────────────────────────────

const Step1 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Capture the guest's role, charter history, and initial personality observations.</p>
    <SelectField
      label="Role in Group"
      required
      value={answers?.roleInGroup}
      onChange={v => setField('roleInGroup', v)}
      options={[
        { value: 'primary_guest', label: 'Primary guest' },
        { value: 'spouse_partner', label: 'Spouse / partner' },
        { value: 'child', label: 'Child' },
        { value: 'family_member', label: 'Family member' },
        { value: 'friend', label: 'Friend' },
        { value: 'business_associate', label: 'Business associate' },
      ]}
    />
    <SelectField
      label="First charter or repeat guest?"
      required
      value={answers?.charterStatus}
      onChange={v => setField('charterStatus', v)}
      options={[
        { value: 'first_time', label: 'First time guest' },
        { value: 'repeat_charter', label: 'Repeat charter guest' },
        { value: 'owner_family', label: 'Owner / owner family' },
      ]}
    />
    <SelectField
      label="Crew familiarity level"
      required
      value={answers?.crewFamiliarity}
      onChange={v => setField('crewFamiliarity', v)}
      options={[
        { value: 'does_not_know', label: 'Crew does not know guest' },
        { value: 'some_familiarity', label: 'Some familiarity' },
        { value: 'knows_well', label: 'Crew knows guest well' },
      ]}
    />
    <MultiSelectField
      label="Personality profile observed"
      value={answers?.personalityProfile}
      onChange={v => setField('personalityProfile', v)}
      options={[
        { value: 'very_private', label: 'Very private' },
        { value: 'social', label: 'Social' },
        { value: 'formal', label: 'Formal' },
        { value: 'relaxed', label: 'Relaxed' },
        { value: 'demanding', label: 'Demanding' },
        { value: 'easygoing', label: 'Easygoing' },
      ]}
    />
    <TextField
      label="Personality notes"
      value={answers?.personalityNotes}
      onChange={v => setField('personalityNotes', v)}
      placeholder="Any additional personality observations..."
      multiline
    />
  </div>
);

const Step2 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Understand how the guest prefers to interact with crew.</p>
    <SelectField
      label="Crew interaction style"
      required
      value={answers?.crewInteractionStyle}
      onChange={v => setField('crewInteractionStyle', v)}
      options={[
        { value: 'highly_attentive', label: 'Highly attentive service' },
        { value: 'discreet', label: 'Discreet / background service' },
        { value: 'friendly_casual', label: 'Friendly and casual' },
        { value: 'professional_formal', label: 'Professional and formal' },
      ]}
    />
    <SelectField
      label="Communication style"
      required
      value={answers?.communicationStyle}
      onChange={v => setField('communicationStyle', v)}
      options={[
        { value: 'direct', label: 'Direct communicator' },
        { value: 'indirect', label: 'Indirect / subtle' },
        { value: 'minimal', label: 'Minimal communication preferred' },
        { value: 'chatty', label: 'Chatty and social' },
      ]}
    />
    <TextField
      label="Crew interaction notes"
      value={answers?.crewInteractionNotes}
      onChange={v => setField('crewInteractionNotes', v)}
      placeholder="Any specific crew interaction observations..."
      multiline
    />
  </div>
);

const Step3 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Capture service preferences, dining service style, and table observations.</p>
    <SelectField
      label="Crew presence preference"
      required
      value={answers?.crewPresence}
      onChange={v => setField('crewPresence', v)}
      options={[
        { value: 'crew_visible', label: 'Crew visible' },
        { value: 'crew_discreet', label: 'Crew discreet / background' },
      ]}
    />
    {/* Dining Service Style — per-meal dropdowns */}
    <div className="mb-4">
      <p className="text-sm font-semibold text-foreground mb-3">Dining Service Style</p>
      <DiningServiceStyleField answers={answers} setField={setField} />
    </div>
    <SelectField
      label="Preferred dining pace"
      required
      value={answers?.diningPace}
      onChange={v => setField('diningPace', v)}
      options={[
        { value: 'fast', label: 'Fast meals' },
        { value: 'moderate', label: 'Moderate pace' },
        { value: 'long_relaxed', label: 'Long relaxed meals' },
      ]}
    />
    <TextField
      label="Table preferences observed"
      value={answers?.tablePreferences}
      onChange={v => setField('tablePreferences', v)}
      placeholder="Seating, table setup, etc..."
      multiline
    />
  </div>
);

const Step4 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Document the guest's daily schedule and routine habits.</p>
    <TimeField label="Wake up time" value={answers?.wakeUpTime} onChange={v => setField('wakeUpTime', v)} />
    <TextField
      label="Morning routine"
      value={answers?.morningRoutine}
      onChange={v => setField('morningRoutine', v)}
      placeholder="Describe typical morning activities..."
      multiline
    />
    <div className="grid grid-cols-3 gap-3">
      <TimeField label="Breakfast time" value={answers?.breakfastTime} onChange={v => setField('breakfastTime', v)} />
      <TimeField label="Lunch time" value={answers?.lunchTime} onChange={v => setField('lunchTime', v)} />
      <TimeField label="Dinner time" value={answers?.dinnerTime} onChange={v => setField('dinnerTime', v)} />
    </div>
    <SelectField
      label="Late night behaviour"
      required
      value={answers?.lateNightBehaviour}
      onChange={v => setField('lateNightBehaviour', v)}
      options={[
        { value: 'early_sleeper', label: 'Early sleeper' },
        { value: 'late_night_social', label: 'Late night social' },
        { value: 'late_night_snacker', label: 'Late night snacker' },
      ]}
    />
    <TextField
      label="Nap habits"
      value={answers?.napHabits}
      onChange={v => setField('napHabits', v)}
      placeholder="Does the guest nap? When?"
    />
    <TimeField label="Bed time" value={answers?.bedTime} onChange={v => setField('bedTime', v)} />
  </div>
);

const Step5 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Record beverage preferences and drinking habits.</p>
    <TextField
      label="Coffee milk preference"
      value={answers?.coffeeMilkPref}
      onChange={v => setField('coffeeMilkPref', v)}
      placeholder="e.g. oat milk, full fat, no milk..."
    />
    <SelectField
      label="Coffee frequency"
      required
      value={answers?.coffeeFrequency}
      onChange={v => setField('coffeeFrequency', v)}
      options={[
        { value: 'once_per_day', label: 'Once per day' },
        { value: 'several_per_day', label: 'Several per day' },
        { value: 'occasional', label: 'Occasional' },
      ]}
    />
    <TextField
      label="Favourite tea"
      value={answers?.favouriteTea}
      onChange={v => setField('favouriteTea', v)}
      placeholder="e.g. Earl Grey, green tea..."
    />
    <TextField
      label="Favourite evening drink"
      value={answers?.favouriteEveningDrink}
      onChange={v => setField('favouriteEveningDrink', v)}
      placeholder="e.g. Aperol Spritz, whisky..."
    />
    <TextField
      label="Typical cocktail order"
      value={answers?.typicalCocktail}
      onChange={v => setField('typicalCocktail', v)}
      placeholder="e.g. Negroni, Mojito..."
    />
    <TextField
      label="Favourite spirits"
      value={answers?.favouriteSpirits}
      onChange={v => setField('favouriteSpirits', v)}
      placeholder="e.g. Hendricks gin, Patron tequila..."
    />
    <TextField
      label="Favourite wines"
      value={answers?.favouriteWines}
      onChange={v => setField('favouriteWines', v)}
      placeholder="e.g. Sancerre, Barolo..."
    />
  </div>
);

const Step6 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Capture food preferences, dietary habits, and presentation style.</p>
    <TextField
      label="Favourite meals requested"
      value={answers?.favouriteMeals}
      onChange={v => setField('favouriteMeals', v)}
      placeholder="Specific dishes they love..."
      multiline
    />
    <TextField
      label="Favourite cuisines"
      value={answers?.favouriteCuisines}
      onChange={v => setField('favouriteCuisines', v)}
      placeholder="e.g. Italian, Japanese, Mediterranean..."
    />
    <TextField
      label="Favourite snacks"
      value={answers?.favouriteSnacks}
      onChange={v => setField('favouriteSnacks', v)}
      placeholder="e.g. nuts, fruit, cheese..."
    />
    <TextField
      label="Late night snacks"
      value={answers?.lateNightSnacks}
      onChange={v => setField('lateNightSnacks', v)}
      placeholder="e.g. crackers, chocolate..."
    />
    <TextField
      label="Dessert preferences"
      value={answers?.dessertPreferences}
      onChange={v => setField('dessertPreferences', v)}
      placeholder="e.g. chocolate fondant, fruit..."
    />
    <SelectField
      label="Food presentation preference"
      required
      value={answers?.foodPresentation}
      onChange={v => setField('foodPresentation', v)}
      options={[
        { value: 'elaborate', label: 'Elaborate / fine dining presentation' },
        { value: 'simple_clean', label: 'Simple and clean' },
        { value: 'rustic', label: 'Rustic / home style' },
      ]}
    />
    <SelectField
      label="Portion size preference"
      required
      value={answers?.portionSize}
      onChange={v => setField('portionSize', v)}
      options={[
        { value: 'small', label: 'Small portions' },
        { value: 'medium', label: 'Medium portions' },
        { value: 'large', label: 'Large portions' },
      ]}
    />
    <SelectField
      label="Spice tolerance"
      required
      value={answers?.spiceTolerance}
      onChange={v => setField('spiceTolerance', v)}
      options={[
        { value: 'none', label: 'No spice' },
        { value: 'mild', label: 'Mild spice' },
        { value: 'medium', label: 'Medium spice' },
        { value: 'hot', label: 'Hot / spicy' },
      ]}
    />
  </div>
);

const Step7 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Capture cabin preferences and comfort requirements.</p>
    <SelectField
      label="Cabin tidiness expectation"
      required
      value={answers?.cabinTidiness}
      onChange={v => setField('cabinTidiness', v)}
      options={[
        { value: 'immaculate', label: 'Immaculate at all times' },
        { value: 'tidy_daily', label: 'Tidy once daily' },
        { value: 'minimal_intrusion', label: 'Minimal intrusion' },
      ]}
    />
    <SelectField
      label="Laundry expectations"
      required
      value={answers?.laundryExpectations}
      onChange={v => setField('laundryExpectations', v)}
      options={[
        { value: 'same_day', label: 'Same day turnaround' },
        { value: 'next_day', label: 'Next day' },
        { value: 'as_needed', label: 'As needed' },
      ]}
    />
    <TextField
      label="Bathroom products"
      value={answers?.bathroomProducts}
      onChange={v => setField('bathroomProducts', v)}
      placeholder="Preferred brands or products..."
    />
    <MultiSelectField
      label="Favourite spaces on board"
      value={answers?.favouriteSpaces}
      onChange={v => setField('favouriteSpaces', v)}
      options={[
        { value: 'sun_deck', label: 'Sun deck' },
        { value: 'main_salon', label: 'Main salon' },
        { value: 'bow', label: 'Bow' },
        { value: 'flybridge', label: 'Flybridge' },
        { value: 'beach_club', label: 'Beach club' },
        { value: 'cabin', label: 'Cabin' },
      ]}
    />
    <TextField
      label="Cabin temperature preference"
      value={answers?.cabinTemperature}
      onChange={v => setField('cabinTemperature', v)}
      placeholder="e.g. cool, warm, 20°C..."
    />
    <TextField
      label="Pillow preference"
      value={answers?.pillowPreference}
      onChange={v => setField('pillowPreference', v)}
      placeholder="e.g. firm, soft, extra pillows..."
    />
    <TextField
      label="Turn-down preferences"
      value={answers?.turnDownPreferences}
      onChange={v => setField('turnDownPreferences', v)}
      placeholder="e.g. chocolates, specific music..."
    />
    <TextField
      label="Music requested"
      value={answers?.musicRequested}
      onChange={v => setField('musicRequested', v)}
      placeholder="e.g. jazz, classical, no music..."
    />
    <SelectField
      label="Music volume preference"
      required
      value={answers?.musicVolume}
      onChange={v => setField('musicVolume', v)}
      options={[
        { value: 'silent', label: 'Silent / no music' },
        { value: 'background', label: 'Background level' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'loud', label: 'Loud' },
      ]}
    />
    <TextField
      label="Ambience preference"
      value={answers?.ambiencePreference}
      onChange={v => setField('ambiencePreference', v)}
      placeholder="e.g. candles, dim lighting, fresh flowers..."
    />
  </div>
);

const Step8 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Record activity preferences and energy levels.</p>
    <TextField
      label="Water toys used"
      value={answers?.waterToysUsed}
      onChange={v => setField('waterToysUsed', v)}
      placeholder="e.g. jet ski, paddleboard, snorkelling..."
    />
    <TextField
      label="Water toys avoided"
      value={answers?.waterToysIgnored}
      onChange={v => setField('waterToysIgnored', v)}
      placeholder="e.g. banana boat, parasailing..."
    />
    <TextField
      label="Favourite excursions"
      value={answers?.favouriteExcursions}
      onChange={v => setField('favouriteExcursions', v)}
      placeholder="e.g. local markets, hiking, restaurants..."
    />
    <TextField
      label="Repeated activities"
      value={answers?.repeatedActivities}
      onChange={v => setField('repeatedActivities', v)}
      placeholder="Activities they always request..."
    />
    <SelectField
      label="Energy level"
      required
      value={answers?.energyLevel}
      onChange={v => setField('energyLevel', v)}
      options={[
        { value: 'very_active', label: 'Very active' },
        { value: 'moderately_active', label: 'Moderately active' },
        { value: 'relaxed', label: 'Relaxed / low energy' },
      ]}
    />
  </div>
);

const Step9 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Plan ahead for the guest's next visit.</p>
    <TextField
      label="Things to prepare for next visit"
      value={answers?.thingsToPrep}
      onChange={v => setField('thingsToPrep', v)}
      placeholder="Special preparations, surprises, etc..."
      multiline
    />
    <TextField
      label="Wines to stock"
      value={answers?.winesToStock}
      onChange={v => setField('winesToStock', v)}
      placeholder="Specific wines to have on board..."
    />
    <TextField
      label="Snacks to pre-order"
      value={answers?.snacksToPreOrder}
      onChange={v => setField('snacksToPreOrder', v)}
      placeholder="Specific snacks to have ready..."
    />
    <TextField
      label="Activities to pre-plan"
      value={answers?.activitiesToPrePlan}
      onChange={v => setField('activitiesToPrePlan', v)}
      placeholder="Bookings or arrangements to make..."
    />
    <TextField
      label="Cabin setup preferences for next visit"
      value={answers?.cabinSetupPreferences}
      onChange={v => setField('cabinSetupPreferences', v)}
      placeholder="Specific cabin arrangements..."
    />
  </div>
);

const Step10 = ({ answers, setField }) => (
  <div>
    <p className="text-sm text-muted-foreground mb-5">Summarise the guest for the Chief Stew briefing.</p>
    <SelectField
      label="Overall guest type"
      required
      value={answers?.overallGuestType}
      onChange={v => setField('overallGuestType', v)}
      options={[
        { value: 'vip_formal', label: 'VIP / formal' },
        { value: 'family_relaxed', label: 'Family / relaxed' },
        { value: 'party_social', label: 'Party / social' },
        { value: 'private_quiet', label: 'Private / quiet' },
        { value: 'adventurous', label: 'Adventurous' },
      ]}
    />
    <TextField
      label="Top thing to remember (1)"
      value={answers?.topThingOne}
      onChange={v => setField('topThingOne', v)}
      placeholder="Most important thing crew must know..."
    />
    <TextField
      label="Top thing to remember (2)"
      value={answers?.topThingTwo}
      onChange={v => setField('topThingTwo', v)}
      placeholder="Second most important thing..."
    />
    <TextField
      label="Top thing to remember (3)"
      value={answers?.topThingThree}
      onChange={v => setField('topThingThree', v)}
      placeholder="Third most important thing..."
    />
    <TextField
      label="Chief Stew summary notes"
      value={answers?.additionalSummary}
      onChange={v => setField('additionalSummary', v)}
      placeholder="Any additional notes for the Chief Stew..."
      multiline
    />
  </div>
);

const STEP_COMPONENTS = [Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8, Step9, Step10];

// ─── Build preferences from wizard answers ────────────────────────────────────
const buildPreferencesToCreate = (answers) => {
  const prefs = [];

  const add = (category, key, value, tags, prefType = 'preference') => {
    if (!value || (Array.isArray(value) && value?.length === 0)) return;
    const displayValue = Array.isArray(value) ? value?.join(', ') : String(value)?.trim();
    const timeOfDay = TIME_OF_DAY_MAP?.[key] || null;
    prefs?.push({ category, key, value: displayValue, tags, prefType, confidence: 'observed', timeOfDay });
  };

  // Step 1 — Service Information
  if (answers?.crewFamiliarity) add(PreferenceCategory?.SERVICE, 'Crew Familiarity', answers?.crewFamiliarity, ['service']);
  if (answers?.personalityProfile?.length) add(PreferenceCategory?.SERVICE, 'Personality Profile', answers?.personalityProfile, ['service']);
  if (answers?.personalityNotes) add(PreferenceCategory?.SERVICE, 'Personality Notes', answers?.personalityNotes, ['service']);

  // Step 2 — Service Information
  if (answers?.crewInteractionStyle) add(PreferenceCategory?.SERVICE, 'Crew Interaction Style', answers?.crewInteractionStyle, ['service']);
  if (answers?.communicationStyle) add(PreferenceCategory?.SERVICE, 'Communication Style', answers?.communicationStyle, ['service']);
  if (answers?.crewInteractionNotes) add(PreferenceCategory?.SERVICE, 'Crew Interaction Notes', answers?.crewInteractionNotes, ['service']);

  // Step 3 — Service Information
  if (answers?.crewPresence) add(PreferenceCategory?.SERVICE, 'Crew Presence Preference', answers?.crewPresence, ['service']);

  // Dining Service Style — one entry per meal, format: "Buffet (Breakfast)"
  MEAL_ROWS?.forEach(meal => {
    const styleVal = answers?.[meal?.key];
    if (styleVal) {
      const styleLabel = DINING_SERVICE_STYLE_OPTIONS?.find(o => o?.value === styleVal)?.label || styleVal;
      add(PreferenceCategory?.SERVICE, 'Dining Service Style', `${styleLabel} (${meal?.label})`, ['service', 'dining']);
    }
  });

  if (answers?.diningPace) add(PreferenceCategory?.SERVICE, 'Dining Pace', answers?.diningPace, ['service']);
  if (answers?.tablePreferences) add(PreferenceCategory?.SERVICE, 'Table Preferences', answers?.tablePreferences, ['service']);

  // Step 4 — Routine
  if (answers?.wakeUpTime) add(PreferenceCategory?.ROUTINE, 'Wake Up Time', answers?.wakeUpTime, ['routine']);
  if (answers?.morningRoutine) add(PreferenceCategory?.ROUTINE, 'Morning Routine', answers?.morningRoutine, ['routine']);
  if (answers?.breakfastTime) add(PreferenceCategory?.ROUTINE, 'Breakfast Time', answers?.breakfastTime, ['routine']);
  if (answers?.lunchTime) add(PreferenceCategory?.ROUTINE, 'Lunch Time', answers?.lunchTime, ['routine']);
  if (answers?.dinnerTime) add(PreferenceCategory?.ROUTINE, 'Dinner Time', answers?.dinnerTime, ['routine']);
  if (answers?.lateNightBehaviour) add(PreferenceCategory?.ROUTINE, 'Late Night Behaviour', answers?.lateNightBehaviour, ['routine']);
  if (answers?.napHabits) add(PreferenceCategory?.ROUTINE, 'Nap Habits', answers?.napHabits, ['routine']);
  if (answers?.bedTime) add(PreferenceCategory?.ROUTINE, 'Bed Time', answers?.bedTime, ['routine']);

  // Step 5 — Food & Drink
  if (answers?.coffeeMilkPref) add(PreferenceCategory?.FOOD_BEVERAGE, 'Coffee', `Milk: ${answers?.coffeeMilkPref}${answers?.coffeeFrequency ? ` | Frequency: ${answers?.coffeeFrequency}` : ''}`, ['coffee']);
  if (answers?.favouriteTea) add(PreferenceCategory?.FOOD_BEVERAGE, 'Tea', answers?.favouriteTea, ['tea']);
  if (answers?.favouriteEveningDrink) add(PreferenceCategory?.FOOD_BEVERAGE, 'Evening Drink', answers?.favouriteEveningDrink, ['drink']);
  if (answers?.typicalCocktail) add(PreferenceCategory?.FOOD_BEVERAGE, 'Cocktail', answers?.typicalCocktail, ['cocktail']);
  if (answers?.favouriteSpirits) add(PreferenceCategory?.FOOD_BEVERAGE, 'Spirits', answers?.favouriteSpirits, ['spirit']);
  if (answers?.favouriteWines) add(PreferenceCategory?.FOOD_BEVERAGE, 'Wine', answers?.favouriteWines, ['wine']);

  // Step 6 — Food & Drink
  if (answers?.favouriteMeals) add(PreferenceCategory?.FOOD_BEVERAGE, 'Favourite Meals', answers?.favouriteMeals, ['galley']);
  if (answers?.favouriteCuisines) add(PreferenceCategory?.FOOD_BEVERAGE, 'Favourite Cuisines', answers?.favouriteCuisines, ['galley']);
  if (answers?.favouriteSnacks) add(PreferenceCategory?.FOOD_BEVERAGE, 'Favourite Snacks', answers?.favouriteSnacks, ['snack']);
  if (answers?.lateNightSnacks) add(PreferenceCategory?.FOOD_BEVERAGE, 'Late Night Snacks', answers?.lateNightSnacks, ['snack']);
  if (answers?.dessertPreferences) add(PreferenceCategory?.FOOD_BEVERAGE, 'Dessert Preferences', answers?.dessertPreferences, ['galley']);
  if (answers?.foodPresentation) add(PreferenceCategory?.SERVICE, 'Food Presentation', answers?.foodPresentation, ['service']);
  if (answers?.portionSize) add(PreferenceCategory?.SERVICE, 'Portion Size', answers?.portionSize, ['service']);
  // Spice tolerance routing
  if (answers?.spiceTolerance) {
    if (answers?.spiceTolerance === 'none' || answers?.spiceTolerance === 'mild') {
      add(PreferenceCategory?.FOOD_BEVERAGE, 'Spice', `Avoid spicy food (tolerance: ${answers?.spiceTolerance})`, ['galley'], 'avoid');
    } else {
      add(PreferenceCategory?.FOOD_BEVERAGE, 'Spice Tolerance', answers?.spiceTolerance, ['galley']);
    }
  }

  // Step 7 — Cabin & Comfort
  if (answers?.cabinTidiness) add(PreferenceCategory?.CABIN, 'Cabin Tidiness', answers?.cabinTidiness, ['cabin']);
  if (answers?.laundryExpectations) add(PreferenceCategory?.CABIN, 'Laundry Expectations', answers?.laundryExpectations, ['cabin']);
  if (answers?.bathroomProducts) add(PreferenceCategory?.CABIN, 'Bathroom Products', answers?.bathroomProducts, ['cabin']);
  if (answers?.favouriteSpaces?.length) add(PreferenceCategory?.CABIN, 'Favourite Spaces', answers?.favouriteSpaces, ['cabin']);
  if (answers?.cabinTemperature) add(PreferenceCategory?.CABIN, 'Cabin Temperature', answers?.cabinTemperature, ['cabin']);
  if (answers?.pillowPreference) add(PreferenceCategory?.CABIN, 'Pillow Preference', answers?.pillowPreference, ['cabin']);
  if (answers?.turnDownPreferences) add(PreferenceCategory?.CABIN, 'Turn-Down Preferences', answers?.turnDownPreferences, ['cabin']);
  if (answers?.musicRequested) add(PreferenceCategory?.CABIN, 'Music', answers?.musicRequested, ['cabin']);
  if (answers?.musicVolume) add(PreferenceCategory?.CABIN, 'Music Volume', answers?.musicVolume, ['cabin']);
  if (answers?.ambiencePreference) add(PreferenceCategory?.CABIN, 'Ambience', answers?.ambiencePreference, ['cabin']);

  // Step 8 — Activities
  if (answers?.waterToysUsed) add(PreferenceCategory?.ACTIVITIES, 'Water Toys Used', answers?.waterToysUsed, ['activities']);
  if (answers?.waterToysIgnored) add(PreferenceCategory?.ACTIVITIES, 'Water Toys Avoided', answers?.waterToysIgnored, ['activities'], 'avoid');
  if (answers?.favouriteExcursions) add(PreferenceCategory?.ACTIVITIES, 'Favourite Excursions', answers?.favouriteExcursions, ['activities']);
  if (answers?.repeatedActivities) add(PreferenceCategory?.ACTIVITIES, 'Repeated Activities', answers?.repeatedActivities, ['activities']);
  if (answers?.energyLevel) add(PreferenceCategory?.ACTIVITIES, 'Energy Level', answers?.energyLevel, ['activities']);

  // Step 9 — Repeat Visit
  if (answers?.thingsToPrep) add(PreferenceCategory?.OTHER, 'Next Visit Preparations', answers?.thingsToPrep, ['notes']);
  if (answers?.winesToStock) add(PreferenceCategory?.FOOD_BEVERAGE, 'Wines to Stock', answers?.winesToStock, ['wine']);
  if (answers?.snacksToPreOrder) add(PreferenceCategory?.FOOD_BEVERAGE, 'Snacks to Pre-Order', answers?.snacksToPreOrder, ['snack']);
  if (answers?.activitiesToPrePlan) add(PreferenceCategory?.ACTIVITIES, 'Activities to Pre-Plan', answers?.activitiesToPrePlan, ['activities']);
  if (answers?.cabinSetupPreferences) add(PreferenceCategory?.CABIN, 'Cabin Setup for Next Visit', answers?.cabinSetupPreferences, ['cabin']);

  // Step 10 — Notes
  if (answers?.overallGuestType) add(PreferenceCategory?.OTHER, 'Overall Guest Type', answers?.overallGuestType, ['notes']);
  const topThings = [answers?.topThingOne, answers?.topThingTwo, answers?.topThingThree]?.filter(Boolean);
  if (topThings?.length) add(PreferenceCategory?.OTHER, 'Top Things to Remember', topThings?.join(' | '), ['notes']);
  if (answers?.additionalSummary) add(PreferenceCategory?.OTHER, 'Chief Stew Summary', answers?.additionalSummary, ['notes']);

  return prefs;
};

// ─── Map existing preferences back to wizard answer fields ───────────────────
const mapExistingPrefsToAnswers = (existingPrefs) => {
  const prefilled = {};
  if (!existingPrefs?.length) return prefilled;

  const findValue = (key) => existingPrefs?.find(p => p?.key === key)?.value || null;
  const findAllValues = (key) => existingPrefs?.filter(p => p?.key === key)?.map(p => p?.value) || [];

  // Step 1
  const crewFamiliarity = findValue('Crew Familiarity');
  if (crewFamiliarity) prefilled.crewFamiliarity = crewFamiliarity;
  const personalityProfile = findValue('Personality Profile');
  if (personalityProfile) prefilled.personalityProfile = personalityProfile?.split(', ')?.filter(Boolean);
  const personalityNotes = findValue('Personality Notes');
  if (personalityNotes) prefilled.personalityNotes = personalityNotes;

  // Step 2
  const crewInteractionStyle = findValue('Crew Interaction Style');
  if (crewInteractionStyle) prefilled.crewInteractionStyle = crewInteractionStyle;
  const communicationStyle = findValue('Communication Style');
  if (communicationStyle) prefilled.communicationStyle = communicationStyle;
  const crewInteractionNotes = findValue('Crew Interaction Notes');
  if (crewInteractionNotes) prefilled.crewInteractionNotes = crewInteractionNotes;

  // Step 3
  const crewPresence = findValue('Crew Presence Preference');
  if (crewPresence) prefilled.crewPresence = crewPresence;

  // Dining Service Style — reconstruct per-meal from saved entries
  // Format stored: "Buffet (Breakfast)", "Family Style (Lunch)", "American (Plated) (Breakfast)"
  const diningServiceEntries = findAllValues('Dining Service Style');
  if (diningServiceEntries?.length) {
    diningServiceEntries?.forEach(entry => {
      // Match the LAST parenthesised group as the meal label, everything before it as the style
      // This handles labels like "American (Plated) (Breakfast)" correctly
      const match = entry?.match(/^(.+)\s*\(([^)]+)\)\s*$/);
      if (match) {
        const styleLabel = match?.[1]?.trim();
        const mealLabel  = match?.[2]?.trim();
        const styleOpt = DINING_SERVICE_STYLE_OPTIONS?.find(o => o?.label === styleLabel);
        const mealRow  = MEAL_ROWS?.find(m => m?.label === mealLabel);
        if (styleOpt && mealRow) {
          prefilled[mealRow?.key] = styleOpt?.value;
        }
      }
    });
  }

  const diningPace = findValue('Dining Pace');
  if (diningPace) prefilled.diningPace = diningPace;
  const tablePreferences = findValue('Table Preferences');
  if (tablePreferences) prefilled.tablePreferences = tablePreferences;

  // Step 4
  const wakeUpTime = findValue('Wake Up Time');
  if (wakeUpTime) prefilled.wakeUpTime = wakeUpTime;
  const morningRoutine = findValue('Morning Routine');
  if (morningRoutine) prefilled.morningRoutine = morningRoutine;
  const breakfastTime = findValue('Breakfast Time');
  if (breakfastTime) prefilled.breakfastTime = breakfastTime;
  const lunchTime = findValue('Lunch Time');
  if (lunchTime) prefilled.lunchTime = lunchTime;
  const dinnerTime = findValue('Dinner Time');
  if (dinnerTime) prefilled.dinnerTime = dinnerTime;
  const lateNightBehaviour = findValue('Late Night Behaviour');
  if (lateNightBehaviour) prefilled.lateNightBehaviour = lateNightBehaviour;
  const napHabits = findValue('Nap Habits');
  if (napHabits) prefilled.napHabits = napHabits;
  const bedTime = findValue('Bed Time');
  if (bedTime) prefilled.bedTime = bedTime;

  // Step 5 — Coffee: stored as "Milk: X | Frequency: Y"
  const coffeeEntry = findValue('Coffee');
  if (coffeeEntry) {
    const milkMatch = coffeeEntry?.match(/Milk:\s*([^|]+)/);
    const freqMatch = coffeeEntry?.match(/Frequency:\s*([^|]+)/);
    if (milkMatch?.[1]) prefilled.coffeeMilkPref = milkMatch?.[1]?.trim();
    if (freqMatch?.[1]) prefilled.coffeeFrequency = freqMatch?.[1]?.trim();
  }
  const favouriteTea = findValue('Tea');
  if (favouriteTea) prefilled.favouriteTea = favouriteTea;
  const favouriteEveningDrink = findValue('Evening Drink');
  if (favouriteEveningDrink) prefilled.favouriteEveningDrink = favouriteEveningDrink;
  const typicalCocktail = findValue('Cocktail');
  if (typicalCocktail) prefilled.typicalCocktail = typicalCocktail;
  const favouriteSpirits = findValue('Spirits');
  if (favouriteSpirits) prefilled.favouriteSpirits = favouriteSpirits;
  const favouriteWines = findValue('Wine');
  if (favouriteWines) prefilled.favouriteWines = favouriteWines;

  // Step 6
  const favouriteMeals = findValue('Favourite Meals');
  if (favouriteMeals) prefilled.favouriteMeals = favouriteMeals;
  const favouriteCuisines = findValue('Favourite Cuisines');
  if (favouriteCuisines) prefilled.favouriteCuisines = favouriteCuisines;
  const favouriteSnacks = findValue('Favourite Snacks');
  if (favouriteSnacks) prefilled.favouriteSnacks = favouriteSnacks;
  const lateNightSnacks = findValue('Late Night Snacks');
  if (lateNightSnacks) prefilled.lateNightSnacks = lateNightSnacks;
  const dessertPreferences = findValue('Dessert Preferences');
  if (dessertPreferences) prefilled.dessertPreferences = dessertPreferences;
  const foodPresentation = findValue('Food Presentation');
  if (foodPresentation) prefilled.foodPresentation = foodPresentation;
  const portionSize = findValue('Portion Size');
  if (portionSize) prefilled.portionSize = portionSize;
  // Spice: check both avoid and preference entries
  const spiceAvoid = existingPrefs?.find(p => p?.key === 'Spice' && p?.prefType === 'avoid');
  const spicePref = existingPrefs?.find(p => p?.key === 'Spice Tolerance');
  if (spiceAvoid) {
    const match = spiceAvoid?.value?.match(/tolerance:\s*(\w+)/);
    prefilled.spiceTolerance = match?.[1] || 'none';
  } else if (spicePref) {
    prefilled.spiceTolerance = spicePref?.value;
  }

  // Step 7
  const cabinTidiness = findValue('Cabin Tidiness');
  if (cabinTidiness) prefilled.cabinTidiness = cabinTidiness;
  const laundryExpectations = findValue('Laundry Expectations');
  if (laundryExpectations) prefilled.laundryExpectations = laundryExpectations;
  const bathroomProducts = findValue('Bathroom Products');
  if (bathroomProducts) prefilled.bathroomProducts = bathroomProducts;
  const favouriteSpaces = findValue('Favourite Spaces');
  if (favouriteSpaces) prefilled.favouriteSpaces = favouriteSpaces?.split(', ')?.filter(Boolean);
  const cabinTemperature = findValue('Cabin Temperature');
  if (cabinTemperature) prefilled.cabinTemperature = cabinTemperature;
  const pillowPreference = findValue('Pillow Preference');
  if (pillowPreference) prefilled.pillowPreference = pillowPreference;
  const turnDownPreferences = findValue('Turn-Down Preferences');
  if (turnDownPreferences) prefilled.turnDownPreferences = turnDownPreferences;
  const musicRequested = findValue('Music');
  if (musicRequested) prefilled.musicRequested = musicRequested;
  const musicVolume = findValue('Music Volume');
  if (musicVolume) prefilled.musicVolume = musicVolume;
  const ambiencePreference = findValue('Ambience');
  if (ambiencePreference) prefilled.ambiencePreference = ambiencePreference;

  // Step 8
  const waterToysUsed = findValue('Water Toys Used');
  if (waterToysUsed) prefilled.waterToysUsed = waterToysUsed;
  const waterToysIgnored = findValue('Water Toys Avoided');
  if (waterToysIgnored) prefilled.waterToysIgnored = waterToysIgnored;
  const favouriteExcursions = findValue('Favourite Excursions');
  if (favouriteExcursions) prefilled.favouriteExcursions = favouriteExcursions;
  const repeatedActivities = findValue('Repeated Activities');
  if (repeatedActivities) prefilled.repeatedActivities = repeatedActivities;
  const energyLevel = findValue('Energy Level');
  if (energyLevel) prefilled.energyLevel = energyLevel;

  // Step 9
  const thingsToPrep = findValue('Next Visit Preparations');
  if (thingsToPrep) prefilled.thingsToPrep = thingsToPrep;
  const winesToStock = findValue('Wines to Stock');
  if (winesToStock) prefilled.winesToStock = winesToStock;
  const snacksToPreOrder = findValue('Snacks to Pre-Order');
  if (snacksToPreOrder) prefilled.snacksToPreOrder = snacksToPreOrder;
  const activitiesToPrePlan = findValue('Activities to Pre-Plan');
  if (activitiesToPrePlan) prefilled.activitiesToPrePlan = activitiesToPrePlan;
  const cabinSetupPreferences = findValue('Cabin Setup for Next Visit');
  if (cabinSetupPreferences) prefilled.cabinSetupPreferences = cabinSetupPreferences;

  // Step 10
  const overallGuestType = findValue('Overall Guest Type');
  if (overallGuestType) prefilled.overallGuestType = overallGuestType;
  const topThings = findValue('Top Things to Remember');
  if (topThings) {
    const parts = topThings?.split(' | ');
    if (parts?.[0]) prefilled.topThingOne = parts?.[0];
    if (parts?.[1]) prefilled.topThingTwo = parts?.[1];
    if (parts?.[2]) prefilled.topThingThree = parts?.[2];
  }
  const additionalSummary = findValue('Chief Stew Summary');
  if (additionalSummary) prefilled.additionalSummary = additionalSummary;

  return prefilled;
};

// ─── Main Wizard Component ────────────────────────────────────────────────────
const PreferenceAssistantWizard = ({ isOpen, onClose, onComplete, guestId }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [progressId, setProgressId] = useState(null);
  const saveTimerRef = useRef(null);

  const tid = getActiveTenantId();

  // Compute completion %
  const completionPct = Math.round(
    (KEY_QUESTION_FIELDS?.filter(f => {
      const v = answers?.[f];
      return v && (Array.isArray(v) ? v?.length > 0 : String(v)?.trim() !== '');
    })?.length / KEY_QUESTION_FIELDS?.length) * 100
  );

  // Load existing progress
  useEffect(() => {
    if (!isOpen || !guestId || !tid) return;
    const loadProgress = async () => {
      try {
        const { data } = await supabase
          ?.from('guest_preference_wizard_progress')
          ?.select('*')
          ?.eq('guest_id', guestId)
          ?.eq('tenant_id', tid)
          ?.single();
        if (data) {
          setProgressId(data?.id);
          setAnswers(data?.answers || {});
        } else {
          // Pre-fill from existing preferences
          const existingPrefs = await getPreferencesByGuest(guestId, tid);
          if (existingPrefs?.length) {
            const prefilled = mapExistingPrefsToAnswers(existingPrefs);
            setAnswers(prefilled);
          }
        }
      } catch {
        // No existing progress
      }
    };
    loadProgress();
  }, [isOpen, guestId, tid]);

  const setField = useCallback((field, value) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
  }, []);

  // Auto-save progress
  const autoSave = useCallback(async (currentAnswers) => {
    if (!guestId || !tid) return;
    setSaving(true);
    try {
      const now = new Date()?.toISOString();
      const payload = { answers: currentAnswers, updated_at: now };
      if (progressId) {
        await supabase
          ?.from('guest_preference_wizard_progress')
          ?.update(payload)
          ?.eq('id', progressId)
          ?.eq('tenant_id', tid);
      } else {
        const { data } = await supabase
          ?.from('guest_preference_wizard_progress')
          ?.insert({ ...payload, guest_id: guestId, tenant_id: tid, created_at: now })
          ?.select('id')
          ?.single();
        if (data?.id) setProgressId(data?.id);
      }
    } catch (err) {
      console.error('[Wizard] autoSave failed:', err);
    } finally {
      setSaving(false);
    }
  }, [guestId, tid, progressId]);

  // Debounced auto-save
  useEffect(() => {
    if (!isOpen) return;
    if (saveTimerRef?.current) clearTimeout(saveTimerRef?.current);
    saveTimerRef.current = setTimeout(() => {
      autoSave(answers);
    }, 1500);
    return () => clearTimeout(saveTimerRef?.current);
  }, [answers, isOpen]);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      // 1. Get existing preferences to avoid duplicates
      const existingPrefs = await getPreferencesByGuest(guestId, tid);
      const existingKeys = new Set(
        existingPrefs?.map(p => `${p.category}::${p.key}`) || []
      );

      // 2. Build preferences from answers (each includes time_of_day)
      const prefsToCreate = buildPreferencesToCreate(answers);

      // 3. For Dining Service Style: remove existing entries first, then re-add per-meal
      const diningStyleExisting = existingPrefs?.filter(p => p?.key === 'Dining Service Style');
      for (const oldPref of diningStyleExisting) {
        try {
          const { supabase: sb } = await import('../../../lib/supabaseClient');
          await sb?.from('guest_preferences')?.delete()?.eq('id', oldPref?.id);
        } catch {}
      }

      // 4. Create preferences (skip duplicates except Dining Service Style which was cleared)
      let created = 0;
      for (const pref of prefsToCreate) {
        const dedupKey = `${pref?.category}::${pref?.key}`;
        const isDiningStyle = pref?.key === 'Dining Service Style';
        if (isDiningStyle || !existingKeys?.has(dedupKey)) {
          await createPreference({ ...pref, guestId }, tid);
          created++;
        }
      }

      // 5. Update charter_status on guest if provided
      if (answers?.charterStatus) {
        await supabase
          ?.from('guests')
          ?.update({ charter_status: answers?.charterStatus })
          ?.eq('id', guestId)
          ?.eq('tenant_id', tid);
      }

      // 6. Mark wizard as completed
      const completedSteps = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1);
      const now = new Date()?.toISOString();
      const payload = {
        answers,
        completed_steps: completedSteps,
        completed_at: now,
        updated_at: now,
      };
      if (progressId) {
        await supabase
          ?.from('guest_preference_wizard_progress')
          ?.update(payload)
          ?.eq('id', progressId)
          ?.eq('tenant_id', tid);
      } else {
        await supabase
          ?.from('guest_preference_wizard_progress')
          ?.insert({ ...payload, guest_id: guestId, tenant_id: tid, created_at: now });
      }

      showToast?.(`Wizard complete — ${created} preference${created !== 1 ? 's' : ''} added to profile.`, 'success');
      onComplete?.();
      onClose?.();
    } catch (err) {
      console.error('[Wizard] handleComplete failed:', err);
      showToast?.('Something went wrong. Please try again.', 'error');
    } finally {
      setCompleting(false);
    }
  };

  const StepComponent = STEP_COMPONENTS?.[currentStep];
  const isLastStep = currentStep === TOTAL_STEPS - 1;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="Wand2" size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Preference Assistant</h2>
              <p className="text-xs text-muted-foreground">Step {currentStep + 1} of {TOTAL_STEPS} — {STEP_LABELS?.[currentStep]}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <div className="w-3 h-3 border border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                Saving...
              </span>
            )}
            <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-1 rounded-full">{completionPct}%</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-3 flex-shrink-0">
          <div className="flex gap-1">
            {Array.from({ length: TOTAL_STEPS })?.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < currentStep ? 'bg-primary' : i === currentStep ? 'bg-primary/50' : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h3 className="text-lg font-semibold text-foreground mb-1">{STEP_LABELS?.[currentStep]}</h3>
          <StepComponent answers={answers} setField={setField} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="ChevronLeft" size={16} />
            Back
          </button>

          <span className="text-xs text-muted-foreground">
            {completionPct}% complete
          </span>

          {isLastStep ? (
            <button
              onClick={handleComplete}
              disabled={completing}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {completing ? (
                <><div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> Completing...</>
              ) : (
                <><Icon name="CheckCircle" size={16} /> Complete Wizard</>
              )}
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Next
              <Icon name="ChevronRight" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreferenceAssistantWizard;

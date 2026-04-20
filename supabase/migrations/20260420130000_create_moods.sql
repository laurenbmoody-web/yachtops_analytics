CREATE TABLE IF NOT EXISTS public.moods (
  key           text    PRIMARY KEY,
  label         text    NOT NULL,
  emoji         text    NOT NULL,
  sort_order    integer NOT NULL,
  is_quick_pick boolean DEFAULT false
);

INSERT INTO public.moods (key, label, emoji, sort_order, is_quick_pick) VALUES
  ('happy',         'Happy',         '🙂', 1,  true),
  ('quiet',         'Quiet',         '🤫', 2,  true),
  ('tired',         'Tired',         '😴', 3,  true),
  ('celebrating',   'Celebrating',   '🥂', 4,  true),
  ('off',           'Off',           '🌀', 5,  true),
  ('playful',       'Playful',       '✨', 10, false),
  ('reflective',    'Reflective',    '📖', 11, false),
  ('flirty',        'Flirty',        '💅', 12, false),
  ('hungover',      'Hungover',      '🥴', 13, false),
  ('jetlagged',     'Jetlagged',     '✈️', 14, false),
  ('grumpy',        'Grumpy',        '😤', 15, false),
  ('stressed',      'Stressed',      '😰', 16, false),
  ('social',        'Social',        '🗣️', 17, false),
  ('private',       'Private',       '🔕', 18, false),
  ('unwell',        'Unwell',        '🤒', 19, false),
  ('relaxed',       'Relaxed',       '🏖️', 20, false),
  ('focused',       'Focused',       '🎯', 21, false),
  ('contemplative', 'Contemplative', '💭', 22, false),
  ('seasick',       'Seasick',       '🌊', 23, false),
  ('buzzy',         'Buzzy',         '🎉', 24, false)
ON CONFLICT (key) DO NOTHING;

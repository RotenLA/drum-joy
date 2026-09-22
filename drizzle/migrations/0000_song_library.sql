CREATE TABLE public.songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  artist text,
  duration_ms integer NOT NULL DEFAULT 0,
  bpm numeric NOT NULL DEFAULT 120,
  ts_num integer NOT NULL DEFAULT 4,
  ts_den integer NOT NULL DEFAULT 4,
  midi_fingerprint text NOT NULL DEFAULT '',
  vocals_path text,
  bass_path text,
  drums_path text,
  other_path text,
  midi_path text NOT NULL,
  sizes jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.songs TO anon;
GRANT SELECT ON public.songs TO authenticated;
GRANT ALL ON public.songs TO service_role;

ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "published songs are public" ON public.songs
  FOR SELECT TO anon, authenticated USING (published = true);

CREATE TABLE public.song_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  difficulty text NOT NULL,
  midi_fingerprint text NOT NULL,
  chart jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (song_id, difficulty, midi_fingerprint)
);

CREATE INDEX song_charts_song_idx ON public.song_charts (song_id);

GRANT SELECT ON public.song_charts TO anon;
GRANT SELECT ON public.song_charts TO authenticated;
GRANT ALL ON public.song_charts TO service_role;

ALTER TABLE public.song_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charts of published songs are public" ON public.song_charts
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.songs s WHERE s.id = song_charts.song_id AND s.published = true));
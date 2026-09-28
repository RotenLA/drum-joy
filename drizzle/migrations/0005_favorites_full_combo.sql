CREATE TABLE public.song_favorites (
  user_id text NOT NULL,
  song_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, song_id)
);
GRANT ALL ON public.song_favorites TO service_role;
ALTER TABLE public.song_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.play_bests ADD COLUMN IF NOT EXISTS full_combo boolean NOT NULL DEFAULT false;
ALTER TABLE public.play_records ADD COLUMN IF NOT EXISTS full_combo boolean NOT NULL DEFAULT false;
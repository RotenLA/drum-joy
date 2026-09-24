CREATE TABLE public.play_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  song_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  difficulty text NOT NULL,
  speed numeric NOT NULL DEFAULT 1,
  score integer NOT NULL DEFAULT 0,
  accuracy numeric NOT NULL DEFAULT 0,
  max_combo integer NOT NULL DEFAULT 0,
  notes integer NOT NULL DEFAULT 0,
  progress integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  played_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, played_at, song_id)
);
CREATE INDEX play_records_user_idx ON public.play_records (user_id, played_at DESC);
GRANT ALL ON public.play_records TO service_role;
ALTER TABLE public.play_records ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.play_bests (
  user_id text NOT NULL,
  song_id text NOT NULL,
  difficulty text NOT NULL,
  best_score integer NOT NULL DEFAULT 0,
  best_accuracy numeric NOT NULL DEFAULT 0,
  best_combo integer NOT NULL DEFAULT 0,
  best_progress integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  plays integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, song_id, difficulty)
);
GRANT ALL ON public.play_bests TO service_role;
ALTER TABLE public.play_bests ENABLE ROW LEVEL SECURITY;
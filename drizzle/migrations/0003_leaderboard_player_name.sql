ALTER TABLE public.play_bests ADD COLUMN IF NOT EXISTS player_name text;
CREATE INDEX IF NOT EXISTS play_bests_board_idx ON public.play_bests (song_id, difficulty, best_score DESC);
ALTER TABLE public.song_tags ADD COLUMN background_path text;
COMMENT ON COLUMN public.song_tags.background_path IS 'Optional private storage path for the playlist background image.';
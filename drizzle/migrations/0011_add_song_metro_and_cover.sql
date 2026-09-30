ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS metro_path text;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS cover_path text;

COMMENT ON COLUMN public.songs.metro_path IS 'Metronome/click reference stem used only server-side to derive the absolute beat map; never downloaded by players.';
COMMENT ON COLUMN public.songs.cover_path IS 'Album art extracted from the untagged original track; signed on read for the song picker.';
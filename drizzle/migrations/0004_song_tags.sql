CREATE TABLE public.song_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.song_tags TO anon, authenticated;
GRANT ALL ON public.song_tags TO service_role;
ALTER TABLE public.song_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags are public" ON public.song_tags FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.song_tag_links (
  song_id uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.song_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, tag_id)
);
GRANT SELECT ON public.song_tag_links TO anon, authenticated;
GRANT ALL ON public.song_tag_links TO service_role;
ALTER TABLE public.song_tag_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tag links of published songs are public" ON public.song_tag_links FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.songs s WHERE s.id = song_tag_links.song_id AND s.published = true));
CREATE INDEX song_tag_links_tag_idx ON public.song_tag_links(tag_id);
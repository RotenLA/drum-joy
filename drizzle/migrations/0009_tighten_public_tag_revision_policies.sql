DROP POLICY IF EXISTS "library revision is public" ON public.library_revision;
CREATE POLICY "library revision singleton is public" ON public.library_revision FOR SELECT TO anon, authenticated USING (id = true);
DROP POLICY IF EXISTS "tags are public" ON public.song_tags;
CREATE POLICY "tags with published songs are public" ON public.song_tags FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.song_tag_links l JOIN public.songs s ON s.id = l.song_id WHERE l.tag_id = song_tags.id AND s.published = true));
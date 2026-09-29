CREATE TABLE public.library_revision (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.library_revision TO anon;
GRANT SELECT ON public.library_revision TO authenticated;
GRANT ALL ON public.library_revision TO service_role;

ALTER TABLE public.library_revision ENABLE ROW LEVEL SECURITY;

CREATE POLICY "library revision is public"
ON public.library_revision
FOR SELECT
TO anon, authenticated
USING (true);

INSERT INTO public.library_revision (id, version) VALUES (true, 1);

CREATE OR REPLACE FUNCTION public.bump_library_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.library_revision
  SET version = version + 1, updated_at = now()
  WHERE id = true;
  RETURN NULL;
END;
$$;

CREATE TRIGGER songs_bump_library_revision
AFTER INSERT OR UPDATE OR DELETE ON public.songs
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_library_revision();

CREATE TRIGGER song_charts_bump_library_revision
AFTER INSERT OR UPDATE OR DELETE ON public.song_charts
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_library_revision();

CREATE TRIGGER song_tags_bump_library_revision
AFTER INSERT OR UPDATE OR DELETE ON public.song_tags
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_library_revision();

CREATE TRIGGER song_tag_links_bump_library_revision
AFTER INSERT OR UPDATE OR DELETE ON public.song_tag_links
FOR EACH STATEMENT EXECUTE FUNCTION public.bump_library_revision();
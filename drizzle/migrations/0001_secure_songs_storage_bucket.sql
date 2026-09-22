CREATE POLICY "service role manages song files"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'songs')
WITH CHECK (bucket_id = 'songs');
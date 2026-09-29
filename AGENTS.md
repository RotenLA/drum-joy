<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Startup watchdog: root component marks booted on mount (covers every route); overlay only on mobile/Unity, never on Preview/desktop, and only when an error was captured — avoids false "Failed to start".
- Playlist detail screens always reveal the blurred gameplay stage; `song_tags.background_path` is deprecated and must not be read, written, or exposed in admin UI.
- Gameplay and tutorial use the stage renderer only; the removed columns mode must not be restored or read from saved settings.
- Auto charts are deterministic, phrase-aware, and density-limited; existing cloud charts change only through explicit regeneration.
- Admin folder import groups by the final underscore suffix and uploads songs sequentially to avoid browser memory spikes.
- The player checks the lightweight library revision once per page session and reuses cached library, favorites, and play data for all in-app returns.
- Song tempo is inferred during admin import from audio transients plus MIDI drum structure in the 80–180 BPM range; MIDI remains the time-signature source.

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
- Gameplay and tutorial support both the stage renderer and the restored columns renderer; columns mode uses one shared ground-plane projection so lanes, notes, and hit targets remain coplanar.
- Auto charts run a three-stage pipeline: AI drum MIDI is sanitized (velocity gates, 62 ms per-part debounce, two-hand arbitration), per-song groove templates are clustered from the cleaned bars, then each difficulty's notes get their real MIDI hit time back-filled (grid time only as fallback) — removes AI stem noise while staying locked to the audio.
- Ratings use strict shared thresholds; live grades are progress-gated, SSS requires 99.5% plus a completed full combo, and stage intensity follows the live grade.
- Admin folder import groups by the final underscore suffix and uploads songs sequentially to avoid browser memory spikes.
- The player checks the lightweight library revision once per page session and reuses cached library, favorites, and play data for all in-app returns.
- Song BPM metadata is inferred from audio plus MIDI structure in the 80–180 range; chart timing follows the difficulty snap rule and the MIDI tempo map, while MIDI remains the GM-part and time-signature source.
- On low-height landscape screens, Settings, Exit/Back, and Tutorial share the same safe-area top line and 2rem height so Unity WebView chrome stays aligned.

- The song picker remembers the open playlist in session memory so leaving a song returns to that playlist; a page reload starts at the home screen.

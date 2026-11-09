# Segments

One file per segment, each on its own branch (`segment/<name>`). A segment file holds:

- **Rundown line**: what gets pasted into the control page's rundown box, in the format `parseRundown` reads (`Title | minutes | subtitle | @scene`; a leading `*` marks an ad read).
- **Scene**: the OBS scene the show runner cuts to on Next.
- **Prep**: sources, talking points, and any overlay text (headline, kicker, ticker lines) to set while it is on air.

Code changes a segment needs (a new layout, a new overlay panel) go on the same branch, with tests.

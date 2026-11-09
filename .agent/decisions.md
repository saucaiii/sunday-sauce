# Decision log (long-term memory). Append only.
# Format: - YYYY-MM-DD | decision | reason | alternatives rejected | review-by YYYY-MM-DD (optional)
- 2026-11-01 | One long-lived segment/<name> branch per show segment (institutional, penguin, ai, trenches) | Owner wants each segment developed apart; merged to main by PR when ready for air | Short-lived feature/ branches per episode; one branch for all segments | review-by 2027-02-01
- 2026-11-01 | Overlay server keeps its own price cache, separate from tg-broadcast | Show stack moved to its own repo; sharing a cache across repos would couple them | Shared data dir across repos; overlay calling tg-broadcast over HTTP | review-by 2027-02-01

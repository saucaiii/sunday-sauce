# sunday-sauce

The Sunday Sauce live show: the OBS overlay, the phone control page, the PTI-style rundown and the OBS show runner that cuts scenes on Next.

## Status

Moved out of [tg-broadcast](https://github.com/saucaiii/tg-broadcast) (`feat/show-runner`, at `0686b46`) so the show has its own history and its own segment branches. The Telegram bot stays in tg-broadcast; this repo only reads what it publishes.

## Run

```bash
npm install
cp .env.example .env     # set OVERLAY_SECRET at least
npm run overlay:demo     # fixture data, no upstream calls
npm run overlay          # live prices
npm test
```

The server prints the control page's phone address at startup.

## Environment

Secrets and configuration go in `.env` (ignored by git). See [`.env.example`](.env.example) for every key the server reads.

## Segments

Each segment is developed on its own long-lived branch and merged into `main` through a PR when it is ready for air:

| Segment | Branch | Notes file |
| --- | --- | --- |
| Institutional | `segment/institutional` | `segments/institutional.md` |
| Penguin | `segment/penguin` | `segments/penguin.md` |
| AI | `segment/ai` | `segments/ai.md` |
| Trenches | `segment/trenches` | `segments/trenches.md` |

See [`segments/README.md`](segments/README.md) for what goes in a segment.

## What moved, and the one thing that changed

In tg-broadcast the overlay and the Telegram market post read one price cache, so CoinGecko was hit on one 30-second clock. Here the overlay server keeps its own cache in `data/prices.json`. That puts a second keyless caller on the same IP while both run on one machine. If rate limits come back, raise `PRICE_CACHE_SECONDS` here.

## Serving the overlay

```bash
npm run overlay          # live prices
npm run overlay:demo     # fixture data, no upstream calls, for design work
```

Set `OVERLAY_SECRET` first. It is a path segment, not a query parameter, and
the whole URL should be handled like a credential:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

| Route | Serves |
|---|---|
| `/overlay/<secret>/` | the overlay itself |
| `/overlay/<secret>/state` | the JSON the overlay polls every 10s |

Both come off one origin, which is why there is no CORS configuration
anywhere: the overlay fetches a relative `./state`. A wrong secret and a
missing file both answer 404, so the URL shape is not confirmed to anyone
guessing at it. The secret is never logged.

The server binds to `127.0.0.1` by default and is not meant to face the
internet directly.

## In OBS

Browser source, 1920×1080, pointed at `/overlay/<secret>/?clean=1`.

`clean=1` is not optional. Without it the page renders the scene tab buttons,
14px of padding and an opaque `#101418` wrapper, and that wrapper arrives in
OBS as a solid dark rectangle over the camera feed. With it, the stage is
transparent and the cutouts show the cameras.

Scene selection stays an operator control: `?scene=two-host` and friends, or
the tab buttons when previewing outside `clean=1`.

Keep a copy of the last known-good overlay as a second, disabled browser source
pointing at a local file. If the server is unreachable there is no overlay, and
that switch is the fallback.

## Controlling the overlay

Open `/overlay/<secret>/control` on a phone or a second window. It sets the
headline, kicker, breaking flag, ticker lines, show name, sponsors and name
plates, and changes reach the stream in about two seconds.

Before this, the overlay's text came from URL parameters baked into each OBS
browser source. That is fine for setup and unusable live: every scene has its
own source, so changing a headline meant editing it in nine places while on
air. The control page writes one value on the server and every scene reads it.

Three rules worth knowing:

- **A URL parameter still wins.** It is a deliberate per-source override, which
  is how one scene keeps `ANGLE 2` on its second camera while the headline is
  set once for all of them.
- **Empty means "not set".** Clearing a field restores the overlay's own
  default rather than blanking the lower third.
- **Manual ticker lines override the published feed.** Clear the box to fall
  back to headlines the channel actually published in the last 24 hours.

`/control` is the only writable route on the server; everything else refuses a
POST. Bodies are capped, text is length-bounded so a paste cannot push the
lower third off the stage, and the page reaches the endpoint by relative path
so the secret never appears in the markup.

State lives in `data/broadcast.json`, so a restart mid-show comes back with the
same lower third.

## Failure behaviour

The one thing this must never do is show frozen prices under a "Live" badge.

- A failed refresh keeps the previous snapshot. Prices that have been on screen
  stay there; they are never replaced with dashes.
- The cache writes through to `data/prices.json`, so a restart mid-show
  repaints from the last known prices instead of blanking.
- After 90 seconds without a successful poll, or when the payload reports the
  server's own prices are stale, the Market Watch badge turns amber and reads
  STALE.
- On a cold start with nothing cached, the strip renders with no columns rather
  than a row of zeros.

## The headline ticker

The marquee carries headlines the channel published in the last 24 hours. Every
one of them has already gone out to Telegram, so the overlay shows a strict
subset of what is already public and needs no approval gate of its own.

The ledger is written by tg-broadcast, not by this repo. It starts empty and
fills as the channel publishes.

## Where the ticker's headlines come from

The tg-broadcast jobs that publish to Telegram record what they sent, at the moment they
send it — `alerts`, `captains-log`, `morning-brief` and `big-story` each call
`recordHeadlines()` beside their existing `markPublished()`. Only what actually
published is recorded; not what was scored, not a `DRY_RUN` rehearsal.

Those jobs run on the droplet and the overlay server runs beside OBS on the
laptop, so the ledger is pulled across with a read-only `ssh host cat file` on
a timer. No port is opened and nothing is pushed. Set `HEADLINE_SYNC_HOST`;
leave it empty to use local headlines only.

The pull lands in `data/headlines.remote.json`, never over the local
`data/headlines.json`. The two are merged at read time, deduplicated by link,
keeping the earliest sighting of a story — so a sync can never erase something
recorded locally, and a story known to both machines still appears once. A
remote file that is truncated or the wrong shape is ignored rather than
trusted.

Manual lines from the control page override all of this; clearing them falls
back to the feed.

## Ticker scroll speed

`TICKER_PX_PER_SEC` in `overlay/index.html`, currently 90. The duration used to
be a fixed 34s, which meant the speed depended on how much text there was — a
placeholder line crawled while a real feed of seventeen headlines went past at
over 300 px/s. Fixing the speed instead of the duration keeps it readable
however long the feed grows. Raise the number to speed up.

## Editing the overlay

`overlay/index.html` is the source of truth. It was extracted from a Claude
Design `.dc.html` bundle, which is no longer used — the overlay is versioned
alongside the endpoint it depends on, because a change to one usually needs a
change to the other. React, the dc runtime and the fonts are vendored under
`overlay/vendor/` so the page has no external dependencies at all.

The symbol list is `src/config/tickers.ts`, a copy of the one in tg-broadcast.
Change both when a coin is added or dropped.
There is no symbol list in the overlay and no rounding either: the server sends
`display.price` and `display.change` already formatted, and the overlay renders
them verbatim. That is deliberate — two rounding rules is exactly how the two
surfaces drifted apart the first time.

## Issues and security

Bugs and feature requests use the templates under `.github/ISSUE_TEMPLATE/`. Vulnerabilities go through private reporting; see [`SECURITY.md`](SECURITY.md).

## Built on gh600-agent-kit

This repo is built from [gh600-agent-kit](https://github.com/saucaiii/gh600-agent-kit). The agent guardrails, plan gate, policy, hooks, and self-tests are documented in [`docs/kit.md`](docs/kit.md). Follow `CLAUDE.md` for the agent workflow.

# tools/

Things that are run by hand, once in a while, and are not part of the site.

## Social preview cards

`assets/og/og-*.png` are the 1200x630 pictures that Discord, Slack, WhatsApp,
Google and X show when someone pastes a link to the site. Every page gets one:
`build.mjs` writes the Open Graph and Twitter tags from each page's front
matter, so a page only has to name its card.

- `og-card.html` draws a card. It is a plain page that reads its own query
  string, so no build step and no dependencies.
- `og-cards.json` lists every shipped card and the words on it.
- `og-urls.mjs` prints the URL for each one.

### Re-rendering them

```
python -m http.server 8000      # from the repo root, not from here
node tools/og-urls.mjs          # prints one URL per card
```

Then, for each URL: open it, set the browser window to **exactly 1200x630**,
screenshot the viewport, and save the PNG into `assets/og/` under the file name
`og-cards.json` gives. In Chrome or Edge, DevTools device toolbar (Ctrl+Shift+M)
with a custom 1200x630 size, then the three dots menu, "Capture screenshot".

The PNGs come out around 450 KB, which is heavier than a preview picture needs
to be. Squash them with a 256-colour palette, which leaves the text crisp and
gets them under 175 KB:

```
ffmpeg -y -i in.png -vf "palettegen=max_colors=256:stats_mode=full" pal.png
ffmpeg -y -i in.png -i pal.png -lavfi "paletteuse=dither=sierra2_4a" out.png
```

### Adding a card

Add an entry to `og-cards.json`, render it, then point a page at it with
`"card": "og-whatever.png"` in that page's front matter. `social()` in
`build.mjs` documents the other fields (`cardAlt`, `ogTitle`, `ogDesc`,
`noindex`).

### Changing the words

Headlines take `*stars*` around the phrase that should be amber, and a `|`
where the line must break. Left to itself the browser balances the lines, which
is rarely where the sense breaks.

The screenshots the cards use (`assets/og/*.jpg`) are stills of real programs,
copied from the homepage repo (`pyweblib-home/ex/`).

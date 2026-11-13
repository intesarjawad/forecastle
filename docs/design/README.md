# Design direction

Forecastle is a game first. You draw a real chart's next week, hand it in, and
find out whether you beat a forecasting model. Every choice below serves that
one minute of play and the result people post afterwards.

## The idea: a calligraphy lesson, corrected in red

In a Japanese calligraphy lesson the student copies a model sheet in black sumi
ink, and the teacher then writes over the student's own page in vermilion:
a corrected stroke where the hand went wrong, and a circle or a double circle
beside what was good. Red over black, on the student's own paper, is the
judgement. The habit has a name in everyday Japanese, 朱を入れる (shu o ireru),
"to put in the vermilion", meaning to correct someone's writing.

Forecastle's page is that sheet. The series runs down the page in weekly
columns read from right to left, like a column of writing. The four given weeks
are already brushed. To their left is the empty column for your week, and to
the left of that the AI's sheet. You brush the next seven days with a
brush as wide as your doubt. When you hand it in, the vermilion arrives: the
real week is brushed down both columns, every day gets the teacher's mark, both
scores are written at the foot, and the winner is circled.

The finished sheet is the thing people screenshot. It carries everything a
stranger needs: the puzzle number, the series and unit, the dates of every
week, both scores, a mark for every day on each side, and a line that says
what decided the verdict, so nobody counting marks mistakes them for the score.

## Who plays, and what they need

- **Daily-game players on a phone**, arriving from a friend's shared grid. They
  must understand "brush here" inside two seconds and finish in under a minute.
  A portrait phone is the natural shape of a vertical page.
- **Chart people and statistics teachers**. They judge whether the uncertainty
  picture is honest and whether drawing feels native to touch.
- **Forecasting researchers**. They look for a fair fight: same scale, same
  rules, the model named.

Before you hand it in there is one action: brush the week. After it there is
one thing to read: who won.

## Three rules that give it its look

1. **Two inks on one paper.** Black sumi is the student: the given weeks and
   your week. Vermilion shu is the teacher: the real week, the marks and the
   circle. The AI is a second student whose week is printed in a flat grey,
   because a machine wrote it, so it reads as type rather than as anyone's
   hand; the teacher marks it the same way as yours. Nothing else on the sheet
   has colour. Vermilion is an opaque pigment, so it lies over the sumi, never
   darkens into it, with a hairline of paper where it crosses black.
2. **Ink behaves like ink.** A loaded brush lands pressed and blunt (kihitsu),
   a rounded head a touch wider than the body, and lays one solid body. On a
   dry brush the body narrows by a fifth over 8 to 12 px, keeping its centre
   line, and the outer hairs part from its edge one by one, swinging out over
   about 10 px, and carry on alone, inking unevenly and skipping over the
   paper's tooth, which leaves kasure at the edge only. A hair never inks over
   the body, so the break only lightens the stroke. Each given week dries where its
   own load runs out: a fast day lays less ink on each pixel and a turn slows
   the hand and spends more, so no two weeks break at one height. It lifts to a
   dry point. With WebGL,
   the ink then creeps one or two pixels into the washi in threads along the
   strongest fibres, and where loaded ink pooled it dries darker on one side,
   in broken lengths. Your band is one diluted wash under your stroke, at the
   band's true width, its edge feathered evenly either side of the band's
   edge as water spreads past the pigment and its two ends feathered over
   about 12 px, so doubt is visible as a wider,
   paler brush. Before the first stroke, three strokes of the same
   brush under the prompt, "sure" to "unsure", teach that width.
3. **The teacher speaks once, and loudly.** The marks are small, crisp and
   many, laid with a fine brush of one even width, under 2 px, on each day's
   point as a teacher marks the writing itself, each ring left open where the
   brush landed. They lie straight over the sumi with no paper round them, and
   the inner ring of ◎ is wide enough that the sumi shows through it as a line,
   never filling it into a dot: every inner ring is at least 3 px wider than
   the sumi on each side. The key under the verdict draws ◎ and ○ from the
   sheet's own paths, at their size and in the same 1.5 px brush. The scores
   are brushed by hand in vermilion, stroke by stroke, pressed on the down
   strokes and lifted to about half on the turns and up strokes; the circle round the winner is the only large gesture on the page. The real
   week is one vermilion stroke: pressed and blunt where it lands at today
   (in the AI's column a few pixels below the top rule, so the head is whole),
   swelling through each turn, and lifting to a flick at day 7. The verdict
   under it is set in black at regular weight, so the teacher speaks once. A
   hanamaru, the flower circle, goes round
   your score when you win. A plain single circle goes round the AI's score
   when it wins. A draw gets no circle.

## The teacher's marks, and where they come from

Every mark is computed by the scoring code, not chosen for looks. Day marks come
from `dayCells` in `site/src/core/scoring.ts`: within one typical move of the
real value, within two, or further. The typical move is `typicalMove` in the
same file. The circle goes to the higher Closeness, then to the band that caught
more days, the same order as `verdict` in `site/src/core/verdict.ts`.

| Mark          | Name                    | Meaning in a Japanese classroom        | Meaning here                  |
| ------------- | ----------------------- | -------------------------------------- | ----------------------------- |
| ◎             | nijūmaru, double circle | Excellent, a step above a plain circle | Very close: one typical move  |
| ○             | maru, circle            | Correct, good                          | Close: two typical moves      |
| No mark       |                         | Nothing to praise                      | Further than two              |
| Flower circle | hanamaru                | Full marks, outstanding work           | Round your score when you win |

A day further than two typical moves is left unmarked. The △ (sankaku) means
partly right in a classroom, and the scoring has no near-miss tier for it to
stand for: the third tier is a miss. I also leave out the × (batsu), which marks
a wrong answer: a forecast that misses a day is not wrong in the way a misspelt
character is, and a column of crosses would read as failure rather than
correction. The scoring page says what each mark means.

The circles are drawn in one stroke that begins at the top, travels
anticlockwise and overshoots its start, after the ensō of Hakuin Ekaku
(1686 to 1769). Only the form is borrowed: one breath, one stroke, an open
or overlapping end. The ensō's meaning in Zen practice is not claimed. The
hanamaru is one filled stroke: a ring that winds almost a full turn just round
the score and runs straight on into the first petal without lifting, then
four more, five in all. Each petal springs out of the ring and falls back to a
deep cusp 3 to 4 px off it, leaning the way the brush
travels; the last is written only to its crown and leaves from there in a
flick, low on the right, which is the stroke's own end. It pools where the
brush lands, runs lighter round the ring, swells through the join into the
petals at about 6 px and stays full until the flick. Reduced motion prints
the same stroke, flick included. The
share grid writes ◎ and ○, and ◌, a blank slot, for a day that earned
neither (`site/src/core/share.ts`).

The page sets no Japanese text. The kanji above appear only in this document.

Sources:

- Circle mark, with the double circle, triangle and cross in Japanese use:
  https://en.wikipedia.org/wiki/Circle_mark
- Maru and batsu in Japanese schools, nippon.com:
  https://www.nippon.com/en/guide-to-japan/cs00032/maru-and-batsu-circles-and-crosses-for-saying-yes-and-no.html
- A calligraphy teacher's red corrections and circles on a student's sheet,
  Beyond Calligraphy: https://beyond-calligraphy.com/?p=10636
- 朱筆 and 朱を入れる, dictionary entries on Kotobank:
  https://kotobank.jp/word/朱筆-525817
- Hakuin Ekaku, ensō, Eisei Bunko Museum, reproduced at
  https://terebess.hu/zen/hakuin/hakuin74.html
- Hakuin Ekaku, Large Ensō, Museum of Fine Arts, Houston:
  https://emuseum.mfah.org/objects/155304/large-enso

## Signature frame

The corrected sheet at 390×844: the player's column and the AI's with their
vermilion marks, both scores, the circle, the stamp ("You beat the AI by 30
points"), the line that says what decided it ("Closer overall, 85 to 55 (100
is exact)"), the mark key ("Each day:"), Share and the streak line, with no scrolling. If any of those leaves
the viewport, the frame fails. On a phone only the last given week has its own
column; the three before it show through it in the same brush, faint and
narrow, the way earlier writing shows through thin paper.

## Colour

| Token       | Role                                             | Value     | Contrast on washi |
| ----------- | ------------------------------------------------ | --------- | ----------------- |
| `--washi`   | Paper and page ground                            | `#eeede7` |                   |
| `--sumi`    | The student's ink, all text                      | `#17140f` | 15.66:1           |
| `--print`   | The AI's printed line and band dots              | `#55524c` | 6.64:1            |
| `--usuzumi` | Quiet text, ticks                                | `#6b6760` | 4.79:1            |
| `--shu`     | Vermilion deep enough for small type: focus ring | `#a8350d` | 5.63:1            |
| `--shu-ink` | Vermilion as a brush lays it: strokes and marks  | `#df4a1a` | 3.49:1            |

Shu is an orange vermilion, the colour of cinnabar ink, not a crimson. At that
lightness it cannot carry text, so it has two tokens: `--shu-ink` for every
stroke and mark on the canvases, which only need 3:1 as graphics, and the
deeper `--shu` only for the focus ring and the archive chart's day rings. The
headline, Share and every other word on the page are sumi, so the teacher is the
only vermilion and there is one red, not two. Where your band overlaps the AI's band, sumi still reaches 8.59:1,
print 3.64:1 and shu 3.09:1, so the lines stay
readable as graphics. The washi is a near-neutral warm white (b* 3.0), well
short of the cream papers this direction must avoid. `tests/unit/tokens.test.ts`
recomputes every figure here from the stylesheet.

Day marks never rely on colour: the double circle, the circle and no mark
differ in shape, and the result repeats them in a key and in a visually hidden
table.

## Type

| Role | Family                        | Use                    |
| ---- | ----------------------------- | ---------------------- |
| Text | Shippori Mincho 400, 600, 800 | Everything set in type |

A self-hosted Latin subset under the SIL Open Font License, credited in
`NOTICE`. Shippori Mincho is a Mincho face with real Latin, so the page reads
as a printed Japanese sheet without setting Japanese text. The scores are set
by hand instead: each figure is the strokes a hand makes, brushed in vermilion
on the canvas, with the number kept in the page as text for assistive
technology. A brush face was tried and dropped: in its figures 55 read as SS. Sizes: 12,
14, 16, 24 and 32 px. Body is 16 px. Spacing sits on a 4 px grid and
controls are at least 44 px.

## Layout

On a wide screen the sheet is at most 1120 px wide: six columns of 136 px with
44 px gutters, the series title set vertically down the right edge, then from
right to left the four given weeks, your week and the AI's. A wider 72 px
gutter separates your week from the given weeks, so your marks belong to your
column. Each row is one day, so the sheet's height follows the viewport, and
every week starts at the top row. The value ticks are labelled once, over the
last given week. Today's value is ringed twice: at the foot of the last given
week and at the head of yours, so the brush starts where the ink stopped.

Column heads count days from today throughout: "−27 to −21 d" through "+1 to
+7 d". They never switch to dates. The dates arrive with the answer, after you
hand it in, because a historical week with its dates could be looked up
(ADR 0003, ADR 0005). They then appear once, under the series title.

On a phone three columns fit: the last given week, yours and the AI's. "Hand
it in" sits directly under the sheet with the band slider after it; after the
reveal the scores and circle take that place, then the stamp, the verdict, the
mark key, Share and the streak. Marks sit on each day's point, in the column.

A graphite line runs from today's ring at the foot of the last given week to
the ring at the head of yours: the printed warm grey, 0.75 to 1 px, laid darker
and lighter where the paper's tooth catches it, with no dashes. It stays in the
margins: under the sheet, up the gutter in one loose curve and over the top, so it never crosses the plot and cannot be read as a
trend. The prompt is set across your column under that ring: "Read right to
left, then brush down from today" on a first visit, and "Brush the next seven
days, from today" after, with the three-brush swatch below it; on a phone the
swatch waits under "Hand it in", in the room the doubt slider takes once you
have drawn, so the idle sheet ends without a band of empty paper. It takes no
space of its own, so nothing moves while the visitor draws. The AI's column is
plain ruled paper until then, with one short line at its foot: "Opens when you
hand in yours".

## States

- **Idle.** The empty column for your week, with today ringed at its head and
  the prompt inside it, on two lines, over the three feathered sample strokes.
  The AI's column is plain ruled paper with one line at its foot. On a desk the
  week takes the height the page leaves; on a phone the rows stay short so the
  corrected sheet still fits one screen. Either way the links sit at the foot of
  the screen, so the page ends where the paper does.
  Keyboard players get seven sliders, one per day.
- **Drawn.** Your stroke and its wash, the slider "How sure are you?" from
  "More sure" to "Less sure", the line "Aim to catch about 8 days in 10", and
  "Hand it in". The slider's space is reserved from the start, so the page does
  not shift when it appears.
- **Revealed.** Everything in the signature frame and a quiet link to how
  scoring works. Share and the mark key wait until the circle is finished.
  "Hand it in" is solid sumi, and before there is a week to hand in, the same
  button drawn in sumi outline; Share is a smaller block of the player's own
  sumi. After the reveal the AI's day dots give
  way to the marks, so a double circle never reads as a target. The calibration record and
  what the dotted band means live on the scoring page.
- **Missing.** When no puzzle is published, the sheet is replaced by a short
  explanation; no empty columns are shown.
- **The AI wins, or a draw.** A plain circle round the AI's score, or no
  circle.

## Motion

One correction, 2.45 seconds, inside the 2.5 second budget for the final frame:

| When            | What                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| 0 to 1000 ms    | The real week is brushed down your column from 0 ms and down the AI's from 300 ms, 700 ms each. |
| 800 to 1660 ms  | Each day is marked, one pair at a time, 110 ms apart, each mark in 200 ms.                      |
| 1400 to 1900 ms | Both scores are brushed, the AI's first.                                                        |
| 1850 to 2450 ms | The circle is brushed round the winning score in one stroke.                                    |
| 2150 to 2450 ms | The stamp and what decided it arrive. No bounce.                                                |

Every stroke is laid along its own path in brush order, so a mark is drawn, not
faded in. Easing is `cubic-bezier(0.23, 1, 0.32, 1)`. Under
`prefers-reduced-motion` the corrected sheet appears at once, fully inked, with
the same content.

## The ink on the paper

The bleed follows the technique in Cullen Webber's "Building a Dual-Scene Fluid
X-Ray Reveal Effect in Three.js" (Codrops, March 2026,
https://tympanus.net/codrops/2026/03/23/building-a-dual-scene-fluid-x-ray-reveal-effect-in-three-js/):
a field held in two framebuffers that are read and written in turn each frame,
so a deposit keeps spreading and settling after it lands. Here the deposit is
the brush's canvas, the field is water and pigment in the paper, and a fibre
texture decides how far each texel lets them through. The paper itself is kozo:
a faint cloud of formation, the tooth, and long thin fibres lying every way. Water spreads one or two
CSS pixels along the grain and hardly at all across it, a little further along
the strongest fibres. Where the ink pooled, the pigment piles up at the front as
it dries, on one side of the stroke and in broken lengths, so the edge is never
a traced outline and has no halo. The sumi within a pixel and a half of the
vermilion is cut back to paper, so the shu reads as a pigment laid on top. Vermilion runs only where the sumi has wet the paper; on dry
paper it stays where the brush put it. The teacher's marks and the circle sit
on their own dry canvas above the field and never bleed, so they stay crisp.
A mark is opaque and lies straight over the sumi, with no outline anywhere.
The shu stroke, the scores and the hanamaru are loaded brushes, so their edges
are bitten by the paper's tooth in short irregular breaks; the day marks are
too fine to break.

Rules the shader keeps:

- It is a separate chunk loaded after first paint. Until it arrives, and
  wherever it cannot run, the brush canvases are the picture.
- The device pixel ratio is capped at 2, and at 1 on phones.
- It stops when the sheet leaves the viewport or the tab is hidden, and once
  the ink has settled.
- It does not start on software renderers or when the browser reports a major
  performance caveat; the still is shown instead.
- Its frame rate is checked by hand at 1440×900 with a performance trace in
  Chromium; the test browsers run WebGL in software, where it stays off.

## What it avoids

A dashboard, a finance terminal or a landing page. Legend boxes. Card inside
card. Gradients, glass and decorative icons. Japanese text used as ornament,
fake seals, cherry blossom or any other borrowed Japanese motif. A cream paper
ground. Teal or purple accents. Emoji in the interface.

One risk stays in view: a flower circle beside a low score can flatter a noisy
forecast, so the coverage verdict always sits directly under the stamp.

## Where the numbers come from

- Scores: `closeness` in `site/src/core/scoring.ts`, with `k` from
  `scoring/constants.json`, which `scripts/calibrate_k.py` writes.
- Day marks: `dayCells` and `typicalMove` in `site/src/core/scoring.ts`.
- The band: `coverage` in the same file; the brush width is the band's half
  width in the series' units times the sheet's scale.
- Stamp and verdict: `site/src/core/verdict.ts`.
- The example round in this document, the README demo and the social cards
  ("No. 1", "You 85, AI 55", "beat the AI by 30 points", "7 of 7 days") is the
  recorded play in `site/tests/fixtures/frames-data.json`, scored by the same
  code. The puzzle and its number come from `site/tests/e2e/recorded-play.ts`
  for the tests and the demo alike, and the demo stops if the sheet shows
  another number.

## What changed from the match card

The first direction was a printed match card: a horizontal chart in green,
ochre and black. Everything it carried is still here. Dropped:

- **The day cells as a coloured strip.** Their information is now the marks
  beside each day, with the same three levels; the cells remain as a visually
  hidden list for screen readers.
- **End-of-line labels "You", "AI" and "Real".** Each column is headed instead,
  and reality is the only vermilion line.
- **The condensed display face.** A condensed sans did not fit a calligraphy
  sheet; the scores are set in the Mincho, in vermilion.
- **"Lock".** The button is "Hand it in", which is what a student does with a
  sheet. Live rounds, which are not a lesson, keep "Lock".

## How I check it

- `tests/unit/tokens.test.ts` recomputes contrast from the stylesheet, checks
  the palette's distance from default teal, purple and cream choices, and
  rejects raw sizes or colours outside `:root`.
- `tests/unit/sheet.test.ts` checks the weeks, the column geometry, the phone's
  show-through and the column headings.
- `tests/e2e/a11y.spec.ts` runs axe on every route and state and plays the
  game, Share, Live, a custom link and Your data with the keyboard alone, in
  the reading order it expects.
- `tests/e2e/reveal.spec.ts` checks the correction's timing, that a retried
  reveal lays the same ink, and that reduced motion shows the finished
  vermilion at once.
- Every state is screenshotted at 390×844 and 1280×800, and again with reduced
  motion. The signature frame test asserts that the sheet, scores, verdict and
  Share are inside the phone viewport.

## Pictures

- `site/tests/e2e/screens.spec.ts` screenshots every state of every page
  into Playwright's `test-results/`, which is not committed. Each picture is
  read before a visual change lands.
- `node scripts/record_demo.ts` films the README demo one frame at a time on a
  fixed clock and writes `docs/demo.gif`, `docs/demo.mp4` and the stills in
  `docs/stills/`.
- `node scripts/render_cards.ts` builds the link-unfurl image and the
  repository's social preview. Both are a crop of the corrected desktop sheet,
  the AI's column and yours from their names down to the scores and the
  hanamaru, with rows a little shorter than the page's so the plot fills the
  card's height and the marks read at feed size, and the verdict, the line that
  says what decided it and the series set beside it at sizes that survive a
  feed's thumbnail. The script scores the recorded play with the page's own
  scoring code and stops if the result differs from the recorded scores.

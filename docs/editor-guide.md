# Writing course notes in the tracker

The tracker stores **Markdown with LaTeX mathematics**. The visual editor is a
convenient way to edit that document; it is not a complete LaTeX document editor.
Write ordinary prose outside formulas. Put mathematical commands inside `$…$`
or `$$…$$`. Do not add `\documentclass`, `\usepackage` or `\begin{document}`.

Open **Debug → Note playground** to experiment with the complete course-note
example. Its left pane shows Markdown and its right pane is the same editor used
for your notes and discussions. Practice drafts are retained in this browser;
they do not replace any course note. Download an `.md` copy to keep it elsewhere.

## A comfortable everyday workflow

1. Open the task note and enter Edit mode.
2. Start with a heading, your explanation, a small example and your questions.
3. Use the toolbar for formatting and the **Σ** button for a formula.
4. Select text or a formula and use the yellow/blue highlighter.
5. Save with **Save** or **⌘S / Ctrl+S**. Wait for success before leaving.
6. For tutor feedback, use the task's **Copy** action, then **Insert review** when
   the answer is ready. The tracker maintains the review boundaries and Q&A link.

In the playground, visual edits update the source pane. After typing in the
source pane, click **Apply Markdown** to update the visual pane. This avoids
reparsing half-written markup while you type. **Check save/reopen** tests the
parsed document's formatting; it does not validate your mathematical reasoning
or guarantee support for unknown Markdown extensions.

## Paragraphs and headings

Separate paragraphs with one empty line. Press Enter for a new paragraph in
visual mode. Press Shift+Enter for a line break without a new paragraph.

```markdown
# Day 11 — policy gradients

This is the first paragraph.

This is the second paragraph.

## My explanation
### Worked example
#### A detail
##### A smaller detail
###### The smallest heading
```

Use headings for structure, not bold text alone. All six levels are supported;
the toolbar's Heading button toggles level 2. Other levels can be written in
source mode. A soft newline in source is not a reliable paragraph separator.

## Emphasis and highlighting

```markdown
**bold**   *italic*   ~~crossed out~~   ++underlined++

==yellow highlight==   ^^blue highlight^^

!!question-colour highlight!!   %%todo-colour highlight%%

==This includes $Q_\theta$ and keeps the surrounding spaces.==

==`inline code can be highlighted too`==
```

Bold, italic and strike are common Markdown. Underlining and coloured highlights
are tracker extensions: other Markdown readers may show their delimiters.
Use `\=` or `\$` when you need a literal punctuation character instead of markup.

- **⌘H / Ctrl+H:** yellow highlight.
- **⌘⇧H / Ctrl+Shift+H:** blue highlight.
- Applying the same colour to a fully highlighted selection removes it.
- Choosing a different colour recolours the selection.
- With no text selected, a prose highlight controls the text you type next.
- A code-block cursor colours the whole code box; a range touching that box does
  the same. A formula highlights as one object, including `\boxed{…}` and fractions.
- To highlight text inside a quote, select its prose normally.

The toolbar also works when your browser or operating system intercepts a
keyboard shortcut. For example, macOS may reserve ⌘H to hide an application.

## Formulas: write, select, edit, convert, delete

For inline mathematics, type `$x^2$` in the visual editor, paste Markdown, or use
**Σ → Inline**. The formula sits inside a sentence:

```markdown
The value is $V_\phi(s_t)$ and the advantage is $G_t - V_\phi(s_t)$.
```

For a separate display, choose **Σ → Display**, or paste/write this in Markdown
source. Display typing is not a special triple-dollar language.

```markdown
$$
\boxed{A(s,a)=Q(s,a)-V(s)}
$$
```

**Click once** to select a formula. The selected outline and action bar let you
highlight it, edit it, change layout or delete it. **Enter** or **double-click**
opens the LaTeX editor with a live preview. **⌘Enter / Ctrl+Enter** applies the
edit; Escape or Cancel discards it. **Delete / Backspace** removes a selected
formula, and Undo restores it. The formula editor also has a Delete button.

**To inline** changes a display into a formula in a normal paragraph. It does not
silently merge your surrounding paragraphs. Put the cursor at that paragraph's
start and press Backspace if you want to join it to the previous paragraph.
**To display** splits a sentence around its formula, preserving both text sides.
In the formula editor, choose the layout and click Apply; Cancel leaves the
original untouched. The selected-formula action bar applies conversion directly.

Some useful LaTeX building blocks:

| Write inside a formula | Meaning |
| --- | --- |
| `x_t`, `x^2`, `x_{t+1}` | Subscripts and superscripts |
| `\frac{a}{b}`, `\sqrt{x}` | Fraction and square root |
| `\sum_{t=0}^{T}`, `\prod_i` | Sum and product |
| `\mathbb{E}`, `\mathbb{R}` | Expectation symbol, real numbers |
| `\theta`, `\pi`, `\gamma` | Greek letters |
| `\nabla_\theta`, `\partial x` | Derivatives |
| `\left( ... \right)` | Automatically sized brackets |
| `\mid`, `\to`, `\approx`, `\le` | Conditional bar, arrow, comparisons |
| `\text{fixed target}` | Ordinary words inside mathematics |
| `\boxed{a=b}` | Box around an expression |
| `\underbrace{x}_{\text{meaning}}` | Annotated underbrace |

For aligned derivations, use `&` for alignment and `\\` to end a row:

```markdown
$$
\begin{aligned}
G_t &= r_t + \gamma G_{t+1} \\
A_t &= G_t - V(s_t)
\end{aligned}
$$
```

Matrices and piecewise expressions:

```markdown
$$
\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}
\qquad
f(x)=\begin{cases}x^2 & x\ge 0 \\ 0 & x<0\end{cases}
$$
```

Use KaTeX-supported math commands. Full LaTeX packages, automatic equation
numbering across the document and `\label`/`\ref` workflows are not implemented.
You can write an ordinary “Equation 1” label beside a display. Keep formulas in
table cells inline and on one source line. Inline formulas may span source lines
elsewhere, but cannot contain blank lines separating paragraphs.

## Code and boxed literal text

Use single backticks for `inline code`. For a larger box, use a fenced code block
and optionally name the language. Code stays literal: dollars, highlighting
markers and backslashes inside it are not interpreted as math or formatting.

````markdown
```python
advantage = (returns - values).detach()
loss = -(log_probs * advantage).mean()
```
````

Use `text` for a plain literal box. To put triple backticks inside a fenced
example, surround the example with four backticks. The editor chooses a safe
fence length automatically when saving. In a code block Tab inserts indentation.

To create a box containing formatted prose and formulas, use a **blockquote**
instead of a code fence:

```markdown
> **Key idea:** compare $Q(s,a)$ with $V(s)$.
>
> This second paragraph belongs to the same quote.
```

### How whole-box highlights are stored

Ordinary Markdown has no block highlight syntax. The tracker puts an ignorable
HTML comment directly above the display/code block, with a blank line between:

````markdown
<!-- note-highlight:blue -->

$$
\boxed{A=Q-V}
$$

<!-- note-highlight:yellow -->

```text
A literal box, highlighted as a whole.
```
````

Supported colour names are `yellow`, `blue`, `question` and `todo`. Each comment
applies to exactly one following display formula or complete fenced code block.
You normally create/remove it with the highlighter. Other Markdown readers may
ignore the colour, but the original mathematics/code remains readable.

## Lists, checklists and separators

```markdown
1. Explain the result.
2. Derive it from memory.
   - Check each assumption.
   - Work through a small numerical case.

- [x] Read the explanation.
- [ ] Reproduce the proof.
  - [ ] Check the boundary case.

---
```

In visual mode, Enter continues the list; Enter on an empty item exits it.
Tab/Shift+Tab indent/outdent a list item. To continue an item's explanation in
source, indent the continuation to its text column. Checkboxes inside a note
record note-local checks; they do not automatically change roadmap task status.

## Tables

```markdown
| Symbol | Interpretation | Example |
| --- | --- | --- |
| $G_t$ | Return | $5$ |
| $V(s_t)$ | Baseline | $3$ |
```

Create a table in Markdown mode, then edit its cells visually. Use `\|` for a
literal pipe in a cell. GFM tables are for simple inline content: avoid display
formulas, multiple paragraphs, merged cells and nested block lists. The formula
controls refuse display conversion inside a table. Advanced row/column controls
are not yet exposed in the formatting toolbar; use source to add rows/columns.

## Links and images

```markdown
[Resource title](https://example.com/resource)

![Description of my diagram](https://example.com/diagram.png)
```

Replace the example URLs with real accessible addresses. An image is a link to
an image, not an upload: pasting a local Finder path does not upload its file.
Keep a useful alt description. Resource linking and PDF screenshot captures use
their dedicated tracker controls. Arbitrary iframes or HTML embeds are not part
of the supported editor format.

## Questions, tutor reviews and my own work

Keep your first attempt in the task note before inserting the tutor review.
Use clear section headings such as **My explanation**, **Worked example** and
**Questions for the tutor**. The task Copy action includes your note and linked
questions; Insert review appends the selected review and creates its Q&A source.
Let those controls create the `tutor-review` comment boundaries. Do not invent,
reuse or edit their IDs by hand.

In regular task/resource notes, prose containing `??` is treated as a question
marker, and `todo!` as a todo marker when saved through the note workflow:

```markdown
Why is this estimator unbiased??

todo! Derive the baseline cancellation without looking it up.
```

Markers in code/formulas are literal. A coloured highlight by itself is not a
new Q&A question. In a Q&A review editor, select a passage and choose **Ask**
(⌘D / Ctrl+D), write the follow-up, then save to persist it. The playground
demonstrates formatting and does not create questions or tutor-review records.

## Saving, source mode and limits

- Visual edits have Undo/Redo. Use ⌘Z / Ctrl+Z or the toolbar.
- Markdown switches to the stored document's source. Visual editor parses that
  source back into the supported schema; this can normalize formatting.
- Save failures leave the current editor draft visible. A normal course-note
  draft is not a durable autosave across navigation/reload: save before leaving.
- The playground is an exception: it saves its practice draft in local browser
  storage. Clearing browser data removes it; Download `.md` keeps a separate copy.
- Footnotes, arbitrary HTML, custom embeds and unsupported LaTeX are not
  guaranteed to survive visual editing. Source mode does not make every Markdown
  extension part of the visual schema. Keep an original `.md` copy for such work.
- Highlights colour whole formulas and code blocks. Editing a particular symbol
  or word inside a rendered formula means opening its LaTeX source.

If something looks wrong, keep the original, test a small copy in the playground,
run Check save/reopen, and consult **Debug → Editor inserts** for recorded paste
and save checks. Do not repeatedly save a visibly damaged document.

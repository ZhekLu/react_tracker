# Editing the RL algorithm map

The **Algorithm map** tab belongs to the TORL course. It offers a conceptual
hierarchy, paper-style procedures, shared mechanisms, a gradient demonstration,
and the Day 12 decision matrix. All content is local; opening the map does not
change task progress, notes, questions, or the tracker database.

Start with TD3 → **Algorithm**. Numbered, indented lines expose nested loops and
the delayed update block. Turn **Step explanations** on for commentary. Click a
small mechanism label to compare its role across papers, then choose another
algorithm to open its procedure with the corresponding steps highlighted.

The default hierarchy shows the principal branches. **Show earlier methods &
branches** reveals the foundations. Each card separates Intuition, Mechanics,
Algorithm, Gradient, Paper trail, and Recall. **Paper notation** swaps the actor
and critic symbols in TD3/SAC or adopts DDPG's superscripts; the symbol guide
explains the common convention. Display equations can be hidden in narrative
sections. Procedures always retain their math.

## Edit content from a terminal

From the application repository:

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker
# Edit content/rl-map/map.json and content/rl-map/nodes/*.md with your editor.
npm --prefix frontend run map:build
npm --prefix frontend test -- src/features/algorithm-map/mapModel.test.tsx
make build
```

Refresh the tracker after the build. The running local service serves the new
frontend without a database migration or service restart. In development, run
`npm --prefix frontend run map:build` after changing content; Vite reloads the
compiled content. `npm --prefix frontend run map:check` detects a stale bundle.
Build, dev, test, and typecheck commands generate it automatically at startup.

The generated `frontend/src/features/algorithm-map/map.generated.json` is an
ignored build artifact. Edit the source JSON/Markdown, never that bundle.

## Add a node

1. Create `nodes/your-method.md` with **all six** headings below. Use original
   wording, formulas, a complete procedure at the stated abstraction level,
   a source/version boundary, and one recall prompt.
2. Append metadata to `nodes` in `map.json`, then add labeled `edges` connecting
   it to existing nodes. The file path is relative to this directory.
3. Add its uses to relevant `mechanisms` and tag the matching algorithm steps.
4. Rebuild and check the node in both the narrow and wide reading layouts.

Example metadata:

```json
{
  "id": "your-method",
  "title": "Your method",
  "family": "path",
  "day": 13,
  "summary": "One sentence: what problem does it solve?",
  "overview": false,
  "file": "nodes/your-method.md",
  "sources": [{"label": "Original paper · Algorithm 1", "url": "https://example.org/paper"}]
}
```

Families are `foundation` (shared prerequisites), `value` (value-based control),
`score` (likelihood/score actor gradient), `path` (actor uses Q's action gradient),
and `bridge` (connections beyond the three lanes). These are learning lenses,
not mutually exclusive mathematical classes: for example SAC is stochastic
and actor-critic, while using a pathwise actor gradient.

New nodes appear automatically in their family when earlier methods/branches
are shown. `overview: true` also includes a node in the compact hierarchy.
Foundation nodes are deliberately expanded-only. Bridge nodes remain visible.
Set `notation` to `swap` for actor φ / critic θ or `ddpg` for θ^μ / θ^Q, only if
those conventions match the cited paper. Write source content using actor θ,
Q critic φ, and state-value ψ (PPO's V uses φ).

`core: true` requires the matrix metadata fields `policy`, `actions`, `data`,
`value`, `replay`, `gradient`, and `control`; the Day 12 table deliberately keeps
its fixed five-algorithm comparison. Additional core flags mark hierarchy nodes
without adding unrelated algorithms to that particular task's table.

Edges have `source`, `target`, a meaningful `label`, and `kind` such as
`builds-on`, `ingredient`, `shared-idea`, `contrast`, or `bridge`. Arrow direction
means the source contributes to or contrasts with the target according to that
label; it does not assert historical invention or a strict taxonomic parent.

Sources can use an external `url`, or a tracker `resourceId` and 1-based PDF
`page`. Existing IDs refer to this personal tracker; a fresh installation needs
its own resource IDs.

## Markdown and paper-style pseudocode

````markdown
## Idea
Explain the problem and the organizing idea.

## Mechanics
Explain each new mechanism, then show its equation.

$$
y = r + \gamma V(s')
$$

## Algorithm
**Algorithm · Name and version**

```algorithm
Initialize parameters
for each iteration do
  Sample minibatch $\mathcal B$ [@replay] :: Old transitions can train a new critic.
  if update is due then
    Update $\theta$ [@action-gradient] :: Optional plain-language step explanation.
  end if
end for
```

State any deliberate adaptation from the paper below the procedure.

## Gradients
Which parameters change? Which quantities are fixed? Which path remains live?

## Paper trail
Link the paper's section/equation/algorithm and distinguish evidence from theory.

## Recall
A question that makes the learner reconstruct one connection.
````

Use **two spaces per nesting level**, one statement per line, and inline `$…$`
for math in `algorithm` blocks. `[@mechanism-id]` is optional and belongs at the
end of the statement, before an optional ` :: explanation`. Explanations are
plain text and hidden until the reader enables them. Display-math `$$` delimiters
must be on their own lines, especially for `aligned` blocks. No raw HTML is needed.

To add a shared mechanism, append an object with `id`, `title`, `question`,
`summary`, `distinction`, and `uses: [{"node":"your-method","role":"..."}]`.
Use the role to say exactly how the method uses the idea; use the distinction to
prevent a likely conflation. Tags link steps to this entry. Cross-paper links
highlight all matching steps when they open a procedure.

The compiler validates node IDs, references, required sections, core metadata,
source URLs, math syntax, and indentation. The rendering tests check every card
in both notation conventions and the gradient demo against finite differences.
These checks cannot prove mathematical claims: content edits still need a
paper/lecture review. See [RESEARCH.md](RESEARCH.md) for the current source boundary.

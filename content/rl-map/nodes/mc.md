## Idea
**Wait for a sampled return, then fit it.** Monte Carlo prediction uses completed episodes rather than a bootstrapped next-state value.

## Mechanics

$$
V(s)\leftarrow V(s)+\eta\,[G_t-V(s)].
$$

First-visit MC updates a state once per episode using its first visit; every-visit MC uses every visit. Neither target bootstraps. Full returns can have high variance.

## Algorithm
**Algorithm · first-visit Monte Carlo prediction**

```algorithm
Initialize $V(s)$ and visit counts $N(s)$
for each episode do
  Generate a complete episode under the policy $\pi$
  Compute every return $G_t$ backwards from the terminal state
  for each state’s first occurrence at time $t$ in the episode do
    $N(s_t)\leftarrow N(s_t)+1$
    $V(s_t)\leftarrow V(s_t)+(G_t-V(s_t))/N(s_t)$
  end for
end for
```

Every-visit MC uses every occurrence instead. MC control learns action values and improves an exploratory policy; it additionally needs sufficient action coverage.

## Gradients
With a differentiable V, regress V to a detached return. This is a value gradient, not REINFORCE. REINFORCE uses the same sampled return to weight a policy log-probability gradient.

## Paper trail
Sutton & Barto, Chapter 5; Day 5 Blackjack and importance-sampling experiments.

## Recall
**Check:** MC prediction and REINFORCE can both use complete returns but update different objects: value estimates versus policy parameters.

## Idea
**Mix return horizons, or carry eligibility backwards.** Lambda-returns connect TD’s short horizon with MC’s long horizon.

## Mechanics
For an episode ending at T:

$$
G_t^\lambda=(1-\lambda)\sum_{n=1}^{T-t-1}\lambda^{n-1}G_t^{(n)}+\lambda^{T-t-1}G_t.
$$

The final MC term keeps the finite-episode weights summing to one. In accumulating tabular TD(lambda):

$$
e_t(s)=\gamma\lambda e_{t-1}(s)+\mathbf1\{s=s_t\},\qquad V(s)\leftarrow V(s)+\eta\delta_t e_t(s).
$$

Forward/backward equivalence requires appropriate conventions; naive online accumulating traces do not exactly reproduce every forward-view update with changing weights.

## Algorithm
**Algorithm · accumulating tabular TD(λ)**

```algorithm
Initialize $V$
for each episode do
  Reset eligibility $e(s)=0$ for all states
  for each transition $(s,a,r,s',d)$ under the policy do
    $\delta\leftarrow r+\gamma(1-d)V(s')-V(s)$ [@bootstrap]
    $e(x)\leftarrow\gamma\lambda e(x)$ for all states $x$ [@gae]
    $e(s)\leftarrow e(s)+1$
    $V(x)\leftarrow V(x)+\eta\delta e(x)$ for all states $x$
  end for
end for
```

For the forward view, construct the finite-episode lambda-return from the Mechanics tab and update toward it. Exact online equivalence requires the appropriate variant; do not equate all changing-weight online implementations with the offline forward view.

## Gradients
Eligibility tracks credit to past states/parameters. It is not differentiation through environmental dynamics. GAE reuses related weighted-TD-residual machinery to estimate an actor’s advantage.

## Paper trail
Sutton & Barto, §12.1–12.3; Day 8 forward-view derivation.

## Recall
**Check:** lambda controls how signals propagate through time; PPO epsilon controls tolerated policy-ratio improvement. They solve different problems.

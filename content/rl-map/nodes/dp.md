## Idea
**Use a known transition/reward model to alternate evaluation and improvement.** This is the planning ancestor of the actor-critic loop.

## Mechanics
Policy evaluation:

$$
V(s)\leftarrow\sum_a\pi(a\mid s)\sum_{s',r}p(s',r\mid s,a)[r+\gamma V(s')].
$$

Greedy improvement chooses actions maximizing that one-step lookahead. Value iteration combines a short evaluation backup and improvement:

$$
V(s)\leftarrow\max_a\sum_{s',r}p(s',r\mid s,a)[r+\gamma V(s')].
$$

Generalized policy iteration (GPI) is the interaction between evaluation and improvement, even when neither is completed before the other proceeds.

## Algorithm
**Algorithm · policy iteration (known model)**

```algorithm
Initialize $V$ and policy $\pi$; set terminal values to zero
repeat
  repeat
    Sweep states: $V(s)\leftarrow\sum_a\pi(a\mid s)\sum_{s',r}p(s',r\mid s,a)[r+\gamma V(s')]$ [@bootstrap]
  until evaluation converges to the chosen tolerance
  $\pi_{\mathrm{old}}\leftarrow\pi$
  For each state, make $\pi$ greedy with respect to $\sum_{s',r}p(s',r\mid s,a)[r+\gamma V(s')]$
until policy is stable (with a consistent tie-breaking rule)
```

**Algorithm · value iteration (known model)**

```algorithm
Initialize $V$; set terminal values to zero
repeat
  For each nonterminal state: $V(s)\leftarrow\max_a\sum_{s',r}p(s',r\mid s,a)[r+\gamma V(s')]$ [@bootstrap]
until the chosen residual tolerance is reached
Extract a policy greedy with respect to the final one-step lookahead
```

These procedures use finite discounted or suitable episodic assumptions. Generalized policy iteration names the broader evaluation/improvement interaction, not a third fixed loop.

## Gradients
Tabular dynamic programming uses sums and maxima, not backpropagation. A later actor parameterizes the improvement step; a critic approximates evaluation.

## Paper trail
Sutton & Barto, Chapter 4; your gridworld, gambler’s problem, and GPI comparison.

## Recall
**Check:** DP knows a model; TD learns from sampled transitions. Both can bootstrap.

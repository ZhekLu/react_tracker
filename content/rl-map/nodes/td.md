## Idea
**Learn before an episode ends by bootstrapping.** TD(0) evaluates a policy from a one-step reward and its own estimate of the continuation.

## Mechanics

$$
\delta_t=r_t+\gamma(1-d_t)V(s_{t+1})-V(s_t),\qquad V(s_t)\leftarrow V(s_t)+\eta\delta_t.
$$

A TD residual is a sampled consistency error. Its expected value conditional on a state/action can provide an advantage signal when V is accurate; a noisy residual is not the exact advantage.

## Algorithm
**Algorithm · tabular TD(0) prediction**

```algorithm
Initialize $V$; use zero continuation value at true terminal states
for each episode do
  Initialize state $s$
  while episode has not ended do
    Sample $a\sim\pi(\cdot\mid s)$; observe $r,s',d$
    $\delta\leftarrow r+\gamma(1-d)V(s')-V(s)$ [@bootstrap]
    $V(s)\leftarrow V(s)+\eta\delta$
    $s\leftarrow s'$
  end while
end for
```

With approximation, replace the table update by $\psi\leftarrow\psi+\eta\delta\nabla_\psi V_\psi(s)$ and detach the target. At a nonterminal time-limit cutoff, bootstrap from the final observation.

## Gradients

$$
L_V=\tfrac12(V_\psi(s)-\operatorname{sg}[r+\gamma(1-d)V_\psi(s')])^2.
$$

Differentiate the prediction only. A moving target across steps is compatible with a detached target within one step.

## Paper trail
Sutton & Barto, §6.1 and Chapter 9; Days 7 and 9.

## Recall
**Check:** bootstrapping means learning from an estimate, not resampling a dataset as in statistical bootstrap.

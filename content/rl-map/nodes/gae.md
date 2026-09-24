## Idea
**Estimate how much better an action was than the state’s baseline by mixing TD residuals.** GAE is an estimator used inside actor-critic, not a standalone control algorithm.

## Mechanics

$$
\hat A_t^{\mathrm{GAE}(\gamma,\lambda)}=\sum_{l\ge0}(\gamma\lambda)^l\delta_{t+l},\quad\delta_t=r_t+\gamma V(s_{t+1})-V(s_t).
$$

At lambda=0 use one TD residual; at lambda=1 telescope to a return minus V (with finite-horizon bootstrap if needed). Intermediate lambda blends horizons.

## Algorithm
**Procedure · finite-rollout generalized advantage estimation**

```algorithm
Input rewards, old value predictions, true-terminal mask $d_t$, episode-boundary mask $b_t$
Initialize $\hat A_T=0$
for $t=T-1,\ldots,0$ backwards do
  $\delta_t\leftarrow r_t+\gamma(1-d_t)V_{\mathrm{old}}(s_{t+1})-V_{\mathrm{old}}(s_t)$ [@bootstrap]
  $\hat A_t\leftarrow\delta_t+\gamma\lambda(1-b_t)\hat A_{t+1}$ [@gae]
  $\hat R_t\leftarrow\hat A_t+V_{\mathrm{old}}(s_t)$
end for
Return detached $\hat A_t$ and $\hat R_t$
```

At a time-limit truncation, $b_t=1$ stops the trace but $d_t=0$ permits bootstrapping from the **final observation**, not the reset observation. At true termination both masks are 1.

## Gradients
GAE supplies weights for a later actor loss. Do not let the policy optimizer change its target by backpropagating through advantage construction.

## Paper trail
Schulman et al., *High-Dimensional Continuous Control Using Generalized Advantage Estimation* (2016); PPO Eqs. 11–12; your lambda/GAE follow-ups.

## Recall
**Check:** GAE estimates a signal; PPO decides how aggressively to act on it.

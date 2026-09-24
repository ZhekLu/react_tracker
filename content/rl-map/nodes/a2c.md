## Idea
**A synchronous advantage actor-critic implementation.** A2C gathers rollouts from several environments, aggregates their gradients, and updates one shared policy/value model.

## Mechanics

$$
L_\pi=-\mathbb E[\operatorname{sg}(\hat A)\log\pi_\theta(a\mid s)]-c_H\mathcal H(\pi_\theta),\quad L_V=\mathbb E[(V_\psi-\operatorname{sg}(\hat R))^2].
$$

A3C uses asynchronous workers instead. Actor-critic is the family; these names describe particular training organizations.

## Algorithm
**Procedure · synchronous advantage actor-critic**

```algorithm
Initialize stochastic actor, value critic, and parallel environments
repeat
  Collect short current-policy rollouts from all environments
  Bootstrap each nonterminal segment’s final value; zero true-terminal values [@bootstrap]
  Compute fixed n-step returns $\hat R$ and advantages $\hat A=\hat R-V_{\mathrm{old}}$
  $L_\pi\leftarrow-\mathbb E[\operatorname{sg}(\hat A)\log\pi_\theta(a\mid s)]-c_H\mathcal H(\pi_\theta)$ [@score]
  $L_V\leftarrow\mathbb E[(V_\psi(s)-\operatorname{sg}(\hat R))^2]$
  Aggregate workers and take one synchronous optimizer step
until training budget exhausted
```

A3C updates asynchronously from workers. Common A2C does not use PPO’s repeated clipped epochs.

## Gradients
Advantage-weighted score gradient at stored rollout actions. A shared trunk can receive both policy and value gradients; the advantage target is detached.

## Paper trail
Mnih et al., asynchronous actor-critic (2016); PPO paper’s A2C comparison; your question Q-pf0d5fb-00-006.

## Recall
**Check:** A2C is actor-critic, but DDPG being actor-critic does not make it A2C.

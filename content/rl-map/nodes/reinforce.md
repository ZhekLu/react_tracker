## Idea
**Increase the likelihood of sampled actions in proportion to their return.** A stochastic policy is learned directly; no action-value maximization is required.

## Mechanics
For a discounted episodic start-state objective:

$$
\hat g=\sum_t\gamma^t\,[G_t-b(s_t)]\nabla_\theta\log\pi_\theta(a_t\mid s_t).
$$

The outer discount can be absorbed into the state-sampling convention in other presentations. A state-only baseline has zero expected score contribution:

$$
\mathbb E_{a\sim\pi}[b(s)\nabla_\theta\log\pi(a\mid s)]=b(s)\nabla_\theta\sum_a\pi(a\mid s)=0.
$$

A suitable baseline reduces variance without changing the expected gradient. It must be detached for the actor update. An action-dependent subtraction is not generally valid without correction.

## Algorithm
**Algorithm · REINFORCE with a learned state baseline**

```algorithm
Initialize stochastic policy $\pi_\theta$ and baseline $V_\psi$
for each episode do
  Generate a full episode using the policy $\pi_\theta$
  Compute returns $G_t$ backwards
  for each time $t$ in that episode do
    $A_t\leftarrow\operatorname{sg}[G_t-V_\psi(s_t)]$
    $\psi\leftarrow\psi+\eta_V[G_t-V_\psi(s_t)]\nabla_\psi V_\psi(s_t)$
    $\theta\leftarrow\theta+\eta_\pi\gamma^t A_t\nabla_\theta\log\pi_\theta(a_t\mid s_t)$ [@score] :: Hold the sampled action and advantage fixed.
  end for
end for
```

This follows the textbook episodic presentation. A batch implementation accumulates a policy gradient at the rollout policy before updating. Plain REINFORCE omits baseline fitting and uses $A_t=G_t$. The outer discount reflects the discounted start-state objective.

## Gradients
Score-function estimator: hold the action fixed, differentiate its log probability. Neither reward nor the environment needs to be differentiable with respect to action. This works for discrete actions as well as continuous distributions.

## Paper trail
Sutton & Barto, §13.1–13.4; Berkeley Lecture 5; Day 11 hand derivation. A learned baseline alone does not make this bootstrapped actor-critic in the book’s sense.

## Recall
**Check:** a negative advantage reduces an action’s probability relative to alternatives; it does not mean the raw reward must be negative.

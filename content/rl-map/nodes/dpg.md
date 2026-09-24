## Idea
**For continuous actions, move the policy output uphill on a differentiable Q surface.** DPG is the theoretical actor-gradient basis for DDPG.

## Mechanics

$$
\nabla_\theta J\propto\mathbb E_{s\sim d^\mu}[(D_\theta\mu_\theta(s))^\top\nabla_aQ^\mu(s,a)|_{a=\mu_\theta(s)}].
$$

The proportionality depends on normalized versus unnormalized discounted occupancy. Smoothness and other theorem assumptions matter. No action-sampling integral appears for a deterministic policy, but states still need sampling and Q still needs estimation.

## Algorithm
Parameterize a deterministic policy, estimate its Q-function, compute the critic action slope and actor Jacobian, and ascend the resulting actor gradient. DDPG adds the concrete deep-network/replay/target machinery; DPG alone does not specify that full implementation.

## Gradients
It is still a policy gradient: the final derivative is with respect to policy parameters. The action derivative is an intermediate factor supplied by the chain rule.

## Paper trail
Silver et al., *Deterministic Policy Gradient Algorithms* (2014); UniPD Lecture 22, comparison around slide 74.

## Recall
**Check:** “gradient through the action” does not mean the environment is differentiable.

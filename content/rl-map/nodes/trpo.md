## Idea
**Optimize a policy surrogate subject to a limit on policy change.** This is the trust-region motivation behind PPO.

## Mechanics

$$
\max_\theta\ \mathbb E_t[\rho_t(\theta)\hat A_t]\quad\text{subject to}\quad\mathbb E_t[D_{\mathrm{KL}}(\pi_{\mathrm{old}}\|\pi_\theta)]\le\delta.
$$

The practical average-KL constraint approximates the stronger conditions in the theoretical bound. PPO’s clipping does not implement this exact constraint.

## Algorithm
Collect rollouts under the old policy, estimate advantages, form the surrogate and KL curvature, approximately solve for a trust-region direction (e.g. conjugate gradients with Fisher-vector products), then backtrack to accept a step satisfying the practical improvement/KL checks. Fit the value baseline separately. This is a mechanism-level outline; Day 12 does not require the numerical solver derivation.

## Gradients
The surrogate is score-function based. Curvature changes how the parameter step is chosen, not whether gradients differentiate through environment actions.

## Paper trail
Schulman et al., *Trust Region Policy Optimization* (2015); UniPD Lecture 21. Your Day 12 plan asks for the constraint intuition only.

## Recall
**Check:** TRPO constrains a policy divergence; TD3 constrains neither KL nor probability ratios.

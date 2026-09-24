## Idea
**Evaluate a target policy using data from another policy.** This is a different objective from learning a policy that improves itself.

## Mechanics
For complete episodic returns, a trajectory ratio is

$$
w_i=\prod_t\frac{\pi(a_t^i\mid s_t^i)}{\beta(a_t^i\mid s_t^i)}.
$$

Ordinary IS: $\hat J=\frac1n\sum_i w_iG_i$. Weighted IS: $\hat J=\frac{\sum_iw_iG_i}{\sum_iw_i}$ when the denominator is nonzero. Ordinary IS is unbiased under suitable assumptions; self-normalization generally introduces finite-sample bias but can reduce variance. Support is necessary, not sufficient for useful variance.

## Algorithm
Specify the target policy and estimand. Check that behavior has support wherever the target matters; use known/reliably estimated propensities with their assumptions. Compute ratios and the chosen estimator, diagnose weight concentration, and quantify uncertainty. A zero weighted denominator means the estimator is undefined, not evidence of zero return.

## Gradients
No policy gradient is needed when evaluating a fixed target. Importance ratios in OPE, PPO, and off-policy multistep learning appear in different objectives; they are not interchangeable remedies.

## Paper trail
Sutton & Barto, §5.5–5.7 and §5.9; your Day 5 ordinary/weighted IS experiment and Day 12 self-normalization follow-up.

## Recall
**Check:** a denominator normalization cannot invent rewards for unsupported actions.

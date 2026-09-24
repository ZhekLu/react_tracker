## Idea
**Reuse a recent batch without repeatedly rewarding excessive policy change.** PPO keeps a snapshot of the policy that collected a rollout, then performs several minibatch epochs against that snapshot.

It is a stochastic policy-gradient method, usually implemented with a value critic. Its central control acts on a **probability ratio**, not on critic overestimation.

## Mechanics
### Old actions, new probabilities

$$
\rho_t(\theta)=\frac{\pi_\theta(a_t\mid s_t)}{\pi_{\theta_{\mathrm{old}}}(a_t\mid s_t)}.
$$

The numerator changes after every optimizer step. Old log probabilities and advantage estimates remain fixed for the rollout's optimization phase. The batch is already stale after the **first minibatch**, not only after the first epoch.

### Remove the incentive for too much of a good thing

$$
L^{\mathrm{CLIP}}=\mathbb E_t\!\left[\min\big(\rho_t\hat A_t,\operatorname{clip}(\rho_t,1-\varepsilon,1+\varepsilon)\hat A_t\big)\right].
$$

| Advantage | Beneficial movement | Where this sample's surrogate becomes flat |
| --- | --- | --- |
| $\hat A>0$ | Increase this action's probability | $\rho>1+\varepsilon$ |
| $\hat A<0$ | Decrease this action's probability | $\rho<1-\varepsilon$ |

Bad-direction movement is still penalized. **The clipping does not force all ratios into an interval**, and is not a hard KL constraint. Other samples, value loss, entropy, and shared parameters can still move the policy after one sample's term is flat.

### GAE supplies the advantage; clipping controls its use

$$
\delta_t=r_t+\gamma(1-d_t)V_{\phi_{\mathrm{old}}}(s_{t+1})-V_{\phi_{\mathrm{old}}}(s_t)
$$

$$
\hat A_t=\delta_t+\gamma\lambda\delta_{t+1}+(\gamma\lambda)^2\delta_{t+2}+\cdots.
$$

The sum stops at the rollout/episode boundary with appropriate bootstrapping. $\lambda$ trades reliance on the value estimate against longer sampled returns. GAE is related to the $\lambda$-return machinery; it is an advantage estimator, not another policy optimizer.

## Algorithm
**Algorithm · PPO-Clip, actor-critic style**

```algorithm
Require rollout size $N T$, minibatch size $M$, epochs $K$, clip width $\varepsilon$
Initialize actor $\pi_\theta$ and value estimator $V_\phi$
for each iteration do
  Snapshot $\theta_{\mathrm{old}}\leftarrow\theta$ and old value predictions
  for environment $n=1,\ldots,N$ do
    Run $\pi_{\theta_{\mathrm{old}}}$ for $T$ steps; save $(s_t,a_t,r_t)$, boundaries, old log probabilities
    $\delta_t\leftarrow r_t+\gamma(1-d_t)V_{\mathrm{old}}(s_{t+1})-V_{\mathrm{old}}(s_t)$ [@bootstrap]
    Compute $\hat A_t$ backwards with GAE; $\hat R_t\leftarrow\hat A_t+V_{\mathrm{old}}(s_t)$ [@gae] :: Stop traces at episode boundaries; bootstrap a nonterminal cutoff.
  end for
  Freeze old log probabilities, $\hat A_t$, and $\hat R_t$ for all epochs
  for epoch $e=1,\ldots,K$ do
    Shuffle the collected batch
    for minibatch $\mathcal B$ of size $M$ do
      $\rho_t\leftarrow\exp[\log\pi_\theta(a_t\mid s_t)-\log\pi_{\theta_{\mathrm{old}}}(a_t\mid s_t)]$ [@score] :: The action stays fixed; its current density changes.
      $\ell_t^{\mathrm{clip}}\leftarrow\min(\rho_t\hat A_t,\operatorname{clip}(\rho_t,1-\varepsilon,1+\varepsilon)\hat A_t)$ [@policy-control]
      $L_V\leftarrow\mathbb E_\mathcal B[(V_\phi(s_t)-\hat R_t)^2]$
      $L\leftarrow-\mathbb E_\mathcal B[\ell_t^{\mathrm{clip}}]+c_V L_V-c_H\mathbb E_\mathcal B[\mathcal H(\pi_\theta(\cdot\mid s_t))]$ [@entropy]
      Take a first-order descent step on $L$ in actor and value parameters :: With a shared trunk, both objectives contribute to the shared weights.
    end for
  end for
  Discard rollout; collect the next batch under the updated policy
end for
```

Adapted from Algorithm 1 / Eqs. 7, 9, 11–12, with the minibatch nesting made explicit. The paper also studies adaptive KL-penalty PPO. Advantage normalization, value clipping, gradient clipping, and KL early stopping are additional implementation choices, not the definition of PPO-Clip.

## Gradients
On the active, unclipped branch:

$$
\nabla_\theta(\rho_t\hat A_t)=\rho_t\hat A_t\nabla_\theta\log\pi_\theta(a_t\mid s_t).
$$

**Updated:** actor weights $\theta$. **Held fixed:** recorded action $a_t$, state, old-policy denominator, and $\hat A_t$. The gradient changes the probability/density **assigned to this fixed action**. It does not ask $\partial Q/\partial a$ and does not differentiate through action sampling or the environment.

At $\theta=\theta_{\mathrm{old}}$, $\rho=1$, recovering the ordinary advantage-weighted score gradient locally. In the flat region this sample's clipped-surrogate gradient is zero (away from the kink).

A Gaussian PPO actor is differentiable, but this estimator still holds its sampled action fixed. **Stochastic versus deterministic policy does not by itself determine the gradient estimator.**

## Paper trail
**Read anchors:** Schulman et al. (2017), §2.1 (vanilla policy gradient), §3 (clipping and its figure), §4 (adaptive KL penalty), §5 and Algorithm 1 (actor-critic training).

Your highlights emphasize first-order optimization and repeated epochs. Your follow-ups identify the right subtleties: the sign of the advantage, stale minibatches, and shared policy/value parameters. All appear in the loop above.

- PPO is generally called **on-policy**, despite limited reuse of a just-collected batch. It is not ordinary long-lived replay like DQN or SAC.
- The ratio corrects conditional action likelihood in a surrogate under old rollout states; it does not magically correct the entire new trajectory/state distribution.
- A smaller sample's clipped objective is a lower bound on that **unclipped surrogate term**, not an unconditional lower bound on real-world policy performance.
- The entropy bonus is useful but not PPO's defining innovation. SAC additionally propagates entropy through its soft value targets.
- A2C is one member of the actor-critic family, not a synonym for every actor-critic method.

## Recall
**Try:** with $\varepsilon=0.2$, why is $\rho=1.4$ flat for $\hat A=+2$ but not for $\hat A=-2$?

**Check:** the positive-advantage objective stops at $1.2\times2=2.4$; for negative advantage the minimum selects $1.4\times(-2)=-2.8$, preserving pressure against increasing a bad action's probability.

**Transfer:** a PPO ratio compares policies. A TD3 minimum compares critics. They constrain different failure mechanisms.

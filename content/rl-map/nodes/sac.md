## Idea
**Replay + stochastic actor + a reward-and-entropy objective.** SAC learns good actions while preserving useful randomness. It can use old transitions for critic fitting and draw new actions at replay states for actor improvement.

This node describes **the original 2018 paper you read**, with an explicit soft-value network. A separate node shows the later SAC version, so its target equations never silently replace the ones in your paper.

## Mechanics
### Change the objective

$$
J(\pi)=\mathbb E_\pi\!\left[\sum_{t\ge0}\gamma^t\big(r_t+\alpha\mathcal H(\pi(\cdot\mid s_t))\big)\right],\qquad\mathcal H=-\mathbb E_a\log\pi(a\mid s).
$$

The discounted expression is our common episodic notation; the paper discusses its continuing/discounted conventions in Appendix A. $\alpha>0$ balances entropy and reward. In many of the original paper's equations it is absorbed into reward scaling.

### Soft evaluation couples Q and V

$$
Q^\pi(s,a)=\mathbb E[r+\gamma(1-d)V^\pi(s')],\qquad V^\pi(s)=\mathbb E_{a\sim\pi}[Q^\pi(s,a)-\alpha\log\pi(a\mid s)].
$$

$Q$ here includes future entropy after the fixed first action. $V$ includes the current action-distribution entropy too. The separate $V_\psi$ is a learned estimate of this expectation; it is not theoretically indispensable.

### Soft improvement explains the exponential and Z
For a frozen critic, the ideal unconstrained action density is

$$
p_Q(a\mid s)=\frac{\exp(Q(s,a)/\alpha)}{Z(s)}.
$$

Project into a tractable policy family by minimizing reverse KL:

$$
\alpha D_{\mathrm{KL}}(\pi_\theta\|p_Q)=\mathbb E_{a\sim\pi_\theta}[\alpha\log\pi_\theta(a\mid s)-Q(s,a)]+\alpha\log Z(s).
$$

$Z(s)$ does not depend on **actor** weights when the critic and state are fixed, so its actor derivative is zero. This is why the practical loss contains log-policy minus Q.

### Turn randomness into a differentiable input

$$
\epsilon\sim\mathcal N(0,I),\quad u=m_\theta(s)+\sigma_\theta(s)\odot\epsilon,\quad a=f_\theta(s,\epsilon)=\tanh u.
$$

For normalized bounds, the density must include the squashing Jacobian:

$$
\log\pi_\theta(a\mid s)=\log\mathcal N(u;m_\theta,\operatorname{diag}(\sigma_\theta^2))-\sum_j\log(1-\tanh^2u_j).
$$

Use a numerically stable expression near saturation. Affine rescaling to environment bounds adds its log-Jacobian too. A diagonal Gaussian has conditionally independent coordinates before squashing, not zero learning interaction between all action dimensions.

## Algorithm
**Algorithm · SAC, original 2018 paper**

```algorithm
Initialize $\pi_\theta$, $Q_{\phi_1},Q_{\phi_2}$, $V_\psi$, replay $\mathcal D$; fix $\alpha>0$
Initialize target value $\bar\psi\leftarrow\psi$ [@targets] :: This version has no target actor or target Q networks.
Reset environment; observe initial state $s$
for each iteration do
  for each environment step do
    Sample $a\sim\pi_\theta(\cdot\mid s)$; execute $a$ [@exploration]
    Observe $r,s',d$; store $(s,a,r,s',d)$ in $\mathcal D$ [@replay]
    $s\leftarrow s'$; reset environment if episode ended
  end for
  for each gradient step do
    Sample minibatch $\mathcal B\sim\mathcal D$ [@replay]
    Sample $\epsilon$; $a_{\mathrm{new}}\leftarrow f_\theta(s,\epsilon)$ [@action-gradient] :: Fresh current-policy action at a replay state; not the stored action.
    $y_V\leftarrow\operatorname{sg}[\min_iQ_{\phi_i}(s,a_{\mathrm{new}})-\alpha\log\pi_\theta(a_{\mathrm{new}}\mid s)]$ [@entropy]
    $\psi\leftarrow\psi-\eta_V\nabla_\psi\tfrac12\mathbb E_\mathcal B[(V_\psi(s)-y_V)^2]$
    $y_Q\leftarrow\operatorname{sg}[r+\gamma(1-d)V_{\bar\psi}(s')]$ [@bootstrap]
    for $i=1,2$ do
      $\phi_i\leftarrow\phi_i-\eta_Q\nabla_{\phi_i}\tfrac12\mathbb E_\mathcal B[(Q_{\phi_i}(s,a)-y_Q)^2]$ :: Stored replay actions train Q.
    end for
    Sample fresh $\epsilon$; $\tilde a\leftarrow f_\theta(s,\epsilon)$ [@action-gradient]
    $L_\pi\leftarrow\mathbb E[\alpha\log\pi_\theta(\tilde a\mid s)-\min_iQ_{\phi_i}(s,\tilde a)]$ [@double-estimation] :: Minimum appears in the actor and soft-value update in this version.
    $\theta\leftarrow\theta-\eta_\pi\nabla_\theta L_\pi$ [@action-gradient] :: Keep critic weights fixed; retain both action and direct log-density derivatives.
    $\bar\psi\leftarrow\tau\psi+(1-\tau)\bar\psi$ [@targets]
  end for
end for
```

Haarnoja et al., Algorithm 1 / §4.2, including the twin-Q extension described alongside the algorithm. Four learned networks + target V = five parameter sets. We expose $\alpha$, which the original equations often absorb into reward scaling. Use the tanh density correction in every log probability. Recompute forward passes after optimizer steps rather than reusing stale autograd graphs.

## Gradients
Let $Q_{\min}=\min_iQ_{\phi_i}$, with critics fixed. For one fixed noise draw:

$$
\begin{aligned}
\nabla_\theta L_\pi
=\mathbb E\big[&\alpha\,\partial_\theta\log\pi_\theta(a\mid s)\big|_{a\ \mathrm{fixed}}\\
&+(D_\theta f_\theta)^\top(\alpha\nabla_a\log\pi_\theta(a\mid s)-\nabla_aQ_{\min}(s,a))\big]_{a=f_\theta(s,\epsilon)}.
\end{aligned}
$$

Two paths matter: an **explicit** dependence of log density on actor parameters and the **action path** through both log density and Q. Autodifferentiating the reparameterized loss computes the total derivative. Away from ties, the minimum routes the Q gradient through the lower critic.

PPO holds a recorded action fixed and changes its likelihood. SAC holds random noise fixed and moves the resulting action. Both update policy parameters; only the latter uses the critic's action derivative.

No environment derivative is needed. A frozen critic's weights do **not** imply a detached critic output.

## Paper trail
**Read anchors:** Haarnoja et al. (2018), §4.1 (soft policy iteration), Eqs. 5–13 and Algorithm 1 (practical SAC), §5.2 ablations, supplement Appendix C (squashing).

Your saved questions ask where $Z$ went, why $V$ is learned, and why replay needs no behavior-policy ratio. These are three views of the same design: evaluate soft values from transitions, then improve the current actor at sampled states.

- The old replay **action** trains Q. The actor uses the old **state** but a fresh current-policy action. There is no old-action likelihood correction in that actor objective. State coverage still matters.
- The two critics' minimum is used in the **value and actor** updates here. TD3 instead uses a minimum in the target and $Q_1$ for its actor.
- The ideal maximum-entropy policy can preserve several good modes. A practical restricted policy family need not represent every separated mode.
- Exact/tabular soft-policy-iteration statements do not guarantee convergence of the practical neural-network algorithm.
- Reward scaling changes the reward/entropy balance. The original version does not have the later automatic-temperature update.
- Entropy can reduce premature policy collapse; it is not a guarantee of exploration or of learning the best policy. Evaluation may use a deterministic action even though training is stochastic.

## Recall
**Try:** reconstruct the triangle $Q\to V\to Q$, then place the actor on the $Q\to V$ side.

**Check:** $V\leftarrow Q-\alpha\log\pi$ at fresh policy actions; $Q\leftarrow r+\gamma V'$ at stored transitions; actor minimizes $\alpha\log\pi-Q$ through its sampled action.

**Transfer:** replay makes SAC off-policy. It does not make it safe to optimize actions outside the coverage of a fixed offline dataset.

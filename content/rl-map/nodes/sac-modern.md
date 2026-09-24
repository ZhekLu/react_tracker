## Idea
**A later SAC formulation removes the separate V-network.** It substitutes the sampled soft next-state value directly into the Q target and uses target Q-networks. It can also learn the entropy temperature.

Keep this separate from your original SAC paper: similar actor loss, different evaluation architecture.

## Mechanics

$$
a'=f_\theta(s',\epsilon'),\quad y=r+\gamma(1-d)[\min_iQ_{\bar\phi_i}(s',a')-\alpha\log\pi_\theta(a'\mid s')].
$$

Two online Q-functions and two target copies replace the original online/target V pair. There is still no target actor. The current actor supplies fresh target actions.

Automatic temperature tuning targets a desired expected entropy $\mathcal H_*$, a differential entropy that can be negative in continuous spaces:

$$
L_\alpha=\mathbb E[-\alpha\operatorname{sg}(\log\pi_\theta(a\mid s)+\mathcal H_*)],\quad\alpha>0.
$$

One may parameterize $\alpha=e^\beta$; a common log-temperature surrogate changes gradient scaling. Do not confuse these optimizer parameterizations with a different entropy constraint.

## Algorithm
**Algorithm · Later SAC with automatic temperature**

```algorithm
Initialize actor, twin Qs, twin target Q copies, replay, and $\alpha=e^\beta>0$
repeat
  Collect current-policy transitions; append to replay $\mathcal D$ [@replay]
  for each gradient step do
    Sample $(s,a,r,s',d)\sim\mathcal D$
    Sample $a'\leftarrow f_\theta(s',\epsilon')$ using the current actor [@action-gradient]
    $y\leftarrow\operatorname{sg}[r+\gamma(1-d)(\min_iQ_{\bar\phi_i}(s',a')-\alpha\log\pi_\theta(a'\mid s'))]$ [@entropy]
    Minimize $\mathbb E[(Q_{\phi_i}(s,a)-y)^2]$ for each critic $i$ [@bootstrap]
    Sample $\tilde a\leftarrow f_\theta(s,\epsilon)$
    Minimize $L_\pi=\mathbb E[\alpha\log\pi_\theta(\tilde a\mid s)-\min_iQ_{\phi_i}(s,\tilde a)]$ over $\theta$ [@action-gradient]
    Minimize $L_\alpha=-\mathbb E[e^\beta\operatorname{sg}(\log\pi_\theta(\tilde a\mid s)+\mathcal H_*)]$ over $\beta$ [@entropy] :: Optional: omit this line for fixed temperature.
    $\bar\phi_i\leftarrow\tau\phi_i+(1-\tau)\bar\phi_i$ for $i=1,2$ [@targets]
  end for
until training budget exhausted
```

No V network and no target actor. The current actor supplies next actions; target Qs supply their values. The common log-temperature surrogate uses a different gradient scaling from the exponential parameterization written here.

## Gradients
The reparameterized actor gradient has the same direct log-density and action-through-Q paths as original SAC. Detach the Q target; hold $\alpha$ fixed during the actor step and detach actor outputs during the temperature step.

## Paper trail
**Source:** Haarnoja et al., *Soft Actor-Critic Algorithms and Applications* (2018), practical algorithm and automatic entropy adjustment. This is a version bridge, not extra Day 12 memorization.

## Recall
**Check:** original SAC targets Q with $V_{\bar\psi}(s')$; this version targets Q with a sampled $Q_{\bar\phi}(s',a')-\alpha\log\pi(a'\mid s')$.

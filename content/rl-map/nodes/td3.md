## Idea
**DDPG + three controls on critic error.** The actor searches for high predicted value; this can select a real opportunity or an error in the critic. Bootstrapping can then carry that error backwards to other states.

Think: **estimate → improve → change the target → estimate again**. The actor and critic are coupled even though their optimizers update different weights.

## Mechanics
### 1 · A second opinion for the target
A single optimistic estimate can sustain a bad action. Two separately initialized critics learn the **same** target, using the smaller target prediction:

$$
y=r+\gamma(1-d)\min_{i=1,2}Q_{\bar\phi_i}(s',\tilde a').
$$

This can introduce underestimation. It is not a certified lower bound on true return: both critics can be wrong together. Sharing data and targets makes their errors correlated.

### 2 · Let evaluation catch up with improvement
Update both critics each training iteration. Update the actor **and all three target networks only every $k$ iterations**; the paper uses $k=2$. Delay is a schedule, not a test that the critic has converged.

### 3 · Value a neighborhood, not an isolated spike

$$
\xi=\operatorname{clip}(\epsilon,-c,c),\qquad \epsilon\sim\mathcal N(0,\sigma_{\mathrm{smooth}}^2 I)
$$

$$
\tilde a'=\operatorname{clip}\big(\mu_{\bar\theta}(s')+\xi,a_{\min},a_{\max}\big).
$$

A noisy target action approximates averaging over a small neighborhood over repeated updates. It is **not** an explicit convolution of the whole critic, nor an average of many actions at each individual state in Algorithm 1.

| Noise | Where it goes | Job |
| --- | --- | --- |
| Exploration noise | Online actor's environment action | Collect experience |
| Smoothing noise | Target actor's next action inside the backup | Regularize the critic target |

These noises are independently chosen. Smoothing resembles an Expected SARSA backup under a perturbed target policy; it does not make TD3 on-policy.

## Algorithm
**Algorithm · Twin Delayed DDPG (TD3)**

```algorithm
Require delay period $k$, smoothing scale $\sigma_s$, clip $c$, target rate $\tau$
Initialize actor $\mu_\theta$, critics $Q_{\phi_1},Q_{\phi_2}$, and replay $\mathcal D$
Initialize targets $\bar\theta\leftarrow\theta$, $\bar\phi_i\leftarrow\phi_i$ for $i=1,2$ [@targets]
Reset environment; observe initial state $s$
for $t=1,\ldots,T$ do
  $a\leftarrow\operatorname{clip}(\mu_\theta(s)+\epsilon_{\mathrm{explore}},a_{\min},a_{\max})$ [@exploration] :: This noise collects data; it is distinct from target smoothing.
  Execute $a$; observe $r,s',d$; store $(s,a,r,s',d)$ in $\mathcal D$ [@replay]
  Sample minibatch $\mathcal B\sim\mathcal D$ [@replay]
  $\epsilon\sim\mathcal N(0,\sigma_s^2 I)$; $\xi\leftarrow\operatorname{clip}(\epsilon,-c,c)$ [@smoothing]
  $\tilde a'\leftarrow\operatorname{clip}(\mu_{\bar\theta}(s')+\xi,a_{\min},a_{\max})$ [@smoothing] :: One fresh noise sample per transition approximates a neighborhood expectation.
  $y\leftarrow\operatorname{sg}[r+\gamma(1-d)\min_{i=1,2}Q_{\bar\phi_i}(s',\tilde a')]$ [@double-estimation] :: Both online critics fit this same detached target.
  for $i=1,2$ do
    $\phi_i\leftarrow\phi_i-\eta_Q\nabla_{\phi_i}\mathbb E_\mathcal B[(Q_{\phi_i}(s,a)-y)^2]$ [@bootstrap]
  end for
  if $t\bmod k=0$ then [@delay] :: The paper uses k=2; this is a schedule, not a convergence test.
    $\theta\leftarrow\theta+\eta_\pi\nabla_\theta\mathbb E_{s\sim\mathcal B}[Q_{\phi_1}(s,\mu_\theta(s))]$ [@action-gradient] :: The actor uses critic 1, not min(Q1,Q2), in original TD3.
    $\bar\theta\leftarrow\tau\theta+(1-\tau)\bar\theta$ [@targets]
    $\bar\phi_i\leftarrow\tau\phi_i+(1-\tau)\bar\phi_i$ for $i=1,2$ [@targets] :: All target updates are inside the delayed block.
  end if
  $s\leftarrow s'$; reset environment if episode ended
end for
```

Fujimoto et al., Algorithm 1. We name the delay $k$ to reserve $d$ for true termination and write action bounds explicitly. Six parameter sets: one actor + two critics and their target copies. Standard evaluation omits exploration noise.

## Gradients
The actor gradient is still deterministic policy gradient:

$$
\nabla_\theta J_{\mathrm{actor}}=\mathbb E_{s\sim\mathcal D}\!\left[(D_\theta\mu_\theta(s))^\top\nabla_aQ_{\phi_1}(s,a)\big|_{a=\mu_\theta(s)}\right].
$$

**Updated:** actor weights $\theta$. **Fixed weights but differentiable input:** critic $\phi_1$. **Held fixed:** replay state $s$. Do not detach the actor action: that would destroy this gradient.

For a critic update, the situation reverses: update $\phi_i$ at the **stored action** $a$; detach the entire target. The target actor affects target values over time, but it is not optimized through that target loss.

The practical replay-state objective is not an exact claim about the current policy's discounted state occupancy.

## Paper trail
**Read anchors:** Fujimoto et al. (2018), §4 (selection bias), §5 (error accumulation, delay, smoothing), Algorithm 1 (p. 6), §6.1 ablations.

Your highlights connect three separate effects: maximization selects optimistic errors; TD backups propagate residual errors; changing the policy changes what the critic must evaluate. Keeping these separate is more useful than memorizing “overestimation” alone.

- **Your double-DQN question:** a slow actor and its target can select very similar actions. Merely borrowing the online/target split does not provide a sufficiently different second estimate in the paper's experiments.
- **Your two-actor question:** the intermediate Double-Q construction uses two actors. Final TD3 saves computation with **one** actor optimized against critic 1.
- **Your fixed-policy figure question:** Figure 3 freezes the actor, not the critic. It separates unstable evaluation from the feedback created by simultaneous policy improvement. $\tau$ controls target tracking; $\gamma$ discounts future rewards.
- **Your gradient-normalization question:** $Z_1,Z_2$ in the local overestimation argument normalize a theoretical comparison. They are not extra TD3 optimizer steps.
- **Your results-table question:** the reported maximum average return is not a convergence guarantee or simply the final return. Examine learning curves, seeds, and ablations together.
- **Boundary:** the experiments support this combination on their continuous-control benchmarks. Twin critics neither prove safety nor solve missing action coverage in offline data.

## Recall
**Before revealing an equation:** name all three changes to DDPG and locate each one in the loop.

**Check:** minimum is in the critic target; smoothing is on the target action; delay gates the actor and target updates. The actor optimizes $Q_1$, not the minimum of the two critics in the original TD3 algorithm.

**Transfer:** why would a fixed dataset worsen this? The actor can seek actions that replay never covers, and new environment interaction can no longer correct the critic there.

## Idea
**Learn an action that makes a Q-critic large.** A continuous action cannot usually be found by enumerating every possibility, so DDPG trains a deterministic actor $a=\mu_\theta(s)$ alongside $Q_\phi(s,a)$.

“Learn the argmax” is useful intuition: the actor is an amortized local maximizer of its critic. It is not guaranteed to find the global maximum or the true optimal action.

## Mechanics
### DPG supplies the improvement direction

$$
J_{\mathrm{actor}}(\theta)=\mathbb E_{s\sim\mathcal D}[Q_\phi(s,\mu_\theta(s))].
$$

The critic supplies a slope in action space; the actor Jacobian converts it into a parameter update.

### DQN supplies stabilization ideas

$$
y=r+\gamma(1-d)Q_{\bar\phi}(s',\mu_{\bar\theta}(s')).
$$

Replay trains from past experience. Slowly tracking copies of **both actor and critic** stabilize the next-action target. Actor and critic are trained every update in the baseline algorithm.

### Separate behavior from the learned deterministic policy

$$
a_{\mathrm{env}}=\operatorname{clip}(\mu_\theta(s)+\epsilon_{\mathrm{explore}},a_{\min},a_{\max}).
$$

Noise supplies exploratory data; it does not turn the underlying learned actor into a density model. The original paper used temporally correlated Ornstein–Uhlenbeck noise. Later implementations often use Gaussian noise.

## Algorithm
**Algorithm · DDPG**

```algorithm
Initialize actor $\mu_\theta$, critic $Q_\phi$, and replay $\mathcal D$
Initialize targets $\bar\theta\leftarrow\theta$, $\bar\phi\leftarrow\phi$ [@targets]
for each episode do
  Reset environment state $s$ and exploration process $\mathcal N$
  for each environment step do
    $a\leftarrow\operatorname{clip}(\mu_\theta(s)+\mathcal N_t,a_{\min},a_{\max})$ [@exploration]
    Execute $a$; observe $r,s',d$; store $(s,a,r,s',d)$ in $\mathcal D$ [@replay]
    Sample minibatch $\mathcal B\sim\mathcal D$ [@replay]
    $y\leftarrow\operatorname{sg}[r+\gamma(1-d)Q_{\bar\phi}(s',\mu_{\bar\theta}(s'))]$ [@targets]
    $\phi\leftarrow\phi-\eta_Q\nabla_\phi\mathbb E_\mathcal B[(Q_\phi(s,a)-y)^2]$ [@bootstrap]
    $\theta\leftarrow\theta+\eta_\pi\nabla_\theta\mathbb E_{s\sim\mathcal B}[Q_\phi(s,\mu_\theta(s))]$ [@action-gradient] :: Critic weights are fixed; the critic’s action input remains differentiable.
    $\bar\phi\leftarrow\tau\phi+(1-\tau)\bar\phi$ [@targets]
    $\bar\theta\leftarrow\tau\theta+(1-\tau)\bar\theta$ [@targets]
    $s\leftarrow s'$; break if episode ended
  end for
end for
```

Lillicrap et al., Algorithm 1, with explicit action bounds and terminal masks. The paper uses Ornstein–Uhlenbeck exploration and batch normalization in its experiments. Standard evaluation uses the actor without exploration noise.

## Gradients

$$
\nabla_\theta J_{\mathrm{actor}}=\mathbb E_{s\sim\mathcal D}[(D_\theta\mu_\theta(s))^\top\nabla_aQ_\phi(s,a)|_{a=\mu_\theta(s)}].
$$

Both factors serve an actor update. $\nabla_a Q$ does **not** mean “update the critic”; it means “measure how its output changes if its action input moves.” Multiplying by the actor Jacobian tells you how to change actor weights to produce that movement.

If action dimension is $m$ and the actor has $p$ parameters, $D_\theta\mu$ is $m\times p$; its transpose maps an $m$-dimensional action slope to a $p$-dimensional parameter gradient.

The deterministic policy-gradient theorem uses the relevant policy occupancy and true policy value under its assumptions. DDPG substitutes learned Q and replay states; its practical update is an approximation, not a proof that arbitrary replay is unbiased for current-policy return.

## Paper trail
**Read anchors:** Lillicrap et al. (2015/ICLR 2016), §2 (DPG), §3 (replay, soft targets, batch normalization, exploration), Algorithm 1.

This connects your Lecture 22 loss question: there is no single DDPG loss. Critic descent fits a target at stored actions; actor descent on negative Q searches for better actions.

**Failure mechanism:** a tiny critic training error on sampled actions does not guarantee a reliable action derivative elsewhere. An actor can seek exactly those places where Q is incorrectly high. This is the direct problem inherited by TD3.

## Recall
**Try:** why is the actor allowed to use an old replay state without using its old action?

**Check:** the actor objective evaluates the current actor's output at that state. The stored action belongs to the critic regression. Coverage and the critic's accuracy at new actions remain crucial.

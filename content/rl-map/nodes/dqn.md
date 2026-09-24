## Idea
**Q-learning with a neural Q-function, replay, and a delayed target.** A single forward pass produces a value for each discrete action. Action selection takes an argmax; there is no separately trained actor.

Two instability problems motivate the design: consecutive transitions are correlated, and the same changing estimator otherwise supplies both prediction and target.

## Mechanics
### Replay changes the training data stream
Store transitions, then sample random minibatches. This reuses experience and reduces short-range correlation. It does not make coverage perfect or samples completely independent.

### A target network slows the moving labels

$$
y=r+\gamma(1-d)\max_{a'}Q_{\bar\phi}(s',a'),\qquad L_Q=\mathbb E[(Q_\phi(s,a)-\operatorname{sg}(y))^2].
$$

Hold the target parameters fixed for $C$ steps, then copy $\bar\phi\leftarrow\phi$. This is different from the slow averaging used by DDPG/TD3.

The maximum both selects and evaluates an action using the target network. Selection of noisy high estimates can still cause overestimation; replay and targets do not remove it.

## Algorithm
**Algorithm · DQN (2015 core)**

```algorithm
Require finite actions; discount $\gamma$, exploration $\varepsilon$, target period $C$
Initialize $Q_\phi$; copy $\bar\phi\leftarrow\phi$; initialize replay $\mathcal D$
Initialize global environment-step counter $t\leftarrow0$
for each episode do
  Initialize state representation $s$
  for each environment step do
    $t\leftarrow t+1$
    Select $a\sim\varepsilon\text{-greedy}(Q_\phi(s,\cdot))$ [@exploration] :: Explore randomly, otherwise select a Q-maximizing action.
    Execute $a$; observe $r,s',d$; store $(s,a,r,s',d)$ in $\mathcal D$ [@replay]
    Sample minibatch $\mathcal B\sim\mathcal D$ [@replay]
    $y\leftarrow\operatorname{sg}[r+\gamma(1-d)\max_{a'}Q_{\bar\phi}(s',a')]$ [@targets] :: The whole right side is fixed during this update.
    $\phi\leftarrow\phi-\eta_Q\nabla_\phi\mathbb E_\mathcal B[\ell(Q_\phi(s,a)-y)]$ [@bootstrap] :: Update only the prediction at the stored action.
    if $t\bmod C=0$ then
      $\bar\phi\leftarrow\phi$ [@targets]
    end if
    $s\leftarrow s'$; break if episode ended
  end for
end for
```

**Paper-specific choices:** the Nature implementation clips the TD-error contribution to $[-1,1]$ (a Huber-style derivative for $\ell$), clips rewards to their sign, stacks four preprocessed Atari frames, repeats actions, warms up replay, and uses RMSProp. The core loop above exposes these as a choice of representation, loss, and schedule; it is not a replacement for the Atari hyperparameter specification. A true terminal transition has $y=r$; a time-limit truncation may still bootstrap.

## Gradients
For the squared-error form (before the paper’s TD-error clipping):

$$
\nabla_\phi L_Q=\mathbb E[2(Q_\phi(s,a)-y)\nabla_\phi Q_\phi(s,a)].
$$

With the paper’s Huber-style loss, replace the linear residual factor by its clipped counterpart. The gradient path stays the same.

**Updated:** Q-network weights $\phi$. **Fixed:** replay $s,a$ and all of $y$. No gradient passes through the argmax used for behavior or through the target maximum.

This is a **semi-gradient TD** update: its target depends on learned values over training, but is treated as constant in this step. It is not full residual-gradient optimization of a Bellman-error expression through both sides.

## Paper trail
**Source:** Mnih et al., *Human-level control through deep reinforcement learning* (2015), Methods / Algorithm 1. Earlier 2013 DQN and later Double DQN are distinct versions.

Connect to Days 7–10: the table entry in Q-learning became a function approximator. Bootstrapping and off-policy learning remain. Adding nonlinear approximation produces the deadly-triad setting; replay and target networks are practical stabilizers, not a universal convergence theorem.

**Decision:** use the DQN family when you can enumerate discrete actions. A large continuous action space makes the inner maximization difficult, motivating a learned continuous-action actor in DDPG.

## Recall
**Try:** delete the actor from your mental diagram. Can the agent still choose an action?

**Check:** yes—evaluate the finite list of Q-values and choose a maximum. DQN learns the value surface, not a separate mapping from state to action.

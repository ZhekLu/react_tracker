## Idea
**A learned evaluator supplies the actor’s improvement signal.** Actor-critic is a broad family, including PPO, DDPG, TD3, and SAC. The one-step stochastic version below is the Day 11 bridge.

## Mechanics

$$
\delta_t=r_t+\gamma(1-d_t)V_\psi(s_{t+1})-V_\psi(s_t).
$$

$$
\theta\leftarrow\theta+\eta_\pi\gamma^t\operatorname{sg}(\delta_t)\nabla_\theta\log\pi_\theta(a_t\mid s_t).
$$

$$
\psi\leftarrow\psi+\eta_V\delta_t\nabla_\psi V_\psi(s_t).
$$

The outer discount is for the discounted episodic convention. Many practical actor-critic implementations use other occupancy/weighting conventions. Bootstrap bias replaces some MC variance; an inaccurate critic can mislead the actor.

## Algorithm
**Algorithm · one-step stochastic actor-critic (episodic)**

```algorithm
Initialize actor $\pi_\theta$ and critic $V_\psi$
for each episode do
  Initialize $s$ and discount weight $I=1$
  while episode has not ended do
    Sample $a\sim\pi_\theta(\cdot\mid s)$; observe $r,s',d$
    $\delta\leftarrow\operatorname{sg}[r+\gamma(1-d)V_\psi(s')-V_\psi(s)]$ [@bootstrap]
    $\psi\leftarrow\psi+\eta_V\delta\nabla_\psi V_\psi(s)$
    $\theta\leftarrow\theta+\eta_\pi I\delta\nabla_\theta\log\pi_\theta(a\mid s)$ [@score]
    $I\leftarrow\gamma I$; $s\leftarrow s'$
  end while
end for
```

This is the Day 11 stochastic example, not the definition of every member of the actor-critic family. Different state-occupancy conventions can change explicit discount weighting.

## Gradients
This instance uses a score gradient. The family name does not require that estimator: DDPG/TD3 use deterministic action gradients and SAC uses reparameterized ones. Do not confuse “has a critic” with “differentiates through Q’s action input.”

## Paper trail
Sutton & Barto, §13.5; Berkeley Lecture 6. This node represents a conceptual bridge, not a claim that all actor-critic algorithms use V or on-policy data.

## Recall
**Check:** the critic supplies either a weighting signal (score methods) or an action slope (pathwise methods). These are two different uses of an evaluator.

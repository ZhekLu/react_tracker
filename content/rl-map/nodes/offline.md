## Idea
**A fixed dataset removes the opportunity to correct new mistakes by interaction.** Off-policy algorithms can reuse data; offline RL must succeed without collecting additional training transitions.

## Mechanics
An actor can choose $a_{\mathrm{new}}$ absent from the data even when its state s is familiar:

$$
\mathcal D\ni(s,a_{\mathrm{logged}},r,s'),\qquad Q_\phi(s,a_{\mathrm{new}})\text{ may be extrapolation}.
$$

Maximization, bootstrapping, and distribution shift can reinforce that unsupported estimate. The minimum of two extrapolating critics need not be trustworthy.

## Algorithm
First establish dataset coverage and evaluation assumptions. Standard DQN/PPO/DDPG/TD3/SAC are online training algorithms in their original forms. Making a dataset read-only does not add an offline correction. Later offline methods modify policy improvement, value learning, or constraints; add those nodes when studied.

## Gradients
No extra derivative automatically fixes missing support. A perfectly computed gradient of an inaccurate Q-function is still the wrong learning signal.

## Paper trail
Day 12 stop condition; Levine et al., *Offline Reinforcement Learning: Tutorial, Review, and Perspectives on Open Problems* (2020). This is a problem-setting bridge, not a new algorithm.

## Recall
**Check:** stochasticity, replay, two critics, and target networks are useful tools. None individually guarantees a reliable offline policy.

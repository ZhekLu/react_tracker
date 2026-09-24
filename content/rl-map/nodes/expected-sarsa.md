## Idea
**Average over next actions instead of sampling one.** Expected SARSA removes the next-action sampling component of target variance.

## Mechanics

$$
y=r+\gamma(1-d)\sum_{a'}\pi(a'\mid s')Q(s',a').
$$

It can evaluate the behavior policy (on-policy) or a different specified target policy (off-policy). With a greedy target policy it recovers the Q-learning backup. Transition/reward randomness and estimation error remain.

## Algorithm
**Algorithm · Expected SARSA control**

```algorithm
Initialize $Q$; specify behavior $\beta$ and target policy $\pi$
for each observed transition $(s,a,r,s',d)$ from $\beta$ do
  $y\leftarrow r+\gamma(1-d)\sum_{a'}\pi(a'\mid s')Q(s',a')$ [@bootstrap]
  $Q(s,a)\leftarrow Q(s,a)+\eta[y-Q(s,a)]$
  Improve the target policy according to the chosen control rule
end for
```

An epsilon-greedy target matching behavior gives the usual on-policy form; a greedy target recovers the Q-learning backup.

## Gradients
This is a value-target choice, not a policy-gradient estimator. Averaging over actions is different from differentiating with respect to actions.

## Paper trail
Sutton & Barto, §6.6; your Day 7 comparison. TD3 smoothing shares the neighborhood-expectation intuition but uses a distinct, perturbed target actor.

## Recall
**Check:** “expected” does not imply model-based; the next state may still be sampled.

## Idea
**Evaluate and improve the policy that actually takes the next action.** SARSA’s target includes the exploratory next action.

## Mechanics

$$
y=r+\gamma(1-d)Q(s',a'),\quad a'\sim\pi(\cdot\mid s'),\qquad Q(s,a)\leftarrow Q(s,a)+\eta(y-Q(s,a)).
$$

Under epsilon-greedy control it accounts for the consequences of future exploration. This explains the safer route in your cliff-walking experiment.

## Algorithm
**Algorithm · SARSA control**

```algorithm
Initialize $Q$ and an epsilon-greedy behavior policy
for each episode do
  Initialize $s$; sample $a\sim\pi(\cdot\mid s)$
  while episode has not ended do
    Execute $a$; observe $r,s',d$
    if $d=1$ then
      $y\leftarrow r$
    else
      Sample $a'\sim\pi(\cdot\mid s')$ [@exploration]
      $y\leftarrow r+\gamma Q(s',a')$ [@bootstrap] :: This is the next action the agent actually intends to take.
    end if
    $Q(s,a)\leftarrow Q(s,a)+\eta[y-Q(s,a)]$
    $s\leftarrow s'$; $a\leftarrow a'$ if continuing
  end while
end for
```

## Gradients
Tabular update has no actor network. Semi-gradient SARSA replaces the table with a differentiable Q and detaches its target.

## Paper trail
Sutton & Barto, §6.4; Day 7 CliffWalking.

## Recall
**Check:** changing only the bootstrap action from sampled to greedy changes SARSA into the Q-learning target.

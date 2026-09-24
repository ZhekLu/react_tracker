## Idea
**Learn which action pays now.** In a stationary bandit there is no action-dependent future state to plan through. A contextual bandit conditions the immediate-reward decision on context.

## Mechanics
Estimate each action's mean reward. Exploration trades immediate reward for information.

$$
Q_{n+1}(a)=Q_n(a)+\frac{1}{n}(R_n-Q_n(a)).
$$

Here $n$ counts observations of this action; the formula treats $Q_n$ as the estimate before observation $n$. Constant step sizes instead track nonstationarity.

UCB selects an optimistic confidence score:

$$
A_t=\arg\max_a\left[Q_t(a)+c\sqrt{\frac{\log t}{N_t(a)}}\right].
$$

Try unvisited actions before using the finite-count expression. UCB bonuses quantify uncertainty for exploration; they are not the accidental overestimation that TD3 tries to suppress.

## Algorithm
**Procedure · incremental epsilon-greedy / UCB bandit**

```algorithm
Initialize estimates $Q(a)$ and counts $N(a)=0$ for every action
for $t=1,2,\ldots$ do
  Select $a$ with epsilon-greedy or the UCB rule [@exploration] :: UCB first tries unvisited actions; its finite-count formula comes afterwards.
  Observe reward $r$ for the selected action only
  $N(a)\leftarrow N(a)+1$
  $Q(a)\leftarrow Q(a)+(r-Q(a))/N(a)$
end for
```

This is the stationary sample-average version. A constant step size tracks nonstationarity instead. Contextual bandits condition decisions on context; log behavior propensities for later IS-based evaluation.

## Gradients
Tabular sample averages require no neural gradient. A gradient-bandit preference policy is a different bandit algorithm; it was explicitly skipped in your Day 2 plan.

## Paper trail
Sutton & Barto, Chapter 2; Day 2 epsilon-greedy, UCB, and contextual-bandit experiment.

## Recall
**Check:** you observe the chosen action’s reward, not the rewards of every action you could have chosen. Missing support already matters before sequential RL.

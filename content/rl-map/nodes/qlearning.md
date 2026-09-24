## Idea
**Learn a greedy target while behaving exploratorily.** Q-learning bootstraps from the best estimated next action, even if behavior will take another action.

## Mechanics

$$
y=r+\gamma(1-d)\max_{a'}Q(s',a'),\qquad Q(s,a)\leftarrow Q(s,a)+\eta[y-Q(s,a)].
$$

Off-policy means target and behavior policies can differ. It does not mean no new interaction. The max is practical for a small discrete action set.

## Algorithm
**Algorithm · tabular Q-learning**

```algorithm
Initialize $Q$ and exploratory behavior (e.g. epsilon-greedy)
for each observed transition $(s,a,r,s',d)$ do
  $y\leftarrow r+\gamma(1-d)\max_{a'}Q(s',a')$ [@bootstrap] :: The greedy target can differ from the behavior policy.
  $Q(s,a)\leftarrow Q(s,a)+\eta[y-Q(s,a)]$
  Continue interaction; reset the environment at episode end
end for
```

Tabular convergence requires sufficient visits, suitable diminishing step sizes, and standard finite discounted/episodic assumptions.

## Gradients
Tabular Q-learning updates a table entry. Approximate Q-learning uses a semi-gradient through Q(s,a), detaching the target. DQN is a deep practical extension.

## Paper trail
Sutton & Barto, §6.5; Days 7–10. Your cliff example compares exploratory SARSA targets against greedy Q-learning targets.

## Recall
**Check:** Q-learning can learn values for greedy behavior while its data were collected by an exploratory policy.

## Idea
**Separate action selection from evaluation to reduce maximization bias.** A maximum preferentially selects positive estimation errors.

## Mechanics
When updating table A:

$$
a^*=\arg\max_a Q^A(s',a),\quad y=r+\gamma(1-d)Q^B(s',a^*).
$$

Swap A/B roles when updating B. This is not the minimum of the two tables.

## Algorithm
**Algorithm · tabular Double Q-learning**

```algorithm
Initialize $Q^A,Q^B$
for each interaction do
  Choose behavior action using an exploratory policy based on $Q^A+Q^B$ [@exploration]
  Observe $(s,a,r,s',d)$
  Randomly select $(X,Y)=(A,B)$ or $(B,A)$
  $a^*\leftarrow\arg\max_{a'}Q^X(s',a')$ [@double-estimation]
  $y\leftarrow r+\gamma(1-d)Q^Y(s',a^*)$ [@double-estimation] :: The other table evaluates the action selected by the updated table.
  $Q^X(s,a)\leftarrow Q^X(s,a)+\eta[y-Q^X(s,a)]$
end for
```

No minimum appears here. That is an additional choice in TD3’s clipped double-Q construction.

## Gradients
No neural gradient in the tabular version. Selection/evaluation separation is the key design; independence of estimators is an idealization that can weaken with shared data.

## Paper trail
Sutton & Barto, §6.7; van Hasselt (2010). TD3’s clipped double Q modifies this idea, rather than copying tabular Double Q exactly.

## Recall
**Check:** Double Q means cross-evaluation. TD3’s minimum is a further, deliberately pessimistic construction.

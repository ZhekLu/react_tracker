## Idea
**DQN with different networks for selecting and evaluating the next action.** Same replay and target-copy machinery, a different target.

## Mechanics

$$
a^*=\arg\max_{a'}Q_\phi(s',a'),\qquad y=r+\gamma(1-d)Q_{\bar\phi}(s',a^*).
$$

Online Q selects; target Q evaluates. Ordinary DQN uses target Q for both. The target copy is not a second independently trained online critic.

## Algorithm
**Algorithm · Double DQN target substitution**

```algorithm
Initialize online and target Q; replay and collection follow DQN
for each DQN training step do
  Sample replay batch $\mathcal B$ [@replay]
  $a^*\leftarrow\arg\max_{a'}Q_\phi(s',a')$ [@double-estimation] :: Online Q selects.
  $y\leftarrow\operatorname{sg}[r+\gamma(1-d)Q_{\bar\phi}(s',a^*)]$ [@double-estimation] :: Target Q evaluates.
  Minimize DQN regression loss at stored $(s,a)$
  Periodically copy $\bar\phi\leftarrow\phi$ [@targets]
end for
```

The interaction, exploration, representation, and reset loop is inherited from the DQN card. This card isolates the complete target change.

## Gradients
The selected action is treated as fixed in the target. This is still a Q semi-gradient, with no actor network.

## Paper trail
van Hasselt et al., *Deep Reinforcement Learning with Double Q-learning* (2016); your Day 10 mechanism task.

## Recall
**Check:** TD3 has two independently initialized online critics and their target copies. Double DQN has one online Q and its target copy.

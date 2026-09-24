## Idea
**A value is expected future return under a specified policy.** Bellman equations are consistency relations, not by themselves a learning algorithm.

## Mechanics

$$
G_t=R_{t+1}+\gamma G_{t+1},\qquad V^\pi(s)=\mathbb E_\pi[G_t\mid S_t=s].
$$

$$
Q^\pi(s,a)=\mathbb E[R_{t+1}+\gamma V^\pi(S_{t+1})\mid S_t=s,A_t=a].
$$

$$
V^\pi(s)=\sum_a\pi(a\mid s)Q^\pi(s,a).
$$

Expectation backups evaluate a policy. Replacing the next-action expectation by a maximum yields an optimality backup. A terminal state's continuation value is zero.

## Algorithm
Define states, actions, transitions, rewards, terminal conditions, and discount. Decide whether the goal is prediction (evaluate a fixed policy) or control (improve it). Then choose a model-based or sample-based way to approximate the backup.

## Gradients
No gradient is required to state a Bellman equation. Later algorithms choose parameterizations and particular update rules to enforce it approximately.

## Paper trail
Sutton & Barto, Chapter 3; Day 3 notation ledger. Our transition shorthand r is the book’s next reward R_(t+1), not a different reward definition.

## Recall
**Check:** an accurate value of a bad policy is not an optimal value. Evaluation and improvement are different jobs.

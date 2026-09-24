## Idea
**Share parameters across states instead of storing independent table entries.** Generalization makes large problems tractable and also lets one update change predictions elsewhere.

## Mechanics

$$
\phi\leftarrow\phi+\eta\,[y-Q_\phi(s,a)]\nabla_\phi Q_\phi(s,a).
$$

The deadly triad is **function approximation + bootstrapping + off-policy learning**. Their combination can diverge; it is not a statement that every such algorithm always diverges.

## Algorithm
Choose features or a neural approximator, construct sampled targets, and perform semi-gradient updates. Monitor values and evaluation behavior as well as minibatch loss. On-policy and off-policy guarantees depend on the approximation and update assumptions.

## Gradients
The semi-gradient holds y fixed even if learned parameters also contribute to y. Small regression error on visited samples does not guarantee correct extrapolation or action derivatives at unvisited points.

## Paper trail
Sutton & Barto, Chapters 9–11; Day 9 Baird counterexample and your deadly-triad mechanism table.

## Recall
**Check:** replay/targets can stabilize deep learning in practice without restoring all tabular convergence guarantees.

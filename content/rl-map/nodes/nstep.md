## Idea
**Choose how long to wait before bootstrapping.** Longer sampled returns reduce immediate dependence on an imperfect value estimate but usually increase sampling variance.

## Mechanics

$$
G_t^{(n)}=\sum_{j=0}^{n-1}\gamma^j r_{t+j}+\gamma^n V(s_{t+n}).
$$

Truncate at true termination and omit the terminal bootstrap. At n=1 this is TD(0); when the horizon reaches episode end it becomes the MC return. Off-policy multistep targets need attention to intermediate behavior actions.

## Algorithm
**Procedure · n-step TD prediction, episodic form**

```algorithm
Initialize $V$ and a rolling transition buffer
for each episode do
  Set $T\leftarrow\infty$ until termination time is known
  Collect transitions under the evaluated policy; record $T$ when the episode terminates
  whenever $n$ rewards for an earlier time $t$ are available (or episode ends) do
    $h\leftarrow\min(n,T-t)$ where $T$ is episode termination time
    $G\leftarrow\sum_{j=0}^{h-1}\gamma^j r_{t+j}$
    if $t+h<T$ then
      $G\leftarrow G+\gamma^h V(s_{t+h})$ [@bootstrap]
    end if
    $V(s_t)\leftarrow V(s_t)+\eta[G-V(s_t)]$
  end whenever
  Flush remaining pending updates after termination
end for
```

At a nonterminal collection cutoff, bootstrap instead of treating it as true termination. Off-policy multistep learning requires accounting for intermediate behavior actions.

## Gradients
For approximate prediction, detach the target and differentiate the earlier value prediction. This is a target-estimation choice, independent of whether a later actor uses a score or pathwise gradient.

## Paper trail
Sutton & Barto, Chapter 7; Day 8 random-walk experiment.

## Recall
**Check:** increasing n is neither universally better nor equivalent to collecting a larger minibatch.

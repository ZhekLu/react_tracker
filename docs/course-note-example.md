# Day 11 — policy gradients, from memory

**Purpose:** explain the update in my own words, then ask the tutor to check the reasoning.

## 1. My explanation

A policy $\pi_\theta(a\mid s)$ assigns a probability to each action. We want to increase the probability of actions with a positive estimated advantage, while keeping the update stable.

==The gradient changes the policy parameters $\theta$, not the observed rewards.==

^^A baseline can reduce variance without changing the expected gradient.^^

I initially wrote ~~“every reward is an advantage”~~. The distinction is **important**: an advantage compares an action with a reference value. My *working intuition* is that it measures ++better or worse than expected++.

## 2. The equation I can derive

Click the formula to select it. Try the yellow or blue highlighter. Double-click it to edit its LaTeX, or choose **To inline**.

<!-- note-highlight:yellow -->

$$
\boxed{\hat g = \frac{1}{N}\sum_{t=1}^{N}\nabla_\theta\log\pi_\theta(a_t\mid s_t)\,\hat A_t}
$$

The boxed inline version is $\boxed{A(s,a)=Q(s,a)-V(s)}$. Highlight the entire sentence, including the formula, and check that the spaces remain.

### A derivation across several lines

$$
\begin{aligned}
G_t &= \sum_{k=0}^{T-t-1}\gamma^k r_{t+k} \\
\hat A_t &= G_t - V_\phi(s_t)
\end{aligned}
$$

### Matrices, cases, sets and prose inside mathematics

$$
M=\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix},\qquad
f(x)=\begin{cases}x^2 & x\ge 0 \\ 0 & x<0\end{cases},\qquad
x\in\mathbb{R},\quad \underbrace{\gamma}_{\text{discount factor}}
$$

## 3. A small worked example

1. Collect a trajectory using the current policy.
2. Compute the return and the reference value.
   - Keep both estimates fixed while computing this policy update.
   - Check their signs on a tiny example.
3. Average the sample gradients.

| Quantity | Meaning | Example |
| --- | --- | --- |
| $G_t$ | Observed return | $5$ |
| $V_\phi(s_t)$ | Reference value | $3$ |
| $\hat A_t$ | Difference | $2$ |

> **Sanity check:** a positive advantage should increase the probability of the sampled action under a sufficiently small update.
>
> The reference value is a comparison, not another reward.

## 4. Code and literal text

Inline code stays literal: `loss = -(log_prob * advantage).mean()`. Select just `advantage` and highlight it.

Click inside this code box, then use the highlighter. The whole box receives a colour; its code remains unchanged.

```python
# Sketch only: check shapes and gradient flow in the real implementation.
advantage = (returns - values).detach()
loss = -(log_probs * advantage).mean()
loss.backward()
```

Code can also show Markdown literally:

````markdown
## This is a heading in source

Use $x^2$ for an inline formula.

```python
print("A nested code fence stays intact.")
```
````

## 5. Questions for the tutor

!!Why does an action-independent baseline leave the expected gradient unchanged??!!

%%todo! Reproduce the baseline cancellation on paper.%%

In a real task note, save the note and use the task's **Copy** and **Insert review** controls. This playground only stores practice content in this browser.

## 6. My review checklist

- [x] Explain the symbols without looking them up.
- [ ] Derive the baseline cancellation from memory.
- [ ] Check the sign using a numerical example.
  - [ ] Compare a positive and a negative advantage.
- [ ] Paste the tutor review and resolve the remaining questions.

---

## Reference and next attempt

[KaTeX supported mathematics](https://katex.org/docs/supported.html) lists the math commands the renderer understands.

Keep an ordinary paragraph here for the next closed-book attempt. A blank line starts another paragraph. Use **Shift+Enter** for a line break inside the current paragraph.

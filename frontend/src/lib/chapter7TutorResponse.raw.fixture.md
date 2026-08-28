Yes — all three are worth slowing down for. And Q-021 exposes a distinction that I think will remove a lot of the unease: you are currently mixing up **the mathematical value \(v_\pi\)**, **a sampled return \(G_t\)**, and **our current estimate \(V(s)\)**.

### Q-021 follow-up — “aren’t targets of different lengths on different scales?”

First, the definition is not quite

$$
v(s)=R_{t+1}+\gamma G_{t+1}.
$$

The sampled return is

$$
\boxed{G_t=R_{t+1}+\gamma G_{t+1}}
$$

whereas the true state value is the **expected** return:

$$
\boxed{
v_\pi(s)
=
\mathbb E_\pi[G_t\mid S_t=s].
}
$$

Therefore,

$$
v_\pi(s)
=
\mathbb E_\pi[
R_{t+1}+\gamma G_{t+1}
\mid S_t=s
].
$$

Using the Markov property,

$$
\boxed{
v_\pi(s)
=
\mathbb E_\pi[
R_{t+1}+\gamma v_\pi(S_{t+1})
\mid S_t=s
].
}
$$

So there are three separate things:

$$
\underbrace{v_\pi(s)}_{\text{true quantity we want}}
\qquad
\underbrace{V(s)}_{\text{our current estimate}}
\qquad
\underbrace{G}_{\text{sample target used to improve }V}.
$$

Chapter 7 is explicitly doing **prediction for a fixed policy \(\pi\)**, so another important correction: here we are estimating

$$
\boxed{v_\pi,\text{ not }v_*}.
$$

There is no “optimal value” involved yet. 

Now to your actual worry.

Suppose \(T=10,n=3\). Near the end we had:

$$
S_7:\quad
G_7=R_8+\gamma R_9+\gamma^2R_{10}
$$

$$
S_8:\quad
G_8=R_9+\gamma R_{10}
$$

$$
S_9:\quad
G_9=R_{10}.
$$

It looks as if these targets have different lengths, so maybe they are “different scales.”

But they are targets for **different states**.

The value of \(S_7\) means:

> How much reward do I expect **from time 7 onward**?

The value of \(S_9\) means:

> How much reward do I expect **from time 9 onward**?

There are simply fewer future rewards left when you're at \(S_9\).

They are supposed to differ.

The book defines the full return from each time \(t\) this way and says that if the \(n\)-step horizon reaches termination, \(G_{t:t+n}\) becomes exactly that state's ordinary complete return \(G_t\). 

Here is a deliberately extreme example:

$$
S_0\xrightarrow{+10}S_1\xrightarrow{+1}\text{terminal}
$$

with

$$
\gamma=0.9.
$$

Then:

$$
v(S_1)=1
$$

but:

$$
v(S_0)=10+0.9(1)=10.9.
$$

So yes:

$$
\boxed{
\text{an earlier/intermediate state can have a much larger value than a state adjacent to termination.}
}
$$

That is completely legitimate.

State value is **not “how close am I to winning?”**

It is:

$$
\boxed{\text{expected discounted future reward from here}.}
$$

If there is a delicious \(+10\) reward earlier in the path, the earlier state should indeed be worth more.

Conversely, consider the classic case where **all intermediate rewards are zero** and the only reward is \(+1\) at termination:

$$
S_0\xrightarrow{0}S_1\xrightarrow{0}S_2\xrightarrow{+1}T.
$$

For \(\gamma=.9\),

$$
v(S_2)=1,
$$

$$
v(S_1)=.9,
$$

$$
v(S_0)=.9^2=.81.
$$

Now states nearer the reward are worth more because they suffer less discounting.

And if

$$
\gamma=1,
$$

then in this deterministic trajectory:

$$
v(S_0)=v(S_1)=v(S_2)=1.
$$

So there is no general monotonicity rule like “later states must have larger values.” It depends on the reward structure, transition probabilities, and discounting.

Now the remaining subtlety:

> But don't we update the **same state** multiple times, sometimes with different target lengths?

Yes — across different visits/episodes.

But those targets are all trying to estimate the **same underlying \(v_\pi(s)\)**.

For example, a one-step target is

$$
R_{t+1}+\gamma V(S_{t+1}),
$$

a 3-step target is

$$
R_{t+1}+\gamma R_{t+2}
+\gamma^2R_{t+3}
+\gamma^3V(S_{t+3}),
$$

and a complete return is

$$
G_t.
$$

They are different estimators of the same quantity.

They have different bias/variance properties, but they are not measured on incompatible scales.

That is exactly why Sutton & Barto can write the \(n\)-step target as an approximation to the full return and prove the error-reduction property. 

So the correction to your mental picture is:

$$
\boxed{
\text{different target horizon}
\neq
\text{different definition of state value}.
}
$$

It only means:

$$
\boxed{
\text{different way of estimating the same }v_\pi(s).
}
$$

And the short targets during the terminal cleanup are not “less informative approximations”: once they reach termination, they are the **exact sampled future return from that state**.

---

## Q-022 follow-up — yes, let's do the \(0\to-1\) change completely

You caught something important:

> “They did not mention initialization, only reward. No?”

The **exercise sentence itself** only asks about the changed left outcome, but the paragraph immediately before it explicitly says:

> the 19-state version has a \(-1\) outcome on the left **and all values initialized to 0**. 

The initialization is actually essential to the elegant answer.

Let's separate the two modifications:

1. 5 states \(\rightarrow\) 19 states.
2. left terminal reward \(0\rightarrow-1\), with initialization \(0.5\rightarrow0\).

The first change affects useful temporal horizon.

The second change is almost purely a **change of coordinates**.

### Original reward convention

Suppose:

$$
R_{\text{left}}=0,
\qquad
R_{\text{right}}=1.
$$

The task is undiscounted:

$$
\gamma=1.
$$

Let

$$
p(s)
=
P_\pi(\text{eventually terminate right}\mid S_0=s).
$$

Because all intermediate rewards are zero, the total return can only be:

$$
G=
\begin{cases}
1 & \text{if right terminal}\\
0 & \text{if left terminal}.
\end{cases}
$$

Therefore:

$$
v(s)
=
E[G\mid s]
$$

$$
=
1\cdot p(s)+0\cdot(1-p(s))
$$

so:

$$
\boxed{v(s)=p(s).}
$$

That is why in the old 5-state walk:

$$
v(A)=\frac16,\quad
v(B)=\frac26,\quad
\dots,\quad
v(E)=\frac56.
$$

### New reward convention

Now change the terminal rewards to:

$$
R'_{\text{left}}=-1,
\qquad
R'_{\text{right}}=+1.
$$

The return becomes:

$$
G'=
\begin{cases}
+1 & \text{right}\\
-1 & \text{left}.
\end{cases}
$$

Therefore:

$$
v'(s)
=
(+1)p(s)
+
(-1)(1-p(s)).
$$

Expand:

$$
v'(s)=p(s)-1+p(s)
$$

$$
\boxed{
v'(s)=2p(s)-1.
}
$$

But old:

$$
v(s)=p(s).
$$

Therefore:

$$
\boxed{
v'(s)=2v(s)-1.
}
$$

That is the central result.

So the new problem is essentially the old value function stretched by 2 and shifted downward by 1.

For example:

$$
v=.1\rightarrow v'=-.8
$$

$$
v=.5\rightarrow v'=0
$$

$$
v=.9\rightarrow v'=.8.
$$

For the **19-state** random walk, if states are indexed

$$
i=1,\ldots,19
$$

between two absorbing boundaries \(0\) and \(20\),

$$
p_i=\frac{i}{20}.
$$

Therefore:

$$
v'_i
=
2\frac{i}{20}-1
$$

$$
=
\frac{i}{10}-1.
$$

So the true values are:

$$
\boxed{
-.9,-.8,\ldots,-.1,0,.1,\ldots,.8,.9.
}
$$

Very clean and symmetric around zero.

### Now why initialization matters

The old experiment initialized every nonterminal value to

$$
V_0(s)=0.5.
$$

Apply the exact same transformation:

$$
V'_0(s)
=
2V_0(s)-1.
$$

Then:

$$
V'_0(s)
=
2(.5)-1=0.
$$

And that is exactly what the new 19-state experiment uses:

$$
\boxed{V'_0(s)=0.}
$$

So not only the true values but also the **initial estimates** have been transformed consistently.

Now let's prove that the entire learning dynamics are preserved.

Assume at some point:

$$
V'(s)=2V(s)-1.
$$

For the corresponding target, because \(\gamma=1\), zero intermediate rewards, and the terminal rewards were transformed the same way:

$$
\boxed{G'=2G-1.}
$$

Old update:

$$
V_{\text{new}}
=
V+\alpha(G-V).
$$

New update:

$$
V'_{\text{new}}
=
V'+\alpha(G'-V').
$$

Substitute:

$$
=
(2V-1)
+
\alpha[(2G-1)-(2V-1)].
$$

Inside brackets:

$$
(2G-1)-(2V-1)=2(G-V).
$$

Thus:

$$
V'_{\text{new}}
=
2V-1+2\alpha(G-V)
$$

$$
=
2[V+\alpha(G-V)]-1.
$$

So:

$$
\boxed{
V'_{\text{new}}
=
2V_{\text{new}}-1.
}
$$

This relation remains true after every update.

The entire learning process is the same trajectory in value-space, just recentered and rescaled.

Even the errors transform simply:

$$
V'-v'
=
(2V-1)-(2v-1)
$$

$$
=
2(V-v).
$$

Thus:

$$
(V'-v')^2
=
4(V-v)^2.
$$

Hence RMS error:

$$
\boxed{
\mathrm{RMS}'=2\,\mathrm{RMS}.
}
$$

Every method's error simply doubles.

Therefore which \(n\) performs best is unchanged:

$$
\boxed{
\arg\min_n\mathrm{RMS}'
=
\arg\min_n\mathrm{RMS}.
}
$$

So the reward change \(0\rightarrow-1\), **together with the corresponding initialization change \(0.5\rightarrow0\)**, should not itself change the best \(n\).

That's the mathematical answer Exercise 7.3 is steering toward.

Important caveat: if they had changed

$$
0\rightarrow-1
$$

but kept initialization at \(0.5\), this exact equivalence would break. Especially because Figure 7.2 measures only the first ten episodes, different initialization could affect the empirical best \(n\).

So initialization is absolutely relevant.

---

## Q-025 follow-up — “why not always add \((1-\rho_k)V(S_k)\)?”

Excellent catch. And I need to refine something from my previous answer because I made §7.3 sound slightly worse than it actually is.

The key distinction is:

### §7.3 already guarantees \(\rho=0\Rightarrow\) no update

The simple off-policy \(n\)-step update is:

$$
V(S_t)
\leftarrow
V(S_t)
+
\alpha
\rho_{t:t+n-1}
[
G_{t:t+n}-V(S_t)
].
$$

If

$$
\rho_{t:t+n-1}=0,
$$

then:

$$
\Delta V=0.
$$

So §7.3 does **not** suffer from “\(\rho=0\) pushes \(V\) toward zero.”

That problem only appears if we decide to construct a **new recursively importance-weighted target** and naively write:

$$
G_{t:h}^{\text{naive}}
=
\rho_t
(R_{t+1}+\gamma G_{t+1:h}).
$$

Then if

$$
\rho_t=0,
$$

the target itself becomes:

$$
G=0.
$$

If we now use the ordinary update

$$
V\leftarrow V+\alpha(G-V),
$$

we incorrectly get:

$$
V\leftarrow V-\alpha V.
$$

Section 7.4's control variate fixes this:

$$
G_{t:h}
=
\rho_t(R_{t+1}+\gamma G_{t+1:h})
+
(1-\rho_t)V(S_t).
$$

The book explains precisely this motivation. 

But now your question becomes even better:

> If that term is good, why isn't it written in §7.3 too?

Because in §7.3 it is actually **implicitly there algebraically**.

Consider a simple update:

$$
V'
=
V+\alpha\rho(Y-V).
$$

Rewrite the error:

$$
\rho(Y-V)
=
\rho Y-\rho V.
$$

Now add and subtract \(V\):

$$
=
[\rho Y+(1-\rho)V]-V.
$$

Therefore:

$$
\boxed{
V'
=
V
+
\alpha
\left(
[
\rho Y+(1-\rho)V
]-V
\right).
}
$$

So these two views are exactly equivalent:

$$
\boxed{
\alpha\rho(Y-V)
}
$$

and

$$
\boxed{
\alpha[
\underbrace{\rho Y+(1-\rho)V}_{\text{modified target}}
-V
].
}
$$

In other words, the §7.3 update already behaves **as though** you had formed a target containing:

$$
(1-\rho)V.
$$

It just leaves \(\rho\) outside the TD error instead.

So the real novelty of §7.4 is **not simply adding the \((1-\rho)V\) term**.

The real novelty is:

$$
\boxed{\textbf{doing this per decision recursively.}}
$$

That's why the section is called:

> Per-decision Methods with Control Variates.

### Let's see exactly why that matters

Take a 2-step state-value return for simplicity.

The ordinary §7.3 method uses:

$$
\rho_t\rho_{t+1}
$$

for the whole update:

$$
\Delta V_t
=
\alpha
\rho_t\rho_{t+1}
[
R_{t+1}
+
\gamma R_{t+2}
+
\gamma^2V(S_{t+2})
-
V(S_t)
].
$$

Notice something statistically ugly.

The first reward:

$$
R_{t+1}
$$

occurs immediately after \(A_t\).

Yet it gets multiplied by:

$$
\rho_{t+1}.
$$

But \(A_{t+1}\) happens **after \(R_{t+1}\)**.

It cannot possibly influence the distribution of \(R_{t+1}\).

Why are we multiplying \(R_{t+1}\) by the random variable \(\rho_{t+1}\)?

We don't need to.

Because:

$$
E_b[\rho_{t+1}\mid S_{t+1}]=1,
$$

it doesn't change the expectation, but it adds variance.

This is the motivation behind per-decision IS in §5.9: only use importance ratios up to the point necessary for the particular reward. 

Now watch what Eq. 7.13 produces.

Define:

$$
G_{t+1}
=
\rho_{t+1}
[
R_{t+2}+\gamma V(S_{t+2})
]
+
(1-\rho_{t+1})V(S_{t+1}).
$$

Then:

$$
G_t
=
\rho_t
[
R_{t+1}+\gamma G_{t+1}
]
+
(1-\rho_t)V(S_t).
$$

Subtract \(V(S_t)\):

$$
G_t-V(S_t)
=
\rho_t
[
R_{t+1}+\gamma G_{t+1}-V(S_t)
].
$$

Now plug in \(G_{t+1}\).

After rearranging:

$$
\boxed{
G_t-V(S_t)
=
\rho_t\delta_t
+
\gamma\rho_t\rho_{t+1}\delta_{t+1}
}
$$

where:

$$
\delta_t
=
R_{t+1}
+\gamma V(S_{t+1})
-
V(S_t),
$$

$$
\delta_{t+1}
=
R_{t+2}
+\gamma V(S_{t+2})
-
V(S_{t+1}).
$$

This formula is beautiful.

The first TD error gets:

$$
\boxed{\rho_t}
$$

only.

The second TD error gets:

$$
\boxed{\rho_t\rho_{t+1}}.
$$

In general:

$$
\boxed{
G_{t:t+n}-V(S_t)
=
\rho_t\delta_t
+
\gamma\rho_t\rho_{t+1}\delta_{t+1}
+
\gamma^2\rho_t\rho_{t+1}\rho_{t+2}\delta_{t+2}
+\cdots
}
$$

when the value estimates are held fixed.

This is the actual gain.

Compare:

**Simple §7.3**

$$
\rho_t\rho_{t+1}\rho_{t+2}\cdots
\times
\text{everything}.
$$

**Per-decision §7.4**

$$
\rho_t\delta_t
+
\gamma\rho_t\rho_{t+1}\delta_{t+1}
+
\gamma^2\rho_t\rho_{t+1}\rho_{t+2}\delta_{t+2}
+\cdots.
$$

Earlier information is not polluted by random importance ratios from actions that happened later.

That is why variance can be much lower. The book explicitly introduces §7.4 because the simple multi-step off-policy methods are conceptually clear but statistically inefficient. 

One final important detail:

$$
(1-\rho_t)V(S_t)
$$

is **not** a convex mixing weight.

Unlike \(\lambda\),

$$
\rho_t
$$

can be greater than 1.

For example:

$$
\rho_t=3
$$

gives:

$$
1-\rho_t=-2.
$$

So don't interpret Eq. 7.13 as:

> “80% sample + 20% value estimate.”

It is a **control-variate algebraic correction**, not probabilistic interpolation.

The shortest useful mental model for §7.4 is therefore:

$$
\boxed{
\text{baseline }V
+
\text{importance-weighted residual}
}
$$

instead of:

$$
\boxed{
\text{importance-weight the whole raw target}.
}
$$

And this particular structural idea — **baseline/model prediction + weighted residual correction** — is one I want you to remember very well, because it will reappear later when we get to doubly robust OPE.
